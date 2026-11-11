# M2 — Database and Authentication: requirement status matrix

M2 is **one milestone**. This file is a working audit, not a sub-milestone list.

| Item | Value |
|---|---|
| Audit date | 2026-11-11 |
| Repository | `main` at `92ecd3d` (clean, pushed) |
| Hosted database | dev project `prfarsersxoeavcqydez`, PostgreSQL 17.11, ten migrations applied and verified read-only |
| Hosted Auth (public settings, read-only) | signup disabled, email is the only login method, email confirmation required, no anonymous users |
| App code | health check route, Supabase client helpers, proxy that only refreshes the session. **No login, logout, recovery, protected area or screens exist yet.** |

Status key: ✅ done and tested at the level stated · 🟡 partly done · ❌ not started · 🔒 needs your approval before it can happen

Test level key: **PGlite** = in-memory PostgreSQL 18 with my stand-in for Supabase. **Hosted** = read-only checks on the real dev project. **PG17** = real PostgreSQL 17 in CI (not built yet). Nothing below is called "tested on real Supabase" unless the Hosted column says so.

---

## A. Authentication (PRD FR-AUTH-1, 2, 5, 6, 8; SECURITY §2)

| # | Requirement | Expected | Current implementation | Where | Existing tests | Missing | Status |
|---|---|---|---|---|---|---|---|
| A1 | Email + password login | Server-side sign-in, clear errors, redirect | None | — | — | Login page, server action, validation, error text | ❌ |
| A2 | Logout | Server-side sign-out, back to login, protected pages blocked | None | — | — | Action, button, tests | ❌ |
| A3 | Forgot password (Owner accounts only, FR-AUTH-13.1) | Email link, reset page, expired/invalid link handling | None | — | — | Request page, callback route, reset page, tests. Needs working email (built-in sender only reaches Supabase team addresses). | ❌ |
| A4 | Public signup disabled | No self-signup | Hosted setting is `disable_signup = true`. App has no signup page. | Hosted Auth | Hosted: public settings read | A test that the app exposes no signup route | 🟡 |
| A5 | Session security | Server-side check on every request; session refresh | Proxy refreshes the session with `getClaims()` | `src/lib/supabase/proxy.ts` | `health.test.ts` only | Redirect to login, data-access layer (`getUser` + active check), cookie handling tests | 🟡 |
| A6 | Active-user check | Disabled user cannot act | Database: `is_active_user()` used by every read policy; disabled profile reads nothing | migration 02, 08 | PGlite: SEC-*, USR-* | App must call it and sign the user out; Auth ban on disable | 🟡 |
| A7 | Role-based route protection | Server-side, not client-only | Role stored in `user_profiles.role` | migration 02 | — | Layout/route checks; role needed only for Owner-protected pages | ❌ |
| A8 | Forced password change (FR-AUTH-5) | New / reset users must change password before using the app | Column `must_change_password` (default true); guard blocks other users from clearing it | migration 02, 06 | PGlite: USR-* | Change-password page, proxy redirect, a function that clears the flag for the user's own account | 🟡 |
| A9 | Business actions record the user (FR-AUTH-8) | `auth.uid()` in triggers | Audit triggers on all business tables; `created_by`/`updated_by` from `auth.uid()` | migration 05, 01 | PGlite: AUD-*, 272 tests | Real-session check on hosted | 🟡 |

## B. Account management and Owner protection (FR-AUTH-3, 4, 7, 9–16)

| # | Requirement | Expected | Current implementation | Where | Existing tests | Missing | Status |
|---|---|---|---|---|---|---|---|
| B1 | Add / edit / disable / enable user (FR-AUTH-3) | Any active user; audited | Table, guard trigger, audit trigger. **No write function and no screen** | `guard_user_profiles` (06) | PGlite: USR-01..07 (rules only) | `profile_create`, `profile_update`, `profile_set_active`, user list/create/edit screens, Auth admin calls (create, ban, unban) | 🟡 |
| B2 | No self-disable (FR-AUTH-4) | Blocked in app and database | Database guard | `guard_user_profiles` | PGlite: USR-03 | App check + function check | 🟡 |
| B3 | Disabled user locked out (FR-AUTH-6) | Cannot log in or act; history kept | RLS stops reads at once | migration 08 | PGlite | Auth ban + refresh-token invalidation (needs Auth admin call) | 🟡 |
| B4 | Account actions audited (FR-AUTH-7) | Who, to whom, when; no passwords | Audit trigger on `user_profiles` records old/new, actor, target | migration 05 | PGlite: AUD-03, OWN-* | `log_account_action` for non-row actions (password reset, owner_recovered) | 🟡 |
| B5 | At least one active Owner (O5, FR-AUTH-9) | Never zero, even concurrently | Guard under table lock | `guard_user_profiles` | PGlite: OWN-02, OWN-03, OWN-06 (single connection only) | PG17 concurrency test (RSV-04) | 🟡 |
| B6 | Protected actions on an Owner (O1) | Only another active Owner | Guard | same | PGlite: OWN-11..13 | Function layer + screens | 🟡 |
| B7 | Only an Owner grants Owner (O2) | Manager cannot self-promote | Guard | same | PGlite: OWN-* | Function layer | 🟡 |
| B8 | Reason + password re-entry + alert (O3) | Reason stored, password rechecked, alert for all users | **Nothing yet.** Password re-check must happen in the server action (cannot be done in the database); alert needs a read function over the audit log | — | — | Server action re-check on a separate non-persisted client, reason column/field in audit, alerts function and banner | ❌ |
| B9 | Recovery (O4, FR-AUTH-13.2) | Server script re-enables an Owner, audits `owner_recovered` | **Nothing yet** (`recover_owner_account` does not exist) | — | — | Function (service role only), `scripts/recover-owner.ts`, tests | ❌ |
| B10 | One Owner works safely (O5, FR-AUTH-14) | Sole Owner cannot disable/demote self; notice shown | Guard blocks both | same | PGlite | Notice on Users page and dashboard | 🟡 |
| B11 | Add second Owner later (O6, FR-AUTH-15) | Existing Owner, reason, password | Guard allows Owner-by-Owner | same | PGlite | Add-user function + screen + re-check | ❌ |
| B12 | Verified own-email change (O7, FR-AUTH-16) | Password check, both links confirm, profile follows only the confirmed address | Trigger `trg_sync_profile_email` on `auth.users` (**exists on hosted**), guard blocks direct edits | migration 06 | PGlite: EML-03..07 | My Account screen + server action; **hosted two-mailbox test (RSV-08)** — needs Supabase team mailboxes | 🟡 |
| B13 | First Owner script | Created once, hidden prompt, forced change, audited | **Nothing yet** | — | — | `scripts/create-first-user.ts` + tests on a local fake; 🔒 real run needs your approval and a rotated key | ❌ |

## C. Database write functions (TRD §2, DATABASE_SCHEMA §5)

All writes are currently impossible for app users (only `SELECT` is granted). That is correct security, but nothing can be saved until these exist. No function below exists yet; the guard triggers (which already enforce the money rules) are the safety net under them.

| # | Group | Functions (DATABASE_SCHEMA §5) | Rules the guards already enforce | Existing tests | Status |
|---|---|---|---|---|---|
| C1 | Account management | `profile_create`, `profile_update`, `profile_set_active`, `log_account_action`, `active_owner_count`, `recover_owner_account` | O1, O2, O5, self-disable | PGlite rules only | ❌ |
| C2 | Master data | `upsert_resort`, `set_resort_active`, `upsert_agent_partner`, `upsert_guest`, `upsert_stay_type`, `upsert_provider` | resort-code lock, mobile normalising | PGlite | ❌ |
| C3 | Booking | `next_booking_code` (internal), `create_booking`, `update_booking`, `set_booking_status`, `cancel_booking`, `change_cancellation_charge` | ID format, amount formula, C/O, cancellation | PGlite BID/AMT/CO/CAN | ❌ |
| C4 | Plan | `set_payment_schedule`, `plan_preview` | plan balances, past-due lock, adjustments (D2) | PGlite PLN/COL | ❌ |
| C5 | Payments | `add_payment`, `update_waiting_payment`, `add_proofs`, `hide_proof`, `approve/reject/reverse_payment` | proof rule (D3), reversal (D5), self-approval flag | PGlite PAY/APR/REV | ❌ |
| C6 | Refunds | `add_refund`, `update_waiting_refund`, `approve/reject/reverse_refund` | refund limit under booking lock (D1) | PGlite REF | ❌ |
| C7 | Correction files | correction-file function | Q9a (original proof untouched) | PGlite COR-01..07 | ❌ |
| C8 | PDF pipeline | `register_pdf_version`, `claim_pdf_jobs` | version order | PGlite | ❌ (belongs to the PDF work, queued by C3–C6) |

Note: the document list also contains report functions; those belong to later milestones (M8) and are not part of M2.

## D. Storage (SECURITY §6)

| # | Requirement | Current | Tests | Missing | Status |
|---|---|---|---|---|---|
| D1 | Three private buckets with size/type limits | Created on hosted: `payment-proofs` (10 MB, images + PDF), `booking-pdfs` (10 MB, PDF), `resort-logos` (2 MB, images) | Hosted: read-only catalog check | Upload probes | 🟡 |
| D2 | Storage policies: active users add and read, no update/delete | Six policies on `storage.objects`, exist on hosted | PGlite: SEC-* | **Hosted probes with a real login (RSV-07)** — need a real user, so after the Owner exists, or a throw-away test user | 🟡 |
| D3 | App upload/download code | None | — | Signed upload URL action, server check of size, real file type (magic bytes) and SHA-256, signed download URLs | ❌ |
| D4 | Q9a original proof is immutable | Database guard + `correction_files` view | PGlite COR-* | Storage-side behaviour (no overwrite) hosted | 🟡 |

## E. Financial and business rules (D1–D5, Q9a)

The rules live in guard triggers and views. They are verified by 181 PGlite tests and a 19-variant mutation check. Not yet verified on PG17 (RSV-03) or under real concurrency (RSV-04). The write functions in section C must call into them, and each function needs its own test (MIGRATION_REVIEW §12.4 lists the rules the functions themselves must enforce, such as duplicate-reference warnings and the five-files limit).

| Rule | Guard | Status |
|---|---|---|
| D1 balances / refund limit | `booking_financials`, `guard_refund` | 🟡 (PGlite) |
| D2 expected collection history | `guard_schedule`, `guard_adjustment` | 🟡 (PGlite) |
| D3 proof required for UPI/Card/Cheque | `check_proof_rule` | 🟡 (PGlite) |
| D4 nights | generated column + guard | 🟡 (PGlite) |
| D5 reversal protection | `guard_payment` | 🟡 (PGlite) |
| Q9a correction files | `guard_proof`, `correction_files` | 🟡 (PGlite) |
| Paise internally, IST dates | `src/lib/money.ts`, `dates.ts`, SQL | ✅ unit tests; hosted `today_ist()` checked once |

## F. Real-environment verification (TEST_PLAN §2.13b)

| ID | Check | Level so far | Status |
|---|---|---|---|
| RSV-01/02 | Dry run, apply | Hosted ✅ | ✅ |
| RSV-03 | Whole DB suite on PostgreSQL 17 | none | ❌ build a CI job (disposable Postgres 17 container; the hosted dev database must not be used) |
| RSV-04 | Concurrency tests | none | ❌ same job |
| RSV-05 | Privilege queries | Hosted ✅ (anon none, authenticated select-only, four functions) | ✅ |
| RSV-06 | Anonymous REST probes | Hosted ✅ (401) | 🟡 the "login without a profile sees 0 rows" half needs a throw-away user |
| RSV-07 | Storage probes | none | ❌ |
| RSV-08 | Two-mailbox email change | none | ❌ needs real mailboxes |
| RSV-09 | Advisors | Hosted ✅ (no errors/warnings; 78 info notes) | ✅ |
| RSV-10 | API surface | Hosted ✅ (4 functions, no table writable) | ✅ (re-run after new functions) |
| RSV-11 | IST midnight | PGlite only | ❌ |

## G. Planned order of work (one milestone, working order only)

1. **Authentication in the app** — login, logout, forgot/reset password, change password, protected area, session handling, data-access layer. App code only; no database change; testable locally.
2. **Write functions** — one new, ordered migration (or a few), PostgreSQL 17 reviewed, tested in PGlite; **applied to Supabase only after your separate approval.**
3. **User management** — screens, server actions, Auth admin calls, password re-entry, reason, alerts, recovery script, first-Owner script (tested against a local fake; real run is 🔒).
4. **Storage code** — signed upload/download, checks.
5. **Real PostgreSQL 17 CI job** — all DB tests plus concurrency tests.
6. **Documentation, sign-off report.**

## H. Approvals still ahead

| Action | Approval needed |
|---|---|
| Apply each new migration to the hosted dev project | yes, after a dry run |
| Rotate the dev Secret Key, then create the first Owner | yes (rotation is your action in Supabase; creation needs separate approval) |
| Hosted storage / email-change probes | need test users; I will ask before creating any |
| Push commits | yes |
