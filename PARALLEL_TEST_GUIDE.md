# Parallel Test Guide

For an agentic Claude Code session asked to run this repo's test suite faster by
splitting it across multiple subagents (e.g. "run the tests using 4-5 agents").

## What you're running

- `tests/unit/**/*.test.ts` (44 files): pure logic — no network, no database.
  Fully self-contained; every test that touches "Supabase" in its name mocks it
  or reads from a fake fixture, never a real project.
- `tests/db/**/*.test.ts` (33 files, excluding the shared helpers `fixtures.ts`,
  `harness.ts`, `pg-backend.ts`, `raw-data.ts`, which aren't test files): each
  file builds its **own** throwaway Postgres database in-process via PGlite
  (WASM), replaying every migration in `supabase/migrations/`, then tests
  against it. No real network, no live Supabase project involved.
- 3 files ending in `.pg.test.ts` (`concurrency.pg.test.ts`,
  `records-performance.pg.test.ts`, `reports-performance.pg.test.ts`) are
  different: they need a **real** Postgres 17 server reachable via
  `STATEADV_PG_URL` (never a Supabase host — `scripts/pg-version.mjs` refuses
  one), not PGlite. This repo already has a dedicated way to run them
  (`npm run test:pg17`). Treat these as optional/separate: only run them if a
  real Postgres 17 instance is available on this machine; otherwise it's fine
  to skip them for a routine fast run and say so in the report.

**No `.env.local` or live Supabase project is required for the 77 files below.**
Everything either mocks Supabase or builds its own in-memory database.

## Steps

1. **List the 77 files to split** (everything except the three `.pg.test.ts`
   files and the non-test helpers):
   ```bash
   { ls tests/unit/*.test.ts; ls tests/db/*.test.ts | grep -v '\.pg\.test\.ts$'; } > /tmp/all-tests.txt
   wc -l /tmp/all-tests.txt
   ```

2. **Split into N roughly-equal groups** — pick 4 or 5 based on how many cores
   makes sense on this machine:
   ```bash
   split -n l/5 -d /tmp/all-tests.txt /tmp/test-group-
   ```
   This produces `/tmp/test-group-00` through `/tmp/test-group-04`, each a
   plain newline-separated list of file paths.

3. **Spawn one subagent per group, all in the same message so they run in
   parallel.** A plain/general-purpose agent is fine — this is mechanical.
   Prompt for each one, e.g.:
   > Run `npx vitest run $(cat /tmp/test-group-00 | tr '\n' ' ')` in
   > `<this repo's path>`. Report back: total passed/failed, and for every
   > failure the file, the test name, and the assertion/error message. Do not
   > fix anything — just report what happened.

4. **Once every subagent has reported, run the PG17 suite separately**
   (sequential, on purpose — the repo already isolates
   `concurrency.pg.test.ts` from the rest to avoid interference), only if a
   real Postgres 17 server is available:
   ```bash
   npm run test:pg17
   ```

5. **Combine into one final summary**: total files, total tests, total
   passed/failed across every group (plus the pg17 run if it ran), and a flat
   list of every failing test with its file and message. If everything passed,
   say so plainly — don't pad the report with narration.

## Notes

- `vitest.config.mts` sets generous timeouts (`hookTimeout: 120_000`,
  `testTimeout: 60_000`) specifically because each `tests/db` file builds a
  full database from scratch on a busy machine — that is normal, not a sign
  anything is slow or broken.
- The reason splitting into N agents helps: this repo's DB-test setup cost
  (building a fresh Postgres per file) is almost entirely independent per file
  and CPU/IO-bound, so it parallelizes close to perfectly — wall-clock time
  should drop close to (serial time ÷ N), not get wasted on contention.
- This is a procedure, not a one-time snapshot: step 1's file listing picks up
  new or removed test files automatically, so nothing here needs updating just
  because the suite grows.
