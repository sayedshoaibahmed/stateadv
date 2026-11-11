# Resort Management — Multi-Resort Booking & Financial Tracking

Internal web application for managing multiple resorts: bookings, payments, approvals, refunds, collections, PDFs and audit history.
It is **not** a public booking site, payment gateway, POS or GST invoicing tool.

## Documentation
| Document | Purpose |
|---|---|
| [PRD.md](PRD.md) | Business requirements and the owner's decisions (§11) |
| [TRD.md](TRD.md) | Technical design |
| [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) / [ER_DIAGRAM.md](ER_DIAGRAM.md) | Database tables, rules and calculations |
| [UI_UX_SPECIFICATION.md](UI_UX_SPECIFICATION.md) | Screens and user flows |
| [SECURITY.md](SECURITY.md) | Authentication, permissions, storage, backups |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Milestones M0–M10 |
| [TEST_PLAN.md](TEST_PLAN.md) | Test strategy and test cases |
| [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) | Environments, deployment, backup and recovery |
| [PROGRESS.md](PROGRESS.md) | Current status |

## Tech stack
Next.js 16 (App Router, Turbopack, Cache Components) · React 19 · TypeScript (strict) · Tailwind CSS 4 · shadcn/ui (Radix, Nova preset) · Supabase (PostgreSQL, Auth, Storage) · Zod · React Hook Form · TanStack Table · Recharts · @react-pdf/renderer · Vitest · Playwright.

## Getting started
Requirements: Node.js ≥ 22.12 (developed on Node 24), npm.

```bash
npm ci
cp .env.example .env.local      # then fill in the values (never commit .env.local)
npm run check:supabase           # verifies the Supabase connection (prints no secrets)
npm run dev                      # http://localhost:3000
```

## Scripts
| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run lint` | ESLint |
| `npm run typecheck` | Route type generation + `tsc --noEmit` |
| `npm test` | Unit tests (Vitest) |
| `npm run format` / `format:check` | Prettier |
| `npm run check:supabase` | Supabase connectivity (auth + database API) |
| `npm run check:migrations` | Blocks destructive SQL without `-- DESTRUCTIVE-APPROVED: <reason>` |
| `npm run check:bundle` | After a build: ensures no secret key is in browser files |
| `npm run check` | lint + typecheck + tests + migration check |

`GET /api/health` returns app and Supabase status (no secrets).

## Project structure
```
src/
  app/                 Next.js routes (pages, layouts, route handlers)
    api/health/        health check
  components/
    ui/                shadcn/ui components (generated; do not hand-edit lightly)
    app/               application components (from M3)
  lib/
    money.ts           integer-paise money parsing/formatting (never floats)
    dates.ts           IST (Asia/Kolkata) date helpers, nights calculation
    calc.ts            booking + financial formulas (reference; DB is the source of truth)
    env.ts             public env validation
    env.server.ts      server-only env validation
    supabase/          client.ts (browser) · server.ts (per request, user JWT) ·
                       admin.ts (secret key, server only) · proxy.ts (session refresh) · health.ts
    validation/        shared Zod schemas (from M4)
  proxy.ts             Next.js 16 proxy (formerly "middleware")
supabase/
  config.toml          Supabase CLI config (local stack)
  migrations/          SQL migrations (from M2; additive only)
  tests/               pgTAP database tests (from M2)
scripts/               check-supabase, check-migrations, check-client-bundle
tests/
  unit/                Vitest
  e2e/                 Playwright (from M3)
.github/workflows/     CI (lint, typecheck, tests, build, bundle check, secret scan)
```

## Security rules (short)
- Never commit `.env*` files (only `.env.example`). They are git-ignored.
- Only `NEXT_PUBLIC_*` values may reach the browser. The Supabase **secret** key is server-only (`src/lib/supabase/admin.ts`).
- All data access goes through Row Level Security. All writes go through database functions (from M2).
- Storage buckets are private. Files are shown with short-lived signed URLs.
- No destructive migrations without explicit approval. No production deployment without the owner's approval.

## Tests (M2)

- `npm test` — everything quick (database tests run on PGlite, an in-memory PostgreSQL).
- `npm run test:pg17` — the same database tests plus the concurrency tests on a **real PostgreSQL 17**. Set `STATEADV_PG_URL` to a throw-away server (CI uses a `postgres:17` container). The harness refuses any Supabase address.
- `npm run check:mutations` — weakens the migrations one rule at a time and checks the tests notice.
- Status of every M2 requirement: `M2_STATUS.md`. Checks on the real Supabase project: `supabase/HOSTED_VERIFICATION.md`.
