# IMPLEMENTATION_PLAN — Milestones M0 to M10

| Item | Value |
|---|---|
| Status | M0 final draft |
| Last updated | 2026-11-11 |

Rules (from the project brief):
- Milestones run strictly in order. Each one starts **only after explicit owner approval**.
- Inside an approved milestone, work is autonomous. Questions are asked only for credentials, financial business decisions, irreversible actions, or production deployment.
- Each milestone ends with a report: completed work, files changed, tests and results, remaining work, known issues, decisions needed. PROGRESS.md is updated.
- Nothing is called "done" without verification.

Every milestone also includes: updating the affected docs; lint + typecheck + all tests; a git commit (from M1).

---

## M0 — Requirement Analysis and Architecture
- Directory inspected (empty). Ten planning documents written.
- All business questions decided (PRD §11), except Q11 (deferred to before M10).
- Derived rules D1–D4 decided. Owner-account protection designed (PRD FR-AUTH-9…13).
- **Exit:** the owner confirms O1–O4 (or accepts) and approves M0.

## M1 — Project Setup
Needs from the owner: GitHub access (private repo), a Supabase account for a **free dev project**, and the Docker Desktop yes/no decision.
1. `git init`, `.gitignore`, README. Docs stay in the root (or move to `/docs`). Private GitHub repo and first push.
2. Next.js app (TypeScript strict, App Router, ESLint, Tailwind, `src/`), Prettier.
3. shadcn/ui init + base components.
4. Libraries: `@supabase/ssr`, `@supabase/supabase-js`, react-hook-form, zod, `@hookform/resolvers`, date-fns (+ tz), @tanstack/react-table, recharts, @react-pdf/renderer, server-only. Dev: vitest, @playwright/test, supabase CLI.
5. Supabase CLI init/link (dev). Local stack if Docker is available.
6. `lib/supabase/{client,server,admin}.ts`, `lib/env.ts` (zod), `.env.example`.
7. `lib/money.ts`, `lib/dates.ts` (IST, nights) and `lib/calc.ts` (preview: base/total/final), all with full unit tests.
8. CI: lint → typecheck → unit → DB tests → migration-safety script → secret scan.
- **Exit:** the app runs locally against Supabase dev, CI is green, and the money/date/calc tests pass.

## M2 — Database and Authentication
**M2 is ONE milestone with ONE completion report** (owner decision 2026-11-11). The internal task list below is only a working order, not separate milestones:
1. Database schema, security rules, views, storage — *written and tested locally; awaiting owner review; NOT applied to Supabase.* See `supabase/MIGRATION_REVIEW.md`.
2. Schema additions agreed 2026-11-11: verified own-email change (O7), correction files (Q9a), reversal protection (D5). *Written and tested at database level; the app screens and the correction-file function come with the later tasks.*
3. Write functions (RPCs): booking ID, create/update/cancel booking, plan changes, payments, refunds, approvals, account management, recovery.
4. Apply to the development project (only after the owner approves, dry run first).
5. Login, password change, My Account (own email change), user management, first-Owner script (the Owner account is created only after separate approval).
6. GitHub Actions database job on real Postgres, concurrency tests.
7. The single M2 completion report.

1. Migrations: extensions → enums → tables (incl. refunds, proofs, approval_history, booking_sequences per resort/year, payment_plan_revisions, expected_adjustments) → constraints (pricing, C/O, cancellation, adjustment) → indexes → triggers (audit, updated_at, prevent_delete, immutability, approval_guard, schedule_guard past-due lock, resort copy, plan-invariant and proof deferred checks, user_profiles_guard: self-disable / last Owner / O1–O2) → views (`booking_financials`, `expected_entries`) and functions (`booking_overdue`, `plan_preview`) → RPCs (incl. plan revision rules, `recover_owner_account`) → grants/revokes → RLS → storage buckets and policies.
2. Seed: stay types (Resort Stay, Day Outing, Package), payment providers. **No test or placeholder Owner accounts are stored in the database** (O5): database tests create their users inside transactions that roll back. `scripts/create-first-user.ts` (creates only the owner's real first Owner account, refuses to run if any profile exists) and `scripts/recover-owner.ts` (with `--reset-mfa`).
3. Auth: email/password login, proxy (`src/proxy.ts`), protected layout, logout, forced password change, user management (add/edit/disable/enable/reset) with self-disable block, Owner protection (Owner-only actions on Owners, password re-entry, reason, alert), Forgot-password link for Owner accounts, and audit.
4. Generated TS types.
5. pgTAP: RLS everywhere, anon denied, inactive user denied, deletes blocked, ID concurrency per resort/year, pricing/C/O/cancellation constraints, plan invariant + past-due lock + adjustments (PLN-05…11, COL-11*), proof rule, transitions, refund limit + race, all of FIN-01…19, audit actor, self-approval flags, USR-* and OWN-* rules.
- **Exit:** all DB tests pass. Login, logout and user management work. A direct REST write attempt fails.

## M3 — UI and Dashboard
1. App shell (sidebar, top bar with user name, mobile bottom nav, global search stub, resort filter).
2. Design tokens. `<Money>`, `<StatusBadge>`, `<SelfApprovedTag>`, `<DateText>`. Empty/loading/error states.
3. Dashboard with one **Total Collection (Approved)** card (+ refunds/net line), a separate Waiting card, Expected, Pending, resort table, chart, recent lists, alerts. Aggregate RPCs.
4. Responsive checks at 360/768/1280.
- **Exit:** dashboard figures match the golden fixture, and it works on mobile.

## M4 — Resort, Guest and Booking Management
1. Resorts (code locked after the first booking, logo upload, activate/deactivate).
2. Agents & Partners, plus quick-add from the booking form.
3. Stay types and payment apps in Settings.
4. Guests (search, detail, history, duplicate suggestions).
5. Booking form: pricing method, nights, extras, discount, manual adjustment with reason, C/O rules, plan editor (empty amounts, sum check; on later changes: locked past rows shown read-only, "Amount still to plan", move-overdue option, automatic adjustment notice), idempotency.
6. Booking list, booking page (Details, Plan, History; Payments/PDF tabs as placeholders).
7. Edit booking: locked resort/year, amount-change reason + plan, version check. Check-in/out status.
8. Cancel / No-show dialog (no default charge / pre-filled full amount + reason), cancellation plan, charge correction.
9. Global search.
- **Tests:** AMT-*, CO-*, BID-*, PLN-*, EDT-*, CAN-* (DB + E2E), double-submit, edit conflict.
- **Exit:** bookings can be created, edited, cancelled and marked no-show, with correct IDs, plans and audit history.

## M5 — Payment Management and Approvals
1. Signed uploads, compression, server verification + SHA-256.
2. Add Payment (proof required for UPI/Card/Cheque), warnings, edit waiting payment, hide proof.
3. Add Refund (limit, warnings, proof rule), refund list.
4. Approvals page (Payments/Refunds tabs, review panel, approve/reject/reverse, self-approved notes).
5. Payments and Refunds list pages. Money box from `booking_financials`.
- **Tests:** PAY-*, APR-*, REF-*, FIN-* via the UI, concurrency.
- **Exit:** the full payment and refund life-cycle works, and every figure matches the golden fixture.
- **Status (2026-11-12):** built, committed (`1eb65b5`) and pushed; migration 22 applied to hosted and verified (read-only); browser E2E and authenticated hosted calls wait for the deferred QA (M9 checklist in PROGRESS.md).

## M6 — Automatic PDF Generation
**Status 2026-11-12:** built, committed (`79f956a`, security fix `5d8be32`, docs `a1c598a`, `45c2282`) and pushed; GitHub Actions passed (confirmed by the owner); migration 23 (`20261111000023_pdf_pipeline.sql`, eight functions) **applied to hosted and verified** (107 functions, 53 callable by signed-in users, 106 by the service role, 0 by anon/PUBLIC; 21 / 26 / 105 tables, policies and triggers unchanged; catalog equals a local rebuild in all 14 categories; HOSTED_VERIFICATION 0n). Not yet tested: authenticated calls of the PDF functions on hosted, real PDF generation and upload, Storage metadata compatibility, signed downloads and expiry, the logo fetch, Vercel cron and `CRON_SECRET`, `after()` in production, and any browser use; these stay on the M9 checklist (see PROGRESS).
1. Template (all PRD §5.14 content, Noto Sans ₹, logo, disclaimer, version).
2. Job processing after commit, content-hash de-duplication, version registration.
3. Cron retry + Regenerate button. PDFs tab with downloads.
- **Tests:** PDF-01…09.
- **Exit:** PDFs are created on every listed event, de-duplicated, and old versions are downloadable.

## M7 — Calendar and Historical Records
**Status 2026-11-14:** built and tested locally; not committed; migration 24 (four read-only functions) not applied to hosted; no browser test; PostgreSQL 17 suites not run locally (see PROGRESS). Dashboard = M3 (done) and Reports = M8 (not started); neither is part of M7.
1. Calendar (month/week/agenda) and day page (check-ins, outs, staying, received, refunds, due).
2. Old Records search. Activity page (incl. account actions) with diffs.
3. Backdated entries shown clearly (payment/refund date vs entered at).
- **Tests:** IST boundaries, multi-year data (2020–2035), performance with about 50k bookings.
- **Exit:** any date can be viewed and managed; old records, screenshots and PDFs are reachable.

## M8 — Reports and Collections
1. Report functions: collection (daily/weekly/monthly/yearly), resort-wise expected vs actual (Originally Expected + Expected Adjustments), payment methods, bookings, pending + overdue, waiting, refunds, cancellations, Expected Adjustments report, manual-adjustment report.
2. Report pages, CSV + PDF export.
- **Tests:** COL-*, golden fixture for every report, Excel/Sheets opening.
- **Exit:** all reports match the golden fixture.
**Status 2026-11-14:** built and tested locally; not committed; migration 25 (eleven read-only functions) not applied to hosted (nor is 24); no browser test; PDF limited to 1,000 rows (see PROGRESS M8).

## M9 — Testing and Security
1. Full TEST_PLAN run, and fill coverage gaps (≥ 90% on money/date/calc; every RPC covered by pgTAP).
2. Security review (RLS audit, anon/inactive attempts, signed URL expiry, headers, deps, secrets).
3. Performance test. Plain-language usability review.
4. Backup job built and the **restore drill** executed on a scratch project.
- **Exit:** all green, no open high/critical findings, drill documented.

## M10 — Deployment and Handover
Needs the **budget/provider confirmation (Q11)** and explicit production approval.
1. Production projects on paid plans (Mumbai). Env vars, domain.
2. Staging migration → smoke test → backup → production migration.
3. Real user accounts and the four resorts.
4. Backup cron enabled and the first run verified.
5. Handover: user guide (simple English, screenshots), admin guide, recovery runbook, credentials checklist, support plan.
- **Exit:** owner sign-off after UAT on production.

---

## Owner decision status
| Item | Status | Needed before |
|---|---|---|
| Q1–Q10, Q12–Q17 (incl. Q6b, Q7a–d) | ✅ Decided (PRD §11) | — |
| D1–D4 derived rules | ✅ Decided | — |
| O1–O4 Owner-account protection | ✅ Accepted with M0 approval | — |
| O5–O6 one Owner now, second Owner added later in the app | ✅ Decided | — |
| First Owner: full name + real email | ❓ Needed from the owner | Start of M2 |
| Second Owner: name + real email | ⏸ Pending (not needed to build or test M2) | Recommended before M10 |
| Q11 hosting budget/providers | ⏸ Deferred | M10 (development on free tiers) |

## M2 progress note (2026-11-11)
Task list items 1–3, 5 (except real accounts) and 6 are done **locally**: schema (applied), write functions (migrations 11–18, not applied), sign-in/People/My Account screens, first-Owner and recovery scripts (not run), storage code, and a real-PostgreSQL job in CI (not yet run on GitHub). Items still open: apply 11–18 (approval), real-account checks (RSV-06..08, 11), the first Owner (approval), the single M2 completion report. See `M2_STATUS.md`.
