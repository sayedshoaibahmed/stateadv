#!/usr/bin/env node
/**
 * READ-ONLY preflight before applying migrations 11-18 to the hosted Supabase project (HOSTED_VERIFICATION 0a).
 *
 *   npm run preflight:hosted
 *
 * It only SELECTs (the Supabase CLI runs every query with --read-only) and a dry run, never changes anything, reads
 * SUPABASE_DB_URL from .env.local, and prints NO connection detail: every part of the URL is redacted from all output.
 * Exit code 0 only if every check holds; otherwise STOP and report.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* reported below */
}
const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error(
    "SUPABASE_DB_URL is not set in .env.local (it is only for local developer tooling).",
  );
  process.exit(2);
}

// ---- redaction: nothing from the URL may ever reach the screen
const secrets = new Set([url]);
try {
  const u = new URL(url);
  for (const x of [
    u.password,
    decodeURIComponent(u.password),
    u.username,
    u.hostname,
  ])
    if (x && x.length >= 4) secrets.add(x);
} catch {
  /* an invalid URL fails the first query */
}
const redact = (t) =>
  [...secrets].reduce((s, x) => s.split(x).join("«redacted»"), String(t));

const CLI = ["node_modules/supabase/dist/supabase.js"];
function cli(args) {
  const r = spawnSync(process.execPath, [...CLI, ...args, `--remote=${url}`], {
    encoding: "utf8",
    timeout: 120000,
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { status: r.status, out: `${r.stdout ?? ""}\n${r.stderr ?? ""}` };
}
function query(sql) {
  const r = cli(["db", "query", "--read-only", sql]);
  const text = r.out;
  const a = text.indexOf("{");
  try {
    const parsed = JSON.parse(text.slice(a, text.lastIndexOf("}") + 1));
    if (r.status === 0 && Array.isArray(parsed.rows)) return parsed.rows;
  } catch {
    /* fall through */
  }
  throw new Error("query failed: " + redact(text).slice(0, 300));
}

let failed = 0;
const check = (id, label, ok, detail = "") => {
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${id}  ${label}${detail ? "  [" + detail + "]" : ""}`,
  );
};

// ---- what the migrations will create (read from the files, so this stays true when they change)
const dir = "supabase/migrations";
const pending = readdirSync(dir)
  .filter((f) => /^2026111100001[1-8]_/.test(f))
  .sort();
const newFns = new Set();
const replaced = new Set();
for (const f of pending) {
  const sql = readFileSync(`${dir}/${f}`, "utf8").replace(/--[^\n]*/g, "");
  for (const m of sql.matchAll(
    /create\s+(or\s+replace\s+)?function\s+public\.(\w+)/gi,
  ))
    (m[1] ? replaced : newFns).add(m[2]);
}
const list = (xs) => [...xs].map((x) => `'${x}'`).join(",");

try {
  const h = query(
    "select count(*)::int n, coalesce(max(version),'') v from supabase_migrations.schema_migrations",
  )[0];
  check(
    "P1",
    "migration history is exactly 01-10",
    h.n === 10 && h.v === "20261111000010",
    `rows ${h.n}, latest ${h.v}`,
  );

  const c = query(`select
    (select count(*) from public.bookings)::int bookings, (select count(*) from public.agents_partners)::int agents_partners,
    (select count(*) from public.booking_sequences)::int booking_sequences, (select count(*) from public.guests)::int guests,
    (select count(*) from public.resorts)::int resorts, (select count(*) from public.payments)::int payments,
    (select count(*) from public.refunds)::int refunds, (select count(*) from public.proofs)::int proofs,
    (select count(*) from public.payment_schedules)::int payment_schedules, (select count(*) from public.expected_adjustments)::int expected_adjustments,
    (select count(*) from public.user_profiles)::int user_profiles, (select count(*) from auth.users)::int auth_users,
    (select count(*) from storage.objects)::int storage_objects`)[0];
  const nonzero = Object.entries(c).filter(([, n]) => n !== 0);
  check(
    "P2",
    "every table that migration 17 changes or reads holds 0 rows",
    nonzero.length === 0,
    nonzero.length
      ? nonzero.map(([k, n]) => `${k}=${n}`).join(", ")
      : "13 tables, all 0",
  );

  const r = query(
    "select (select count(*) from public.stay_types)::int stay_types, (select count(*) from public.payment_providers)::int providers",
  )[0];
  check(
    "P3",
    "reference data as expected (3 stay types, 9 payment apps)",
    r.stay_types === 3 && r.providers === 9,
    `${r.stay_types}, ${r.providers}`,
  );

  const d = query(`select
    (select count(*) from pg_type where typname in ('co_category','partner_type') and typnamespace = 'public'::regnamespace)::int enum_types,
    (select count(*) from information_schema.columns where table_schema='public' and ((table_name='bookings' and column_name in ('co_category','agent_partner_id')) or (table_name='agents_partners' and column_name='type')))::int columns_,
    (select count(*) from pg_constraint where conname='bookings_co_rules')::int rule,
    to_regclass('public.co_categories') is null and to_regclass('public.co_entries') is null as new_tables_absent`)[0];
  check(
    "P4",
    "the objects migration 17 drops exist exactly as expected",
    d.enum_types === 2 && d.columns_ === 3 && d.rule === 1,
    `types ${d.enum_types}/2, columns ${d.columns_}/3, rule ${d.rule}/1`,
  );

  const dep = query(`select
    (select count(*) from information_schema.columns where table_schema='public' and udt_name in ('co_category','partner_type'))::int typed_columns,
    coalesce((select string_agg(p.proname, ',' order by p.proname) from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f' and (p.prosrc ~ 'co_category|agent_partner|agents_partners' or pg_get_function_arguments(p.oid) ~ 'co_category|partner_type' or pg_get_function_result(p.oid) ~ 'co_category|partner_type')),'') functions_,
    (select count(*) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='v' and pg_get_viewdef(c.oid) ~ 'co_category|agent_partner|agents_partners')::int views_,
    (select count(*) from pg_policies where qual ~ 'co_category|agents_partners' or with_check ~ 'co_category|agents_partners')::int policies_`)[0];
  check(
    "P5",
    "nothing but the two columns and guard_booking depends on them",
    dep.typed_columns === 2 &&
      dep.functions_ === "guard_booking" &&
      dep.views_ === 0 &&
      dep.policies_ === 0,
    `columns ${dep.typed_columns}/2, functions [${dep.functions_}], views ${dep.views_}, policies ${dep.policies_}`,
  );

  const k = query(`select
    (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in (${list(newFns)}))::int new_names_present,
    (select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in (${list(replaced)}))::int replaced_present,
    (select count(*) from public.resorts where code in ('SR1','SR2','SR3','SR4'))::int placeholder_conflicts`)[0];
  check(
    "P6",
    `none of the ${newFns.size} new functions exists; the ${replaced.size} replaced ones do; no placeholder conflict`,
    k.new_names_present === 0 &&
      k.replaced_present === replaced.size &&
      k.placeholder_conflicts === 0,
    `new present ${k.new_names_present}, replaced present ${k.replaced_present}/${replaced.size}`,
  );

  const dry = cli(["db", "push", "--dry-run", "--skip-vault"]);
  const listed = [...dry.out.matchAll(/•\s*(\S+\.sql)/g)].map((m) => m[1]);
  check(
    "P7",
    "dry run lists exactly the eight pending files, in order",
    dry.status === 0 && JSON.stringify(listed) === JSON.stringify(pending),
    `${listed.length} listed`,
  );
} catch (e) {
  console.error(redact(e.message));
  process.exit(1);
}

// ---- P8: the files being applied are the files on GitHub
const git = (args) =>
  spawnSync("git", args, { encoding: "utf8" }).stdout.trim();
spawnSync("git", ["fetch", "origin"], { encoding: "utf8" });
const clean = git(["status", "--short"]) === "";
const same = git(["rev-parse", "HEAD"]) === git(["rev-parse", "origin/main"]);
check(
  "P8",
  "working tree is clean and equals GitHub main (what is applied = what CI tested)",
  clean && same,
  `${clean ? "clean" : "UNCOMMITTED CHANGES"}, ${same ? "equals origin/main" : "differs from origin/main"}`,
);

console.log(
  failed === 0
    ? "\nPREFLIGHT PASSED (read-only; nothing was changed)"
    : `\nPREFLIGHT FAILED: ${failed} check(s). STOP; do not apply.`,
);
process.exit(failed === 0 ? 0 : 1);
