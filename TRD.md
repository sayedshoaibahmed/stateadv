# TRD — Technical Requirements Document

| Item | Value |
|---|---|
| Milestone | M0 |
| Status | M0 final draft (consistent with PRD §5.11 and DATABASE_SCHEMA §4) |
| Last updated | 2026-11-11 |

---

## 1. Architecture overview
```
 Browser (phone / tablet / laptop)
   │  HTTPS
   ▼
 Next.js app on Vercel (Mumbai region)
   ├─ React Server Components (pages, read data)
   ├─ Server Actions / Route Handlers (all writes, PDF generation, CSV export, user management)
   ├─ Proxy `src/proxy.ts` (Next.js 16 name for middleware; Node.js runtime): session refresh, redirect to /login, force password change
   │
   │  Supabase JS with the user's JWT
   │  (secret key only in src/lib/supabase/admin.ts: Auth admin calls + PDF cron)
   ▼
 Supabase (Mumbai region)
   ├─ Auth (email + password, no public sign-up)
   ├─ PostgreSQL
   │    ├─ Tables with RLS (read only for authenticated)
   │    ├─ RPC functions (SECURITY DEFINER) = the only write path
   │    ├─ Triggers: audit, updated_at, delete blocking, immutability, approval guard
   │    └─ Views: booking_financials, expected_entries; booking_overdue + report functions
   └─ Storage (private buckets): payment-proofs, booking-pdfs, resort-logos
         ▲ direct browser upload with a server-issued signed upload URL

 Off-site backup job (GitHub Actions cron) ──► external object storage (DB dump + all files)
```

### Key design principles
1. **The database is the single source of truth for money.** Every figure comes from `booking_financials` or a report function. The UI, PDFs and CSVs only format numbers.
2. **All writes go through Postgres RPC functions** (one transaction each), called from Server Actions with the user's JWT. No direct table writes are granted.
3. **Append-only history:** approval history, audit logs, PDF versions and superseded plan rows are never changed.
4. **No hard deletes**, enforced by revoked grants plus triggers.
5. **The user's identity flows into the DB.** `auth.uid()` in triggers and RPCs means the "who" in the audit log cannot be faked by app code.

## 2. Technology stack (confirmed, no changes recommended)
| Layer | Choice |
|---|---|
| Framework | Next.js (App Router, current stable at M1), React, TypeScript strict |
| UI | Tailwind CSS, shadcn/ui (Radix), lucide icons |
| Forms | React Hook Form + Zod (schemas shared client/server) |
| Tables | TanStack Table (server pagination) |
| Charts | Recharts |
| Dates | date-fns + its time zone support; react-day-picker (shadcn Calendar) |
| PDF | @react-pdf/renderer (server side; Node.js is the default runtime — with Cache Components enabled, routes must NOT export `runtime`), bundled Noto Sans for ₹ |
| DB/Auth/Storage | Supabase (`@supabase/ssr`, `@supabase/supabase-js`) |
| Migrations | Supabase CLI SQL migrations in git |
| Tests | Vitest (unit), pgTAP via `supabase test db` (DB), Playwright (E2E) |
| Quality | ESLint, Prettier, `tsc --noEmit`, GitHub Actions CI |
| Hosting | Vercel + Supabase Cloud. Plans and budget deferred (Q11). |

No ORM: an ORM would bypass RLS. Generated Supabase types + RPCs are enough.
Local development needs Docker Desktop (`supabase start`). The fallback is a free Supabase cloud "dev" project, decided at the start of M1.

## 3. Money handling
- `bigint` paise in the DB, `_paise` suffix.
- Input parsing from **strings** (`"2,500.50"` → 250050). Never `parseFloat × 100`. More than 2 decimals, negative numbers, exponents and letters are rejected.
- Arithmetic is integer only: PAX × tariff × nights, + extra, − discount, ± adjustment. The SQL result is authoritative. The UI computes the same values in integers for live preview only.
- Display: `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })`, display-only.
- No division or percentages anywhere in version 1 (rupee discounts only, no advance %).

## 4. Dates and time zone
| Field | Type | Meaning |
|---|---|---|
| booking_date | date | Business date of booking. Decides the Booking ID year. |
| check_in_at / check_out_at | timestamptz | entered in IST |
| nights | int | IST date(check_out) − IST date(check_in), computed (PRD D4) |
| payment_date / refund_date | date | actual dates. Backdating allowed, future blocked. |
| due_date | date | payment plan |
| cancellation_date | date | |
| created_at / updated_at | timestamptz | entry / last-change time, automatic |

`APP_TZ = 'Asia/Kolkata'`. "Today" is always calculated in IST on both server and client.

## 5. Core server flows

### 5.1 Create booking — `create_booking(payload, plan, idempotency_key)`
One transaction:
1. If the idempotency key already exists, return the existing booking.
2. Validate: resort active; PAX ≥ 1; check-out > check-in; nights computed, ≥ 1 for the per-night method; C/O rule (Agent/Partner = active list entry of the right type; Own = name; Direct = none); discount ≤ total; manual adjustment requires a reason; Final ≥ 0.
3. Find/create the guest.
4. Booking ID (per resort, per booking-date year):
   ```sql
   insert into booking_sequences(resort_id, year) values ($r, $y) on conflict do nothing;
   update booking_sequences set last_value = last_value + 1
    where resort_id = $r and year = $y returning last_value;
   ```
   The row lock serialises concurrent creators for the same resort and year. The update is rolled back if the booking fails, so numbers are gap-free and never reused. The code is `code || '-' || y || '-' || lpad(n, 6, '0')`.
5. Insert the booking (base amount computed in SQL; total/final/amount_due are generated columns).
6. Insert plan revision 1 and its rows. Σ must equal the Final Amount. Past due dates are allowed only in this first revision. No amounts are auto-generated (Q6b).
7. Audit (trigger) and a `pdf_jobs` row. Commit. Return id + code.

### 5.2 Update booking — `update_booking(id, expected_version, payload, plan, reason)`
- Lock the row. Version mismatch → `STALE_RECORD`.
- Changing `resort_id` or the booking-date **year** is refused (`ID_FIELDS_LOCKED`, Q16). Same-year date change is allowed.
- Cancelled/no-show bookings: amount fields are locked (use `change_cancellation_charge`).
- If any amount input changed: `reason` required, and the plan is revised in the same transaction using the revision rules (§5.2a). Payments and refunds are untouched (Q13).

### 5.2a Plan revision rules (D2), shared by every plan-changing RPC
```
locked   = Σ active rows with due_date < today_ist()      -- never superseded, never edited
adj      = Σ existing expected_adjustments
to_plan  = new_amount_due − locked − adj
if move_overdue M > 0:  M ≤ unpaid past amount;  insert adjustment −M;  to_plan += M
if to_plan < 0:        insert adjustment (to_plan) dated today_ist(), reason, source;  new rows must be empty
else:                  supersede active rows with due_date ≥ today;  insert new rows (due ≥ today) with Σ = to_plan
assert Σ active rows + Σ adjustments = new_amount_due      -- also a deferred constraint trigger at commit
```
- One `payment_plan_revisions` row groups the change (source, reason, before/after amount, locked total).
- "Today" is evaluated once, inside the transaction (`today_ist()`), so there is no client/server clock mismatch.
- The UI calls `plan_preview` to show "Already due (locked) ₹X · Adjustments ₹Y · Amount still to plan ₹Z" before saving.
- Audit with old/new values. PDF job queued.

### 5.3 Cancel / No-show — `cancel_booking(...)`
- Lock the booking. Status must be active.
- Cancelled: the charge must be provided (no default). No-show: the UI pre-fills charge = Final; if the charge ≠ Final, `charge_change_reason` is required (Q7c).
- 0 ≤ charge ≤ Final. Set the cancellation fields. `amount_due` (generated) becomes the charge.
- Cancellation date ≤ today. Revise the plan with §5.2a (source `cancellation`/`no_show`): locked past rows stay; future rows are replaced by the cancellation row(s) for to_plan; or, if to_plan < 0, an automatic negative adjustment dated today with the cancellation reason.
- Audit + PDF job. Original amounts are never modified.
- `change_cancellation_charge` follows the same rules, with a reason always required.

### 5.4 Add payment / refund
1. The server issues signed upload URLs for server-chosen paths. The browser compresses images (canvas, max 2000px, JPEG 0.85, which also removes EXIF) and uploads directly to Storage. This avoids Vercel's ~4.5 MB request body limit.
2. The Server Action verifies each object (exists, size, magic-byte MIME) and computes its SHA-256.
3. RPC `add_payment` / `add_refund`:
   - check the idempotency key;
   - check the proof rule (UPI/Card/Cheque need ≥ 1 file, Q9; refunds the same, D3);
   - for refunds, lock the booking and check amount ≤ A − RA − RW;
   - insert with status `waiting`, add proofs, history (`null → waiting`), audit and a PDF job;
   - return warnings: duplicate reference, duplicate file hash, payment above Amount Due, refund above Refund due.
4. Uploaded files never attached to a record are listed in a weekly maintenance report. They are not auto-deleted.

### 5.5 Approve / reject / reverse (payments and refunds)
`SELECT … FOR UPDATE`, check version and transition (waiting→approved, waiting→rejected (reason), approved→reversed (reason)), update the fields, insert `approval_history` with `is_self_action`, audit, and a PDF job. Self-approval is allowed and flagged (Q8). A concurrent second action gets `ALREADY_DECIDED` with the name of the user who decided it.

### 5.6 PDF generation and versioning
- Trigger events (PRD FR-PDF-1): booking create/edit, plan change, payment/refund add/edit/decision, cancel/no-show/charge change. Each RPC inserts a `pdf_jobs` row in its transaction.
- After commit, the Server Action processes the job (default Node.js runtime): load the booking, `booking_financials`, plan, payments and refunds → render → upload `booking-pdfs/{booking_id}/v{n}.pdf` → `register_pdf_version`.
- **Content hash** = SHA-256 of the canonical JSON of the printed data (excluding the generation time). If it equals the latest version's hash, no new version is created.
- `version_no` = max + 1 under a booking row lock, with a `UNIQUE (booking_id, version_no)` constraint.
- Failure: the job stays pending/failed. A Vercel Cron job (every 10 min, `CRON_SECRET`) retries using `claim_pdf_jobs` (`SKIP LOCKED`). Users can also press "Regenerate PDF". A failed PDF never affects saved data.

### 5.7 User management (Q10)
- Any active user may call the user-management Server Actions. Each action:
  1. checks the session (`getUser()`) and `is_active_user()`;
  2. calls the profile RPC first (`profile_update`, `profile_set_active`, `log_account_action`). The RPC applies all DB rules (self-disable, last Owner, O1/O2) and writes `audit_logs` with the actor, target user and old/new values (never passwords);
  3. then calls the Supabase Auth admin API (service-role, server-only module): `updateUserById` (password reset, email change, ban/unban). For a **new user**, the order is reversed: `createUser` → `profile_create`, and the auth user is deleted again if `profile_create` refuses.
- **Self-disable is blocked** twice: in the Server Action (`target ≠ current user`) and in `profile_set_active`.
- **Owner-account protection (PRD FR-AUTH-9…13, O1–O4):**
  - Last active Owner: the profile RPC takes `lock table user_profiles in share row exclusive mode` and refuses any change that would leave zero active Owners (`LAST_OWNER_PROTECTED`). A trigger re-checks this.
  - Protected actions on an Owner target (disable, password reset, email change, role change) and any grant of the Owner role need an active Owner actor ≠ target (`OWNER_ACTION_REQUIRES_OWNER`).
  - For those actions the Server Action **re-verifies the actor's password** (`signInWithPassword` on a separate, non-persisted server client), and requires a reason. Only then does it call the Auth admin API and the RPC.
  - The **order of operations** protects against half-done states. The RPC (DB checks + audit) runs first; the Auth admin call (ban / password / email) runs after it. If the Auth call fails, a compensating RPC call restores the profile, and the error is shown.
  - A dashboard alert is created for every protected Owner action.
  - "Forgot password" email links are shown on the login page **for Owner accounts only** (no email is ever sent for Manager accounts). This needs working email: production should use a custom SMTP sender (budget item under Q11).
  - **One-Owner operation (O5/O6):** the first Owner is made by `scripts/create-first-user.ts`, which exits with an error if any profile exists (it cannot add a second Owner). A second Owner is added later in the app through the normal create-user action with role Owner, by an active Owner only, with a reason and password re-entry. No dummy Owner is created. See SECURITY.md §3.2a for the recovery limitations.
  - Recovery script `scripts/recover-owner.ts` (run locally with the Supabase secret key by the business owner or developer): calls `recover_owner_account` and the Auth admin API to unban or set a temporary password for an Owner. The audit action `owner_recovered` is recorded with the reason.
- Disable = `is_active=false` (blocked by RLS immediately) + Auth ban (refresh tokens stop working).
- If one step fails, the other is compensated (re-enable / unban / remove the just-created auth user), and the error is shown. An integrity check compares `auth.users` with `user_profiles` nightly (banned ⇔ inactive).
- Password reset by another user sets a temporary password and `must_change_password = true`. The app does not depend on outgoing email (Supabase's default email sender is heavily rate-limited).

### 5.8 Reports and exports
- Report functions take `(resort_id nullable, from, to, …)`, are paginated, and use the date rules in PRD §5.12/§5.16.
- CSV: streamed, UTF-8 with BOM, amounts in rupees with 2 decimals, formula-injection escaping.
- PDF reports: A4 landscape. Reports over 5,000 rows are CSV only.

## 6. Financial calculation design

### 6.1 `booking_financials` (see DATABASE_SCHEMA §3.1)
```
D  = amount_due (Final, or Cancellation Charge if cancelled/no-show)
total_collection = A                    net_collection = A − RA
pending          = max(D − (A + W − RA), 0)       -- waiting refunds ignored (D1)
verified_remain  = max(D − (A − RA), 0)
extra            = max((A + W − RA) − D, 0)
refund_due       = max((A − RA) − D, 0)
refund_to_record = max(refund_due − RW, 0)
refund_limit     = A − RA − RW
```

### 6.2 Expected collection (D2)
- Expected = active plan rows (by due date) + expected adjustments (by adjustment date), via the `expected_entries` view.
- Past due rows are locked, so historical figures never change. Corrections land on the date they are made, with a reason.
- Invariant: Σ active rows + Σ adjustments = amount_due, enforced by the RPCs, a deferred constraint trigger and a nightly check.
- Overdue as of X = max(expected entries ≤ X − net collected ≤ X, 0), per booking.

### 6.3 Risks and solutions
| Risk | Example | Solution |
|---|---|---|
| Advance payments distort "Difference" | Paid in Nov for a Dec due date | Show Overdue (oldest-due-first allocation) next to Difference |
| Amount changed after plan set | Discount added later | update_booking requires a new plan in the same call |
| Approval date ≠ payment date | Paid 30 Nov, approved 2 Dec | Collection always uses the payment date. Reports show "as of" time. |
| Cancelled booking still expected | Old plan rows | Future rows replaced by the cancellation plan. Past rows locked + a negative dated adjustment. amount_due = charge. |
| History rewritten | October expected changes after a November cancellation | Past due rows locked (trigger). Adjustments are dated today, never backdated. |
| Waiting refund changes balances | Pending drops before the refund is checked | RW is excluded from all balances (D1). It is shown only as "Refunds Waiting for Approval". |
| Money returned looks collected | Refund after cancellation | Separate refunds table. Net Collection = A − RA by refund date. |
| Refund race | Two refunds at once | Booking row lock + limit A − RA − RW |
| Waiting counted as collection | Inflated totals | Total/Net Collection use approved only, asserted by tests |
| Manual adjustment hides errors | Final typed by hand | Reason required. Calculated parts stored. Adjustment shown on PDF and in a report. |
| Rounding | — | Integer paise, no division |

## 7. Validation layers
1. Zod in the browser (instant messages).
2. The same Zod schema in the Server Action.
3. RPC checks + DB CHECK/FK/UNIQUE + triggers (final guard).

RPC errors use codes (`STALE_RECORD`, `ID_FIELDS_LOCKED`, `PLAN_TOTAL_MISMATCH`, `PROOF_REQUIRED`, `REFUND_TOO_LARGE`, `ALREADY_DECIDED`, `CANNOT_DISABLE_SELF`, `LAST_OWNER_PROTECTED`, `OWNER_ACTION_REQUIRES_OWNER`, `PAST_DUE_ROW_LOCKED`, `PASSWORD_CONFIRM_FAILED`, …), mapped to simple English messages in `lib/errors.ts`.

## 8. Planned project structure (M1)
```
/src/app/(auth)/login, /change-password
/src/app/(app)/dashboard, bookings, approvals, payments, refunds, calendar, guests,
              resorts, agents-partners, reports, old-records, activity, settings (users, stay-types, providers, system)
/src/app/api/cron/pdf-retry, /api/export/[report]
/src/components (ui/, forms/, tables/, money/)
/src/lib (supabase/{server,client,admin}.ts, money.ts, dates.ts, errors.ts, validation/*, pdf/*)
/supabase (migrations/, seed.sql, tests/*.sql)
/tests (unit/, e2e/)
```

## 9. Performance
- Indexes per DATABASE_SCHEMA §6. Paginated lists. The dashboard uses a few aggregate RPCs.
- If needed later (beyond about 200k payments), add a daily summary table maintained by triggers.

## 10. Observability
- Vercel logs with request ids (no personal data).
- `/settings/system`: PDF queue, last backup time, integrity check results (plan sums, auth/profile match, orphan files).
