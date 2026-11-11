# Checks on the real Supabase development project

**Nothing in this file has been run yet** (status per check below). Each check says what it needs, exactly what to do, and what a pass looks like. Everything uses fictional data. None of it touches production.

Rules for every check
- Use the development project only. Never print or paste the connection string, the Secret Key or any password into chat, tickets or logs.
- Test accounts use addresses you control (`you+owner-test@…`). Delete nothing: switch test people off instead; the system never deletes records.
- Do not mark a check as passed unless its "pass" line was actually observed.

## 0. Applying migrations 11-18 (needs your explicit approval; NOT done)

Commit and push the current local changes first and wait for GitHub Actions to be green, so that the files applied are the files on GitHub.

### 0a. Preflight (read-only; every line must hold, otherwise STOP and report)
| # | Check | Required |
|---|---|---|
| P1 | `select count(*) from supabase_migrations.schema_migrations` and max version | 10 and `20261111000010` |
| P2 | exact counts: `bookings`, `agents_partners`, `booking_sequences`, `guests`, `resorts`, `payments`, `refunds`, `proofs`, `payment_schedules`, `expected_adjustments`, `user_profiles`, `auth.users`, `storage.objects` | all **0** |
| P3 | `stay_types` 3, `payment_providers` 9 | as stated |
| P4 | objects to be dropped exist exactly once: types `co_category`, `partner_type`; columns `bookings.co_category`, `bookings.agent_partner_id`, `agents_partners.type` | present |
| P5 | nothing else depends on them (functions / views / policies mentioning `co_category`, `agent_partner`, `agents_partners`) | only `guard_booking` |
| P6 | none of the 60 new function names, `co_categories`, `co_entries` exists | none |
| P7 | `db push --dry-run --skip-vault` | lists exactly the expected files |
| P8 | local working tree equals GitHub `main`, CI green | yes |

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

### 0e. Rotating the compromised Secret Key (separate approval)

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
