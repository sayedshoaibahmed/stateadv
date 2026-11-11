#!/usr/bin/env node
/**
 * "Do the tests really guard the rules?"
 *
 * Deliberately weakens the migrations, one rule at a time, in a TEMPORARY COPY,
 * and checks that the database tests FAIL because a test noticed - not because
 * the SQL stopped working. The real migration files are never modified.
 *
 *   node scripts/mutation-check.mjs
 */
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const SRC = "supabase/migrations";
const ANSI = /\u001b\[[0-9;]*m/g; // terminal colour codes

const MUTATIONS = [
  {
    name: "last-Owner protection removed",
    file: "06",
    from: "if n_other_owners = 0 then",
    to: "if false then",
  },
  {
    name: "RLS switched off on payments",
    file: "08",
    from: "alter table public.payments               enable row level security;",
    to: "",
  },
  {
    name: "past-due plan rows no longer locked",
    file: "06",
    from: "  if old.due_date < public.today_ist() then\n    raise exception 'PAST_DUE_ROW_LOCKED'",
    to: "  if false then\n    raise exception 'PAST_DUE_ROW_LOCKED'",
  },
  {
    name: "waiting refunds wrongly reduce Pending (D1 broken)",
    file: "07",
    from: "greatest(x.due_paise - (x.approved_paise + x.waiting_paise - x.refunds_approved_paise), 0)  as pending_paise",
    to: "greatest(x.due_paise - (x.approved_paise + x.waiting_paise - x.refunds_approved_paise - x.refunds_waiting_paise), 0)  as pending_paise",
  },
  {
    name: "app users given INSERT on bookings",
    file: "08",
    from: "grant usage on schema public to authenticated;",
    to: "grant usage on schema public to authenticated;\ngrant insert on public.bookings to authenticated;",
  },
  {
    name: "functions executable by anon / PUBLIC again",
    file: "08",
    from: "revoke all on all functions in schema public from public, anon, authenticated;",
    to: "",
  },
  {
    name: "refund limit check removed",
    file: "06",
    from: "    if new.amount_paise > sum_a - sum_ra - sum_rw then",
    to: "    if false then",
  },
  {
    name: "approved payments editable",
    file: "06",
    from: "      raise exception 'PAYMENT_LOCKED' using detail = 'An approved payment can only be reversed.';",
    to: "      null;",
  },
  {
    name: "cancellation allowed to rewrite original amounts",
    file: "06",
    from: "        raise exception 'CANCELLED_AMOUNTS_LOCKED'\n          using detail = 'The original amounts of a cancelled booking cannot be changed.';",
    to: "        null;",
  },
  {
    name: "audit log editable",
    file: "06",
    from: "foreach t in array array['payment_plan_revisions','expected_adjustments','approval_history','booking_pdf_versions','audit_logs']",
    to: "foreach t in array array['payment_plan_revisions']",
  },
];

let problems = 0;
for (const m of MUTATIONS) {
  const dir = mkdtempSync(join(tmpdir(), "stateadv-mut-"));
  try {
    cpSync(SRC, dir, { recursive: true });
    const file = readdirSync(dir).find((f) =>
      f.startsWith(`202611110000${m.file}`),
    );
    const text = readFileSync(join(dir, file), "utf8");
    if (!text.includes(m.from))
      throw new Error(`mutation anchor not found for "${m.name}"`);
    writeFileSync(join(dir, file), text.replace(m.from, m.to));

    const r = spawnSync("npx", ["vitest", "run", "tests/db"], {
      env: { ...process.env, STATEADV_MIGRATIONS_DIR: dir },
      encoding: "utf8",
      shell: true,
    });
    const out = `${r.stdout}\n${r.stderr}`.replace(ANSI, "");

    if (/Migration .* failed/.test(out)) {
      problems++;
      console.log(
        `INVALID   ${m.name}  (the weakened SQL did not even run - fix the mutation)`,
      );
      continue;
    }
    const failed = Number((out.match(/Tests\s+(\d+) failed/) ?? [])[1] ?? 0);
    const caught = r.status !== 0 && failed > 0;
    if (!caught) problems++;
    console.log(
      `${caught ? "CAUGHT  " : "SURVIVED"}  ${m.name}  (${failed} test(s) failed)`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
console.log(
  problems === 0
    ? `\nAll ${MUTATIONS.length} weakened versions were caught by the tests.`
    : `\n${problems} problem(s): a weakened version survived, or a mutation was invalid.`,
);
process.exit(problems === 0 ? 0 : 1);
