# M2 — Database and Authentication: requirement status matrix

M2 is **one milestone**. This is a working audit, generated from the data in the status script; it is not a list of sub-milestones.

| Item | Value |
|---|---|
| Last updated | 2026-11-11 |
| Branch | `main` = `origin/main` at `91a4d13` (CI green on all four jobs; reported by the owner). The only uncommitted changes are documentation updates recording the hosted apply of migration 19 |
| Hosted dev database | PostgreSQL 17.11; **migrations 01-19 applied and verified item by item (019 on 2026-11-12)**; the first Owner exists (password changed); no other user and no business data |
| Hosted Auth (read-only) | signup disabled; email login only; **no Owner account exists** |

## Headline

| Measure | Result |
|---|---|
| M2 requirements in scope | **71** (plus 3 that belong to later milestones) |
| Fully complete (verified at every level possible without your approval) | **12** |
| Built and tested locally / on real PostgreSQL 17, **not yet verified on the hosted project** | **56** |
| Not done | **3** |
| **Built and locally verified** | **96%** |
| **Fully verified (counting hosted checks)** | **17%** |

**M2 is NOT complete.** Migrations are applied. Remaining, each needing you: replace the compromised secret key, then create the real Owner (separate approvals); the dashboard checks (secure email change, sessions, backups); two mailboxes and test users for the real-login checks (RSV-06/07/08); browser run of the settings screens; commit of the documentation.

Status key: ✅ complete · 🟡 built and tested locally, hosted verification pending · ❌ not done · ➡️ belongs to a later milestone

**Test levels** — *PGlite*: in-memory PostgreSQL with my copy of Supabase's parts. *PG17*: a real PostgreSQL 17.11 server (throw-away, local; the CI job uses the same tests). *Hosted*: the real Supabase dev project (read-only checks so far). *Unit/fakes*: plain code tests with stand-ins.

## A. Authentication (PRD FR-AUTH-1, 2, 5, 6, 8)

| # | Requirement | Where | Tests | Missing | Status |
|---|---|---|---|---|---|
| A1 | Email + password login, validation, clear errors, redirect | src/lib/auth/actions.ts `login`, src/app/login | AUTH-U1..U4, U11/U12 (unit); signed-out smoke run of the built app | Real sign-in against Supabase Auth (needs an account) | 🟡 |
| A2 | Logout, session ended, protected pages blocked afterwards | `logout` action; proxy + `requireUser` | smoke run: protected pages redirect when signed out | Real sign-out/sign-in cycle on hosted | 🟡 |
| A3 | Forgot password (Owner accounts only), reset link, expired/used link handling | `requestPasswordReset`, /auth/callback, /reset-password | AUTH-U8..U10 (redirect safety); callback with a bad code redirects (smoke) | Real email + link (built-in email reaches only Supabase-team addresses; production needs custom SMTP) | 🟡 |
| A4 | Public signup stays disabled | Hosted Auth setting; no signup route in the app | Hosted: public settings read (`disable_signup=true`); smoke: /signup redirects to sign in | — | ✅ |
| A5 | Server-side session validation and refresh, no reliance on the browser | src/lib/auth/session.ts, src/lib/supabase/proxy.ts | unit tests for the redirect rules; build + smoke run | Session expiry and refresh on hosted | 🟡 |
| A6 | Active-user check, disabled users blocked | `getSession` (profile read under RLS) + `is_active_user()` | SEC-*, USR-*, ACC-06, ACM-16, STO-DB4/6 (PGlite and PostgreSQL 17) | Hosted disabled-user test (needs accounts) | 🟡 |
| A7 | Role-based route protection, not client-only | `requireUser({ role })`; Owner rules enforced by the database | ACU-04 (unit), OWN-*/ACM-* (database) | No page is Owner-only by design (Q10: same operational access); Owner-only actions are enforced in database + server actions | 🟡 |
| A8 | Forced change of a temporary password | `complete_password_change` (migration 11), /change-password | ACC-01..10 (PGlite + PG17) | Migration 11 is applied on hosted; the real flow is untested (needs the Owner) | 🟡 |
| A9 | Every business action records the logged-in user (not the browser's claim) | audit + stamp triggers; functions use `auth.uid()` | AUD-*, BKF-01/02, PAF-01/02 (PGlite + PG17) | Hosted session check | 🟡 |

## B. Account management and Owner protection (FR-AUTH-3..16)

| # | Requirement | Where | Tests | Missing | Status |
|---|---|---|---|---|---|
| B1 | Add / edit / switch off / switch on a person; list; details; history | migration 12; src/lib/accounts/actions.ts; /users pages | ACM-01..16 (PGlite + PG17); ACU-* (unit) | Browser run against hosted (needs the Owner; migration 12 is applied) | 🟡 |
| B2 | Nobody switches off their own account | guard + `profile_set_active` + server action | ACM-13 | — | 🟡 |
| B3 | Switched-off person locked out at once | `is_active=false` (RLS) + Auth ban in the server action | ACM-12/16, STO-DB4/6 | Auth ban call untested on hosted | 🟡 |
| B4 | Every account action audited, with reason, no passwords | audit trigger (reason via `app.reason`), `audit_account_action` | ACM-01/03/10/21/24 | — | 🟡 |
| B5 | At least one active Owner, also under simultaneous requests (O5) | `guard_user_profiles` (table-wide lock) | OWN-02/03 (PGlite); CON-04 (real PG 17, 5 rounds); mutation check removes the lock → caught | Hosted re-check with real accounts (functions are applied) | 🟡 |
| B6 | Protected actions on an Owner only by another active Owner (O1) | guard + explicit checks in 12 | OWN-11..13, ACM-14/18/20 (PGlite + PG17) | — | 🟡 |
| B7 | Only an Owner gives the Owner role; nobody changes their own role (O2) | guard + `profile_update` | ACM-02/08/09/10 | — | 🟡 |
| B8 | Reason (10+ chars) + the acting person's own password + dashboard notice (O3) | `gate()` in actions.ts; `verifyPassword`; `describeOwnerEvent`; home page | ACU-01..12 (rules, wording); ACM-03/10/21 (reason in audit) | The password check calls Supabase Auth: untested against the real service | 🟡 |
| B14 | Protected Owner actions need the database's re-authentication grant (O3): single use, 60 seconds, bound to the acting user, the action, the account AND the exact operation; only the server (secret key) can issue it; attempts are reserved under a lock before the password is tried (5 per 15 minutes); audit rows readable by Owners only | migration 19; src/lib/accounts/reauth.ts; gate() in src/lib/accounts/actions.ts | REA-01..16 (incl. the 15-minute window), CON-19/20 (real PG17), REAUTH-U1..13, 24 mutation checks | Applied to hosted 2026-11-12 (RSV-18); the real Supabase Auth password check and a real grant used by a real session need a second Owner | 🟡 |
| B9 | Owner recovery by server script (O4) | `recover_owner_account` (service role only); scripts/recover-owner.ts | ACM-23..26 (PGlite + PG17); REC-01..04 (fakes) | Script never run against hosted | 🟡 |
| B10 | Works with exactly one Owner; visible notice (O5) | /users and home page notices; guard | OWN-*; FUO-DB-3 | — | 🟡 |
| B11 | Second Owner added later in the app (O6) | AddUserForm + `profile_create` (reason + password) | ACM-02/03, ACU-03/04 | Browser run | 🟡 |
| B12 | Verified own-email change (O7) | trigger on `auth.users` (exists on hosted); My Account → `changeOwnEmail` | EML-03..07 (PGlite + PG17): confirmed address copied and audited, no direct edit, no sync switch abuse, rollback keeps Auth and profile equal. Expired/reused links and the emails themselves are Supabase Auth behaviour: only testable with real mailboxes | RSV-08: two real mailboxes | 🟡 |
| B13 | First Owner creation, once, hidden password, forced change, audited | scripts/create-first-user.ts + scripts/lib/first-owner.ts | FUO-01..06 (fakes); FUO-DB-1..3 (PGlite + PG17) | REAL RUN needs your approval and the rotated Secret Key | 🟡 |

## C. Database write functions (DATABASE_SCHEMA §5)

| # | Requirement | Where | Tests | Missing | Status |
|---|---|---|---|---|---|
| C1 | Accounts: `profile_create/update/change_email/set_active/reset_password`, `active_owner_count`, `recover_owner_account` (`log_account_action` replaced by explicit audit inside each function) | migration 12 | ACM-01..27 | Applied to hosted 2026-11-11 and compared with a local rebuild (RSV-17). Remaining: first real call as a signed-in user (needs the Owner) | 🟡 |
| C2 | Master data: resort, guest, C/O category and name, stay type, payment app (all configurable by Managers and Owners) | migration 13 | MDF-01..11, CFG-* | Applied to hosted 2026-11-11 and compared with a local rebuild (RSV-17). Remaining: first real call as a signed-in user (needs the Owner) | 🟡 |
| C3 | Booking: create (server-built Booking ID, amounts), update, status, cancel, no-show, charge correction | migration 14 | BKF-01..35; CON-01..03, 09 | Applied to hosted 2026-11-11 and compared with a local rebuild (RSV-17). Remaining: first real call as a signed-in user (needs the Owner) | 🟡 |
| C4 | Plan: `apply_plan_change`, `set_payment_schedule`, `plan_preview` (D2) | migration 14 | BKF-23..27, 40; CON-10 | Applied to hosted 2026-11-11 and compared with a local rebuild (RSV-17). Remaining: first real call as a signed-in user (needs the Owner) | 🟡 |
| C5 | Payments: add, edit while waiting, approve, reject, reverse, proofs | migration 15 | PAF-01..23, 40..41; CON-06, 08, 11 | Applied to hosted 2026-11-11 and compared with a local rebuild (RSV-17). Remaining: first real call as a signed-in user (needs the Owner) | 🟡 |
| C6 | Refunds: add, edit while waiting, approve, reject, reverse (D1, D5, Q12) | migration 15 | PAF-30..37; CON-05, 07 | Applied to hosted 2026-11-11 and compared with a local rebuild (RSV-17). Remaining: first real call as a signed-in user (needs the Owner) | 🟡 |
| C7 | Correction files (Q9a) | migration 15 `add_correction_files` | PAF-42/43 (originals identical, balances identical) | Applied to hosted 2026-11-11 and compared with a local rebuild (RSV-17). Remaining: first real call as a signed-in user (needs the Owner) | 🟡 |
| C8 | App-side typed layer over the functions, plain-English errors, no secret key | src/lib/db/*, src/lib/errors.ts | ERR-01..04 (every database error code has a message), DBC-01..04 | Used by the booking/payment screens in M4/M5 | 🟡 |
| C9 | PDF pipeline functions `register_pdf_version`, `claim_pdf_jobs` | — | — | Belong to the PDF milestone (M6); jobs are already queued by every function | ➡️ |
| C10 | Report functions | — | — | Belong to M8 | ➡️ |

## D. Storage (SECURITY §5)

| # | Requirement | Where | Tests | Missing | Status |
|---|---|---|---|---|---|
| D1 | Three private buckets with size/type limits | migration 09 (applied) | Hosted: catalog read; STO-DB1 | — | ✅ |
| D2 | Policies: active users add (well-formed names only) and read; nobody replaces or deletes | migration 09 (applied; six policies) | STO-DB2..8 (PGlite + PG17) | RSV-07: real login against the real Storage service | 🟡 |
| D3 | Secure upload/download code: server-chosen names, signed upload, content (magic-byte) + size + SHA-256 check, 60-second signed links, own login only | src/lib/storage/* | STO-U1..U10 (unit) | Never run against hosted storage (needs a user) | 🟡 |
| D4 | Stored file must match what the database row says (size, type); wrong booking/kind refused | `parse_files` (migration 15) | PAF-08 | Real Storage metadata field names unverified → fails closed | 🟡 |
| D5 | Q9a: originals immutable, corrections controlled | guards + `add_correction_files` | COR-*, PAF-41..43 | — | 🟡 |

## E. Approved financial and business rules

| # | Requirement | Where | Tests | Missing | Status |
|---|---|---|---|---|---|
| E1 | D1 waiting refunds change no balance; refund limit under concurrency | views + `guard_refund` + `add_refund` | FIN-*, PAF-30/31, CON-05 (10 simultaneous refunds → exactly 3 succeed) | — | 🟡 |
| E2 | D2 past-due rows locked; dated adjustments; plan + adjustments = amount due | guards + `apply_plan_change` | PLN-*, COL-*, BKF-23..26, CON-10 | — | 🟡 |
| E3 | D3 proof for UPI/Card/Cheque (payments and refunds) | `check_proof_rule` + functions | PAY-*, PAF-03/33 | — | 🟡 |
| E4 | D4 nights from IST calendar days, never typed | `calc_booking_amounts` | BKF-03/04/09; IST-01..09 (23:59:59 → 00:00:00 IST, UTC and other offsets, five database session time zones, per-night minimum, leap day and year end, booking-number year); IST-U (same rules in five machine time zones) | — | 🟡 |
| E5 | D5 payment cannot be reversed while refunds depend on it, also against a simultaneous refund | `guard_payment` | REV-*, PAF-36, CON-07 | — | 🟡 |
| E6 | Q9a original proofs immutable; corrections need 10+ char reason; never change balances | guards + function | COR-*, PAF-42 | — | 🟡 |
| E7 | Owner decisions of 2026-11-11: payments on cancelled bookings, status undo needs a reason, reasons 5/10 characters, payment apps, refund limits (running A-D-RA-RW; cancelled A-RA-RW) | migrations 12, 14, 15, 16 | DEC-1..5 (PGlite + PG17); CON-12..14 (real PG17: simultaneous refunds on both kinds of booking); 11 mutation checks | Applied to hosted 2026-11-11 and compared with a local rebuild (RSV-17). Remaining: first real call as a signed-in user (needs the Owner) | 🟡 |
| E8 | Amounts in paise; Booking IDs server-built, unique, per resort and year, gap-free | migrations 03/14 | BKF-01/05/07, CON-01 (20 simultaneous bookings → 20 distinct gap-free numbers) | — | 🟡 |

## G. Configurable C/O, resorts and stay types (owner requirement 2026-11-11)

| # | Requirement | Where | Tests | Missing | Status |
|---|---|---|---|---|---|
| G1 | C/O categories: Managers and Owners add any number, name them freely, choose how bookings use each (pick from a list / typed name / none), rename, switch on/off; nothing fixed | migrations 13, 17; /settings/co | CFG-CO-01..03, 11, 12; MDS-07 | Applied to hosted 2026-11-11 and compared with a local rebuild (RSV-17). Remaining: first real call as a signed-in user (needs the Owner); browser run | 🟡 |
| G2 | C/O names inside list categories: add, edit, switch off; unique per category; cannot move; type-to-search | migrations 13, 17; /settings/co; OptionPicker | CFG-CO-04..08; MDS-01..06 | Applied to hosted 2026-11-11 and compared with a local rebuild (RSV-17). Remaining: first real call as a signed-in user (needs the Owner); browser run | 🟡 |
| G3 | Resorts: unlimited, editable details and logo, switch on/off; code locked after the first booking; Booking IDs never change; no new booking on a switched-off resort | migrations 13, 17, 18; /settings/resorts; storage logo | CFG-RES-01..07; CON-17, 18; MDF-01..05 | Applied to hosted 2026-11-11 and compared with a local rebuild (RSV-17). Remaining: first real call as a signed-in user (needs the Owner); browser run; logo upload on hosted (RSV-07) | 🟡 |
| G4 | Four placeholder resorts at start (Sample Resort One to Four, SR1-SR4), editable, not hard-coded | migration 18 | CFG-RES-01; schema test; MIG17-05 | Applied to hosted 2026-11-11 and compared with a local rebuild (RSV-17). Remaining: first real call as a signed-in user (needs the Owner) | 🟡 |
| G5 | Stay types: unlimited, any name, rename, switch on/off, type-to-search | migrations 13, 17; /settings/stay-types | CFG-STAY-01..04; MDS-* | Applied to hosted 2026-11-11 and compared with a local rebuild (RSV-17). Remaining: first real call as a signed-in user (needs the Owner); browser run | 🟡 |
| G6 | History protected: bookings keep their own copy of category, C/O name and stay type names; renaming/switching off never rewrites or hides old bookings; old bookings with switched-off choices stay readable and editable; new choices must be switched on | guard_booking (migration 17); composite FK | CFG-CO-05..10, 12; CFG-STAY-02/03; MIG17-02; CON-16 | Applied to hosted 2026-11-11 and compared with a local rebuild (RSV-17). Remaining: first real call as a signed-in user (needs the Owner) | 🟡 |
| G7 | Authorization: Manager AND Owner may configure; signed-out, no-profile, switched-off users and anonymous refused; no direct table write; nothing deleted | functions (13), RLS (17) | CFG-CO-11, CFG-RES-07, CFG-STAY-04; SEC-04 | Hosted check with real accounts | 🟡 |
| G8 | Existing data survives the conversion (bookings, entries, money, plans) | migration 17 | MIG17-01..07 (PGlite + PG17); hosted tables are empty (read-only check) | Migration 17 applied on hosted 2026-11-11 (tables were empty, so nothing could be lost; conversion proven locally on a database with bookings, payments and plans) | 🟡 |
| G9 | Settings screens (resorts, C/O, stay types) and the shared type-to-search picker | src/app/(app)/settings, src/components/app | built, type-checked, linted, production build; rules unit-tested | Not exercised in a browser; booking forms that use the picker are M4 | 🟡 |
| G11 | Generated TypeScript types for the database, used by all three Supabase clients, kept in step with the migrations by a test and a reproducible generator | src/lib/supabase/database.types.ts; scripts/gen-types.mts | TYP-01..05; typecheck; generator output identical to the committed file | CI green for the commit that added it (cc94490, owner-reported); no hosted step | ✅ |
| G10 | Booking forms that use the lists | - | - | Booking screens belong to M4 | ➡️ |

## F. Real-environment verification (TEST_PLAN §2.13b)

| # | Requirement | Where | Tests | Missing | Status |
|---|---|---|---|---|---|
| RSV-01/02 | Dry run and apply (migrations 01–10) | hosted | done on 2026-11-11 | Migrations 11-18: applied and verified 2026-11-11 (RSV-17) | ✅ |
| RSV-03 | Whole database suite on PostgreSQL 17 | tests/db with STATEADV_PG_URL; CI job defined | 355 tests pass in each of two local throw-away PostgreSQL 17.11 configurations (superuser, and migrations run as a plain role named postgres like the hosted one); the GitHub job passed for commit 8be574e (owner report) | GitHub Actions for cc94490: green (owner-reported) | ✅ |
| RSV-04 | Concurrency tests | tests/db/concurrency.pg.test.ts | 18 tests pass on real PostgreSQL 17.11; removing the locks makes them fail (checked) | GitHub Actions for cc94490: green (owner-reported) | ✅ |
| RSV-05 | Privilege queries on hosted | hosted | done for 01–10 | Grants of all 85 functions and every table compared with a local rebuild after 18 (RSV-17): identical. Probing as a signed-in user needs the Owner | 🟡 |
| RSV-06 | Anonymous REST probes; a login without a profile sees 0 rows | hosted | anonymous half done (HTTP 401) | The 'login without a profile' half needs a throw-away user | 🟡 |
| RSV-07 | Storage probes with a real login | hosted | — | Needs a user: after the first Owner exists or with a throw-away test user (will ask first) | ❌ |
| RSV-08 | Real email change with two mailboxes | hosted | — | Needs two real mailboxes | ❌ |
| RSV-09 | Supabase advisors | hosted | done for 01–10 (no errors/warnings) | Advisors need the dashboard or a token: ask the owner to open Advisors once | 🟡 |
| RSV-10 | Exposed API surface | hosted | done for 01–10 | Anonymous REST probes after 18: tables 401, functions 404/401 (done 2026-11-11) | 🟡 |
| RSV-11 | IST midnight boundaries | tests/db/ist-midnight.test.ts; tests/unit/ist-midnight.test.ts | IST-01..09 (PGlite + PG17) and IST-U in five machine zones: 34 tests pass; today_ist() is independent of the session zone. The wall clock itself cannot be moved, so the instant of the real midnight is tested through fixed instants | IST tests ran in the green CI for cc94490 (owner-reported); today_ist() on hosted is read-only checkable any time | ✅ |
| RSV-12 | Hosted preconditions for migrations 11-18 (read-only): history, structure, exact row counts, dependants of what migration 17 drops, name collisions, privileges, storage, Auth settings | hosted | done 2026-11-11: history 10; every table that 17 changes holds 0 rows; only guard_booking depends on the dropped objects; no collisions | Re-run as the preflight just before any apply | ✅ |
| RSV-13 | Migrations 01-18 run as a NON-superuser role named postgres (hosted-role rehearsal) | tests/db with STATEADV_PG_RESTRICTED=1; CI job database-postgres-17-restricted | 355 + 18 tests pass on real PostgreSQL 17.11 | The CI job database-postgres-17-restricted passed for cc94490 (owner-reported); Supabase's own extensions, PostgREST, Auth, Storage are not part of it | ✅ |
| RSV-14 | Dashboard-only settings: Secure email change ON, session lifetime / refresh-token rotation (FR-AUTH-2, FR-AUTH-16) | hosted dashboard | - | Only the project owner can look: not readable through the public API | ❌ |
| RSV-15 | Who may decide payments and refunds; repeated and unknown-id decisions (second approver) | approve/reject/reverse functions (migration 15) | PAF-20..22, 35, 36 and PAF-50..55 (no session, unknown user, anon, switched-off user, unknown id, repeats, session-stamped approver) | Real two-person run in the browser needs two logins (after the first Owner exists) | 🟡 |
| RSV-16 | Unauthenticated access to every settings and user page from a production build | local production server against the hosted project | done 2026-11-11: /settings/resorts, /settings/co, /settings/stay-types, /users all redirect to /login?next=...; /login and /api/health answer 200; sign-up refused (422 signup_disabled) | Logged-in screens need migrations 11-18 and accounts | ✅ |
| RSV-17 | Migrations 11-18 applied to the hosted project in stages and verified item by item against a local rebuild | hosted | done 2026-11-11: history 18; every catalog category identical to the local build; 85 functions, 38 for signed-in users, 0 for anon; 4 placeholder resorts; 4 C/O categories; reference data intact | Functions have not yet been exercised by a signed-in user (needs the Owner) | ✅ |
| RSV-18 | Migration 19 (O3 re-authentication grants) applied to the hosted project and verified with preflight P1-P9 and a catalog comparison against a local rebuild | hosted | done 2026-11-12: preflight P1-P9 passed; applied alone; every catalog category identical to the local rebuild (history 19, 21 tables, 89 functions, 38 callable by signed-in users, 0 by anon, 26 policies, 105 triggers); data, Owner and 18 audit rows unchanged; anonymous access refused | A real grant used by a real session needs a second Owner | ✅ |

## What I need from you (nothing below has been done)

| Step | Why |
|---|---|
| Approve pushing the local commits | CI (including the new PostgreSQL 17 job) can then run on GitHub |
| Replace the dev Secret Key, then approve the first-Owner run | Your own rule; the script asks for it before it creates anything |
| Provide two mailboxes for RSV-08 and allow throw-away test users for RSV-06/07 | Cannot be done without them |
