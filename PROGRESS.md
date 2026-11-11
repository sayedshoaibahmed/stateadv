# PROGRESS — Milestone Tracking

Last updated: 2026-11-11

## Current status (updated 2026-11-11)
**M2 – Database and Authentication is ONE milestone, in progress.** The database schema and security rules are written and tested locally, now including the owner's decisions of 2026-11-11 (O7 verified own-email change, Q9a correction files, D5 reversal protection). They are **NOT applied to Supabase** and **NOT pushed**.
- Local-only commits (not pushed, awaiting owner approval); GitHub (`origin/main`) is still at `f15f5e9`.
- No Owner account has been created. No connection string has been requested or used. No migration has been applied.
- Waiting for the owner to review the updated `supabase/MIGRATION_REVIEW.md` (section 10 lists exactly what changed).

### Exact remaining blockers
| # | Blocker | Status | Who |
|---|---|---|---|
| 1 | **Secret key revocation** | **Open.** Last checked 2026-11-11: `.env.local` still holds the key pasted in chat; it works, and Supabase still accepts that same key (HTTP 200). Create a new secret key, delete the old one in Supabase (Project Settings → API Keys), put the new one in `.env.local` yourself. I will re-verify without printing it. | Owner |
| 2 | **GitHub Actions verification** | **Open.** I cannot read a private repository's CI (no GitHub tool here; anonymous access gets 404). Please report the result of both jobs, "Lint, typecheck, test, build" and "Secret scan", for the last pushed commit `f15f5e9`. Note: the unpushed work adds a database-test run to the same job (PGlite, no secrets needed). | Owner |
| 3 | Push approval | Waiting. Local commits are ready; commit messages no longer say "M2-A". | Owner |
| 4 | Approval to apply the migrations to the dev project | Waiting. Needs your review of the updated migration files first. | Owner |
| 5 | Session Pooler connection string | **Not requested yet**, by instruction. Needed only for step 4, entered by you into `.env.local`. | Owner |
| 6 | Approval to create the first Owner account | Waiting. Not before the migrations are applied and you say so. | Owner |
| 7 | Remaining M2 work | Write functions (booking ID, bookings, plan, payments, refunds, approvals, correction-file function, user management, recovery), login / My Account / user screens, first-Owner script, CI job on real Postgres with concurrency tests. | Developer |

### Done so far in M2
- 10 migration files (`supabase/migrations/20261111000001..10`, about 2,150 lines): 19 tables, 3 views, 10 enums, 59 foreign keys, 75 check constraints, 57 indexes, 24 RLS policies, 97 triggers + 1 on `auth.users`, 25 functions (4 callable by app users).
- **O7:** profile email follows only an address Supabase Auth has confirmed; direct self-edit refused; roles never self-service. **Q9a:** originals of decided payments/refunds locked; controlled correction files (approved items only, reason of 10+ characters, permanent, listed in `correction_files`). **D5:** reversal blocked while dependent refunds exist.
- Database tests on PGlite (PostgreSQL 18 in memory; never connected to Supabase), fictional data only: **170 database tests** (143 earlier + 27 new); with the 91 other tests, **261 pass**. Money views match `src/lib/calc.ts` on the golden table and 250 random bookings. Two earlier assertions were updated because the decisions changed the expected error name / the views list; everything else is unchanged.
- Mutation check: **18 of 18** deliberately weakened versions of the migrations are caught by failing tests (it also exposed one vacuous new test of mine, which was rewritten).
- Review guide: `supabase/MIGRATION_REVIEW.md`.

### Still to confirm only on the real Supabase project
Creating policies on `storage.objects`, inserting into `storage.buckets`, creating a trigger on `auth.users`, the real confirmation emails (Secure email change ON; built-in development email delivers only to Supabase team addresses).

## Milestones
| # | Milestone | Status | Approved by owner |
|---|---|---|---|
| M0 | Requirement Analysis and Architecture | ✅ Complete | Yes (2026-11-11) |
| M1 | Project Setup | 🟢 Complete, awaiting review | No |
| M2 | Database and Authentication | 🟡 In progress (one milestone). Schema written + tested locally, awaiting review. Not applied. | Started 2026-11-11; applying to Supabase and creating the Owner need separate approval |
| M3 | UI and Dashboard | ⚪ Not started | No |
| M4 | Resort, Guest and Booking Management | ⚪ Not started | No |
| M5 | Payment Management and Approvals | ⚪ Not started | No |
| M6 | Automatic PDF Generation | ⚪ Not started | No |
| M7 | Calendar and Historical Records | ⚪ Not started | No |
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
