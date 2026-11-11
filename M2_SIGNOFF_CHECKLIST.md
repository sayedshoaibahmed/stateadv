# M2 sign-off checklist

Last updated: 2026-11-11. Status of M2: **NOT complete.** Migrations 01–18 are applied and verified on the hosted dev
project; there is no Owner account, no user and no data yet. Source of truth for every item: `M2_STATUS.md`.

How to read the tables: **You** = needs your manual action (dashboard, mailbox, typing a password). **Claude** = I can do
it myself once the inputs exist. **Approval** = I will not start without your explicit approval for that step.

## A. Supabase dashboard settings and security advisor review

| # | What needs to be done | You | Claude | Evidence that proves it |
|---|---|---|---|---|
| A1 | Open Authentication → Sign In / Providers → Email and confirm **Secure email change** is ON (both old and new address must confirm) (RSV-14, B12) | Yes: only you can open the dashboard | Cannot read it (not exposed by the public API) | You tell me "ON", ideally with a screenshot; I record it in HOSTED_VERIFICATION 0b. Final proof is the real two-mailbox run in E |
| A2 | Check session settings: session lifetime / inactivity timeout (if your plan offers it), **refresh token rotation** ON and reuse interval (FR-AUTH-2, FR-AUTH-16) | Yes | Cannot read | The values you read out, recorded in 0b. The server-side refresh behaviour is tested in D (A5 row of M2_STATUS) |
| A3 | Open Advisors (Security and Performance) and send me the list of warnings or errors (RSV-09) | Yes (or give me read access some other way; I will not ask for a token without telling you why) | I judge each finding against the schema and propose fixes as migrations (a fix is a new migration: needs your approval) | Advisor list with "no errors", or each finding explained and closed |
| A4 | Backups: Database → Backups. Tell me the plan and the date of the latest backup (optional: nothing of value is in the project yet; a safety export exists in `stateadv-backups`) | Yes | Cannot read | Plan name and backup date written into HOSTED_VERIFICATION 0b |
| A5 | Email sender: the built-in Supabase sender only delivers to addresses of your Supabase team. For forgot-password and email-change mails to reach other mailboxes you need a **custom SMTP** sender (Authentication → SMTP). For testing you can instead use mailboxes that belong to Supabase team members | Yes (SMTP credentials go only into the Supabase dashboard, never to me) | Cannot configure it | A test mail arrives in the second mailbox |
| A6 | Site URL and redirect URLs (Authentication → URL Configuration): for local testing `http://localhost:3000`; production address later | Yes (I will give you the exact values when we get there) | Cannot change dashboard settings without your approval | The reset and email-change links open the app |
| A7 | Already verified by me (no action): sign-up disabled, only the email provider is on, autoconfirm off, anonymous REST access refused, 85 functions with the right privileges | No | Done 2026-11-11 | HOSTED_VERIFICATION 0h |

## B. Secret Key rotation preparation

The key that was once pasted into a chat is treated as compromised. **Do not paste the new key anywhere except `.env.local` and, later, your hosting provider's secret settings.**

| # | What needs to be done | You | Claude | Evidence |
|---|---|---|---|---|
| B1 | Decide to rotate now (I recommend before the Owner exists, as already agreed) | Approval | – | Your "approved: rotate" |
| B2 | Supabase dashboard → Project Settings → API Keys → create a **new** secret key | Yes | No | New key listed in the dashboard |
| B3 | Put the new value into `.env.local` as `SUPABASE_SECRET_KEY` (replace the old value; do not print it) | Yes | No (I do not edit or read the value) | `.env.local` changed |
| B4 | Delete (revoke) the **old** secret key in the dashboard | Yes | No | Old key no longer listed |
| B5 | Verify the application with the new key: `npm run check:supabase`, `npx tsx scripts/create-first-user.ts --dry-run`, bundle scan, secret scan | – | Yes, after B3 | Command output (no key shown) |
| B6 | Where the key is used (checked): `src/lib/supabase/admin.ts`, `src/lib/env.server.ts`, `scripts/create-first-user.ts`, `scripts/recover-owner.ts`, and a search in `scripts/check-client-bundle.mjs`. Not in Vercel (not deployed), not in GitHub Actions, not in git history (scan clean) | – | Done | HOSTED_VERIFICATION 0e |
| B7 | Also treat the **database password** as exposed if it was ever pasted: tell me if it was (Project Settings → Database → reset password, then update `SUPABASE_DB_URL` in `.env.local`) | Yes, if applicable | I re-run the preflight afterwards | Preflight passes with the new URL |

Downtime risk: none (nothing is deployed). Risk if B4 is done before B3: the local scripts stop working until B3 is done.

## C. First Owner creation preparation

| # | What needs to be done | You | Claude | Evidence |
|---|---|---|---|---|
| C1 | Give me the Owner's **full name** and **email address** (a mailbox you control). A second Owner can be added later in the app | Yes | – | The two values (no password) |
| C2 | Approval to create the Owner, separate from B | Approval | – | Your "approved: create first Owner" |
| C3 | Dry run: `npx tsx scripts/create-first-user.ts --dry-run` prints "Dry run: nothing was created." | – | Yes | Output |
| C4 | The real run **in your own terminal** (type `! npx tsx scripts/create-first-user.ts` in this chat prompt, or run it yourself). It asks the name and email, then the temporary password through a hidden prompt. Use a fresh, long password nobody has seen; never the one pasted earlier | Yes (you type the password) | I never see it | Script ends with "The Owner account exists" |
| C5 | Read-only check afterwards: exactly 1 `user_profiles` row (role owner, active, must change password), 1 Auth user, 1 audit row with no actor, nothing else created | – | Yes | Query results |
| C6 | Sign in with the temporary password and set your own password (12+ characters) | Yes | – | You land on the home page |

Protections already proven by tests (FOW-*, FIRSTOWNER unit tests): runs only server-side with the secret key; refuses when any profile exists; refuses an existing login; a failed profile removes the new login; password never printed or stored.

## D. Authenticated browser testing

Needs C. Start the app locally against the hosted project (`npm run dev`); I cannot drive a real browser from this
terminal unless a browser tool is available in your Claude desktop app, so you follow the steps while I check the database
afterwards. Steps are in `supabase/HOSTED_VERIFICATION.md`: **section 2** (sign-in flows S1–S8), **section 3** (people and
Owner rules), **0g** (settings screens), **5b**. Use only clearly fictional names; switch things off, never delete.

| # | What | You | Claude | Evidence |
|---|---|---|---|---|
| D1 | Sign-in, wrong password message, sign-out, Back button, expired session (A1, A2, A5 of M2_STATUS) | Yes | I check the audit rows and sessions afterwards | S1–S8 ticked |
| D2 | Add a test Manager in People (needs your approval to create the account), forced password change, switch off, locked out at once (A6, A8, B1, B3, B4) | Yes (approval for the test account) | Database checks | Rows and audit entries; the switched-off user is refused |
| D3 | Owner rules in the real app: nobody switches off themselves; last Owner cannot be removed; only an Owner gives the Owner role; reason + own password for protected actions (B2, B5–B8, B10) | Yes | Database checks | Refusal messages and unchanged profile rows |
| D4 | Settings screens: Resorts (edit a placeholder, switch off/on, duplicate code, empty name), C/O (three modes, add/rename/switch off a name, search), Stay types; also at 360 px width; also as Manager (G1–G5, G7, G9) | Yes | Database checks of what was saved | 0g steps ticked; screenshots optional |
| D5 | Unauthorized access: signed-out already verified (RSV-16). Remaining: no-profile login sees 0 rows (RSV-06 second half) | Approval for one throw-away login | Yes | 0 rows returned |
| D6 | Owner recovery script (B9) is run once against hosted only if you want it proven; otherwise stays tested locally | Optional | I prepare it | Script output |

## E. Email-change and second-approver testing

| # | What | You | Claude | Evidence |
|---|---|---|---|---|
| E1 | Two mailboxes you can read (one for the Owner, one for the test Manager or a new address) and an email sender that can reach them (A5) | Yes | – | Both mailboxes receive a test mail |
| E2 | Real own-email change (RSV-08, B12): Owner requests a new address, confirms from **both** mailboxes; check profile email changes only after both confirm, audit row written, a direct edit is refused. Also: reuse the link (expired message), request a change and let it expire | Yes (click the links) | I check the profile and audit rows | Profile email updated once; audit row; reused link refused |
| E3 | Second approver (RSV-15): Manager A enters a payment, Owner approves; Manager B tries to approve a second time (refused as already decided); a switched-off user cannot approve; self-approval is **allowed and flagged** by approved decision Q8 (it is not prevented); waiting approvals do not expire. Payment screens are built in M5, so before then this is exercised through the functions with real logins | Yes (logins) | I run the call sequence after you create the test users | approval_history rows; refusals match PAF-50..55 |
| E4 | Already proven without mailboxes: database side of the email change (EML-03..07), approval access (PAF-50..55), 34 IST tests, all green in CI | No | Done | CI run for cc94490 |

## F. Storage testing

| # | What | You | Claude | Evidence |
|---|---|---|---|---|
| F1 | Real login against Storage (RSV-07, D2): upload a small fictional PDF/PNG as an active user; a signed-out request and a switched-off user are refused; no one can replace or delete a file | A login (after C) | I write and run the check once a login exists (you type any password at a hidden prompt) | Upload accepted for the active user; refused for the others |
| F2 | The upload code (D3, D4): size and type compared with what Storage reports, magic-byte check, SHA-256, 60-second signed links, wrong booking refused. The real Storage metadata field names are unverified, so the code **refuses when unsure** until proven | – | Yes, with F1 | A real upload that is accepted and a download link that works for 60 seconds only |
| F3 | Logo upload for a resort on hosted (G3) | Yes (browser) | Database check | `logo_path` set; file readable only by signed-in users |

## G. Final M2 sign-off

| # | What | You | Claude | Evidence |
|---|---|---|---|---|
| G1 | A to F complete, no row of `M2_STATUS.md` left at "local", "todo" or "later" except items that belong to M3–M9 | – | I regenerate the status | M2_STATUS shows every in-scope row done |
| G2 | Commit and push the documentation (and any fixes found in D–F), CI green for that commit | Approval + you read CI | I commit after approval | Green run for the final commit |
| G3 | Final preflight-style read-only comparison of the hosted database with a local rebuild of 01–18 (identical) | – | Yes | Comparison output, 0 differences |
| G4 | Final report with percentages, remaining blockers (none) and the recommendation to start M3 | – | Yes | Report; you say "M2 signed off" |
| G5 | M3 prerequisites noted: dashboard aggregate functions do not exist yet and will be M3's first step (new migration 20; migration 19 is the O3 re-authentication hardening; both need your approval to apply) | – | – | M3 plan |

Mutation testing stays as agreed: targeted checks in M2 (done, 10/10 plus earlier runs caught), full suite in M9.

## The shortest path

1. You: A1–A5 (about 15 minutes in the dashboard) and tell me the results.
2. You approve B, do B2–B4 yourself, I verify B5.
3. You send C1 and approve C2; you run C4 in your terminal; I check C5.
4. D, E and F in one sitting with two mailboxes; I check the database after each step.
5. Commit the documentation, CI green, final comparison, sign-off.
