# DATABASE_SCHEMA — PostgreSQL (Supabase)

| Item | Value |
|---|---|
| Milestone | M0 (design). Implemented in M2. |
| Status | M0 final draft. All owner decisions applied (PRD §11), including D1–D4. Owner-protection rules O1–O4 (PRD §12.2) marked where used. |
| Last updated | 2026-11-11 |

Conventions:
- Primary keys `uuid default gen_random_uuid()` unless noted.
- Money is `bigint` **paise**, suffix `_paise`.
- Business tables have `created_at timestamptz not null default now()`, `created_by uuid`, `updated_at`, `updated_by` (FK → `user_profiles`).
- Text is trimmed by the RPCs, and empty strings are stored as NULL.
- Extensions: `pgcrypto`, `pg_trgm`, `citext`.
- Time zone for business dates: `Asia/Kolkata`. `today_ist()` = `(now() at time zone 'Asia/Kolkata')::date`.

---

## 1. Enum types
```sql
create type user_role       as enum ('owner','manager');   -- no operational difference (Q10); used only for Owner-account protection (O1–O3)
create type co_category     as enum ('agent','partner','own','direct');   -- exactly four
create type partner_type    as enum ('agent','partner');
create type pricing_method  as enum ('per_person_per_night','per_person_per_stay');  -- Q1
create type booking_status  as enum ('confirmed','checked_in','checked_out','cancelled','no_show');
create type payment_method  as enum ('cash','upi','card','cheque','other');
create type approval_status as enum ('waiting','approved','rejected','reversed');   -- payments and refunds
create type plan_kind       as enum ('booking','cancellation');
create type adjustment_source as enum ('cancellation','no_show','amount_change','plan_change','charge_change','move_overdue');  -- D2
create type pdf_job_status  as enum ('pending','running','done','failed');
```
Lists that may grow are lookup tables (stay types, payment providers).

---

## 2. Tables

### 2.1 `user_profiles`
| Column | Type | Rules |
|---|---|---|
| id | uuid PK | FK → `auth.users(id)` |
| full_name | text not null | shown everywhere in the app |
| email | citext unique not null | copy of the login email, for display and search |
| phone | text | |
| role | user_role not null default 'manager' | no operational difference; used only for Owner-account protection (O1–O3) |
| is_active | boolean not null default true | inactive users are blocked by RLS and banned in Auth |
| must_change_password | boolean not null default true | set on create and on reset |
| disabled_at / disabled_by | timestamptz / uuid | |
| created_at / created_by / updated_at / updated_by | | |

Rules enforced by the trigger `user_profiles_guard` (BEFORE UPDATE) plus the profile RPCs:
1. `disabled_by <> id`: a user cannot disable themselves (Q10).
2. **At least one active Owner:** after any change, `count(*) where role='owner' and is_active` must be ≥ 1. Otherwise `LAST_OWNER_PROTECTED` is raised. This is checked under `lock table user_profiles in share row exclusive mode` inside the RPC, so two concurrent changes cannot both remove an Owner.
3. **Protected targets (O1):** if the target row has `role='owner'` (before the change), then disabling it, changing its email or role, or a password-reset log entry requires that the actor's profile is an active Owner and actor ≠ target.
4. **Owner role grants (O2):** setting `role='owner'` (on insert or update) requires the actor to be an active Owner.
5. The service-role recovery path (`recover_owner_account`) bypasses rules 3–4 only. It never bypasses rule 2, and it always writes an audit entry.

The first Owner is created by `scripts/create-first-user.ts` (secret key). The script **refuses to run if any `user_profiles` row exists**, so it can only ever create the very first account (O5). After that, every Owner is created by an existing Owner (O2, O6).

**One-Owner operation (O5):** rule 2 is evaluated on UPDATE only. The initial insert is the one moment with zero Owners and is allowed only when the table is empty. With one active Owner, disabling or demoting that Owner is always refused (`LAST_OWNER_PROTECTED`), and rules 3–4 mean no other user can act on it. No placeholder or test Owner is ever stored in the database; tests create their users inside transactions that are rolled back.

### 2.2 `resorts`
| Column | Type | Rules |
|---|---|---|
| id | uuid PK | |
| code | citext unique not null | `CHECK (code ~ '^[A-Z0-9]{2,10}$')`. A trigger blocks changes once the resort has a booking (Q4). |
| name | text not null | unique case-insensitive |
| location | text | |
| contact_number | text | |
| logo_path | text | path in `resort-logos` |
| is_active | boolean not null default true | |
| audit columns | | |

### 2.3 `guests`
| Column | Type | Rules |
|---|---|---|
| id | uuid PK | |
| full_name | text not null | |
| mobile | text not null | as entered |
| mobile_normalized | text not null | digits only, leading +91/0 removed; set by trigger |
| email | text | |
| address | text | |
| notes | text | |
| audit columns | | |

Mobile is not unique; the UI suggests matches.

### 2.4 `agents_partners`
`id uuid PK, type partner_type not null, name text not null, mobile text, notes text, is_active bool default true, audit columns, UNIQUE (type, lower(name))`.

### 2.5 `stay_types` (lookup, Q2)
`id smallint identity PK, name text unique not null, is_active bool default true, sort_order int`.
Seed: **Resort Stay (1), Day Outing (2), Package (3)**. Editable in Settings.

### 2.6 `payment_providers` (lookup)
`id smallint identity PK, method payment_method not null, name text not null, is_active bool, sort_order int, UNIQUE (method, name)`.
Seed: UPI: PhonePe, Google Pay, Paytm, BHIM, Other. Card: Visa, Mastercard, RuPay, Other.

### 2.7 `booking_sequences` (Q4)
| Column | Type | Rules |
|---|---|---|
| resort_id | uuid not null FK → resorts | |
| year | int not null | year of the **booking date**, `CHECK (year between 2000 and 2100)` |
| last_value | int not null default 0 | `CHECK (last_value between 0 and 999999)` |
| PK | (resort_id, year) | |

Used only by internal `next_booking_code(resort_id, booking_date)`. No grants to `authenticated`.

### 2.8 `bookings`
| Column | Type | Rules |
|---|---|---|
| id | uuid PK | |
| booking_code | text unique not null | e.g. `DRI-2026-000001`. Immutable. |
| resort_id | uuid not null FK → resorts | immutable after insert (Q16) |
| booking_year | int not null | = year(booking_date) at insert. Immutable. |
| booking_seq | int not null | `UNIQUE (resort_id, booking_year, booking_seq)` |
| guest_id | uuid not null FK → guests | |
| guest_name / guest_mobile | text not null | snapshot |
| pax | int not null | `CHECK (pax between 1 and 1000)` |
| co_category | co_category not null | |
| agent_partner_id | uuid FK → agents_partners | |
| co_name | text | snapshot of the agent/partner name, or the Own source name |
| stay_type_id | smallint not null FK → stay_types | |
| booking_date | date not null | `CHECK (extract(year from booking_date) = booking_year)` (Q16) |
| check_in_at / check_out_at | timestamptz not null | `CHECK (check_out_at > check_in_at)` |
| nights | int not null | = IST date(check_out) − IST date(check_in), computed by the RPC (D4). `CHECK (nights >= 0)` |
| pricing_method | pricing_method not null | Q1 |
| tariff_per_person_paise | bigint not null | `CHECK (>= 0)` |
| base_amount_paise | bigint not null | per night: pax × tariff × nights; per stay: pax × tariff (RPC computes; CHECK below) |
| extra_charges_paise | bigint not null default 0 | `CHECK (>= 0)` |
| extra_charges_note | text | |
| total_amount_paise | bigint **generated** (base + extra) stored | |
| discount_paise | bigint not null default 0 | `CHECK (discount_paise >= 0 AND discount_paise <= base_amount_paise + extra_charges_paise)` |
| manual_adjustment_paise | bigint not null default 0 | signed (+/−) |
| manual_adjustment_reason | text | `CHECK (manual_adjustment_paise = 0 OR manual_adjustment_reason IS NOT NULL)` |
| final_amount_paise | bigint **generated** (base + extra − discount + manual_adjustment) stored | `CHECK (>= 0)` |
| status | booking_status not null default 'confirmed' | |
| cancellation_date | date | |
| cancellation_charge_paise | bigint | `CHECK (cancellation_charge_paise between 0 and final_amount_paise)` |
| cancellation_reason | text | |
| charge_change_reason | text | required when no-show charge ≠ final (Q7c), or when the charge is corrected later |
| cancelled_at / cancelled_by | timestamptz / uuid | |
| amount_due_paise | bigint **generated**: `case when status in ('cancelled','no_show') then cancellation_charge_paise else final_amount_paise end` stored | Q7a |
| remarks | text | |
| idempotency_key | uuid unique not null | |
| version | int not null default 1 | optimistic locking |
| audit columns | | |

Base amount check (Q1):
```sql
CHECK (base_amount_paise = pax * tariff_per_person_paise *
       case when pricing_method = 'per_person_per_night' then nights else 1 end)
CHECK (pricing_method <> 'per_person_per_night' OR nights >= 1)
```
C/O check (Q3):
```sql
CHECK (
  (co_category in ('agent','partner') and agent_partner_id is not null and co_name is not null)
  or (co_category = 'own'    and agent_partner_id is null and co_name is not null)
  or (co_category = 'direct' and agent_partner_id is null and co_name is null)
)
```
Plus a trigger: `agents_partners.type` must match `co_category`.

Cancellation check (Q7):
```sql
CHECK (
  (status in ('cancelled','no_show') and cancellation_reason is not null
     and cancellation_date is not null and cancellation_charge_paise is not null and cancelled_by is not null)
  or (status not in ('cancelled','no_show') and cancellation_charge_paise is null
     and cancellation_date is null and cancelled_at is null)
)
CHECK (status <> 'no_show' OR cancellation_charge_paise = final_amount_paise OR charge_change_reason IS NOT NULL)
```
Triggers on bookings:
- `booking_code`, `resort_id`, `booking_year`, `booking_seq`, `created_*` are immutable.
- A status change out of cancelled/no_show is blocked.
- Amount columns are immutable while cancelled/no_show (only the charge can change, via RPC with a reason).

### 2.9 `payment_schedules` (Payment Plan)
| Column | Type | Rules |
|---|---|---|
| id | uuid PK | |
| booking_id | uuid not null FK → bookings | |
| kind | plan_kind not null | 'booking' or 'cancellation' |
| line_no | int not null | |
| label | text not null | "Advance", "Balance", "Cancellation charge", … |
| due_date | date not null | |
| amount_paise | bigint not null | `CHECK (> 0)` |
| revision_id | uuid not null FK → payment_plan_revisions | the revision that created this row |
| superseded_at / superseded_by / superseded_revision_id | | NULL = active |
| created_at / created_by | | |

- `UNIQUE (booking_id, line_no) WHERE superseded_at IS NULL`.
- **Past due lock (D2):** trigger `schedule_guard` blocks UPDATE of any row, and blocks setting `superseded_at` on a row whose `due_date < today_ist()`. A past due row stays active for ever.
- **New rows added on a later revision** must have `due_date >= today_ist()`. Only the first revision (booking creation) may contain past dates (PRD FR-SCH-8).
- **Invariant (D2):** Σ active `amount_paise` + Σ `expected_adjustments.amount_paise` = `bookings.amount_due_paise`. It is enforced in every RPC that changes amounts, plan or status, by a deferred constraint trigger at commit, and by a nightly integrity check.
- No advance amount or percentage is ever generated (Q6b). The only system-made row is the default cancellation row (= Amount still to plan, due today), which the user can edit before saving.

### 2.9a `payment_plan_revisions` (append-only, D2)
| Column | Type | Rules |
|---|---|---|
| id | uuid PK | |
| booking_id | uuid not null FK → bookings | |
| revision_no | int not null | `UNIQUE (booking_id, revision_no)`. 1 = at creation. |
| source | text not null | 'created', 'plan_change', 'amount_change', 'cancellation', 'no_show', 'charge_change', 'move_overdue' |
| reason | text | required for revision_no > 1 |
| amount_due_before / amount_due_after | bigint | snapshot |
| locked_total_paise | bigint | Σ past due rows at the time |
| created_at / created_by | | |

It groups each plan change (rows replaced + rows added + adjustment) into one reviewable event shown in booking history.

### 2.9b `expected_adjustments` (append-only, D2)
| Column | Type | Rules |
|---|---|---|
| id | uuid PK | |
| booking_id | uuid not null FK → bookings | |
| resort_id | uuid not null FK → resorts | copied from the booking by trigger |
| revision_id | uuid not null FK → payment_plan_revisions | |
| adjustment_date | date not null | = today_ist() at the time of the change (never backdated) |
| amount_paise | bigint not null | `CHECK (amount_paise <> 0)`, signed. Usually negative. |
| source | adjustment_source not null | |
| reason | text not null | |
| created_at / created_by | | |

When an adjustment is created (inside the plan-change RPC):
- `to_plan = amount_due − Σ past-due active rows − Σ existing adjustments`.
- If `to_plan < 0`, the RPC inserts an adjustment of `to_plan` (negative), and no new rows are allowed.
- **Move overdue:** the user selects an amount M (≤ the unpaid past amount). The RPC inserts an adjustment of −M, and the new rows must add up to `to_plan + M`.
- A positive adjustment arises only from move-overdue reversals (rare). Normally extra money is planned as new rows.

### 2.10 `payments`
| Column | Type | Rules |
|---|---|---|
| id | uuid PK | |
| payment_code | text unique not null | `{booking_code}-P{n}` |
| booking_id | uuid not null FK → bookings | |
| resort_id | uuid not null FK → resorts | copied from the booking by trigger; a mismatch is blocked |
| amount_paise | bigint not null | `CHECK (> 0)` |
| method | payment_method not null | |
| provider_id | smallint FK → payment_providers | the provider must match the method (trigger) |
| provider_other | text | |
| payment_date | date not null | ≤ today_ist (RPC), ≥ 2000-01-01 |
| payment_time | time | |
| reference_number | text | |
| remarks | text | |
| status | approval_status not null default 'waiting' | |
| recorded_by / recorded_at | uuid / timestamptz | entry user and time |
| approved_by / approved_at | | |
| rejected_by / rejected_at / rejection_reason | | `CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL)` |
| reversed_by / reversed_at / reversal_reason | | `CHECK (status <> 'reversed' OR reversal_reason IS NOT NULL)` |
| is_self_approved | boolean generated `(approved_by = recorded_by)` stored | Q8 |
| idempotency_key | uuid unique not null | |
| version | int not null default 1 | |
| updated_at / updated_by | | |

Trigger `approval_guard`:
- amount, method, date and reference can change only while the status is `waiting`;
- the only allowed status transitions are waiting→approved, waiting→rejected and approved→reversed.

**Proof rule (Q9)**, enforced in RPCs `add_payment`, `update_waiting_payment` and `hide_proof`, and checked by a deferred constraint trigger:
- method ∈ {upi, card, cheque} → at least one visible proof row is required;
- cash/other → proof is optional.

### 2.11 `refunds` (Q7, Q7b, Q12)
| Column | Type | Rules |
|---|---|---|
| id | uuid PK | |
| refund_code | text unique not null | `{booking_code}-R{n}` |
| booking_id | uuid not null FK → bookings | |
| resort_id | uuid not null FK → resorts | copied from the booking by trigger |
| amount_paise | bigint not null | `CHECK (> 0)` |
| method / provider_id / provider_other | | same as payments |
| refund_date | date not null | actual refund date, ≤ today_ist |
| refund_time | time | |
| reference_number / remarks | text | |
| reason | text not null | cancellation, overpayment, … |
| status, recorded_*, approved_*, rejected_*, reversed_*, is_self_approved, idempotency_key, version | | identical rules to payments |

- Limit (RPC `add_refund`, which locks the booking row): `amount ≤ A − RA − RW` (approved payments − approved refunds − waiting refunds). A refund larger than Refund due shows a warning.
- The proof rule is the same as for payments (D3).
- `approval_guard` trigger as for payments.

### 2.12 `proofs` (payment and refund files)
| Column | Type | Rules |
|---|---|---|
| id | uuid PK | |
| payment_id | uuid FK → payments | |
| refund_id | uuid FK → refunds | `CHECK (num_nonnulls(payment_id, refund_id) = 1)` |
| storage_path | text unique not null | `payment-proofs/{booking_id}/{uuid}.{ext}` |
| original_file_name | text | |
| mime_type | text not null | jpeg, png, webp, pdf |
| size_bytes | int not null | `CHECK (size_bytes between 1 and 10485760)` |
| sha256 | text not null | duplicate detection |
| uploaded_by / uploaded_at | | |
| hidden_at / hidden_by / hidden_reason | | hide only while the parent is waiting. Never deleted. |

### 2.13 `approval_history` (append-only, payments and refunds)
| Column | Type | Rules |
|---|---|---|
| id | bigint identity PK | |
| payment_id / refund_id | uuid FK | exactly one is set |
| from_status | approval_status | NULL on creation |
| to_status | approval_status not null | |
| reason | text | |
| acted_by | uuid not null | |
| acted_at | timestamptz not null default now() | |
| is_self_action | boolean not null | acted_by = recorded_by |

### 2.14 `booking_pdf_versions` (append-only)
`id uuid PK, booking_id FK, version_no int, UNIQUE (booking_id, version_no), storage_path text unique, content_hash text, trigger_reason text, summary jsonb (printed numbers), size_bytes int, generated_by uuid, generated_at timestamptz`.

### 2.15 `pdf_jobs`
`id bigint identity, booking_id FK, reason text, status pdf_job_status, attempts int default 0, last_error text, created_at, updated_at`. Partial index on pending/failed jobs.

### 2.16 `audit_logs` (append-only)
| Column | Type | Rules |
|---|---|---|
| id | bigint identity PK | |
| occurred_at | timestamptz not null default now() | |
| actor_id | uuid | `auth.uid()`; NULL = system |
| actor_name | text | snapshot |
| action | text not null | insert, update, approve, reject, reverse, cancel, no_show, charge_changed, refund_*, plan_revised, expected_adjustment, manual_adjustment, proof_hidden, user_created, user_updated, role_changed, user_disabled, user_enabled, password_reset, email_changed, owner_recovered, … |
| table_name / record_id | text not null | |
| booking_id / resort_id | uuid | plain columns (not FKs) for filtering |
| target_user_id | uuid | for account actions |
| old_data / new_data | jsonb | passwords never stored |
| changed_fields | text[] | |
| reason | text | |

### 2.17 `system_status`
`key text PK, value jsonb, updated_at`. Holds the last backup and integrity-check results.

---

## 3. Views (read-only, `security_invoker = true`)

### 3.1 `booking_financials` (the only source of booking money figures)
```sql
-- per booking
F   = final_amount_paise            -- original/final booking amount
D   = amount_due_paise              -- F, or cancellation charge if cancelled/no_show (Q7a)
A   = Σ payments.amount where status='approved'
W   = Σ payments.amount where status='waiting'
RJ  = Σ payments.amount where status='rejected'
RV  = Σ payments.amount where status='reversed'
RA  = Σ refunds.amount  where status='approved'
RW  = Σ refunds.amount  where status='waiting'

total_recorded_paise          = A + W
total_collection_paise        = A                       -- Total Collection (Approved) (Q5, Q17)
net_collection_paise          = A - RA                  -- Q7d
net_recorded_paise            = A + W - RA              -- D1: waiting refunds NOT subtracted
pending_paise                 = greatest(D - net_recorded_paise, 0)
verified_remaining_paise      = greatest(D - net_collection_paise, 0)
extra_paise                   = greatest(net_recorded_paise - D, 0)
refund_due_paise              = greatest(net_collection_paise - D, 0)
refund_waiting_paise          = RW                      -- shown on its own line only
refund_still_to_record_paise  = greatest(refund_due_paise - RW, 0)
refundable_limit_paise        = A - RA - RW             -- max new refund (prevents double refund)
```
`RW` appears **only** in `refund_waiting_paise`, `refund_still_to_record_paise` and `refundable_limit_paise` (D1).

### 3.2 `expected_entries` (D2)
A union of everything that is "expected", one row per entry:
```sql
select booking_id, resort_id, due_date  as entry_date, amount_paise, 'plan'       as kind, id from payment_schedules where superseded_at is null
union all
select booking_id, resort_id, adjustment_date,        amount_paise, 'adjustment' as kind, id from expected_adjustments
```
- Every expected-collection report uses this view, so historical rows never disappear and adjustments land on their own dates.
- Σ over all dates per booking = amount_due (invariant).

### 3.3 `booking_overdue(as_of date)` (function)
Per booking: `expected_to_date = Σ expected_entries with entry_date ≤ as_of`, `net_collected_to_date = Σ approved payments with payment_date ≤ as_of − Σ approved refunds with refund_date ≤ as_of`, `overdue = greatest(expected_to_date − net_collected_to_date, 0)`.
For display only, the per-row "covered / outstanding" on the Payment Plan tab allocates net collection oldest-due-first. The booking-level figure is the authoritative one.

### 3.4 Report functions (period figures)
| Function | Rule |
|---|---|
| `report_expected(from, to, resort)` | from `expected_entries`: Originally Expected (kind='plan', due_date in range) + Expected Adjustments (kind='adjustment', adjustment_date in range) = Expected |
| `report_expected_adjustments(...)` | list of adjustments with reason, source, user |
| `report_collection(from, to, resort, group)` | approved payments by payment_date; waiting payments by payment_date (separate); approved refunds by refund_date; net = approved − refunds |
| `report_expected_vs_actual` | Expected, Total Collection (Approved), Waiting, Refunds, Net Collection, Difference = Expected − Total Collection (Approved) |
| `report_payment_methods` | by method/provider |
| `report_bookings(date_field, …)` | booking or check-in date |
| `report_pending(as_of, resort)` | from booking_financials + booking_overdue |
| `report_waiting(…)` | waiting payments and refunds |
| `report_refunds(…)` | by refund_date |
| `report_cancellations(…)` | by cancellation_date |
| `report_adjustments(…)` | bookings with a manual adjustment or charge change |

Historical expected figures never change after a due date has passed (D2). Corrections appear as adjustments on their own date.

---

## 4. Calculations (authoritative summary)

| Value | Formula | Where |
|---|---|---|
| Nights | IST date(check_out) − IST date(check_in) (D4) | RPC |
| Base Amount | per night: PAX × Tariff × Nights · per stay: PAX × Tariff | RPC + CHECK |
| Total Amount | Base + Extra Charges | generated |
| Final Booking Amount | Total − Discount + Manual Adjustment (reason required if ≠ 0) | generated |
| Amount Due | Final, or Cancellation Charge when cancelled/no-show | generated |
| Total Collection (Approved) | A | view |
| Waiting for Approval | W | view |
| Net Collection | A − RA | view |
| Pending Amount | max(D − (A + W − RA), 0) (waiting refunds ignored, D1) | view |
| Verified Remaining | max(D − (A − RA), 0) | view |
| Extra Payment | max((A + W − RA) − D, 0) | view |
| Refund due | max((A − RA) − D, 0) | view |
| Refund still to record | max(Refund due − RW, 0) | view |
| Refund limit | A − RA − RW | view |
| Expected (period) | Σ active plan rows due in period + Σ adjustments dated in period (D2) | report fn |
| Overdue (as of X) | max(expected entries ≤ X − net collected ≤ X, 0) | function |
| Collection (period) | Σ approved payments by payment_date | report fn |
| Refunds (period) | Σ approved refunds by refund_date | report fn |
| Net Collection (period) | Collection − Refunds | report fn |

### Worked examples
1. **Brief example:** per stay, 2 × ₹2,500 = ₹5,000; Final ₹5,000. P1 ₹1,500 UPI waiting, P2 ₹3,500 cash waiting → Total Collection 0, Waiting 5,000, Pending 0, Verified Remaining 5,000. After both are approved: Total Collection 5,000, Pending 0, Verified Remaining 0.
2. **Per night with extras:** 2 × ₹2,500 × 2 nights = ₹10,000, extra ₹500, discount ₹1,000 → Final ₹9,500.
3. **Manual adjustment:** calculated ₹9,500, user sets ₹9,000 with reason "Rounded for regular guest" → adjustment −₹500, Final ₹9,000.
4. **Cancellation with refund (D1):** Final ₹5,000, approved ₹3,000. Cancelled with charge ₹1,000 → D = 1,000, Extra 2,000, Refund due 2,000, Pending 0.
   - Refund ₹2,000 recorded (waiting) → Extra 2,000, Refund due 2,000, Refund waiting 2,000, Refund still to record 0, Net Collection 3,000. Nothing else changes.
   - After approval → Extra 0, Refund due 0, Net Collection 1,000.
5. **Waiting refund does not touch Pending (D1):** Final ₹5,000, approved ₹6,000, refund ₹1,500 waiting → Pending 0. Approved → Pending 500, Verified Remaining 500, Net 4,500.
6. **No-show:** Final ₹5,000, charge pre-filled ₹5,000 (D = 5,000). If the user changes it to ₹2,500, a charge-change reason is required.
7. **Historical expected (D2):** Advance ₹2,000 due 1 Oct, Balance ₹3,000 due 1 Dec; cancelled 10 Nov, charge ₹1,000.
   - Revision 2 supersedes the 1 Dec row. The 1 Oct row stays locked.
   - to_plan = 1,000 − 2,000 = −1,000 → adjustment −1,000 dated 10 Nov.
   - Expected: Oct 2,000 · Nov −1,000 · Dec 0. Total 1,000 = D. ✓
8. **Charge higher than locked rows:** same booking, charge ₹3,000 → to_plan +1,000 → new cancellation row ₹1,000 due ≥ 10 Nov. Oct 2,000 · Nov 1,000. Total 3,000. ✓
9. **Move overdue:** the 1 Oct ₹2,000 is unpaid. On 10 Nov move it to 15 Dec → adjustment −2,000 (10 Nov) + new row 2,000 (15 Dec). Oct 2,000 · Nov −2,000 · Dec 2,000 + 3,000. Total 5,000. ✓ Overdue on 10 Nov = (2,000 − 2,000) − 0 = 0.

---

## 5. RPC functions (SECURITY DEFINER, `set search_path = public, pg_temp`)
Every function first checks `is_active_user()`, validates input, locks the rows it changes, writes audit entries, and queues a PDF job where relevant.

| Function | Purpose |
|---|---|
| `is_active_user()` | used in all RLS policies |
| `next_booking_code(resort_id, booking_date)` | internal, atomic per resort/year |
| `create_booking(payload, plan, idem)` | guest find/create + ID + booking + plan |
| `update_booking(id, expected_version, payload, plan, reason)` | resort/year change refused. Amount change → reason + plan required. |
| `set_payment_schedule(booking_id, expected_version, future_rows, move_overdue_paise, reason)` | new revision: supersede only rows due ≥ today, insert new rows (due ≥ today), create an adjustment if to_plan < 0 or for move-overdue. Invariant checked. Used internally by update_booking / cancel_booking / change_cancellation_charge. |
| `plan_preview(booking_id, new_amount_due)` | read-only: locked total, existing adjustments, to_plan, unpaid past amount (for the UI) |
| `set_booking_status(id, expected_version, 'checked_in'/'checked_out')` | |
| `cancel_booking(id, expected_version, kind ('cancelled'/'no_show'), date, charge, reason, charge_change_reason, plan)` | Q7, Q7a, Q7c |
| `change_cancellation_charge(id, expected_version, charge, reason, plan)` | correction with reason |
| `add_payment(payload, proofs, idem)` → id + warnings | |
| `update_waiting_payment(id, expected_version, payload, reason)` | |
| `add_proofs(parent, files)` / `hide_proof(id, reason)` | proof rule enforced |
| `approve_payment` / `reject_payment` / `reverse_payment` (id, expected_version, reason) | |
| `add_refund(payload, proofs, idem)` → id + warnings | limit check |
| `update_waiting_refund`, `approve_refund`, `reject_refund`, `reverse_refund` | |
| `upsert_resort`, `set_resort_active`, `upsert_agent_partner`, `upsert_guest`, `upsert_stay_type`, `upsert_provider` | master data |
| `profile_create(id, full_name, email, role)`, `profile_update(id, …, reason)`, `profile_set_active(id, active, reason)`, `log_account_action(target, action, reason)` | account management (Q10). Refuses self-disable. Last active Owner protected. Owner targets and Owner-role grants require an Owner actor (O1, O2). |
| `recover_owner_account(target, reason)` | **service role only** (not granted to authenticated). Re-enables an Owner / clears a ban flag, and audits `owner_recovered` (O4). |
| `active_owner_count()` | used by the UI for warnings |
| `register_pdf_version(...)`, `claim_pdf_jobs(n)` | PDF pipeline (`FOR UPDATE SKIP LOCKED`) |
| report functions (§3.3) | |

---

## 6. Indexes
| Table | Index |
|---|---|
| bookings | `(resort_id, booking_date)`, `(resort_id, check_in_at)`, `(check_out_at)`, `(guest_id)`, `(status)`, `(agent_partner_id)`, `(cancellation_date) WHERE status in ('cancelled','no_show')`, trigram `guest_name`, `(guest_mobile)`, unique `booking_code`, unique `(resort_id, booking_year, booking_seq)` |
| guests | `(mobile_normalized)`, trigram `full_name` |
| payments | `(booking_id)`, `(resort_id, payment_date)`, `(status, payment_date)`, `(status) WHERE status='waiting'`, `(reference_number)`, `(recorded_by)` |
| refunds | `(booking_id)`, `(resort_id, refund_date)`, `(status) WHERE status='waiting'` |
| proofs | `(payment_id)`, `(refund_id)`, `(sha256)` |
| payment_schedules | `(booking_id) WHERE superseded_at IS NULL`, `(due_date) WHERE superseded_at IS NULL`, `(revision_id)` |
| payment_plan_revisions | unique `(booking_id, revision_no)` |
| expected_adjustments | `(resort_id, adjustment_date)`, `(booking_id)` |
| user_profiles | `(role) WHERE is_active` |
| approval_history | `(payment_id, acted_at)`, `(refund_id, acted_at)` |
| booking_pdf_versions | `(booking_id, version_no desc)` |
| audit_logs | `(occurred_at desc)`, `(table_name, record_id)`, `(booking_id)`, `(actor_id, occurred_at desc)`, `(target_user_id)` |

---

## 7. Delete and immutability protection
- `REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon, authenticated`. Writes happen only through RPCs.
- A `prevent_delete()` trigger on every business table raises `DELETE_NOT_ALLOWED`, even for the service role.
- `audit_logs`, `approval_history` and `booking_pdf_versions` also block UPDATE.
- Plan rows can never be updated except for setting `superseded_*` once, and never at all when past due (trigger `schedule_guard`, D2).
- `payment_plan_revisions` and `expected_adjustments` block UPDATE and DELETE.
- Codes, resort, booking year and created fields are immutable (triggers).
- Foreign keys use `ON DELETE RESTRICT`. No cascade anywhere.

---

## 8. Database design risks and mitigations
| Risk | Mitigation |
|---|---|
| Booking ID reuse/gaps/races | Counter row per resort+year updated in the same transaction (row lock). Gap-free, never reused. Resorts never block each other. |
| ID inconsistent with resort/year | Resort code locked after the first booking. resort_id/booking_year immutable. CHECK year(booking_date) = booking_year. |
| Plan sum ≠ amount due | Invariant Σ active rows + Σ adjustments = amount_due. Single RPC path + deferred constraint trigger + nightly check. |
| Expected double counting | Only active rows + adjustments count. Superseded rows are immutable history. Σ over all time = amount due. |
| Historical expected changes (D2) | Past due rows locked by trigger. Corrections only as dated, reasoned adjustments. Adjustments never backdated. |
| "Today" differs between server and DB | Lock decision uses `today_ist()` inside the DB transaction only |
| Last Owner removed (incl. by concurrent requests) | Owner count check under a table lock in the profile RPC + trigger |
| Manager takes over an Owner account | O1/O2 rules in RPC + trigger. Password re-entry checked in the Server Action. |
| Cancellation overwrites history | Separate cancellation columns. Original amounts untouched. Generated amount_due. |
| Refund over the limit / race | Booking row locked in add_refund. Limit = A − RA − RW. |
| Proof missing for UPI/Card/Cheque | RPC checks + deferred constraint trigger. The last proof cannot be hidden. |
| Payment/refund resort mismatch | Trigger copies and verifies resort_id |
| Manual adjustment abuse | Reason required (CHECK). Calculated parts stored separately. Report + audit. |
| Time zone at day boundaries | `date` type for business dates. One IST helper. Boundary tests. |
| Self-disable / lockout | `profile_set_active` refuses own id. At least one active Owner. Recovery function (service role only). |
| Large audit table | Time index. No partitioning needed below about 10M rows. |
| RLS bypass via views | `security_invoker` views, tested |
