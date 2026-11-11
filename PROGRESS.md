# PROGRESS — Milestone Tracking

Last updated: 2026-11-11

## Current status (updated 2026-11-11)
**M2 – Database and Authentication: sub-step M2-A (schema + security) is written and tested locally. It is NOT applied to Supabase and NOT pushed.** Waiting for the owner to review `supabase/MIGRATION_REVIEW.md` and the ten migration files.
- Local-only commits not pushed: 8a6d0ad (docs) and the M2-A commit.

### M2 preflight results (2026-11-11)
| Check | Result |
|---|---|
| Repository state | clean; `main` = `8a6d0ad`, 1 commit ahead of GitHub (`f15f5e9`) |
| GitHub Actions status | **Could not be read**: private repo, no GitHub CLI on this computer, anonymous API gets 404. Both jobs ("Lint, typecheck, test, build", "Secret scan") need to be reported by the owner. |
| SUPABASE_SECRET_KEY rotation | **NOT rotated**: the key in `.env.local` is the same one pasted in chat on 2026-11-11, it works, and the old chat key is still accepted by Supabase (HTTP 200). Not used or needed for M2-A. |
| Docker / gh CLI | not installed (database tests use PGlite instead) |

### M2-A work done (2026-11-11)
- 10 migration files (`supabase/migrations/20261111000001..10`), about 2,000 lines: 19 tables, 2 views, 10 enums, 59 foreign keys, 74 check constraints, 57 indexes, 24 RLS policies (18 tables + 6 storage), 97 triggers, 24 functions (only 4 callable by app users).
- Test harness on PGlite (PostgreSQL 18 in WebAssembly, in memory) with stand-ins for Supabase roles/auth/storage; fictional data only.
- 143 database tests + 76 existing = all passing; golden financial table + 250 random bookings match `src/lib/calc.ts` to the paisa.
- Mutation check: 10 deliberately weakened versions of the migrations, all caught by failing tests.
- Review guide: `supabase/MIGRATION_REVIEW.md`. DATABASE_SCHEMA.md updated with implementation notes.
- Bugs found by the tests and fixed before review: a commit-time plan check that read a column missing on some tables; a plan-row guard that rejected the intended "replace" update.

### Decisions needed from the owner (see MIGRATION_REVIEW §10)
1. Owner cannot change their own e-mail/role in the app (O1 literal) — keep, or allow a verified self-service e-mail change?
2. Files can be added to a payment/refund only while it is waiting — keep, or allow adding a missing receipt after approval?
3. A payment cannot be reversed while refunds depend on it (extra safety rule) — keep?
4. Approve applying M2-A to the dev project (dry-run first)? Needs the Session Pooler connection string in `.env.local` (not requested yet).

## Milestones
| # | Milestone | Status | Approved by owner |
|---|---|---|---|
| M0 | Requirement Analysis and Architecture | ✅ Complete | Yes (2026-11-11) |
| M1 | Project Setup | 🟢 Complete, awaiting review | No |
| M2 | Database and Authentication | 🟡 M2-A written + tested locally, awaiting review | Started 2026-11-11 (apply step needs separate approval) |
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
