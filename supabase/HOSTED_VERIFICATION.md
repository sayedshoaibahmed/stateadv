# Checks on the real Supabase development project

**Nothing in this file has been run yet** (status per check below). Each check says what it needs, exactly what to do, and what a pass looks like. Everything uses fictional data. None of it touches production.

Rules for every check
- Use the development project only. Never print or paste the connection string, the Secret Key or any password into chat, tickets or logs.
- Test accounts use addresses you control (`you+owner-test@…`). Delete nothing: switch test people off instead; the system never deletes records.
- Do not mark a check as passed unless its "pass" line was actually observed.

## 0. Applying migrations 11-18 (APPLIED and verified 2026-11-11, see 0h)

Commit and push the current local changes first and wait for GitHub Actions to be green, so that the files applied are the files on GitHub.

### 0a. Preflight (read-only; every line must hold, otherwise STOP and report)

`npm run preflight:hosted` (optionally `-- --pending=<version>[,<version>...]` to assert the exact pending list). Nothing is hard-coded: it reads the migration files, reads the hosted history and requires the history to be exactly the first N files, in order, with the same names; everything after that is pending. It only SELECTs (the Supabase CLI runs every query with `--read-only`) plus a dry run, and redacts every part of the connection string.

| Check | What it proves |
|---|---|
| P1 | hosted history = the first N repository files (versions, names, order); the pending files are identified |
| P2 | each pending migration with a destructive statement has declared preconditions in `supabase/preflight.json` (tables that must be empty, objects that must exist, only listed dependants, no clash with inserted rows) and they hold; additive migrations need none |
| P3 | nothing the pending files create (tables, functions) exists yet; every function they replace does |
| P4 | the Supabase CLI dry run lists exactly the pending files, in order |
| P5 | the working tree is clean and equals `origin/main` |
| P6 | every pending file exists on `origin/main`, identical to the working copy |
| P7 | no pending migration has a destructive statement without its approval comment |
| P8 | pending versions come after the latest applied one and are strictly increasing |
| P9 | baseline: every function a pending file replaces has, on hosted, exactly the source of its LAST applied definition in the repository (`pg_proc.prosrc`), and the new policy names are free |

A destructive migration with no entry in `supabase/preflight.json` fails P2: add its preconditions before it can be applied. The script was rehearsed on 2026-11-11 against a LOCAL database that pretends to be the hosted project: at history 18 it finds exactly migration 19 pending (P5 and P6 fail only because the change is not yet committed and pushed), at history 19 it reports nothing pending, and a tampered history name is rejected by P1.

### 0b. Checks only you can do (dashboard)
The public API cannot show these. Please look and tell me:
1. **Secure email change is ON** (Authentication -> Providers/Sign-in -> Email). Required by FR-AUTH-16.
2. **Session lifetime**: JWT expiry 3600 s and refresh-token rotation ON (Project Settings / Authentication -> Sessions). Required by FR-AUTH-2 / SECURITY section 2.
3. Which Supabase plan the project is on (whether daily backups / point-in-time recovery exist).
(Menu names differ between dashboard versions.)

### 0c. Proposed execution (staged)
| Step | Action | Stop and report if |
|---|---|---|
| 1 | Preflight 0a | any line fails |
| 2 | **Stage A** - additive 11-16: `db push --skip-vault --yes --workdir <scratch copy of the migrations folder containing only 01-16>` | any error |
| 3 | Verify stage A (read-only): history 16 rows; functions **85**; callable by signed-in users **38**, by anonymous **0**; tables 19, policies 18 + 6; `recover_owner_account` executable by `service_role` only; anonymous probe of one new function returns 401 | any difference |
| 4 | **Stage B** - destructive 17-18: `db push --skip-vault --yes` from the repository | any error |
| 5 | Verify the final state against the table in MIGRATION_REVIEW 15.5 (history 18; tables 20, enums 8, triggers 102, policies 19 + 6; `co_categories` 4 rows; resorts 4; types and old columns gone; RLS everywhere) | any difference |
| 6 | `db advisors`; anonymous REST probes of the new table and one new function (expect denial) | any error or warning that is new |
| 7 | **Stop.** Report. Do not create the Owner, do not start M3. | |
Nothing in this sequence creates an account, changes a credential or deploys.

### 0d. The migration approval request (one batch; nothing below has been done)

| Item | Detail |
|---|---|
| Files | 20261111000011 ... 20261111000018 (eight files, contiguous after 10; 01-10 unchanged and byte-identical to what is applied) |
| Destructive operations (all in 17, all marked DESTRUCTIVE-APPROVED) | drop constraint `bookings_co_rules`; drop columns `bookings.co_category` and `co_entries.type` (the renamed `agents_partners`); drop index `co_entries_type_name_key`; drop types `co_category` and `partner_type`. Hosted data they hold: **0 rows** in every affected table (preflight P2, P4) |
| Preconditions | preflight P1-P7 PASS now; P8 passes once the working tree equals GitHub main (it does not while new local test files are uncommitted) |
| Recovery | there are no down-migrations. Hosted holds only reference data (3 stay types, 9 payment apps, 12 system audit rows), so the recovery for any failure is: stop, inspect read-only, then with your approval correct it or reset the schema and re-apply 01-18. Staged apply (A: 11-16, verify, B: 17-18) limits what a failure can touch. **Backup status is unknown until you check the dashboard (0b item 4).** Nothing of value would be lost, so I would not wait for a backup, but tell me if you want one |
| Expected result | history 18; 20 tables, 3 views, 8 enums, 85 functions, 38 callable by signed-in users, 0 by anon; 102 public triggers; 19 public + 6 storage policies; 4 `co_categories`; 4 placeholder resorts; 16 audit rows |
| Verification afterwards | `npm run preflight:hosted` no longer applies; run the read-only queries of section 8 and compare with the expected result above; anonymous REST probes; advisors |
| Stop rule | any failing statement: stop at once, change nothing else, report the exact error |

### 0h. APPLIED to the hosted project, 2026-11-11 (evidence)

Approved by the owner in two steps; applied with `supabase db push` from scratch copies of the migrations folder (stage A: 01-16, stage B: 01-17, then the repository for 18), each preceded by a dry run that listed exactly the files applied. Every run exited 0 with no error. Nothing else was changed (no keys rotated, no users created, no reset, no deployment).

| Stage | Applied | Result |
|---|---|---|
| A | 11 account_self_service, 12 account_management, 13 master_data_functions, 14 booking_functions, 15 payment_refund_functions, 16 refund_limits | success; history 16; 85 functions; 38 callable by signed-in users; 0 by anon and by PUBLIC |
| B1 | 17 configurable_co | success; history 17; tables 20, enums 8, triggers 103 (102 public + 1 on auth.users), policies 19 public + 6 storage |
| B2 | 18 initial_resorts | success; history 18; four placeholder resorts SR1-SR4 "Sample Resort One..Four", all active, no location, contact or logo |

**How it was verified (read-only).** A throw-away PostgreSQL 17 was rebuilt from the same migration files for each stage (01-16, 01-17, 01-18). The same catalog queries were then run on the local rebuild and on the hosted project and compared item by item: columns, constraints, indexes, triggers, policies, functions (definition hash, security definer, volatility, settings), function privileges for anon / signed-in / service_role / PUBLIC, table and column privileges, RLS flags, enums, views, relations. **Every category was identical at every stage** (after 18: 306 columns, 186 constraints, 82 indexes, 103 triggers, 25 policies, 85 functions, 183 table grants, 303 column grants, 20 tables all with RLS, 8 enums, 3 views). The comparison was first calibrated on the state after 16 (before 17 was applied) and matched too. Migration history after 18: exactly 18 rows, versions and names equal the files in git.

Migration 17 specifically: types `co_category` and `partner_type` gone; columns `bookings.co_category` and `co_entries.type` (and `agent_partner_id`) gone; table `agents_partners` renamed to `co_entries`; index `co_entries_type_name_key` gone; new `bookings_co_rules` constraint present; no constraint or index name contains agent/partner; `co_categories` holds Agent (listed), Partner (listed), Own (typed), Direct (none), all active.

Data after 18: stay types 3, payment apps 9, audit rows 16 (12 from before + 4 for the resorts; no audit rows for the seeded categories, as documented), resorts 4, co_categories 4; bookings, co_entries, guests, payments, refunds, proofs, user profiles, Auth users, Storage files all 0; 3 private buckets. Anonymous REST: resorts, bookings, user_profiles, co_categories, co_entries all 401 permission denied; the new functions are not reachable by anon. `npm run check:supabase`: Auth and database API ok.

The safety export taken before the apply is in `stateadv-backups` (outside the repository). This evidence is local and uncommitted until the owner approves a commit.

### 0i. Migration 19 (O3 re-authentication grants): written and tested locally, NOT applied

Separate approval needed. Nothing here has been run on the hosted project. Plan when approved: (1) commit and push with CI green; (2) refresh the safety export (the schema changes); (3) `npm run preflight:hosted -- --pending=20261111000019` must pass P1-P9 (P9: the five functions to be replaced still have exactly migration 12's source on hosted, no name clash for the new table, functions and policy); (4) apply it (additive, no destructive statement) with the usual staged `db push` from a scratch folder; (5) post-apply comparison with a local rebuild (section 0j): expected history 19, tables 21, functions 89, callable by signed-in users 38 and by anon 0, columns 314, constraints 191, indexes 84, triggers 105 (104 public + 1 on auth.users), policies 26, relations 30, rows unchanged; (6) anonymous probes of the four new functions and the table (all refused); (7) the app code that issues grants must be deployed together with it. Full table in `MIGRATION_REVIEW.md` section 16. With only one Owner the real end-to-end check (a second Owner being switched off after a password re-entry) cannot be done on hosted; it is covered locally by REA-*, CON-19 and CON-20.

### 0j. Post-apply comparison with a local rebuild (any migration, no hard-coded numbers)

After ANY apply, prove the hosted structure equals what the migration files describe:
1. Start a throw-away local PostgreSQL 17 (never a Supabase address) and set `STATEADV_PG_URL` (README, "Regenerating the database types").
2. `npm run catalog:local -- --out=catalog.json` rebuilds the local database from the migration files (add `--upto=<version>` to stop at an earlier one) and writes a fingerprint of every function (definition, security-definer flag, settings, privileges for anon / signed-in / service role / PUBLIC), constraint, index, trigger, policy, column, grant, RLS flag, enum and view.
3. `npm run catalog:compare -- catalog.json` (read-only; reads SUPABASE_DB_URL from .env.local; nothing is printed that could contain a credential) requires the hosted migration history to be exactly the migrations the file was built from and every category to be IDENTICAL. Row counts are printed for information only. Exit code 0 only if everything matches.
4. The same method proved migrations 11-18 on 2026-11-11 (section 0h). It was rehearsed again on a local database that pretends to be hosted: identical state passes, a hosted state that is behind fails in every category.

### 0e. Rotating the compromised Secret Key### 0e. Rotating the compromised Secret Key (separate approval)

1. Where the key is used (checked 2026-11-11): `src/lib/supabase/admin.ts` (server only, `import 'server-only'`), `src/lib/env.server.ts` (reads it), `scripts/create-first-user.ts` and `scripts/recover-owner.ts` (one-time scripts reading `.env.local`), `scripts/check-client-bundle.mjs` (only searches the browser files for it). Vercel: not deployed yet, so no Vercel copy exists. GitHub Actions: not used (the CI build uses placeholders).
2. Procedure (you do it, I never see the key): Supabase dashboard -> Project Settings -> API Keys -> create a **new** secret key -> paste it into `.env.local` as `SUPABASE_SECRET_KEY` (replace the old value) -> delete the **old** secret key in the dashboard. Down time: none, nothing runs yet.
3. Verify without printing: `npm run check:supabase`, then `npx tsx scripts/create-first-user.ts --dry-run` (a dry run creates nothing), and a bundle scan.
4. The old key must stop working: I will make one request with the old value from your `.env.local` backup only if you keep it; otherwise deleting it in the dashboard is the proof.

### 0f. Creating the first Owner (separate approval; after 0d and 0e)

The mechanism is `scripts/create-first-user.ts` with `scripts/lib/first-owner.ts`: server-side only (needs the Secret Key from `.env.local`), refuses to run when any profile exists, refuses an existing login, creates the Auth user and then the profile through the database (a failed profile removes the new login), asks for the password through a hidden prompt and never prints or stores it (tests: FOW-*, FIRSTOWNER unit tests). Steps after your approval and your Owner's name and email: dry run, real run (you type the password), sign in, forced password change, then sections 1-3 below.

### 0g. Browser checks of the settings screens (need 0d and an account)

The unauthenticated side is verified (RSV-16). The logged-in side needs migrations 11-18 and the Owner. Steps, each in a normal and a narrow (360 px) window: (1) Settings -> Resorts: list shows four placeholder resorts; edit one (name only), switch one off and on, try a code that already exists (plain error), try an empty name (message, nothing saved). (2) Settings -> C/O: four starting categories; add a category in each mode (listed / typed / none); add, rename, switch off a name; type in the picker to search; an empty name is refused. (3) Settings -> Stay types: add, rename, switch off. (4) Sign in as a Manager (created in People): Manager can use the same pages; People page is not offered. (5) Switch the Manager off in People: the next page load sends them to the login page. (6) Slow network (browser throttling): loading placeholders appear, no blank page. Use clearly fictional names and delete nothing; switch off instead.

## 1. First Owner (needs approval + replaced Secret Key) — status: not run
1. `npx tsx scripts/create-first-user.ts --dry-run` → "Dry run: nothing was created."
2. After approval: real run in your own terminal. **Pass:** one `user_profiles` row (role owner, active, must change password), one Auth user, one audit row with no actor.

## 2. Sign-in flows (needs the Owner) — status: not run
| # | Do | Pass |
|---|---|---|
| S1 | Sign in with the temporary password | sent to "Choose your own password"; no other page opens |
| S2 | Choose a new password (12+ characters) | lands on the home page; the profile no longer says "must change" |
| S3 | Sign out; open a protected address | back at sign-in; the browser's Back button shows nothing private |
| S4 | Wrong password / wrong email | the same message for both; no hint which one |
| S5 | "Forgot password" with the Owner email | same message as for an unknown address; an email arrives (built-in sender: only Supabase-team addresses) |
| S6 | Open the email link twice | first works; second → "link expired or already used" |
| S7 | Edit the reset link's code | same expired-link message |
| S8 | Wait for the session to expire (or clear the cookies) | next click goes to sign-in, no error page |

## 3. People and Owner rules (needs the Owner + one test Manager) — status: not run
| # | Do | Pass |
|---|---|---|
| U1 | Owner adds a Manager | temporary password shown once; Manager signs in and must change it |
| U2 | Manager adds a Manager | works |
| U3 | Manager tries to add an Owner / promote self / open an Owner's actions | not offered; if forced (direct request) → refused |
| U4 | Owner adds a second Owner with reason + wrong password | refused, nothing created; with the right password → created, notice on everyone's home page |
| U5 | Owner switches off the Manager; the Manager clicks anything | signed out / refused at once; History shows who and when |
| U6 | The only Owner tries to switch themselves off or change their own role | refused with a plain message |
| U7 | With two Owners, each tries to switch the other off at the same moment (two browsers) | exactly one succeeds; one active Owner remains |
| U8 | Owner resets the Manager's password | old password stops working; new temporary password works once |

## 4. Verified email change, O7 (RSV-08; needs two real mailboxes) — status: not run
"Secure email change" must be ON (Auth settings; I will not change it).
| # | Do | Pass |
|---|---|---|
| E1 | My Account → new email + current password | message says links were sent to BOTH addresses; email, profile and audit unchanged |
| E2 | Open only the new-address link | still signs in with the OLD email; profile unchanged |
| E3 | Open both links | signs in with the new email; profile shows it; audit shows old → new with the person as target; Owner notice appears |
| E4 | Wrong current password | refused, no emails |
| E5 | Direct change of the profile email (API/SQL as the person) | refused (`EMAIL_CHANGE_REQUIRES_VERIFICATION`) |

## 5. Money functions through the app or API (needs the Owner, a Manager, one resort) — status: not run
Use `plan_preview`/`create_booking` etc. via the Server Actions once screens exist, or with a signed-in API client. Pass criteria are the same as the PAF/BKF tests: server-built Booking ID, amounts recalculated, plan must balance, waiting refunds change no balance, reversal blocked while refunds depend on it, correction files change no figure. Audit rows carry the real user.

### 5a. Refund limits on the real project (decision 5) — status: not run
With a throw-away booking (amount due 5,000; approved payments 7,000): a running booking accepts refunds up to 2,000 in total (waiting ones count) and refuses the next rupee; after cancelling it with a 5,000 charge the same booking accepts up to 7,000. Two people recording refunds at the same moment never exceed the limit.

### 5b. Settings: C/O, resorts, stay types (needs the Owner and a Manager) — status: not run
Migration 17 first (it drops two old columns and two old types: the hosted tables are empty, checked read-only before approval).
| # | Do | Pass |
|---|---|---|
| M1 | Open Settings → Resorts | exactly the four "Sample Resort" placeholders (SR1–SR4), all switched on |
| M2 | Rename one, add a fifth resort, switch one off | saved; the switched-off one is not offered for new bookings |
| M3 | Settings → C/O: add "Corporate" (list), add a name inside, add "Website" (no name), rename "Agent" | all saved; renaming changes nothing already booked |
| M4 | Settings → Stay Types: add "Honeymoon", rename "Package", switch one off | saved; switched-off type not offered |
| M5 | As the Manager and as the Owner, repeat M2–M4 | both can do everything above; a signed-out visitor is sent to sign-in |
| M6 | Create a throw-away booking with the new category/name/stay type (needs the booking screens or the API), then rename all three | the booking still shows the OLD names; a new booking shows the new ones |
| M7 | Upload a logo (PNG) for one resort | saved; a non-image renamed .png is refused |
Direct database checks (read-only): `co_categories` has Agent, Partner, Own, Direct; types `co_category` and `partner_type` no longer exist; `bookings` has the four copy columns.

## 6. Storage (RSV-07; needs a signed-in user) — status: not run
| # | Do | Pass |
|---|---|---|
| T1 | Request an upload link, upload a small PNG to `payment-proofs`, run the confirm step | file listed with the right size/type; description saved with the payment |
| T2 | Upload a file renamed `.png` that is really HTML | confirm step refuses; the file is removed |
| T3 | Upload 11 MB | refused (Storage limit and our check) |
| T4 | Try to overwrite, update or delete a stored file as an Owner | refused/no effect |
| T5 | Open a file link after 60 seconds | expired |
| T6 | Open a file address directly without a signed link, and as an anonymous visitor | refused |
| T7 | Attach a file that belongs to another booking | refused |
| T8 | **Important:** the database compares a file's size and type with what Storage recorded in `storage.objects.metadata` (`size`, `mimetype`). If every upload is refused at the payment step with "uploaded file does not match", the field names differ — tell me and I will adjust migration 15 before it goes further. |

## 7. IST midnight (RSV-11) — status: local tests done (IST-01..09, IST-U: 34 tests, 5 session zones and 5 machine zones); hosted read of `today_ist()` after apply still to do
The date rules use `Asia/Kolkata` explicitly. A real test needs the hosted clock to cross 00:00 IST: just after midnight check that `today_ist()` shows the new date, a plan row due "yesterday" is locked, and a payment dated "today" is accepted while one dated tomorrow is refused.

## 8. Privileges and advisors after apply (RSV-05, 09, 10)
Re-run the read-only queries and `db advisors` from the first verification; compare with `tests/db/schema-security.test.ts` (SEC-04).
