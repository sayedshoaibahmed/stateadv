# M2 — Database migration review guide

**Status: written and tested locally. NOT applied to Supabase.** Nothing here touches your Supabase project until you review and explicitly approve applying it.

**Updated 2026-11-11:** your decisions O7 (verified own-email change), Q9a (correction files) and D5 (reversal protection) are now in the migration files. Section 10 shows exactly what changed, file by file. Sections 1-9 describe the current files.

Files: `supabase/migrations/20261111000001_…` to `…000010_…` (10 files, about 2,000 lines of SQL).
How it was checked: all ten files are applied to a throw-away in-memory PostgreSQL (PGlite) with stand-ins for Supabase's own parts, then **181 database tests** and a **mutation check (19 deliberately weakened versions)** run against it (§9).

## 1. What these migrations create

| | Count |
|---|---|
| Tables | 19 (+ 3 read-only views) |
| Enum types (fixed lists) | 10 |
| Primary keys / Foreign keys / Unique constraints / Check constraints | 19 / 59 / 16 / 75 |
| Indexes (besides primary keys) | 57 |
| Generated (database-calculated) columns | 5 |
| Row Level Security policies | 24 (18 on tables, 6 on file storage) |
| Triggers (the safety rules) | 97 on our tables (6 are "checked at commit") + 1 on Supabase's `auth.users` (copies a confirmed email) |
| Functions | 25 (15 run with elevated rights; **only 4 are callable by app users**, all read-only) |
| Data inserted | only 3 stay types and 9 payment providers (migration 10) |

What is **not** in these files (later work inside the same M2 milestone, after you approve this part): the write functions (RPCs), login / user-management screens and the first-Owner script, the GitHub Actions database job and the true-concurrency tests, plus the two agreed additions in §10 (verified own-email change, correction files).

## 2. How to read the rules (the three layers)

1. **Table constraints** (CHECK / FOREIGN KEY / UNIQUE): a wrong value cannot be stored at all.
2. **Guard triggers**: rules about *changes* and *who* — "a decided payment cannot be edited", "only an Owner can disable an Owner". They also stamp *who* and *when* from the verified login, so the caller cannot fake them.
3. **Commit-time checks**: "the payment plan must add up", "UPI needs a screenshot" — checked once when the whole transaction is saved, so steps can happen in any order but the final result must be consistent.

Errors use short codes (for example `LAST_OWNER_PROTECTED`). The app will turn each into a plain-English message.

## 3. The ten files

| # | File | Purpose |
|---|---|---|
| 01 | `foundation` | Trigram search extension, the 10 enum types, helper functions (`today_ist`, `normalize_mobile`) and the generic trigger functions (no-delete, append-only, who/when stamps, version counter). |
| 02 | `users_and_master_data` | `user_profiles`, `resorts`, `guests`, `agents_partners`, `stay_types`, `payment_providers`, and `is_active_user()`. |
| 03 | `bookings_and_plan` | `booking_sequences`, `bookings`, `payment_plan_revisions`, `payment_schedules`, `expected_adjustments`. |
| 04 | `payments_refunds_proofs` | `payments`, `refunds`, `proofs`, `approval_history`. |
| 05 | `pdf_and_audit` | `booking_pdf_versions`, `pdf_jobs`, `audit_logs`, `system_status`, and the audit trigger function. |
| 06 | `guards_and_triggers` | All the guard rules and commit-time checks, and attaching every trigger. |
| 07 | `views` | `booking_financials`, `expected_entries`, `booking_overdue()`: the only source of money figures; and `correction_files`, the review list of files added after approval. |
| 08 | `security_rls_grants` | Removes Supabase's broad default rights, turns on RLS everywhere, adds the read policies, grants the minimum. |
| 09 | `storage` | Three private file buckets and their policies. |
| 10 | `reference_data` | Stay types and payment providers. |

## 4. Tables, relationships, constraints and indexes

Money is always a whole number of **paise** (`bigint`). Amounts typed into bookings, payments, refunds and plan rows are capped at 10¹⁵ paise (the same limit as the app code).

### `user_profiles` — one row per login
- **Link:** `id` is the Supabase Auth user id (foreign key to `auth.users`, no delete). `created_by`, `updated_by`, `disabled_by` point back to `user_profiles`.
- **Constraints:** name 1–120 characters; email lower-case and well-formed, unique; a disabled account must record when; `disabled_by` can never be the account itself.
- **Index:** active users by role (used by the "at least one Owner" count).
- **Rules (trigger):** see §6.1.

### `resorts`
- **Constraints:** `code` is 2–10 upper-case letters/digits and unique (it is the Booking ID prefix); name unique ignoring case.
- **Rule:** the code is locked as soon as the resort has a booking.

### `guests`
- **Constraints:** name and mobile length checks. Mobile is **not** unique (families share phones).
- **Indexes:** normalised mobile; trigram index on the lower-case name for fast partial search.
- **Rule:** `mobile_normalized` is filled by trigger (digits only, `+91`/leading `0` removed).

### `agents_partners`, `stay_types`, `payment_providers` — editable lists
- `agents_partners`: type (agent/partner) + name, unique together ignoring case.
- `stay_types`: name unique ignoring case. `payment_providers`: unique (method, name), plus unique (id, method) so a payment can reference **both** — a provider can never be attached to the wrong method (PhonePe with Cash is impossible).

### `booking_sequences`
- One row per **resort per booking-date year**; `last_value` 0–999999. Primary key (resort, year). Not readable by app users. The row lock on this row is what makes simultaneous bookings safe (used by the booking function, later in M2).

### `bookings`
- **Links:** resort, guest, agent/partner, stay type, and the user who created/updated/cancelled.
- **Booking ID:** `booking_code` unique and in the form `RSA-2026-000001`; the code must agree with its own `booking_year` and `booking_seq`; `(resort, year, seq)` is unique; the year must equal the **year of the booking date**; idempotency key unique (blocks a double-click).
- **Amount rules (Q1, Q14):**
  - `base` must equal PAX × tariff (× nights for per-night pricing) — a wrong base cannot be stored.
  - Per-night pricing needs at least one night. Nights must equal the IST date difference between check-out and check-in (D4).
  - `total` = base + extra and `final` = total − discount + manual adjustment are **calculated by the database**.
  - Discount is rupees only and cannot exceed the total. A manual adjustment needs a written reason. Final can never be below ₹0.
- **C/O rules (Q3):** Agent/Partner need a listed name; Own needs a name; Direct has none; the listed name's type must match.
- **Cancellation (Q7, Q7a, Q7c):** cancelled/no-show needs reason, date, charge and who; charge between ₹0 and the final amount; a no-show with a charge different from the full amount needs its own reason. **`amount_due` = the cancellation charge once cancelled, otherwise the final amount.** Original amounts are never changed.
- **Indexes (9):** resort+booking date, resort+check-in, check-out, guest, status, agent/partner, cancellation date, mobile, trigram name.

### `payment_plan_revisions` — one row per plan-changing event (append-only)
- Numbered 1, 2, 3 per booking with no gaps; revision 1 is "created", later ones need a reason. Records the amount due before/after and the total already past due at that moment. Composite key (id, booking) so plan rows and adjustments can only belong to a revision **of the same booking**.

### `payment_schedules` — the payment plan rows
- Amount positive; label 1–60 characters. A row is **active** until replaced (`superseded_*`). `(booking, line_no)` is unique among active rows.
- **Indexes:** active rows by booking, active rows by due date, by revision.
- **Rules (trigger):** past-due rows are locked for ever; rows can only be added by a revision written in the same transaction (§6.3).

### `expected_adjustments` — dated corrections to what is expected (append-only)
- Signed non-zero amount, reason required, always dated **today**, tied to a revision of the same booking. Resort copied from the booking. Index by (resort, date) for reports.

### `payments` and `refunds` — money in and money out (same shape)
- **Links:** booking, resort (copied from the booking), recorder, approver, rejecter, reverser; provider+method composite key.
- **Constraints:** amount positive; date ≥ 2000; every status carries exactly its own decision fields (waiting has none; approved has approver+time; rejected has rejecter+time+reason; reversed keeps the approval and adds reverser+time+reason); `is_self_approved` is a calculated column (Q8); idempotency key unique; code unique (`…-P1`, `…-R1`).
- **Indexes:** by booking; (resort, date); (status, date); waiting items by entry time; payment reference number.

### `proofs` — screenshot / receipt of a payment or refund
- Belongs to exactly **one** payment or refund. Object name must look like `{booking-uuid}/{uuid}.jpg|png|webp|pdf` (or `refunds/…`) — path tricks are refused. Type limited to JPEG/PNG/WEBP/PDF; size 1 byte–10 MB; 64-character fingerprint (duplicate-screenshot warning). Hiding needs a reason; files are never deleted. **Correction files (Q9a):** `is_correction` and `correction_reason` columns; a CHECK makes a correction file carry a written reason of at least 10 characters and an ordinary file carry none. Indexes: by payment, by refund, by fingerprint.

### `approval_history` (append-only)
- One row per status change of a payment **or** refund, written **by the database**, never by app code: from, to, reason, who, when, and whether the person acted on their own record.

### `booking_pdf_versions` (append-only), `pdf_jobs`, `audit_logs` (append-only), `system_status`
- PDF versions: unique (booking, version), unique path. Jobs: pending/failed queue with attempt count (partial index). Audit log: who, what, which record, booking, resort, target user, old/new values, changed fields (5 indexes). `audit_logs` has **no foreign keys** on purpose, so history can never be blocked by a later change.

## 5. Row Level Security and privileges

**Model:** not logged in → nothing; logged in and active → read-only; **all writes go through functions** (to be written in M2).

| Layer | What happens |
|---|---|
| Supabase default | Supabase gives `anon`/`authenticated` broad rights on every new table and function. Migration 08 first **removes all of that**, then grants back only what is below. |
| `anon` | No privilege of any kind on any table or view or function. |
| `authenticated` | `SELECT` on 18 tables and 3 views. **No** insert/update/delete/truncate anywhere. No access at all to `booking_sequences`. Can execute only: `is_active_user`, `today_ist`, `normalize_mobile`, `booking_overdue`. |
| RLS | Enabled on all 19 tables. **18 identical read policies** "active users can read": `SELECT … TO authenticated USING (is_active_user())`. `booking_sequences` has RLS on and no policy. **There are no insert/update/delete policies on any table.** |
| Views | `security_invoker`: they run with the reader's rights, so the policies still apply. |
| `service_role` (secret key) | Keeps its Supabase default rights (it must create Auth users), but **every guard trigger still applies to it**, including no-delete and the Owner rules. |

**Storage (6 policies, migration 09):** buckets `payment-proofs` (10 MB; JPEG/PNG/WEBP/PDF), `booking-pdfs` (10 MB; PDF), `resort-logos` (2 MB; PNG/JPEG/WEBP, **no SVG**) — all **private**. Per bucket: one read policy and one add policy (active users only; the object name must match its server-generated pattern). **No update or delete policy**, so nobody can overwrite or remove a stored file.

## 6. The rules in the triggers

### 6.1 Accounts (`guard_user_profiles`)
- Account changes happen **one at a time** (advisory lock), so the "at least one Owner" count cannot be fooled.
- **First account:** allowed only when the table is empty, and it must be an Owner and active.
- **Later accounts:** only an active user can add them; only an **Owner** can create an Owner (O2, O6).
- **Nobody can disable themselves.**
- **O1:** disabling/enabling an Owner, changing an Owner's email or role, or flagging an Owner for a password reset needs **another active Owner**.
- **At least one active Owner always exists** — enforced for everyone, including the recovery path.
- **Own-email change (O7):** nobody can edit their *own* profile email directly (`EMAIL_CHANGE_REQUIRES_VERIFICATION`). The only way is the verified process: Supabase Auth confirms the new address (and the old one, with Secure email change on), updates `auth.users.email`, and a trigger copies it to the profile. The account guard accepts that copy **only if** there is no session user, the trigger's switch is on, the new value is exactly the address Auth confirmed for the *same* user, and **nothing else about the account changes**. If the copy is refused, the whole Auth change is rolled back. Changing someone else's email (the admin route) works as before: another Owner for an Owner (O1).
- **Roles are never self-service:** an Owner cannot demote themselves and a Manager cannot promote themselves.
- Who disabled an account and when are stamped from the session.
- **Recovery path:** a session with no user plus a setting that only the (service-role-only) recovery function will set (written later in M2). It can re-enable an Owner but can never remove the last one.

### 6.2 Bookings (`guard_booking`)
- New bookings only for **active resorts**; status starts as "confirmed".
- Resort, booking year, code and sequence are **frozen for ever** (Q16).
- A cancelled/no-show booking is **final**: status, original amounts, dates and the cancellation record are locked; only the charge can be corrected, and only with a new written reason.
- Cancellation date cannot be in the future; who/when stamped from the session.

### 6.3 Payment plan (`guard_plan_revision`, `guard_schedule`, `guard_adjustment`, commit-time check)
- Revisions are numbered without gaps and must record the booking's true amounts (and the true past-due total).
- **Past-due rows (due before today IST) can never be changed or replaced** (D2). Rows can never be edited, only replaced.
- Plan rows and adjustments can only be added by the **latest revision created in the same transaction**; later revisions cannot add rows with past dates.
- Adjustments are **always dated today**.
- **Commit-time check:** active rows + adjustments must equal the amount due, or the whole save is refused (`PLAN_TOTAL_MISMATCH`).

### 6.4 Payments and refunds (`guard_payment`, `guard_refund`, `record_approval_history`)
- Only an active, logged-in user can record or decide. Code, resort, recorder and entry time come from the database.
- Starts as "waiting". Payment/refund date cannot be in the future (backdating is fine).
- Only **waiting→approved, waiting→rejected, approved→reversed**. A decision cannot also edit the amount. Approved/rejected/reversed items are locked. Approver/rejecter/reverser and times are stamped from the session. Self-approval is allowed and flagged (Q8).
- **Refund limit (under a row lock):** approved payments − approved refunds − waiting refunds. A payment cannot be **reversed** if that would leave refunds larger than the money held.
- **History is written by a trigger on every status change**, so a decision cannot happen without leaving its history row.

### 6.5 Files (`guard_proof`) and the screenshot rule
- Ordinary files can be added or hidden only while the item is **waiting**; a file can be hidden once; never deleted or edited.
- **After approval the originals are locked** (cannot be added to, hidden, edited or deleted). The only exception is a **correction file (Q9a)**: allowed on **Approved** payments and refunds only, flagged `is_correction`, with a written reason of at least 10 characters, stamped with the real person and time, audited, listed in `correction_files`, and with **no effect on any amount, status, date or financial figure**. Corrections are refused on waiting items (add a normal file instead) and on rejected/reversed items (enter a new payment). A correction file is itself permanent.
- **Commit-time check:** UPI / Card / Cheque payments **and refunds** must always keep at least one visible file; Cash / Other need none (Q9, D3).

### 6.6 Everywhere
- **No DELETE and no TRUNCATE** on any of the 19 tables, even for the service role.
- Five history tables are **append-only**.
- Every meaningful change is **audited** with the real actor, old and new values, and the booking/resort.
- Each update bumps a **version** (for "someone else changed this" detection).

## 7. Functions

25 functions. 15 run with elevated rights (`SECURITY DEFINER`, empty search path so they cannot be tricked). Fourteen of those are triggers or helpers that app users **cannot** call. The fifteenth, `is_active_user()`, needs elevated rights only so it can look up the caller's profile. App users can call exactly four functions, all read-only: `is_active_user()`, `today_ist()`, `normalize_mobile()` and `booking_overdue(date)`. A test fails if any other function becomes callable by them or by `anon`.

## 8. Money figures (`booking_financials`, `expected_entries`, `booking_overdue`)

One row per booking with: amount due, total collection (approved only), waiting, rejected, reversed, refunds approved/waiting, net collection, pending, verified remaining, extra, refund due, refund still to record, refund limit. **Waiting refunds are excluded from every balance (D1).** `expected_entries` lists active plan rows (on their due dates) and adjustments (on the day made). `booking_overdue(date)` = expected up to the date − net collected up to the date (never below zero).

## 9. How it was tested

- **181 database tests** (all fictional data) in eight files: structure and security; accounts and Owner protection; bookings, cancellation and plan; payments, refunds and approvals; money views; email-change / correction-file rules; guard branches found untested in the pre-push review; and a test that compares `DATABASE_SCHEMA.md` with the real database. Together with the 91 other tests: **272 tests**, all passing.
- **Money cross-check:** the views are compared with the independent reference formulas in `src/lib/calc.ts` on the 19 golden cases (FIN-01…19) **and 250 random bookings, to the paisa**, including rejected/reversed noise that must not count.
- **Mutation check** (`node scripts/mutation-check.mjs`): the migrations are deliberately weakened in **19** ways, one at a time, in a temporary copy. The original ten: last-Owner protection removed, RLS off, past-due lock off, waiting refunds reduce Pending, app users given INSERT, functions open to anon, refund limit off, approved payments editable, cancelled amounts editable, audit log editable. The eight new ones: email sync accepts any address; email sync may carry a role change; users may edit their own email directly; corrections allowed on waiting payments; ordinary files allowed on approved payments; correction reason not mandatory; originals can be hidden after approval; payment reversal allowed while refunds depend on it. The nineteenth: a system change keeps the previous editor's name in `updated_by`. **All 19 make real tests fail.**
- Bugs found and fixed by these tests before review: an expression in the commit-time plan check that referenced a column not present on every table, a plan-row guard that rejected the intended "replace" update; and, in the new work, one of my own new tests that proved nothing: the mutation check exposed it and it was rewritten so the protected path is genuinely exercised.

**Limits (honest):** the engine is PostgreSQL 18 (Supabase runs 17); Supabase's own pieces are stand-ins. Tests with several simultaneous connections (parallel bookings, two Owners acting at once) cannot run on a single connection and are planned for GitHub Actions on real Postgres (later in M2). The first real test on Supabase is the apply step itself, which I will run only with `--dry-run` first and after your approval.

## 10. Owner decisions of 2026-11-11 - what changed in the files

You approved O7, Q9a and D5. Because nothing has been applied to Supabase, I edited the migration files in place (no extra "patch" files), so there is still one definition of every rule.

| Decision | File and change |
|---|---|
| **O7 - verified own-email change** | **06 guards:** `guard_user_profiles` gets the narrow "verified sync" exception and the new refusal `EMAIL_CHANGE_REQUIRES_VERIFICATION` for editing your own email. New function `sync_profile_email()` and trigger `trg_sync_profile_email` on `auth.users` (after an email update): it switches the flag on for that one statement, copies the confirmed address, switches the flag off. |
| **Q9a - correction files** | **04 proofs table:** new columns `is_correction`, `correction_reason` and the CHECK `proofs_correction_fields` (reason of 10+ characters for a correction, none otherwise). **06 `guard_proof`:** waiting allows ordinary files only; **approved allows correction files only**; rejected/reversed allow nothing; originals and corrections can never be hidden, edited or deleted afterwards; `is_correction` and the reason are immutable. **07:** new view `correction_files` (who, when, why, which payment/refund, which booking). **08:** read access for active users only. |
| **D5 - reversal protection** | No change. It was already in `guard_payment` (`REVERSAL_EXCEEDS_REFUNDS`). Its tests are unchanged, two more spot checks were added (a waiting refund also blocks the reversal; allowed once that refund is rejected or reversed), and the mutation check now proves the tests would notice if it were removed. |

### What the email-change rule does and does not do
- **Does:** let any user change their own login email, only after the confirmations Supabase Auth requires; make the profile follow Auth exactly; refuse every other way of writing an email on your own account; keep another-Owner changes under O1; keep every Owner protection unchanged.
- **Does not:** change roles (self-service role change stays impossible), weaken last-Owner protection, or touch the recovery path.
- **Not testable here:** the confirmation emails themselves and the "old and new address" step are Supabase Auth features (switch "Secure email change" on in the project; see DEPLOYMENT_GUIDE). The tests simulate the moment Auth reports a confirmed address. Real emails can only be verified on the real project, and the built-in development email delivers only to your Supabase team addresses.
- **Audit:** the sync is recorded as an update on the profile with old and new address, no session user (it is Supabase Auth acting after the user confirmed), and the user as the target. The app raises the dashboard alert.

### What the correction-file rule does and does not do
- **Does:** let someone add a missing receipt to an *approved* payment/refund, with a written reason; show it clearly as "added after approval"; list it for the owner to review; leave the original files and every figure exactly as they were.
- **Does not:** allow editing, hiding or replacing any file after a decision; allow corrections on waiting, rejected or reversed items; change what is counted as collected, pending or refunded.
- The booking PDF will print corrections with date, person and reason (done when the PDF is built).

### Test changes
- **Two existing assertions were updated** because your decisions changed the expected outcome, and both still refuse the action: the list of views now includes `correction_files`, and an Owner's direct edit of their own email is now refused as `EMAIL_CHANGE_REQUIRES_VERIFICATION` instead of the older `OWNER_ACTION_REQUIRES_OWNER`.
- **Every other existing test is unchanged** and passes. **27 new tests** were added in `tests/db/email-change-and-corrections.test.ts`.

## 11. Other points for awareness

1. **Hiding a file** (while waiting): the caller sends "hide" with a reason; the database stamps the real time and user.
2. **Reference data is audited** as "system" actions (12 audit rows from migration 10, no user).
3. **Still to be written in M2:** `next_booking_code`, `create_booking`, plan/cancel/refund/payment functions, the correction-file function, user-management functions, `recover_owner_account` (service role only).
4. **Supabase hosted specifics to confirm at apply time:** creating policies on `storage.objects`, inserting into `storage.buckets`, and creating a trigger on `auth.users`. These are standard on Supabase but can only be proven on the real service.
5. **If the sync is ever refused, Auth's email change is rolled back** (by design, so Auth and the profile never differ). The app will show a plain message and keep the old email.

## 12. Pre-push review (2026-11-11)

### 12.1 The date
Commit 1317052 and ten files said "2026-11-12" and the migration files were named `20261112…`. That was **my mistake**: the machine date and every commit timestamp are **2026-11-11**. It is corrected everywhere, including inside the local commit history (no commit now contains it) and the migration file names (`20261111000001…10`). Deliberately **not** changed: the 12 Nov values in `src/lib/dates.ts` and `tests/unit/dates.test.ts` (real time-zone boundary test data from the first milestone) and a random-number seed in a test. The corrected files are byte-identical to what the tests ran on.

### 12.2 Do the migrations implement the documented rules consistently?
Checked three ways: (1) a new automatic test compares `DATABASE_SCHEMA.md` with the real database: the same 19 tables, the same 10 enum types with the same values in the same order, and every one of 150+ column names the document mentions exists; (2) the rule-to-test matrix below; (3) a line-by-line re-read of the guard functions.

| Documented rule | Enforced by | Tests |
|---|---|---|
| Booking ID format, uniqueness, year = booking-date year, frozen parts (FR-BID) | table checks + `guard_booking` | BID-* |
| Amount formula, nights, discount, manual adjustment (FR-BK-4) | `bookings_base_formula`, generated columns | AMT-* |
| C/O rules (FR-BK-2) | `bookings_co_rules`, type match | CO-* |
| Cancellation, no-show, original amounts untouched (FR-CAN) | table checks + `guard_booking` | CAN-* |
| Plan must balance; past-due rows locked; adjustments dated today (FR-SCH) | commit-time check + `guard_schedule`, `guard_adjustment` | PLN-*, COL-11* |
| Payment starts waiting, dates, codes, resort copy (FR-PAY) | `guard_payment` | PAY-* |
| Screenshot rule for UPI/Card/Cheque (FR-PAY-2, D3) | commit-time proof check | PAY-*, REF-06 |
| Decisions, locking, self-approval flag, history (FR-APR) | `guard_payment/refund`, history trigger | APR-* |
| Reversal protection (FR-APR-3a, D5) | `guard_payment` | REF "REVERSAL", REV-01..03 |
| Refund limit, own approval flow (FR-REF) | `guard_refund` | REF-* |
| Correction files (FR-PAY-12, Q9a) | `guard_proof` + `proofs_correction_fields` | COR-* |
| Money figures (PRD 5.11), expected/overdue (5.12) | views and function | FIN-01..19 + 250 random, COL-* |
| Owner protection, self-disable, last Owner (FR-AUTH) | `guard_user_profiles` | OWN-*, USR-* |
| Verified own-email change (FR-AUTH-16, O7) | guard + sync trigger | EML-* |
| No deletes, append-only history, audit (section 18) | triggers | schema/audit tests |
| Private storage, RLS, minimum privileges (SECURITY 3, 5) | migrations 08 and 09 | SEC-* |

### 12.3 Defects found in this review (both fixed)
1. **"Last updated by" could name the wrong person.** A change with no logged-in person (such as the verified email copy) left `updated_by` showing the *previous* editor. It is now empty (meaning "system"), as the audit log already said. New test plus a mutation check.
2. **Read policies checked the user once per row.** They now use `(select is_active_user())`, so the database checks once per query, as Supabase recommends. Same rule, much cheaper on large lists. (Migrations 08 and 09.)

Also added: eight tests for guard branches that had none (account created inactive, cancel with no session, cash→UPI edit without a file, PDF version/job/status tables, duplicate stored file name).

Static checks run on the built database: every one of the 25 functions has a fixed search path; every table has a primary key; no function is callable by `anon`.

### 12.4 Rules that are NOT enforced by the database (by design: the write functions and screens do them)
Duplicate-reference / duplicate-screenshot / over-amount **warnings** (FR-PAY-6); payments on a cancelled booking only up to the charge (FR-PAY-11); at most 5 files per payment and file-type checking by content (FR-PAY-3); returning the existing record on a repeated submit; the "someone else changed this" check (the database bumps the version, the function compares it); queuing PDF jobs; plain-English messages for the error codes; the password re-entry and reasons for protected Owner actions; dashboard alerts; forced password change; the nightly integrity checks. **Each needs its own test when the write functions and screens are built.**

### 12.5 What the in-memory stand-in cannot prove, and how each will be verified
| What differs | Risk | How and when it will be verified |
|---|---|---|
| Engine is PostgreSQL **18**; Supabase runs **17** | A syntax or behaviour difference | Run the same 181 tests against a real Supabase Postgres 17 in GitHub Actions (disposable). Later in M2. |
| Only **one connection** | Concurrency behaviour is unproven (parallel bookings, two Owners disabling each other, double refund, double approval) | Concurrency tests BID-02/03, OWN-06, REF-04, APR-05 on real Postgres in CI. Later in M2. |
| Roles, `auth.uid()`, default privileges, `auth` and `storage` schemas are **my copies** of Supabase's | Real Supabase may differ in details (claim names, default grants, owners) | First apply uses `--dry-run`; afterwards read-only checks on the real project: privilege queries, REST probes with the public key (anon sees nothing, a user with no profile sees nothing), storage probes. |
| Hosted Supabase restrictions on `storage` and `auth` objects | Policies on `storage.objects`, inserts into `storage.buckets` and the trigger on `auth.users` might be refused | Each migration file runs in its own transaction, so a refusal changes nothing in that file. Confirmed only by applying to the dev project (after your approval). |
| No real **Supabase Auth** | The email-change confirmation (old + new address) and the exact columns Auth updates are simulated | End-to-end test with real mailboxes (Supabase team addresses) after apply; confirm "Secure email change" is ON. |
| No PostgREST / pooler | Behaviour per request and through the pooler | All state uses transaction-local settings and transaction-level locks, which work through the pooler. Verified in the real-project run. |
| Time zone set explicitly in every rule | Low | Rules use `Asia/Kolkata` explicitly; checked around midnight IST in the real run. |
| Supabase **Advisors** (security and performance) | Warnings I cannot see here | Run in the dashboard after apply; review every item. |

### 12.6 Informational notes (no action needed now)
- 40 "who did it" foreign keys (`created_by`, `updated_by`, `approved_by` …) have no index. Deletes are blocked, so this only affects filtering; revisit with real report queries in the reports work.
- A change made with the **secret key and no logged-in person** (for example in the Supabase dashboard) is allowed on non-money master data and is audited as "system". Money records, accounts and files still require a real active user. This is why the secret key must stay private and be rotated after any exposure.
- The audit log for the email copy shows the actor as the system (Supabase Auth), with the user as the target.
