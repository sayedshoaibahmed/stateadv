# M2 — Database migration review guide

**Status (updated 2026-11-12): migrations 01–20 are APPLIED to the dev Supabase project and verified** (evidence: `HOSTED_VERIFICATION.md` sections 0h, 0i and 0k). The text below was written before 11–18 were applied and is kept as the review record; where it says "not applied", read "applied on 2026-11-11 after the owner's approval".

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

## 13. Migrations after the first apply (2026-11-11)

Migrations 01–10 were applied to the dev project on 2026-11-11 and verified (see PROGRESS). Everything below is **written locally and not applied**.

### 13.1 Migration 11 - account self-service
- Adds `complete_password_change()`: clears only the caller's own "must change password" flag (SECURITY DEFINER, empty search_path, identity from `auth.uid()`, refused for no session / inactive profile).
- **New rule for every later function:** PostgreSQL gives EXECUTE to PUBLIC on new functions, and migration 08 only removed the old ones. Each new function therefore starts with `revoke all ... from public, anon, authenticated` and grants back only what it needs. Tests ACC-09 and ACC-10 enforce this for all functions.
- PostgreSQL 17: only plain PL/pgSQL and standard GRANT/REVOKE; nothing version-specific.
- Applying it: dry run first, then your approval.

### 13.2 Migration 12 — account management
Adds `profile_create / update / change_email / set_active / reset_password`, `active_owner_count`, `recover_owner_account` (service role only) and the internal helpers `require_reason`, `audit_account_action`. **Replaces** `audit_row_change()` (migration 05) so it also stores the reason passed in `app.reason` (unchanged behaviour when none is set).
- Owner rules are enforced twice: explicitly in the function (for example `profile_reset_password` refuses a Manager even when the "must change password" flag is already on, which the table guard alone would not catch) and by `guard_user_profiles` underneath.
- Nothing destructive. PostgreSQL 17: plain PL/pgSQL.

### 13.3 Migration 13 — master data functions
Resort, guest, agent/partner, stay type, payment app. Reads `storage.objects` to check a resort logo exists (the hosted `postgres` role has SELECT and BYPASSRLS there — checked read-only). Payment apps are case-insensitively unique per method (the table rule is case-sensitive).

### 13.4 Migration 14 — bookings and payment plan
`create_booking` (idempotent; recalculates nights and amounts; Booking ID from a locked counter row), `update_booking`, `set_booking_status`, `cancel_booking`, `change_cancellation_charge`, `set_payment_schedule`, `plan_preview`, and the internal `apply_plan_change` (TRD 5.2a). JSON input is read by small validating helpers (`pl_*`); a timestamp without a time zone is refused so nothing depends on a server setting.
- *Known cost*: the overdue/unpaid amount is computed per booking from `expected_entries`, `payments`, `refunds` (not through `booking_overdue()`, which scans every booking).

### 13.5 Migration 15 — payments, refunds, approvals, proofs, corrections
Adds the functions listed in TEST_PLAN §2.16 and the internal `money_position`, `parse_files`, `check_provider`, `insert_proofs`, `decide_payment`, `decide_refund`, `proof_parent`.
- **Lock order**: booking first, then the payment/refund row, everywhere.
- A proof row can only point at a file that really exists in `payment-proofs`, in THIS booking's folder, whose recorded size and type match.
- Verified on real PostgreSQL 17.11: all rules, and under simultaneous requests (CON-01..11).

### 13.6 Real PostgreSQL 17 results (local throw-away server, 2026-11-11)
| Check | Result |
|---|---|
| Migrations 01–15 apply cleanly | yes |
| All database tests (300) | pass |
| Concurrency tests (11) | pass |
| Locking weakened in a copy: no account-change lock; no booking lock in the refund guard AND function; booking numbers by read-then-write | each is **caught** by the concurrency tests |
| Locking weakened in only one of two layers (refund guard only; function only; payment-row lock in approval) | **not** caught — correct: a second layer (the other lock, or the status guard) still protects the outcome |

Differences between this server and Supabase that remain: migrations run as a superuser here (the hosted `postgres` is not one); Supabase's `supautils` permission exceptions, PostgREST and the real Auth/Storage services are not present.

### 13.7 Stand-in changes made in this stage
`storage.objects` now has the `metadata` column and the unique (bucket, name) index that the real service has; roles are created idempotently for the real-server backend.

### 13.8 Owner decisions of 2026-11-11 (migrations 12, 14, 15 edited; migration 16 added)
Migrations 11–15 had not been applied, so 12, 14 and 15 were edited in place. Migration 06 **is** applied on the hosted project, so the refund guard is replaced by a new migration 16 (`create or replace function`; trigger, owner and privileges unchanged; no data touched).

| Decision | Change |
|---|---|
| 2 status undo needs a reason | `set_booking_status` gained `p_reason text default null` (14); undo steps require `require_reason(…, 5)`; the reason travels to the audit entry through `app.reason` |
| 3 reason lengths | every `require_reason(…, 1)` became 5 in 14 and 15; refund reason and manual-adjustment reason check 5; new internal `optional_reason` (12) for optional account reasons; 10 stays for protected Owner actions and correction files |
| 5 refund limits | **16**: `guard_refund` reads the booking's amount due and status under the lock and applies `A − D − RA − RW` (running) or `A − RA − RW` (cancelled/no-show), on insert and on raising a waiting refund |
| 1, 4 | already as approved; now pinned by DEC-1 and DEC-4 |

**Exact difference of migration 16 from the applied guard** (verified by a line diff): the declarations `v_due, v_status, v_max`; the booking select also reads `amount_due_paise` and `status`; the two limit checks; the error detail now reports the real limit. Nothing else.

**Re-verification (local):**
| Check | Result |
|---|---|
| Migrations 01–16 apply on PGlite and on real PostgreSQL 17.11 | yes |
| Database + concurrency tests on real PostgreSQL 17.11 | 334 pass |
| New simultaneous-request tests: CON-12 (running booking, 10 refunds → exactly 3 of 30000 fit in 100000), CON-13 (same numbers: running → 1 of 70000, cancelled → 8 of 70000), CON-14 (two waiting refunds raised at once → exactly one) | pass |
| Existing tests that built refunds on a running, fully paid booking (REF-*, REV-02/03, COR-05, REVERSAL) | updated to cancel the booking first (charge 0), because under decision 5 a running booking cannot refund money that is due |
| Existing tests with one-to-four-character reasons | fixture text lengthened; no assertion weakened |

## 14. Configurable C/O, resorts and stay types (owner requirement 2026-11-11)

### 14.1 What changed
| File | Change |
|---|---|
| **17** `configurable_co` (new) | New table `co_categories` (seeded with Agent / Partner / Own / Direct as **examples**). `agents_partners` is renamed `co_entries` and gets `category_id` (filled from the old `type`). `bookings` gets `co_category_id`, `co_category_name`, `co_mode`, `stay_type_name` (all filled for existing rows); `agent_partner_id` is renamed `co_entry_id`; the new `bookings_co_rules` is driven by `co_mode`; composite FK entry↔category; `guard_booking` replaced (copies of names, switched-off choices); the old column `bookings.co_category`, column `co_entries.type` and enum types `co_category`, `partner_type` are dropped; the new table gets RLS, the read policy, grants, no-delete and audit triggers. |
| **18** `initial_resorts` (new) | Four placeholder resorts (SR1–SR4, "Sample Resort One … Four"), only where the code and name are free; safe to run twice. |
| 13 (edited, unapplied) | `upsert_agent_partner` replaced by `upsert_co_category` and `upsert_co_entry` |
| 14 (edited, unapplied) | `create_booking` / `update_booking` use `co_category_id`, `co_entry_id`, `co_name`; `resolve_co` is driven by the category's kind; new internal `check_stay_type`; `next_booking_code` never hands out a number that already exists |

### 14.2 What needs the project owner's approval at apply time
Migration 17 contains **DROP COLUMN (×2) and DROP TYPE (×2)**, each marked `-- DESTRUCTIVE-APPROVED` with the reason, because the information moves into the new columns first. On the hosted project **the affected tables are empty** (0 bookings, 0 agents/partners — checked read-only 2026-11-11), so nothing can be lost there; the same migration was also proven on a database that holds data (below). The approval to apply is still the project owner's.

### 14.3 Proof that existing data is preserved (test `MIG17-*`, PGlite and real PostgreSQL 17)
A database is built up to migration 16, filled with four bookings (one per old category, with amounts, a plan, an approved payment) and two agents/partners, and only then are 17 and 18 applied. Verified: booking codes, resort, amounts, status, payments **identical**; every booking has the right category, mode, name and stay-type copy; the old entries keep their ids and names and sit in the right category; the old columns, tables and types are gone with no leftover names; the converted bookings can be edited, new bookings can use the old names, numbering continues; RLS, privileges and triggers are intact on the renamed and the new table. Side effect, by design: each converted booking's version goes up by one.

### 14.4 Defects found by these tests and fixed before review
1. **Migration 17 failed on a database with bookings** ("cannot ALTER TABLE … pending trigger events"): the conversion queued the end-of-transaction books-must-balance checks. Fixed by running them (`set constraints all immediate`) before the structural change. An empty database, like the hosted one, would never have shown this.
2. **Booking numbers could repeat** when bookings existed but the counter row did not (bookings added outside `create_booking`, imports). `next_booking_code` now never goes at or below an existing number (the counter row is still the lock).
3. **A migration contained a non-ASCII arrow** that a non-UTF-8 database refuses. All migrations are ASCII; `npm run check:migrations` now enforces it.
4. **`src/lib/db/actions.ts` exported non-async functions**, which Next.js refuses as server actions; nothing imported it before, so the build had not noticed. All 23 are now async.

### 14.5 Results (local; hosted = read-only checks only)
| Check | Result |
|---|---|
| Migrations 01–18 apply from scratch | PGlite and real PostgreSQL 17.11 |
| Database + concurrency tests, real PostgreSQL 17.11 | 368 pass |
| Concurrency (real PG 17): CON-15 (same category created 10×) · CON-16 (renames racing bookings) · CON-17 (30 bookings across 5 resorts: unique, gap-free) · CON-18 (resort switched off while bookings are saved) | pass |
| Function counts | 85 in schema `public`, 38 callable by signed-in users; 102 triggers; 25 policies |

### 14.6 Known test-environment issue (open, not a database defect)
On the Windows development machine the file `tests/db/concurrency.pg.test.ts` (dozens of simultaneous connections) occasionally ends because its Node worker process dies with exit code `0xC0000409` (a process-level fatal, no assertion output, no crash in the PostgreSQL server log). Measured: about 1 run in 4 at first; after giving every connection an error listener, closing connections one at a time, and removing queries that overlapped on one shared connection, about 1 run in 10. A stand-alone script that opens 30 connections at once, 60 times in a row, six times over, never crashes, so it is not the PostgreSQL driver or the server. **Every run that completed passed all 18 tests; no run ever produced a failing assertion.** `npm run test:pg17` and the CI job run this file separately from the other files. Not yet seen on Linux (CI has not run). If it recurs in CI it should be investigated rather than re-run blindly.

## 15. Pre-apply review of migrations 11-18 (2026-11-11, before any hosted change)

Everything below was checked **read-only** against the hosted project (PostgreSQL 17.11) and rehearsed locally. **Nothing has been applied.**

### 15.1 Hosted facts (evidence, exact counts - not estimates)
| Fact | Finding |
|---|---|
| Migration history | exactly 10 rows, `20261111000001` .. `20261111000010`, names identical to the local files; local files 01-10 are byte-identical to what is on GitHub |
| Tables / views / enums / functions / triggers / policies | 19 / 3 / 10 / 25 / 97 (+1 on `auth.users`) / 24 |
| RLS | enabled on all 19 tables; no table without it |
| **Rows in the tables migration 17 changes** | `bookings` **0**, `agents_partners` **0**, `booking_sequences` 0, `guests` 0, `resorts` 0, `payments` / `refunds` / `proofs` / plans / adjustments **0**, `user_profiles` 0, `auth.users` 0, `storage.objects` 0 |
| Rows that exist | `stay_types` 3, `payment_providers` 9, `audit_logs` 12 (the 12 system inserts of migration 10, no actor) |
| What depends on the objects migration 17 drops | only the two columns themselves (`bookings.co_category`, `agents_partners.type`) and the function `guard_booking` (replaced inside migration 17 **before** the drops). No view, policy, default or other column uses the two enum types. |
| Name collisions | none of the 60 new functions, the new table or the new indexes exists; the 3 functions that are replaced (`audit_row_change`, `guard_booking`, `guard_refund`) do exist; no resort named or coded like the placeholders |
| Callable by app roles now | 4 functions, none by `anon` (as designed) |
| Default rights for new functions | `postgres` in `public` grants new functions only to `postgres` and `service_role`; PostgreSQL still adds EXECUTE for PUBLIC to a new function, which is why every new function starts with `REVOKE ... FROM PUBLIC` (tests ACC-09, SEC-04) |
| The `postgres` role | NOT a superuser; has BYPASSRLS; may SELECT `storage.objects` (needed by migrations 13 and 15); `storage.objects` has the `metadata` column |
| Server settings | UTF-8; `standard_conforming_strings` on; `lock_timeout` 5 s; `statement_timeout` 120 s |
| Storage | 3 private buckets with the agreed limits; 6 policies (3 read, 3 add; none for update/delete) |
| Auth (public settings) | signup **disabled**, email login only, no anonymous users, email confirmation required |
| Not readable without a dashboard login | "Secure email change" and the session lifetime: see HOSTED_VERIFICATION 0b |

### 15.2 Migration by migration
| # | Purpose and objects | Additive or destructive | Depends on | Safe on the current hosted project? | Data preservation | Recovery if it fails or must be undone | Verify after |
|---|---|---|---|---|---|---|---|
| 11 | `complete_password_change()` | additive (1 function) | 02 | yes | none touched | drop the function | function exists; callable by `authenticated` only |
| 12 | 10 account functions (`profile_*`, `recover_owner_account`, `active_owner_count`, helpers); **replaces** `audit_row_change()` so the audit rows also store the reason | additive + 1 in-place function replacement (same signature; triggers keep working) | 02, 05, 06 | yes | no table touched | restore the old `audit_row_change` body from migration 05; drop the new functions | `audit_row_change` text contains `app.reason`; `recover_owner_account` executable by `service_role` only |
| 13 | master-data functions (`upsert_resort`, `set_resort_active`, `upsert_guest`, `upsert_co_category`, `upsert_co_entry`, `upsert_stay_type`, `upsert_provider`, helpers) | additive (9 functions) | 02; the two C/O functions name tables created by 17 (PostgreSQL resolves names when a function RUNS, so creating them first is valid; they cannot work until 17) | yes | no table touched | drop the functions | callable list matches SEC-04 |
| 14 | booking and payment-plan functions (create / update / cancel / status / plan, helpers); `next_booking_code` never reuses a number | additive (about 19 functions) | 03, 05, 13; names columns created by 17 (same remark) | yes | no table touched | drop the functions | as above |
| 15 | payment, refund, approval, proof and correction-file functions (about 21) | additive | 04, 06, 14; reads `storage.objects` | yes (the `postgres` role can read it) | no table touched | drop the functions | as above |
| 16 | **replaces** `guard_refund()` (refund limits: running booking `A-D-RA-RW`, cancelled/no-show `A-RA-RW`) | additive; in-place replacement of a trigger function (trigger, owner, grants unchanged) | 06 | yes | no table touched | restore the body from migration 06 | `guard_refund` text contains `v_max` |
| 17 | configurable C/O (details 15.3): new `co_categories`; `agents_partners` renamed `co_entries`; new columns and rules on `bookings`; guard replaced; **drops 2 columns, 2 enum types, 1 index, 1 constraint** | **destructive (schema), data-preserving** | 01-06, 08, 13/14 not required | **yes, because every affected table is empty (checked)**; also proven on a populated database | converted first (tests MIG17-01..07) | see 15.4: the hosted project holds only re-creatable reference data | 15.5 list |
| 18 | four placeholder resorts SR1-SR4 | additive (4 rows; skipped if code or name exists) | 02 | yes (no conflicting resort) | none touched | the rows can be switched off (never deleted); no booking uses them yet | 4 resorts, all active |

**As a batch (11-18 in order):** 60 new functions, 3 replaced, 1 new table, 1 renamed table, 0 data rows lost (there are none to lose), 8 seed rows (4 categories, 4 resorts). The order is forced: 17 must follow 13 and 14 only for *using* the functions, not for creating them; 18 is independent but follows 17 by convention.

### 15.3 Migration 17, statement by statement
| Step | Statement | Effect on the hosted project today |
|---|---|---|
| A | create `co_categories`; insert Agent, Partner, Own, Direct | new table, 4 rows |
| B | add 4 nullable columns to `bookings`; one UPDATE copies category id, category name, kind and stay-type name into them | **0 rows updated** (`bookings` is empty) |
| C | add `category_id` to `agents_partners`; UPDATE maps the old `type` to it | **0 rows updated** |
| D | `create or replace function guard_booking()` (copies of names; switched-off choices) | function body replaced; trigger unchanged |
| E | `set constraints all immediate` / `deferred` | no pending checks (no rows) |
| F | `alter table agents_partners rename to co_entries`; rename its constraints and indexes | triggers, policy, grants, RLS follow the table (verified: 5 triggers, 1 policy, SELECT for `authenticated`) |
| G | **`drop index co_entries_type_name_key`** (replaced by `co_entries_category_name_key`) | an empty table's index |
| H | **`alter table co_entries drop column type`** | the column holds no rows; values were mapped to `category_id` first |
| I | `category_id` NOT NULL, FK, `unique (id, category_id)`, new unique and search indexes | nothing to violate |
| J | rename `bookings.agent_partner_id` to `co_entry_id` (+ its index and foreign-key names) | empty table |
| K | **`drop constraint bookings_co_rules`**, then add the new rule driven by `co_mode` | replaced |
| L | **`alter table bookings drop column co_category`** | no rows; every row would have been converted in B |
| M | the 4 new columns NOT NULL, checks, **composite FK** (`co_entry_id`, `co_category_id`) -> `co_entries (id, category_id)`, index | would fail only if a booking row lacked a conversion: impossible with 0 rows |
| N | **`drop type co_category`**, **`drop type partner_type`** | no remaining user (checked in `pg_depend` terms: only the two dropped columns and `guard_booking`) |
| O | RLS, read policy, grants (SELECT only), no-delete / no-truncate / stamp / audit triggers on `co_categories` | new table follows the same rules as all others |

**Exactly which existing data could be affected:** only rows in `bookings` and `agents_partners`. **Hosted today: 0 and 0.** If either were not empty at apply time, step B/C would convert the rows (proven on a populated database by MIG17-01..07) - but the preflight in HOSTED_VERIFICATION 0 stops the run if the counts are not zero, so that path will not be exercised on hosted unless the owner decides to.
**Side effects by design:** each converted booking's version goes up by one; the four seeded categories have no audit entry (they are inserted before the audit trigger is attached; the four resorts of migration 18 do have one).
**Defects found in 17 during this review and fixed (unapplied file):** a leftover constraint name `bookings_agent_partner_id_fkey` is now renamed `bookings_co_entry_id_fkey`; the conversion test now checks that no constraint or index name anywhere in the schema still contains "agent" or "partner".

### 15.4 Failure behaviour and recovery
- **Atomicity.** The Supabase CLI sends each migration file as one batch, expected to run as a single implicit transaction and to record the version only on success. **This is the expected behaviour and is not verified until the first apply**; if it were wrong, a failure in the middle of 17 could leave a half-converted schema.
- **Why the risk is small and recoverable.** The hosted project holds only reference data (3 stay types, 9 payment apps, 12 system audit rows): nothing a person typed. If anything failed, the complete recovery is to inspect the state (read-only), then - **only with your approval** - correct it or reset the schema and re-apply 01-18. There are no down-migrations.
- **Staged execution reduces the blast radius.** Stage A applies the additive 11-16 (no table touched); stage B applies the destructive 17-18 alone. The CLI cannot apply "the first N" directly, so stage A uses a scratch copy of the migrations folder containing only 01-16 (byte-identical files; the dry run was proven: it lists exactly 11-16). The repository is not modified.
- **Not covered:** no backup is taken (nothing irreplaceable exists; the plan of the Supabase project may not include point-in-time recovery - not checked).

### 15.5 Expected state after a complete, successful apply (exact)
| Item | Before (now) | After 11-16 | After 17-18 |
|---|---|---|---|
| Migration history rows | 10 | 16 | 18 |
| Tables / views / enum types | 19 / 3 / 10 | 19 / 3 / 10 | **20** / 3 / **8** |
| Functions in `public` | 25 | **85** | 85 |
| Callable by signed-in users / by anonymous | 4 / 0 | **38** / 0 | 38 / 0 |
| Triggers in `public` (+1 on `auth.users`) | 97 | 97 | **102** |
| Policies: `public` + `storage` | 18 + 6 | 18 + 6 | **19** + 6 |
| Tables without RLS | 0 | 0 | 0 |
| `co_categories` / `resorts` / `stay_types` / `payment_providers` rows | - / 0 / 3 / 9 | same | **4 / 4** / 3 / 9 |
| `bookings`, `co_entries`, payments, refunds, profiles, auth users | 0 | 0 | 0 |
| Audit rows | 12 | 12 | 16 |
| Types `co_category`, `partner_type`; columns `bookings.co_category`, `co_entries.type` | exist | exist | **gone** |
(Figures computed from a fresh local build of migrations 01-18; Stage A figures follow from 60 new functions all being created in 11-16.)

### 15.6 Rehearsal as the hosted role (new evidence)
The same 355 database tests and 18 simultaneous-request tests were run on real PostgreSQL 17.11 with **migrations 01-18 executed as a plain, non-superuser role named `postgres`** (CREATEROLE, BYPASSRLS, owns what it creates), exactly the hosted role's attributes: **all pass.** A first attempt with a differently named role failed in migration 08 ("permission denied to change default privileges") - a flaw of that attempt, not of the migrations: migration 08 says `alter default privileges for role postgres`, so the rehearsal role must really be named `postgres`. This rehearsal does **not** reproduce Supabase's `supautils` extension, PostgREST, the real Auth and Storage services, or object ownership by `supabase_admin`.

## 16. Migration 19: re-authentication grants (O3), APPLIED to hosted 2026-11-12 and verified (HOSTED_VERIFICATION 0i)

File: `supabase/migrations/20261111000019_reauth_grants.sql`. Approved by the owner 2026-11-11 as hardening for Security Advisor finding F1 (`SECURITY.md` section 15), then revised after the independent review (M1 grants bound to the exact operation, M2 attempts reserved atomically before the password, L2 no grant id returned, L3 audit rows readable by Owners only). Migrations 01-18 are untouched. The planned M3 dashboard-functions migration is now number **20**.

| Item | Detail |
|---|---|
| Purpose | The database refuses a protected Owner action unless a single-use, 60-second grant exists for exactly this user, action, account and operation |
| New objects | table `reauth_grants` (RLS on, no policy, no privilege for any role, no-delete and no-truncate triggers like every table); functions `reauth_begin`, `issue_reauth`, `record_reauth_failure` (service role only) and `consume_reauth` (no one: internal); restrictive policy `"reauth audit rows are for owners"` on `audit_logs` |
| Replaced objects | `profile_create`, `profile_update`, `profile_set_active`, `profile_reset_password`, `profile_change_email` via `create or replace` with **unchanged signatures** (grants kept). A line comparison with migration 12 shows only the added Owner-actor check, the `consume_reauth` call and the header changed |
| Destructive operations | **none** (no DROP, no DELETE, no ALTER of existing tables). `check:migrations` passes without any approval marker |
| Data | nothing to convert; the new table starts empty; no existing row is touched; no audit row is changed (the new policy only restricts who may READ rows whose action starts with `reauth_`) |
| Dependencies | 02 (`user_profiles`), 05 (`audit_logs`), 06 (`prevent_delete`, `prevent_truncate`, `guard_user_profiles`), 08 (`audit_logs` policy), 12 (`require_reason`, `optional_reason`, `audit_account_action`, the five functions) |
| Expected hosted state after applying (from a local rebuild) | history 19; tables **21** (RLS on all); functions **89** (85 + 4); callable by signed-in users **38** (unchanged), by anon 0; public triggers 104 (+1 on auth.users = 105); policies 19 public + 6 storage = **26** (+1); columns 314; constraints 191; indexes 84; relations 30; rows unchanged by the migration |
| Exact differences from the state after 18 | +8 columns, +5 constraints, +2 indexes, +2 triggers, +1 table, +1 policy, +4 functions, 5 function bodies changed (the five above), 0 table or column privileges changed |
| Risks | (1) the app code and the migration must ship together: with only the migration, protected Owner actions fail closed with `REAUTH_REQUIRED` (none is reachable today: one Owner); (2) the grant-issuing path needs the secret key (already required for user creation); (3) more code in a security path, mitigated by the tests below; (4) a stolen session can make an Owner's five attempts fail (locks protected actions for up to 15 minutes; sign-in is unaffected) |
| Existing sessions | unaffected: nobody is signed out, no token changes |
| Recovery | additive: with the owner's approval restore the five bodies from migration 12 with `create or replace`, drop the policy, the four functions and the table (it holds only grants). No data is involved. The refreshed safety export is taken first |
| Preflight and post-apply verification | `npm run preflight:hosted -- --pending=20261111000019` (section 0a of HOSTED_VERIFICATION; P9 checks the five functions on hosted still have exactly migration 12's source); afterwards `npm run catalog:local` and `npm run catalog:compare` (section 0j) must report every category identical |

Tests (all local): REA-01..16 (tests/db/reauth-grants.test.ts, 24 tests, run on PGlite and on real PostgreSQL 17; REA-16 is the 15-minute window with controlled timestamps), CON-19 and CON-20 (real PostgreSQL 17: one grant claimed by six simultaneous calls is used once and only by the call for the confirmed operation; twenty simultaneous attempts reserve at most five), REAUTH-U1..U13 (tests/unit/reauth.test.ts), PRE-U1..U8 and PRE-DB-1 (preflight logic and "migration text equals stored source"), and 24 targeted mutation checks "O3: ..." (23 on PGlite plus the advisory-lock one on real PostgreSQL), all caught.

## 17. Migration 20: dashboard functions, APPLIED to hosted 2026-11-12 and verified (HOSTED_VERIFICATION 0k)
Read-only aggregate functions for the dashboard. All SECURITY INVOKER, so row-level security still applies to every table they read; each begins by refusing a non-active user (`dashboard_range`, NOT_ALLOWED); periods longer than 3,660 days or ending before they start are refused (INVALID_INPUT). Definitions: total collection = approved payments by payment date; waiting = waiting payments by payment date (plus an all-dates item count); refunds = approved by refund date; pending = booking financials as of now; expected = payment-plan rows due in the period; overdue via `booking_overdue(today_ist())`. Tests DSH-01..18 and SEC-04 pass on PGlite, PostgreSQL 17 (superuser and restricted-role) and the concurrency suite. No existing object changes.

### Dashboard definitions (confirmed by the owner, 2026-11-12)
1. **Total Bookings** = bookings whose booking date is in the chosen period, including ones later cancelled.
2. **Today's Check-ins / Check-outs** = bookings checking in / out on today's IST date, excluding cancelled and no-show; independent of the chosen period.
3. **Pending Amount** = the amount due less approved and waiting payments, plus approved refunds (rule D1; never below zero), as of now, independent of the chosen period. Waiting payments count as recorded; waiting refunds change nothing. The separate **Verified Remaining** uses approved money only.
4. **Waiting for Approval** = waiting payments by payment date in the chosen period; the card also states how many waiting payments and refunds exist across all dates.

Applied alone after preflight P1-P9, a dry run and a verified safety export. Hosted afterwards equals a local rebuild in every catalog category (94 functions, 43 callable by signed-in users, 0 by anon/PUBLIC). Not yet tested: a real authenticated call, and the page against hosted in a browser.

## 18. Migration 21: booking and guest lists (local only, awaiting approval)
`booking_list(...)` returns one page (at most 100 rows) of bookings with their money figures from `booking_financials` and the total number of matches; `guest_list(...)` returns guests with their booking count, last check-in and money totals; `like_safe(text)` makes search text safe for LIKE. Security: SECURITY INVOKER (row-level security of every table still applies), refuse a caller who is not an active user (NOT_ALLOWED), no dynamic SQL (every filter is a parameter), search text escaped, filters are `NULL` = off. Definitions: Pending is `booking_financials.pending_paise` unchanged (rule D1: the amount due less approved AND waiting payments, plus approved refunds, never below zero; waiting refunds are ignored). It is **not** Verified Remaining, which counts approved money only; "Has Waiting" also counts waiting refunds; "Adjusted" means the final amount was changed by hand; the date range filters by IST calendar date. Tests BKL-01..23. No existing object changes.

**Pending is not Verified Remaining.** Pending = max(Due − (Approved + Waiting − Approved refunds), 0): a payment that is recorded but still waiting already lowers it. Verified Remaining = max(Due − (Approved − Approved refunds), 0): only approved money lowers it. Every screen shows Pending from the same view column (booking list, booking page, guest page and totals, dashboard cards and resort table). The guest totals sum it over ALL of a guest's bookings, so an unpaid cancellation or no-show charge (the Amount Due of that booking) is included, exactly as on the booking page.
