# PROGRESS — Milestone Tracking

Last updated: 2026-11-11

## Current status (updated 2026-11-11)
**M2 – Database and Authentication is ONE milestone, in progress, NOT complete.** Full audit: `M2_STATUS.md`.

### Where each thing has been verified
| Level | State |
|---|---|
| **Hosted dev project** (PostgreSQL 17.11) | Migrations **01–10 applied** and verified read-only. Migrations **11–18 are NOT applied** (dry run lists exactly those eight). No Owner account. Signup disabled. Tables that migration 17 changes are **empty** on hosted (0 bookings, 0 C/O names). |
| **GitHub** | `origin/main` = `8be574e`; CI for it passed (lint/typecheck/test/build, secret scan, PostgreSQL 17 database tests; reported by the owner). The newer local changes (migration 17 constraint rename, generated types, hosted-rehearsal CI job, preflight script, docs) are **uncommitted and not pushed**, so the new `database-postgres-17-restricted` job has never run on GitHub. |
| **Local, real PostgreSQL 17.11** (throw-away server) | **355** database tests + **18** simultaneous-request tests pass, in each of two modes: superuser, and the hosted rehearsal (migrations run as a plain role named `postgres`). |
| **Local, PGlite** | **508** tests pass (18 concurrency tests skipped there). |
| **Mutation checks** | Exhaustive suite (53 weakened versions) is **deferred to M9** by owner decision (see below). Essential targeted M2 checks run 2026-11-11: 15 security/financial weakenings **all caught**; the runner now treats a crashed test process as INCONCLUSIVE (retried 3 times) and never as caught. |
| **Hosted preflight** (`npm run preflight:hosted`, read-only) | P1-P7 PASS; P8 FAILS because the working tree has uncommitted changes (correct behaviour). |
| **Generated types** | `src/lib/supabase/database.types.ts` regenerated from the migrations on a throw-away PostgreSQL: byte-identical to the file in the tree. |
| Lint, types, format, production build, bundle scan, migration check (now also ASCII-only) | pass |
| `npm audit --omit=dev` | 0 findings (3 dev-only advisories in the `shadcn` command-line tool, not shipped) |

**Known issue (open):** on this Windows machine the many-connection test file sometimes loses its Node worker process (about 1 run in 10; no failing assertion ever; see MIGRATION_REVIEW 14.6).

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
| 1 | Approve applying migrations 11–18 (dry run done; migration 17 has DROP COLUMN/TYPE, see MIGRATION_REVIEW 14.2) | everything on the hosted project |
| 2 | Approve pushing the local commits | CI incl. PostgreSQL 17 job |
| 3 | Replace the dev Secret Key, then approve the first-Owner run | the real Owner account |
| 4 | Two mailboxes; allow throw-away test users | RSV-06 (second half), 07, 08 |

## Milestones
| # | Milestone | Status | Approved by owner |
|---|---|---|---|
| M0 | Requirement Analysis and Architecture | ✅ Complete | Yes (2026-11-11) |
| M1 | Project Setup | 🟢 Complete, awaiting review | No |
| M2 | Database and Authentication | 🟡 In progress (one milestone). Schema written, tested and reviewed locally. Not applied. | Started 2026-11-11; applying to Supabase and creating the Owner need separate approval |
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
