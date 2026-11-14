# PROGRESS — Milestone Tracking

Last updated: 2026-11-11

## Current status (updated 2026-11-11)
**M2 – Database and Authentication is ONE milestone, in progress, NOT complete.** Full audit: `M2_STATUS.md`.

### Where each thing has been verified
| Level | State |
|---|---|
| **Hosted dev project** (PostgreSQL 17.11) | Migrations **01–23 applied and verified** against a local rebuild (HOSTED_VERIFICATION 0h, 0i, 0k, 0l, 0m and 0n; 019 to 023 on 2026-11-12): 107 functions, 53 callable by signed-in users, 106 by the service role, 0 by anon or PUBLIC (99 / 48 before migration 23), 21 tables, 26 policies, 105 triggers, 4 placeholder resorts, 4 C/O categories, reference data intact. One active Owner account (password changed), no other users, no business data. Signup disabled. |
| **GitHub** | `origin/main` = `91a4d13`; all four CI jobs passed (lint/typecheck/test/build, secret scan, PostgreSQL 17 database tests, PostgreSQL 17 as a non-superuser; reported by the owner). Only documentation changes are uncommitted. |
| **Local, real PostgreSQL 17.11** (throw-away server) | **355** database tests + **18** simultaneous-request tests pass, in each of two modes: superuser, and the hosted rehearsal (migrations run as a plain role named `postgres`). |
| **Local, PGlite** | **508** tests pass (18 concurrency tests skipped there). |
| **Mutation checks** | Exhaustive suite (53 weakened versions) is **deferred to M9** by owner decision (see below). Essential targeted M2 checks run 2026-11-11: 15 security/financial weakenings **all caught**; the runner now treats a crashed test process as INCONCLUSIVE (retried 3 times) and never as caught. |
| **Hosted preflight** (`npm run preflight:hosted`, read-only) | P1-P7 PASS; P8 FAILS because the working tree has uncommitted changes (correct behaviour). |
| **Generated types** | `src/lib/supabase/database.types.ts` regenerated from the migrations on a throw-away PostgreSQL: byte-identical to the file in the tree. |
| Lint, types, format, production build, bundle scan, migration check (now also ASCII-only) | pass |
| `npm audit --omit=dev` | 0 findings (3 dev-only advisories in the `shadcn` command-line tool, not shipped) |

**Known issue (open):** on this Windows machine the many-connection test file sometimes loses its Node worker process (about 1 run in 10; no failing assertion ever; see MIGRATION_REVIEW 14.6).

### Stage 2026-11-12 (O3 hardening: committed, APPLIED to hosted, verified)
Security Advisor finding F1 (the Owner's password re-entry existed only in the server action) is fixed and hardened after an independent review: **migration 19** adds single-use, 60-second re-authentication grants bound to the exact operation, attempts reserved atomically under a per-Owner lock BEFORE the password is tried (5 per 15 minutes; REA-16 tests the window with controlled timestamps), every database call failing closed, no grant id returned, and re-authentication audit rows readable by Owners only. Committed as `91a4d13` (all four CI jobs green) and **applied to the hosted project on 2026-11-12**: a fresh safety export was verified first, `preflight:hosted` passed P1-P9, and afterwards the hosted catalog was identical to a local rebuild in every category (history 19, 21 tables, 89 functions, 38 callable by signed-in users, 0 by anon, 26 policies, 105 triggers); data, the Owner account and the 18 earlier audit rows are unchanged; anonymous access to the new table and functions is refused. Not shown on hosted yet: a real grant being used by a real session (needs a second Owner). The M3 dashboard-functions migration is number 20 and is now applied to hosted too (see the M3 note below). Details: `SECURITY.md` section 15, `supabase/MIGRATION_REVIEW.md` section 16, `supabase/HOSTED_VERIFICATION.md` 0i.

### Stage 2026-11-11 (later): checks completed without needing approval
- **GitHub:** `5050a8e` pushed; all four CI jobs passed (reported by the owner), including the new restricted-role job.
- **IST midnight (RSV-11):** `tests/db/ist-midnight.test.ts` (IST-01..09) and `tests/unit/ist-midnight.test.ts` (IST-U, five machine zones): 34 tests pass. Not yet committed.
- **Second approver / access (RSV-15):** `tests/db/approval-access.test.ts` (PAF-50..55): 6 tests pass. Self-approval is allowed and flagged by approved decision Q8; waiting approvals do not expire in the product.
- **Unauthenticated check of a production build against the hosted project (RSV-16):** every settings and People page redirects to login; sign-up is refused (422).
- **Hosted preflight re-run:** P1-P7 PASS; P8 fails only because the new test files are uncommitted.
- **Needs you:** dashboard checks (HOSTED_VERIFICATION 0b), the migration approval (0d), key rotation (0e), Owner details (0f), two mailboxes for RSV-08.

### Mutation testing schedule (owner decision 2026-11-11)
M2: essential targeted security and financial-rule checks only. M3, M4, M6, M7, M8: ordinary tests only. M5: targeted financial mutation checks. **M9: full mutation testing across M2-M8.** `scripts/mutation-check.mjs` and its 53 mutations are kept unchanged for M9 (`MUTATION_ONLY="name part,name part"` selects a subset). Do not run the full suite earlier unless a critical issue requires it.

### Done in this stage (owner requirement 2026-11-11: configurable master data)
- **C/O categories and names**, **resorts** and **stay types** are configured by Managers and Owners themselves: any number, any name, rename, switch on/off, type-to-search. Four **placeholder resorts** start the system. Bookings keep their own copy of the names, so renaming or switching off never rewrites history; old bookings with switched-off choices stay readable and editable; new choices must be switched on.
- Schema: migration **17** (new `co_categories`; `agents_partners` → `co_entries`; booking copies of names; composite key; guard replaced; two old enum types removed) and **18** (placeholder resorts); functions in 13 and 14 changed. **Data-preserving conversion proven** on a database that holds bookings, payments and plans.
- Screens: Settings → Resorts, C/O, Stay Types, and the shared type-to-search picker. Not yet exercised in a browser against a real project; the booking forms that use the picker are M4.
- Four defects found and fixed along the way (MIGRATION_REVIEW 14.4), including one that the empty hosted database would never have shown.
- The five approved decisions (commit `5cd0c99`) are intact and still tested.

### Blocked on you
| # | Action | Needed for |
|---|---|---|
| 1 | Dashboard checks and the Advisors review (`M2_SIGNOFF_CHECKLIST.md` group A) | RSV-09, RSV-14 |
| 2 | Replace the dev Secret Key (group B), then approve the first-Owner run with the Owner's name and email (group C) | the real Owner account |
| 3 | Two mailboxes or a custom email sender; approve throw-away test users | RSV-06 (second half), 07, 08, the second-approver run |
| 4 | Approve committing the documentation | records the hosted evidence on GitHub |

## Milestones
| # | Milestone | Status | Approved by owner |
|---|---|---|---|
| M0 | Requirement Analysis and Architecture | ✅ Complete | Yes (2026-11-11) |
| M1 | Project Setup | 🟢 Complete, awaiting review | No |
| M2 | Database and Authentication | 🟡 In progress (one milestone). Schema written, tested and reviewed locally. Not applied. | Started 2026-11-11; applying to Supabase and creating the Owner need separate approval |
| M3 | UI and Dashboard | 🟡 Built, committed (`a4ea2de`, comment fix `714a514`, both pushed); migration 20 (dashboard functions) **applied to hosted and verified 2026-11-12**. Open: no real authenticated call tested on hosted; page not yet viewed in a browser against hosted | Browser QA stays deferred (after M8; comprehensive QA in M9) |
| M4 | Resort, Guest and Booking Management | 🟡 Built, committed (`0ec47fa`, pushed, CI green); migration 21 (booking and guest lists) **applied to hosted and verified 2026-11-12**. Open: no real authenticated call tested on hosted; screens not yet viewed in a browser against hosted | Browser QA stays deferred (after M8; final QA in M9) |
| M5 | Payment Management and Approvals | 🟡 Built, committed (`1eb65b5`, pushed, CI run #17 passed all four jobs, reported by the owner); migration 22 (payment and refund lists) **applied to hosted and verified 2026-11-12**. Open: no authenticated call of the two functions tested on hosted; the screens, uploads and approvals not yet tried in a browser | Browser QA stays deferred (after M8; final QA in M9, checklist below) |
| M6 | Automatic PDF Generation | 🟡 Built, committed (`79f956a`, security fix `5d8be32`, docs `a1c598a`, all pushed; CI run #19 and #20 passed all four jobs, confirmed by the owner); migration 23 (PDF pipeline functions) **applied to hosted and verified 2026-11-12**. Open: no authenticated call, real upload, signed download, logo fetch, Vercel cron or `after()` check yet; no browser test | Browser QA stays deferred (after M8; final QA in M9, checklist below) |
| M7 | Calendar and Historical Records | 🟡 Built locally, **not committed, not pushed**. Migration 24 (calendar, old records and activity functions) written and tested locally, **NOT applied to hosted**. No browser test; no CI run yet | Committing, pushing and applying migration 24 each need a separate approval |
| M8 | Reports and Collections | ⚪ Not started | No |
| M9 | Testing and Security | ⚪ Not started | No |
| M10 | Deployment and Handover | ⚪ Not started | No |

## M1 log (2026-11-11)
**Environment found:** Node 24.15, npm 11.12, git 2.53. GitHub CLI and Docker are **not installed**, so the cloud Supabase dev project is used (no local Supabase stack). The GitHub repo `sayedshoaibahmed/stateadv` is empty and **public**.

**Done:**
1. `git init` (branch `main`), remote `origin` → GitHub repo. Pushed to GitHub after the owner made the repo private.
2. Next.js **16.4.6** (App Router, Turbopack, Cache Components, `src/` dir, `@/*` alias), React 19.3, TypeScript strict.
3. Tailwind CSS 4.3 + shadcn/ui (Radix base, Nova preset, Lucide icons, Geist font). 21 base components.
4. Dependencies pinned (exact versions, `.npmrc save-exact`): Supabase JS 2.119 + SSR 0.12, Zod 4, React Hook Form, TanStack Table, Recharts, date-fns 4 + @date-fns/tz, @react-pdf/renderer, server-only. Dev: Vitest 5, Playwright 1.65 (browsers not downloaded yet; needed from M3), Supabase CLI 3.1, Prettier, tsx.
5. Supabase clients: `src/lib/supabase/client.ts` (browser), `server.ts` (per request, user JWT, async cookies), `admin.ts` (secret key, `server-only`, unused until M2), `proxy.ts` (session refresh with `getClaims()`), and `src/proxy.ts` (the Next.js 16 replacement for middleware).
6. Env validation: `src/lib/env.ts` (public; rejects a secret key placed in a public variable) and `src/lib/env.server.ts` (server-only). `.env.local` created (git-ignored). `.env.example` committed with names only.
7. Core libraries + tests: `money.ts` (integer paise), `dates.ts` (IST, nights), `calc.ts` (booking amounts + financial formulas, mirroring DATABASE_SCHEMA §3–4).
8. `/api/health` route + `npm run check:supabase` script (no secrets printed).
9. Safety scripts: `check:migrations` (blocks destructive SQL without approval) and `check:bundle` (no secrets in browser files).
10. Security headers in `next.config.ts` (HSTS in production only); `X-Powered-By` removed; `robots: noindex`.
11. Supabase CLI `supabase/config.toml` (local sign-up disabled), `migrations/` and `tests/` folders.
12. GitHub Actions CI: lint → typecheck → unit tests → migration check → build → bundle check, plus a gitleaks secret scan.
13. Prettier with Tailwind class sorting. `.gitattributes` (LF line endings). README.
14. Docs updated: `proxy.ts` instead of middleware; new Supabase key names (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`); no `runtime` export with Cache Components; O1–O4 accepted.

**Verification results:**
| Check | Result |
|---|---|
| Unit tests (`npm test`) | ✅ 90/90 passed (money, dates/IST, booking amounts AMT-*, financial golden table FIN-01…19, health check, migration guard) |
| ESLint | ✅ 0 errors / 0 warnings |
| TypeScript (`tsc --noEmit`) | ✅ 0 errors |
| Prettier | ✅ all files formatted |
| Production build | ✅ success; `/api/health` dynamic, `/` static |
| Supabase connection (`check:supabase`) | ✅ auth ok, database API ok |
| Negative test with a wrong key | ✅ correctly fails (401) |
| `next start` → `/api/health` | ✅ HTTP 200, auth ok, database ok |
| Security headers (production) | ✅ X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, CSP (frame-ancestors etc.), HSTS; no X-Powered-By |
| `next dev` | ✅ home 200, health 200, no HSTS in development, no errors |
| Client bundle secret scan | ✅ no secrets in 10 browser files |
| `.gitignore` | ✅ `.env.local`, `.env`, `.env.production`, `.env.recovery`, `*.env` ignored; only `.env.example` committed |
| Staged content scan | ✅ no keys, no project reference in committed files |
| CI workflow | ⚠️ written but **not run yet** (runs on the first push) |

## M1 known issues
1. ~~GitHub repo public~~ — fixed: now private (anonymous API returns 404). Pushed.
2. ~~Supabase public sign-up~~ — fixed: `disable_signup: true` verified.
3. `npm audit`: 7 moderate findings, all in `minimatch` inside ESLint plugins (dev tooling only, never shipped). There is no non-breaking fix; recheck when `eslint-config-next` updates.
4. The CSP `script-src` (nonce-based) is planned for M9; current CSP directives are the safe subset.
5. Playwright browsers are not installed yet (needed from M3).
6. The Supabase CLI is not linked to the cloud project (needs a personal access token). Migrations in M2 need `supabase link` or the database connection string.

## Owner decision: one Owner at first (2026-11-11)
- Only the owner's own first Owner account will be created in M2. **No second, dummy or fake-email Owner**, in the real data or as a stored test account.
- The system must (and will) run securely with one active Owner and keep the rule "at least one active Owner always".
- Documented: PRD FR-AUTH-13/14/15 and O5–O6; SECURITY.md §3.2a (recovery limitations with one Owner); DEPLOYMENT_GUIDE §7.4–7.5 and go-live checklist; DATABASE_SCHEMA user_profiles rules; TRD §5.7; UI notice and Add Owner flow; tests OWN-11…19; IMPLEMENTATION_PLAN M2 seed and pending items.
- **Pending from the owner:** (1) first Owner full name + real email (needed at the start of M2); (2) second Owner details (not needed to build M2; recommended before M10, or the owner signs off on the one-Owner limitations).
- The second Owner is added later in the app by the existing Owner (Settings → Users → Add User → role Owner), with no development work.
- M2 has NOT started.

## 2026-11-11: f15f5e9 pushed; M2 setup choices
- Commit f15f5e9 (docs only, 9 files) reviewed and pushed to the private repo. Remote = local. No credentials in it.
- Owner decisions recorded: O6 approved (current Owner's password + written reason to add an Owner); first Owner details provided in chat (not stored in the repo); second Owner pending; fictional test data only; database tests via GitHub Actions; built-in Supabase email in development; database access via Option B.
- Supabase CLI 3.1.0 supports `--remote=<connection url>` and `--dry-run` for `db push`, so Option B is compatible.
- Still needed before M2 (see the M2 prerequisites list in the report): the session-pooler connection string in `.env.local`; confirmation that the Supabase account email matches the Owner email; the first Owner's temporary password entered privately at account creation.

## Needed before M2
- Make the GitHub repo private → then I push.
- Disable public sign-ups in Supabase.
- Supabase **secret key** (`sb_secret_…`) for user management, to put into `.env.local` yourself (do not paste it in chat if possible), plus a way to apply migrations: a Supabase access token for `supabase link`, or the DB connection string.

## M0 log
### 2026-11-11
- (1) Directory inspected (empty). Ten planning documents created. 15 questions raised.
- (2) Q4–Q8 applied. Q11 deferred.
- (3) All remaining questions applied. All ten documents rewritten for consistency.
- (4) D1–D4 decided. Owner-account protection O1–O4 designed.
- (5) **M0 approved by the owner.** O1–O4 accepted with the approval.

## Known issues / notes (general)
- Production hosting budget and providers are deferred (Q11). The production requirements are documented.
- Remaining business risk: Managers can disable/reset other Managers (decided Q10; mitigated). Owner accounts are protected (O1–O4).
- Owner "Forgot password" emails need a production email sender (cost under Q11).

## M3: migration 20 applied to hosted (2026-11-12)
Migration `20261111000020_dashboard_functions.sql` (five read-only dashboard functions) was applied alone, after preflight P1-P9, a dry run listing only that file, and a fresh verified safety export (`stateadv-backups/hosted-export-2026-11-12T03-13-23`, outside the repository). Afterwards, read-only: history exactly 01-20; the five function bodies equal the migration source; all five SECURITY INVOKER with an empty search_path; `authenticated` can execute them, `anon` and PUBLIC cannot; 94 functions, 43 callable by signed-in users, 0 by anon/PUBLIC; 21 tables, 26 policies, 105 triggers; hosted equals a local rebuild in every catalog category (`catalog:compare`); row counts of all 21 tables and the content of resorts, stay types, payment providers, C/O categories and user profiles equal the safety export; 18 audit rows unchanged; the one Owner account intact; anonymous calls to all five functions refused. No other migration, user, password, role change or deployment happened.

**Two limitations remain, stated plainly:**
1. No real *authenticated* call of the dashboard functions has been made against hosted Supabase (it needs a login; hosted also holds no bookings or payments, so it would return zeros).
2. The dashboard page has not been visually checked in a browser against hosted Supabase.

Browser QA remains deferred as decided: comprehensive M2/M3 browser testing is scheduled after M8, with comprehensive QA in M9.

## M4: Resort, Guest and Booking Management (built locally, not committed)
**What a person can now do (screens):** Bookings list `/bookings` (search by Booking ID, name, mobile or C/O name; filters for resort, status, date type and range, C/O, pricing method, Has Pending, Has Waiting, Refund due, Adjusted; 25 per page; a table from tablet width up and cards on a phone); Add Booking `/bookings/new` (resort, guest with "Use this guest" suggestions by mobile number, stay, C/O with quick-add of a new Agent or Partner name, amount with live line and "Change final amount" with a reason, payment plan with empty amounts and a live "adds up / short / more" line, remarks); Booking page `/bookings/[id]` (header, status, money box with the documented labels, red banner for cancelled and no-show, tabs Details, Payments & Refunds (placeholder), Payment Plan (rows with covered and outstanding, Expected Adjustments, plan versions, replaced rows on request), PDFs (placeholder), History in plain English); Edit Booking `/bookings/[id]/edit` (resort locked with the documented explanation, booking date kept in the same year, reason when an amount changes, plan editor with locked past rows, "amount still to plan", reduction notice and "move unpaid amount to a new date"); check-in, check-out and undo with a reason; Cancel Booking and Mark No-show dialog (typed charge for cancel, full amount for no-show, reason for changing it, plan preview, refund line); change cancellation charge; change payment plan; Guests `/guests` and `/guests/[id]` (search, history, totals, edit, "New booking for this guest"); Search `/search` (the top-bar search box); Payment apps `/settings/payment-apps`. The menu items Bookings, Add Booking and Guests are now real links.

**Database:** one new migration, **21 `booking_guest_lists`** (read-only `booking_list`, `guest_list`, `like_safe`; SECURITY INVOKER; applied to hosted 2026-11-12). Everything else M4 needs (create, update, status, cancel, charge change, plan change, plan preview, guest, C/O, stay type, payment app functions) already existed from M2 and is unchanged.

**Tests:** BKL-01..23 (migration 21, hand-calculated), BFC-01..16 (the form's payload against the REAL database functions), CON-21/22 (concurrency), booking-form / plan-cancel / list-history / actions / views unit tests. Results: see the M4 report in the conversation and TEST_PLAN section 2.22.

**Not done, stated plainly:** (1) "Save and Add Payment" waits for M5 (payments); (2) the Payments & Refunds and PDFs tabs are placeholders by design; (3) no screen was opened in a browser (Playwright browsers are not installed and a second login must not be created): layouts at 360/768/1280 are verified by markup tests and the production build only, and the signed-out redirects of the new routes were checked on a local production server; (4) E2E tests of the booking flows wait for the deferred browser QA (after M8, final QA in M9); (5) migration 21 must be applied to hosted (separate approval) before these screens work against the real project.

## M4: migration 21 applied to hosted (2026-11-12)
Migration `20261111000021_booking_guest_lists.sql` (`booking_list`, `guest_list`, `like_safe`) was applied alone, after preflight P1-P9, a dry run listing only that file, and a fresh verified safety export (`stateadv-backups/hosted-export-2026-11-12T04-47-41`, outside the repository). Afterwards, read-only: history exactly 01-21; the three function bodies equal the migration source; `booking_list` and `guest_list` are SECURITY INVOKER (none is SECURITY DEFINER) with an empty search_path; `authenticated` can execute them, `anon` and PUBLIC cannot; **97 functions, 46 callable by signed-in users, 0 by anon or PUBLIC**; 21 tables, 26 policies, 105 triggers; hosted equals a local rebuild in every catalog category (`catalog:compare`, rebuild file `stateadv-backups/catalog-after-021.json`); row counts of all 21 tables and the content of resorts, stay types, payment providers, C/O categories and user profiles equal the safety export; 18 audit rows unchanged; the one Owner account intact; anonymous calls to all three functions refused (HTTP 401). The financial rule D1 is unchanged: `booking_financials` was not touched and on hosted still reads Pending = max(Due − (Approved + Waiting − Approved refunds), 0) and Verified Remaining = max(Due − (Approved − Approved refunds), 0), with no waiting refund in either. The live `guest_list` sums Pending over ALL of a guest's bookings, so an unpaid cancellation or no-show charge is included. No other migration, user, password, role change or deployment happened.

**Limitations that remain, stated plainly:**
1. No real *authenticated* call of `booking_list` or `guest_list` has been made against hosted Supabase (it needs a login; hosted also holds no bookings or guests of its own, so the result would be empty). The guest-Pending behaviour is therefore shown by the live function and view definitions and by the local tests (BKL-17b on PGlite, PostgreSQL 17 superuser and restricted role), not by live data.
2. The M4 screens have not been viewed in a browser against hosted Supabase. Browser QA stays deferred: comprehensive M2-M4 browser testing is scheduled after M8, final QA in M9.

## M5: Payment Management and Approvals (built locally, not committed)
**Reused, not rebuilt:** the database already had every money rule from M2 (migrations 06, 15, 16): payments, refunds, approvals, self-approval, the refund limit, reversal protection (D5), proofs, correction files (Q9a), the `booking_financials` view (D1) and the storage rules with signed uploads. M5 is the screens, the server actions and two read-only list functions on top of them; no rule was changed.

**What a person can now do:**
- **Add Payment** `/payments/new?booking=` and **Add Refund** `/refunds/new?booking=` (booking summary and the database's own figures on top; "Fill pending" and "Fill the most you can refund" helper buttons; five method buttons; payment app / card type for UPI and Card with a typed name for "Other"; date that cannot be in the future; reference label that follows the method; screenshot or receipt marked Required (UPI, Card, Cheque) or Optional (Cash, Other); refund reason with quick picks; remarks). Photos over 1 MB are shrunk in the browser before upload; the server checks the real type, size and SHA-256 afterwards. Add is disabled until uploads finish and is protected against double taps (one save key per form). Warnings (same reference, same file, above what is pending, above the refund due) never block saving.
- **Payments** `/payments` and **Refunds** `/refunds`: every record with filters (status, method, payment app, resort, payment or entry date range, recorded by, Only Self-approved, search by number, Booking ID, guest or reference), a table from tablet width and cards on a phone, 25 per page.
- **One payment or refund** `/payments/[id]`, `/refunds/[id]`: facts, status badge and Self-approved tag, Approve / Reject (reason, quick picks) / Reverse (reason, strong confirmation), Change while waiting (reason), files viewer (private files through 60-second links, zoom, PDF), add more files or hide a wrong one while waiting, **Add correction file** on approved items (reason of at least 10 letters, "Added after approval" tag), the booking's money box and the history.
- **Waiting for Approval** `/approvals`: Payments | Refunds tabs with counts, oldest first, review panel beside the list, the next waiting item opens after each decision, the orange "You recorded this. It will be marked Self-approved." note.
- **Booking page, Payments & Refunds tab:** this booking's payments and refunds with Add Payment and Add Refund buttons.
- **Menu:** Waiting for Approval (with the waiting count), Payments and Refunds are real links; the dashboard's recent payments link to their pages.

**Database:** one new migration, **22 `payment_refund_lists`** (read-only `payment_list`, `refund_list`; SECURITY INVOKER; applied to hosted 2026-11-12). No existing object changed. **Payment apps** (`/settings/payment-apps`, built in M4) are the provider configuration; the database validates app / method pairs, the switched-off state and the typed name for "Other" on every payment and refund.

**Tests (local):** PGL-01..16 (migration 22, hand-calculated), PFC-01..19 (the screens' payloads against the REAL database functions with D1 figures worked out by hand, D3, D5, Q8, Q9a, Q12), CON-23/24 (concurrency), PF-01..30, PA-01..19 and PV-01..20 (unit), and the M2 PAY/APR/REF/FIN/CON tests unchanged.

**Not done, stated plainly:** (1) no screen was opened in a browser (Playwright browsers are not installed and a second login must not be created): layouts at 360/768/1280, the real upload to private storage, image shrinking in a real browser and the file viewer are verified only by markup tests, the build and the local database tests; (2) browser E2E (the PAY/APR/REF/FIN tests "via the UI") waits for the deferred browser QA (after M8, final QA in M9); (3) migration 22 is now applied to hosted (see the next section), but the screens have not been tried against it; (4) there is no per-resort restriction by design (Q10: every active user has the same access to every resort), so "cross-resort access" means only that anonymous, signed-out, unknown and switched-off callers are refused.

## M5: migration 22 applied to hosted (2026-11-12)
Migration `20261111000022_payment_refund_lists.sql` (`payment_list`, `refund_list`), commit `1eb65b5d847c9104f9abb11b7aba0942d3adc7b3`, was applied alone, after the owner's explicit approval, preflight P1-P9, a dry run listing only that file, and a fresh verified safety export (`stateadv-backups/hosted-export-2026-11-12T06-41-00`, outside the repository). Afterwards, read-only: history exactly 01-22 (022 once, 01-21 unchanged); the two function bodies equal the committed source; both SECURITY INVOKER (neither is SECURITY DEFINER) with an empty search_path, an active-user check, `like_safe` for search text and no dynamic SQL; `authenticated` can execute them, `anon` and PUBLIC cannot; **99 functions, 48 callable by signed-in users, 0 by anon or PUBLIC**; 21 tables, 26 policies, 105 triggers; hosted equals a local rebuild of migrations 1..22 in all 14 catalog categories (`catalog:compare`, rebuild file `stateadv-backups/catalog-after-022.json`, also equal to the catalog expected before the apply); row counts of all 21 tables and the content of resorts, stay types, payment apps, C/O categories, user profiles and the audit log equal the safety export; the one Owner account is intact; the financial rules are unchanged (`booking_financials` still reads Pending = max(Due - (Approved + Waiting - Approved refunds), 0) and Verified Remaining = max(Due - (Approved - Approved refunds), 0), no waiting refund in either); anonymous calls to both functions were refused with HTTP 401. No other migration, user, password, role change or deployment happened.

**Limitations that remain, stated plainly:**
1. **No real authenticated call** of `payment_list` or `refund_list` has been made against hosted (it needs a login; hosted also holds no payments or refunds, so the lists would be empty). Their behaviour is shown by the live definitions and grants and by the local tests (PGL-01..16 on PGlite, PostgreSQL 17 superuser and restricted role).
2. **No browser test** of the M5 screens (Add Payment, Add Refund, approvals, the file viewer) has been done, and no real upload to the private proof bucket has been made.
3. **Known warning in the old backup verifier:** `stateadv-backups/tools/verify-export.mjs` still prints FAIL on "the SQL recorded on hosted for 01-10 equals the migration files in git" (shown as `21/10`) because its check is hard-coded to expect exactly 10 migrations. All 21 hosted migrations matched their repository files before migration 022 was applied (and all 21 again afterwards, checked against the export). The warning is left as it is, not suppressed.

### M9 browser QA checklist for M5 (to be run against hosted, after M8)
These are NOT done; none may be reported as passed until they are run in a real browser with a real signed-in session.
- [ ] Signed-in `payment_list` and `refund_list` calls against hosted (through the Payments, Refunds, Waiting for Approval and booking Payments & Refunds screens): rows, filters, paging, totals; Owner and Manager see the same.
- [ ] **Add Payment** and **Add Refund** browser workflows: every method, the app / card type and the typed "Other" name, the Required and Optional proof labels, the helper buttons, the refund figures, the warnings, the saved message, pressing Add twice.
- [ ] **Approval and rejection** (and reversal): the Waiting for Approval review panel, the next item opening, the self-approved note and tag, reasons, confirmations, the second person told who already decided, a payment that cannot be reversed while refunds depend on it.
- [ ] **Private proof upload and viewing:** a real upload through the signed link, photo shrinking, the server's content check, adding and hiding files while waiting, the 60-second link, zoom, PDF viewing.
- [ ] **Signed URL and CSP compatibility:** the file viewer's image and PDF frame under the app's content-security policy with the project's storage host; link expiry after 60 seconds; no storage credentials in the browser.
- [ ] **Proof correction workflow:** a correction file on an approved item (reason of at least 10 letters, "Added after approval" tag, originals and amounts unchanged); refused on waiting, rejected and reversed items.
- [ ] Layouts at 360, 768 and 1280 pixels for all of the above.


## M6: Booking PDFs and Document Management (committed and pushed; migration 23 applied to hosted 2026-11-12)
**Status, plainly:** implemented, tested locally, committed and pushed (`79f956a`, `5d8be32`, `a1c598a`; GitHub Actions confirmed by the owner). **Migration 23 is applied to hosted and verified** (below). Not deployed, not browser-tested. (The wording of the rest of this section is from before the apply and is kept as the record.)

**Reused, not rebuilt:** tables `booking_pdf_versions` and `pdf_jobs`, the private bucket `booking-pdfs` and its storage rule (M2); `booking_financials` (D1, unchanged); the audit trail. No migration 01-22 was changed.

**New:**
- Migration `20261111000023_pdf_pipeline.sql`: `pdf_booking_data` (all printed content, money taken from `booking_financials`), `pdf_prepare` (content hash, next version number and storage path chosen by the database), `register_pdf_version` (re-checks the hash, de-duplicates, enforces version = highest + 1, checks the stored file's size and type), `finish_pdf_jobs`, `claim_pdf_jobs` (service role only), `request_pdf_regeneration`, and the internal helpers `pdf_actor`, `pdf_hash`. Expected hosted counts after applying: 107 functions, 53 authenticated-callable, 0 anon/PUBLIC.
- `src/lib/pdf/`: `model.ts` (formatting only, no money arithmetic), `document.tsx` and `render.tsx` (react-pdf, bundled Noto Sans with the rupee sign), `pipeline.ts` (prepare, render, re-check, upload, register, finish; never throws; safe messages), `schedule.ts` (runs after the save through `after()`), `actions.ts` (Regenerate, 60-second signed download link).
- `src/app/api/cron/pdf-retry/route.ts` and `vercel.json` (every 10 minutes, `CRON_SECRET` bearer, constant-time compare, closed when unset). This is the only new place that uses the secret key.
- PDFs tab, header "Download PDF" button, Regenerate PDF button; PDFs are scheduled after every booking, payment, refund, approval, file and correction change.

**Tests:** PGlite PDB-01..26, E2E-01..08 (real PDF rendered from real DB functions); PG17 superuser and restricted: same plus CON-25/26/27 concurrency and PDB-27..33; unit PM, PR, PP, PDFA, PV6, PDFS. Full run: ESLint, tsc, Prettier clean; PGlite suite 1025 passed (26 skipped = PG17-only); PG17 superuser 522 passed, restricted 522 passed, concurrency 26 passed; `check:migrations` 23 files; secret scan clean; bundle scan clean (no react-pdf in browser files); `npm audit --omit=dev` 0 vulnerabilities; production build succeeds with the font files traced. Mutation tests for M6: none (per plan: ordinary tests only).

**Security correction (2026-11-12, second local commit):** `finish_pdf_jobs` now enforces in the database that a person can finish only pending or failed jobs, can say "done" only when the latest registered version matches the booking now, and always stores the fixed failure sentence; the retry job (service role) keeps its running-job and error-text rights. See SECURITY 18a, MIGRATION_REVIEW 20a, tests PDB-27..33 and CON-27. Latest local results: PGlite 1032 passed / 27 skipped; PG17 superuser 529; restricted 529; concurrency 27. At that time still local only (since pushed, and migration 23 applied to hosted; see below). Not browser-tested.

**Limitations, stated plainly:**
1. No browser test; no visual inspection of the rendered PDF (no PDF-to-image tool installed). Layout is checked through text extraction and parsing only.
2. A real signed-URL download, a real logo fetch from the private `resort-logos` bucket, Vercel cron and font tracing on Vercel, and `after()` behaviour in production are not exercised outside unit and database tests.
3. WEBP logos are skipped (PNG and JPEG only).
4. (Before the apply: migration 23 was not on hosted.) It is now applied, but the app is not deployed, so the PDF screens and the retry job do not run anywhere against hosted yet.
5. A version number can have a gap if a run uploads and then fails to register; the retry job overwrites the orphan file (system rights only).

## M6: migration 23 applied to hosted (2026-11-12)
Migration `20261111000023_pdf_pipeline.sql` (eight functions), commit `a1c598a22895ed2a85ea3c141f661a6edd462d47`, SHA-256 `7d313e5c77217d43079552055fb78813909cf7cf55addd6873348334d756566f`, was applied alone, after the owner's explicit approval, preflight P1-P9, a dry run listing only that file and a fresh verified safety export (`stateadv-backups/hosted-export-2026-11-12T09-47-35`, outside the repository, no credentials, all 4 manifest hashes match), with `push020.mjs apply` (`supabase db push --skip-vault --yes`): exit 0, only migration 023. Details: `supabase/HOSTED_VERIFICATION.md` section 0n.

**Verified afterwards (read-only):**
| Metric | Result |
|---|---|
| Migrations applied | 23 (001-023), 023 once, 01-22 unchanged |
| Functions in `public` | 107 (was 99) |
| Callable by signed-in users | 53 (was 48) |
| Callable by the service role | 106 |
| Callable by anon / PUBLIC | 0 / 0 |
| Tables / policies / triggers | 21 / 26 / 105 (unchanged) |
| PDF versions / PDF jobs | 0 / 0 |
| Function bodies equal to the migration source | 8 of 8 |
| Catalog comparison with a local rebuild | HOSTED STATE EQUALS THE LOCAL REBUILD, 14 of 14 categories |
| Existing table row counts | unchanged (equal to the safety export) |

All eight new functions have an empty `search_path`; seven are SECURITY DEFINER and `pdf_hash` is SECURITY INVOKER. The `finish_pdf_jobs` security correction is present in the hosted definition.

**Not done, so not claimed:** no authenticated call of the PDF functions on hosted; no real PDF generated or uploaded; Storage `size` / `mimetype` metadata compatibility not checked; no signed download or expiry; no logo fetch from `resort-logos`; no Vercel cron run and `CRON_SECRET` not configured; no `after()` check in production; no browser test. They stay on the M9 checklist below or belong to deployment verification. Safety-export limitations stand (no Auth user records, no Storage file contents, not a complete disaster-recovery backup), and `verify-export.mjs` still prints its known `22/10` warning (hard-coded 10 migrations; all 22 were checked independently, 22 of 22 equal git).

### M9 browser QA checklist for M6 (NOT done)
- [ ] Generate a PDF from a real booking; check the guest, stay, resort, charges, payments, refunds, totals and balance against the screen.
- [ ] Download from the PDFs tab and the header button; the file opens and is named `{Booking ID}-v{n}.pdf`.
- [ ] Multi-page PDF (many payments), long names and long notes, every optional field empty and filled, cancelled booking.
- [ ] Regenerate with nothing changed ("no new PDF needed"); after a payment is approved a new version appears.
- [ ] Private access: the file URL does not work signed out; a signed link stops working after 60 seconds; after sign-out the old link and the tab are not usable; a user cannot open another booking's PDF by guessing an id.
- [ ] Layouts at 360, 768 and 1280 pixels (buttons at least 44 px).
- [ ] CSP compatibility when the M9 nonce policy is added: downloads and the storage host.
- [ ] Vercel: cron fires and returns 200 with the secret, 401 without; fonts are present in the function.
- [ ] **Visual inspection** of the rendered PDF (layout, rupee sign, page breaks, logo placement); only text extraction and parsing were checked so far.
- [ ] **Real resort logo** fetched from the private `resort-logos` bucket and printed; a booking whose resort has no logo or a WEBP logo still produces a PDF.
- [ ] **Next.js `after()`**: on Vercel the PDF appears shortly after a save without delaying the save's response, and a failure leaves the booking saved with a retry queued.

## M7: Calendar and Historical Records (built locally, not committed)
**Status, plainly:** implemented and tested locally. Not committed, not pushed, not CI-verified, **migration 24 not applied to hosted**, not deployed, not browser-tested.

**Scope note (a conflict between the request and the repository, resolved the repository's way):** the request called M7 "Dashboard, Reports & Calendar". In IMPLEMENTATION_PLAN, PRD §5.13/§5.17 and UI spec §3.11/3.14/3.15, M7 is **Calendar and Historical Records** (calendar, day page, Old Records, Activity, backdated entries shown clearly). The **Dashboard was built and applied in M3**; the **Reports are M8** (Collection Reports, expected vs actual, CSV and PDF export) and were NOT started. Nothing was duplicated and no new business rule was invented.

**Reused, not rebuilt:** `booking_financials` (rule D1), `expected_entries` (plan rows + dated adjustments), `like_safe`, `is_active_user`, the audit log and its Owners-only rule for password re-entry rows (migration 19), the money and status components, the resort filter in the top bar, the list/filter/paging patterns of M4 and M5. No table, view, policy, trigger or money rule changed.

**New:**
- Migration `20261111000024_calendar_and_records.sql`: four read-only SECURITY INVOKER functions with an empty `search_path`, executable by signed-in users only: `calendar_month`, `calendar_day`, `old_records_search`, `activity_list` (details in DATABASE_SCHEMA 5d). Expected hosted counts after applying (a projection from the local rebuild, not verified): 111 functions, 57 callable by signed-in users, 110 by the service role, 0 by anon or PUBLIC; tables, policies and triggers unchanged (21 / 26 / 105).
- **Calendar** `/calendar` (month; resort filter from the top bar; Previous, Today, Next, a "Go to month" box, any month from 1990 to 2100): a 7-column grid from a tablet up and an agenda list of the busy days on a phone. Each day shows check-ins, check-outs, staying, **Due** (expected entries), **Collected** (approved payments only), **Waiting** (separate) and **Refunds** (approved only).
- **Day page** `/calendar/[date]` with the six tabs of the spec (Check-ins, Check-outs, Staying, Payments Received, Refunds, Payments Due), counts on the tabs, previous/next day, "Add Booking for this date", and quick actions as links (open the booking, Add Payment while money is pending, open the payment or refund). Payments and refunds of every status are listed with their status; only approved money is ever counted.
- **Backdated entries** (payment or refund date earlier than the IST day it was typed in) are tagged "Backdated" with the day it was entered on the day page, in Old Records, and now also in the **Payments and Refunds lists** (table and phone cards) and on the payment or refund page (`isBackdated` in `lib/dates.ts`, the same rule as the database). Display only: no financial logic changed.
- **Old Records** `/old-records`: bookings, payments and refunds in one list, newest first, by **any stored date (FR-CAL-3)**: the date on the record (booking, payment or refund date), the day it was typed in, the booking's **check-in** date, its **check-out** date or its **cancellation** date (all IST). A payment or refund is found through the date of its booking and listed with it; the cancellation date exists only on cancelled and no-show bookings, so that choice lists only them and their payments and refunds. Each row says which stored date matched. Text search (Booking ID, guest, mobile, payment or refund number, reference number, refund reason); kinds ticked; resort; paging; every row links to its page, with PDF versions (bookings) and files (payments, refunds) counted and reachable.
- **Activity** `/activity`: the audit log, newest first, with filters (who, what happened, kind of record, resort, dates, "only files added after approval"), a plain sentence per entry, a "What changed" table (before and after, only changed fields, money in rupees, India time, internal numbers and technical keys hidden) and account actions with the person they were about.
- Menu: Calendar, Old Records and Activity are now links (Collection Reports was built in M8). The booking form accepts `?checkin=` and `?resort=` (valid date and an active resort only) so "Add Booking for this date" pre-fills them.
- `src/lib/supabase/database.types.ts`: first written by hand (the local PostgreSQL 17 was blocked at that moment), then **regenerated with `scripts/gen-types.mts` on a throw-away PostgreSQL 17 on 2026-11-14**. The generated file differs from the committed one only by the four new function entries (104 added lines, none removed); my hand-written entries had the right content and one entry in the wrong place (`old_records_search` is now before `optional_reason`). `tests/db/types-in-sync.test.ts` passes.
- `vitest.config.mts`: `hookTimeout` raised from 10 s to 120 s. Seventy test files each build their own database in their setup hook; on a busy computer that sometimes took more than 10 s and failed whole files that pass alone. No test or assertion was changed or removed.

**Corrections after the final review (2026-11-14):** (1) Old Records date options extended to check-in, check-out and cancellation dates (migration 24 edited locally, new column `matched_date`; REC-11..20); (2) the month page's "Add Booking" now starts today in this month and on the first day of any other month shown; (3) Old Records and Activity read the resorts once (`loadResorts`, `lib/resorts.ts`); (4) Activity says "Activity no. 41" instead of "Entry 41", and "What" / "Filled in" in the table; (5) the Backdated tag is also shown in the Payments and Refunds lists and detail pages; (6) the Next.js 16.4 documentation was read and the pages compared with it (below). The week view, pagination for millions of records and the Safari month-box limitation were left as accepted.

**Next.js documentation review (node_modules/next/dist/docs, read 2026-11-14):** `page` (params and searchParams are Promises, awaited: already correct), `loading` and "Linking and navigating" (Cache Components is ON in `next.config.ts`, so pages that read cookies or the address need a loading boundary: present; a dynamic route should have its own `loading.tsx`: **added** for `/calendar/[date]`), `error` (the boundary gets `retry`, which re-fetches, and `reset`, which only redraws; the docs say to prefer `retry`: **the three M7 error screens were changed from `reset` to `retry`**; the M3 dashboard error screen still uses `reset`, outside M7, listed below), `functions/not-found` (`notFound()` renders the nearest `not-found.tsx`: **added** a plain-words not-found screen for a bad date; there is still no app-wide `not-found.tsx`), caching (nothing in M7 uses `use cache`: the data is one signed-in person's). Tests M7N-01..10 keep these conventions from slipping. Not changed: plain GET forms for the filters (the docs offer `next/form` for client-side navigation; the other list screens use plain forms too), and the status code of a bad date stays 200 once the loading screen has streamed (docs: not-found).
**Follow-ups outside M7 (not done):** the M3 dashboard error screen (`src/app/(app)/dashboard/error.tsx`) should use `retry` like the new ones; an app-wide `not-found.tsx` in the app's own style.

**Tests (all local):** database `tests/db/calendar-records.test.ts` CAL-01..29, REC-01..20, ACT-01..11 (60 tests: hand-calculated March 2026 data, IST boundaries 23:30 and 00:30, years 1990 to 2100 and 2020 to 2035, money agrees with independent SQL and with the dashboard, cancelled and no-show never shown as guests, waiting/rejected/reversed never counted, access refusals, Owners-only password re-entry rows, 300-row cap); scale `tests/db/records-performance.pg.test.ts` PERF-01..06 (50,000 bookings, 2020-2035; passed on real PostgreSQL 17 and on PGlite); unit `calendar-model` CALM-01..14, `records-activity-logic` RECF/ACTF/ACTD, `m7-views` M7V-01..24, `m7-security` M7S-01..09. The existing menu test and the function allow-list test (SEC-04) were updated on purpose (three pages now built; four functions added). Mutation tests: none for M7 (plan: ordinary tests only).

**Limitations, stated plainly:**
1. **No browser test and no visual check** of any M7 screen (layout at 360/768/1280, the grid, the tabs). Signed-out redirects of the new routes were checked on a local production server (all go to the login page).
2. **PostgreSQL 17:** on 2026-11-14 the local server was first blocked by Windows Application Control (`pg_trgm.dll`; no workaround was tried) and later started normally again. The PostgreSQL 17 superuser suite (589 tests), the restricted-role suite (589), the concurrency suite (27) and the 50,000-booking scale tests (6) were then run locally and passed (one cold first run in each of the superuser and restricted modes showed an incomplete file count with no failure text, and could not be reproduced in three further runs of each; CI is the independent check). CI (run on GitHub) has not run for M7.
3. No separate **week view**: UI spec 3.11 asks for a month view on a desktop and an agenda/week view on a phone; the phone gets the agenda list of the month's busy days. A week-by-week screen was not built.
4. Quick actions on a day row are links; **Mark Checked-in / Checked-out** stay on the booking page (a status change needs the booking's version number, which the day list does not carry).
5. "Staying" means the IST check-in date <= the day < the IST check-out date (a guest who leaves on the day is not staying that night); cancelled and no-show bookings are never shown as arriving, leaving or staying.
6. Migration 24 is not applied to hosted: on hosted these screens would show "could not be loaded" until it is (needs a fresh export, the exact SQL shown, preflight and a separate approval).

### M9 browser QA checklist for M7 (NOT done)
- [ ] Calendar month at 360, 768 and 1280 px: grid from a tablet up, agenda list on a phone; Previous / Today / Next / Go to month; resort filter in the top bar keeps the month; today marked; first and last allowed months.
- [ ] Day page: all six tabs and their counts, previous/next day, Add Booking for this date (check-in and resort pre-filled), Add Payment and Open links, a day with more than 300 of one kind, an empty day.
- [ ] Real data: a booking checking in at 23:30 IST and out at 00:30 IST appears on the right days; cancelled and no-show bookings do not appear as guests; Due, Collected, Waiting and Refunds agree with the dashboard for the same dates.
- [ ] Backdated payment and refund: tag and both dates on the day page and in Old Records.
- [ ] Old Records: each filter, all five date choices (record, typed in, check-in, check-out, cancellation) with a real cancelled booking and its payments, paging, text search with `%` and `_`, links to the booking, payment, refund, its files and the PDFs tab; records from 2020 and 2035.
- [ ] Activity: every filter, "only files added after approval", a real before/after table for a payment approval and a booking change, an account action (password reset) with the person named, and that password re-entry rows are visible to an Owner and not to a Manager.
- [ ] Signed out: every new URL goes to the login page; a signed-in Manager and an Owner see the same calendar.
- [ ] Performance with real history on hosted (month, day, Old Records, Activity feel fast); keyboard use and screen-reader labels of the grid.
- [ ] After migration 24 is applied: an authenticated call of each of the four functions on hosted.

## M8: Reports (built locally, not committed)
**Status, plainly:** implemented and tested locally. Not committed, not pushed, not CI-verified, **migration 25 not applied to hosted** (and migration 24 is not applied either), not deployed, not browser-tested.

**Scope:** the ten reports of IMPLEMENTATION_PLAN M8 / PRD / UI spec 3.13, each with a screen, a CSV file and a PDF file: Collection (daily, weekly, monthly, yearly; optional split by resort or payment method), Resort-wise Collection (Originally Expected, Expected Adjustments, Expected, Total Collection (Approved), Waiting, Refunds, Net, Difference), Payment Methods, Bookings, Pending Amount (with overdue as of a date), Waiting for Approval, Refunds, Cancellations, Expected Adjustments, Manual Adjustments. The dashboard (M3) and the calendar / old records / activity (M7) were not rebuilt.

**Money rules used (unchanged):** Total Collection (Approved) = approved payments by payment date; Waiting for Approval is shown apart and never added; Refunds = approved refunds by refund date; Net = Total Collection (Approved) - Refunds; rejected and reversed records are never counted; Difference = Expected - Total Collection (Approved); Expected comes from `expected_entries` (plan rows + dated adjustments, so a past month never changes). All dates are India time (IST); money is whole paise in the database.

**New:**
- Migration `20261111000025_reports.sql` (SHA-256 `e43bc78b80e16e743b8466638b3e2c2ac768570460413771d772875cd80b8b66`): eleven read-only SECURITY INVOKER functions with an empty `search_path`, executable by signed-in users only: `report_check`, `report_collection`, `report_expected_vs_actual`, `report_payment_methods`, `report_bookings`, `report_pending`, `report_waiting`, `report_refunds`, `report_cancellations`, `report_expected_adjustments`, `report_manual_adjustments`. Every function refuses a person who is not active (`NOT_ALLOWED`), refuses a reversed range or more than 3,660 days (`INVALID_INPUT`), returns the totals of the whole filter with every row (window sums) and pages of at most 1,000 rows. No table, policy, trigger or data changed. Projection after applying (not verified on hosted): 122 functions, 68 callable by signed-in users, 0 by anon or PUBLIC.
- Screens `/reports` (index) and `/reports/[report]` (filters, totals cards, table from a tablet up and cards on a phone, paging of 25, empty state, Download CSV / Download PDF with the same choices). `loading.tsx`, `error.tsx` (uses `retry`) and a not-found screen exist. Menu: Collection Reports is now a link.
- File route `/api/export/[report]?format=csv|pdf`: checks the session first (401), then report, format and choices (400/404), then reads as the signed-in person. CSV: UTF-8 with BOM, CRLF, rupees with two decimals, quoting by RFC 4180, a guard against spreadsheet formulas (free text starting with = + - @ tab or CR gets a leading apostrophe), streamed one page of 1,000 rows each time the reader asks (nothing piles up in memory), at most 100,000 rows (413 above that, never a silent cut). PDF: A4 landscape, bundled Noto Sans (the rupee sign prints), at most **1,000 rows** (413 with a plain sentence pointing to the CSV).
- `src/lib/supabase/database.types.ts` regenerated with `scripts/gen-types.mts` (278 lines added, none removed).

**Decisions and limits, stated plainly:**
1. **PDF row cap lowered to 1,000** (TRD said 5,000): react-pdf render time grows faster than the rows (measured here: 1,000 rows about 11 s, 2,500 rows about 62 s), so 5,000 would run for minutes and exceed a serverless limit. The CSV is limited to 100,000 rows (see the final audit below).
2. **The PDF footer has no "Page X of Y"**: a fixed footer with a page-number function made react-pdf fail on reports of several hundred rows (probed in several variants), so the footer is the plain fixed text "StateAdv · Time zone: India (IST)". Long text cells are clipped in the PDF (not in the CSV).
3. Files carry a header block (title, date used, rule, filters, time zone, when made) so a printed page says what it shows.
4. Date ranges are limited to ten years for the one-table reports.
5. No browser test and no visual check of any report screen or of how Excel or Google Sheets open the CSV (TEST_PLAN asks for it: M9).
6. Signed-out requests to the new routes (including the file route) are redirected to the login page by the proxy (checked on a local production server); the route itself also answers 401 (unit tests).
7. Migration 25 is not applied to hosted: until it is, the report screens would show "could not be loaded" there.

**Tests (all local):** database `tests/db/reports.test.ts` (56 tests, hand-calculated golden data, IST edges, approved/waiting/rejected/reversed, resort filters, empty data, access refusals, dashboard agreement, expected-entries immutability); scale `tests/db/reports-performance.pg.test.ts` RPT-PERF-01..05 (50,000 bookings, answers compared with independent SQL; passed on real PostgreSQL 17; also on PGlite with a smaller size); unit `report-definitions`, `report-format-csv`, `report-rows-pdf`, `report-export-route`, `report-views`, `report-security` (M8S-01..12). Mutation checks of the SQL were run by hand while writing the tests (changes to the date, status and window sums were caught). Existing tests updated on purpose: the menu test (Reports ready) and the function allow-list SEC-04 (+11).

### M9 browser QA checklist for M8 (NOT done)
- [ ] Each of the ten reports at 360, 768 and 1280 px: filters, totals cards, table vs cards, empty state, paging.
- [ ] Download CSV of each report and open it in Excel and Google Sheets (rupee amounts, dates, a guest name starting with = stays text, non-English names).
- [ ] Download PDF of each report: A4 landscape, rupee sign, long names, 1,000-row limit message.
- [ ] Totals agree with the dashboard for the same dates; Waiting is never inside Total Collection (Approved).
- [ ] Resort filter from the top bar and the report's own choices; a Manager and an Owner see the same figures.
- [ ] Signed out: every report URL and the file route go to the login page.
- [ ] After migration 25 is applied: an authenticated call of each of the eleven functions on hosted.

### M8 final audit (2026-11-14, before commit)
1. **CSV size and time.** Before: the file route read all pages inside `start()` of the stream, so a slow reader let up to 500,000 rows pile up in memory, and above the limit it cut the file silently while still writing the totals row. **Changed:** the stream now reads one page each time the reader asks (`pull`); a report above **100,000 rows** is a 413 ("choose fewer dates or one resort") instead of a silent cut. Evidence on real PostgreSQL 17 (this computer): one 1,000-row page of `report_bookings` took about 90 ms with 31,000 rows in range (RPT-PERF-06: 32 pages, 2.9 s in all) and about 0.8 to 1.4 s with 312,000 rows in range (500,000 bookings; offset paging gets slower with the offset). So a file of 100,000 rows needs about 100 pages: seconds at normal size, about 2 minutes on a database 10 times bigger than the plan expects. Not measured: the real Vercel/Supabase round trip, response download time, or a 100,000-row file in a browser. Paging by offset is kept (keyset paging would need a new migration and was judged out of proportion).
2. **Formula guard.** Text and code columns were guarded; the whole-number column and the status words passed text through unguarded (not reachable with today's data, which comes from numbers and enums). **Changed:** whole numbers are written only if they are numbers; status words are guarded too. CSV-08 puts a formula in every column of every report and checks no cell starts with a formula sign; CSV-09 keeps negative amounts (-500.00) unguarded.
3. **Expected vs actual.** Traced to `expected_entries` (the same view as the dashboard and the booking page): Originally Expected = active plan rows (superseded rows are gone), Expected Adjustments = dated adjustments, counted once. New `tests/db/reports-m5-consistency.test.ts` (RPT-M5-01..10) goes through the real flow (approve, reject, reverse, waiting payments and refunds, a cancellation with its adjustment) and agrees with `booking_financials` to the paisa; no gap found and no rule changed.
4. **Authorization.** Every active person sees every resort (Q10), so there is no per-resort access list to bypass; the route and the screen use the same `fetchReportPage` and filter (M8S-13). New RX-20 (every report, both formats, signed out/blocked: 401/403, nothing read) and RX-21 (tampered resort/date/choice matrix for every report and both formats). Database refusals for anon, unknown and switched-off people were already RPT-48/49.
5. **Execution time limit (added after the audit).** The export route now exports `maxDuration = 120` (configured, build passes). A full 100,000-row CSV through the real route code against local PostgreSQL 17 took about 34 s (13.4 MB, 100 pages; rows, totals and formula guard checked). **Production timing is NOT verified:** the limit actually granted depends on the Vercel plan and Fluid compute setting, and the Vercel-to-Supabase delay per page was not measured. To be checked in M10 on the real project; if too slow, lower `CSV_MAX_ROWS` first.
