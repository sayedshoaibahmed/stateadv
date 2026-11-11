#!/usr/bin/env node
/**
 * READ-ONLY preflight before applying the NEXT migration(s) to the hosted Supabase project (HOSTED_VERIFICATION 0a).
 *
 *   npm run preflight:hosted                       checks whatever is pending (nothing is hard-coded)
 *   npm run preflight:hosted -- --pending=20261111000019[,...]   additionally asserts the exact pending list
 *
 * It only SELECTs (the Supabase CLI runs every query with --read-only) and a dry run, never changes anything, reads
 * SUPABASE_DB_URL from .env.local, and prints NO connection detail: every part of the URL is redacted from all output.
 * Exit code 0 only if every check holds; otherwise STOP and report.
 *
 * How it works: it reads the migration files, reads the hosted history, and requires the history to be exactly the first
 * N files in order. Everything after that is "pending"; the checks below are derived from the pending files (and the
 * per-migration preconditions in supabase/preflight.json), so a new migration needs no change to this script.
 *
 *   P1  hosted history = the first N repository files, same names, same order; pending files identified
 *   P2  destructive statements in pending files have declared preconditions (supabase/preflight.json) and they hold
 *   P3  nothing the pending files CREATE exists yet (tables, functions, policies); everything they REPLACE does exist
 *   P4  the Supabase CLI dry run lists exactly the pending files, in order
 *   P5  the working tree is clean and equals origin/main
 *   P6  every pending file exists on origin/main (what is applied is what CI tested)
 *   P7  no pending migration has a destructive statement without its approval comment
 *   P8  pending versions are contiguous after the applied ones and strictly increasing
 *   P9  baseline: every function a pending file REPLACES has, on hosted, exactly the source of its last applied
 *       definition (so the change starts from the reviewed state); every new table or policy name is free
 *
 * After applying: run the comparison with a local rebuild (npm run catalog:local, npm run catalog:compare; see
 * supabase/HOSTED_VERIFICATION.md section 0j).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  baselineBodies,
  createdPolicies,
  createdTables,
  definedFunctions,
  destructiveStatements,
  listMigrations,
  planPending,
} from "./lib/migrations.mjs";
import { connectHosted } from "./lib/hosted-cli.mjs";

const { redact, cli, query } = connectHosted();
const md5 = (s) =>
  createHash("md5").update(s.replace(/\r\n/g, "\n")).digest("hex");
const list = (xs) => [...xs].map((x) => `'${x}'`).join(",");

let failed = 0;
const check = (id, label, ok, detail = "") => {
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${id}  ${label}${detail ? "  [" + detail + "]" : ""}`,
  );
};

const MIGRATIONS = "supabase/migrations";
const manifest = existsSync("supabase/preflight.json")
  ? JSON.parse(readFileSync("supabase/preflight.json", "utf8"))
  : {};
const files = listMigrations(MIGRATIONS);
const wanted = (process.argv.find((a) => a.startsWith("--pending=")) ?? "")
  .slice("--pending=".length)
  .split(",")
  .filter(Boolean);

try {
  // ---- P1
  const hosted = query(
    "select version, name from supabase_migrations.schema_migrations order by version",
  );
  const plan = planPending(files, hosted);
  const pending = plan.pending;
  check(
    "P1",
    "hosted history is exactly the first files of the repository, in order; pending identified",
    plan.problems.length === 0,
    plan.problems.length
      ? plan.problems.join("; ")
      : `hosted ${hosted.length}, latest ${hosted.at(-1)?.version ?? "none"}; pending ${pending.length}: ${pending.map((p) => p.version.slice(-3)).join(", ") || "none"}`,
  );
  if (plan.problems.length) throw new Error("history mismatch");
  if (wanted.length)
    check(
      "P1b",
      "the pending list is the one you expected (--pending=...)",
      JSON.stringify(pending.map((p) => p.version)) === JSON.stringify(wanted),
      pending.map((p) => p.version).join(","),
    );
  if (pending.length === 0) {
    console.log(
      "\nNothing is pending: the hosted project is up to date with the repository.",
    );
    process.exit(failed === 0 ? 0 : 1);
  }

  // ---- P2 destructive preconditions, migration by migration
  const tableName = (t) => (t.includes(".") ? t : `public.${t}`);
  for (const mig of pending) {
    const destructive = destructiveStatements(mig.sql);
    const entry = manifest[mig.version];
    const id = `P2 ${mig.version.slice(-3)}`;
    if (destructive.length && !entry) {
      check(
        id,
        `${mig.file} is destructive (${destructive.length} statement(s)) and has NO declared preconditions in supabase/preflight.json`,
        false,
        destructive.map((d) => d.text).join(" | "),
      );
      continue;
    }
    if (!entry) {
      check(
        id,
        `${mig.file}: no destructive statement, no precondition needed`,
        true,
      );
      continue;
    }
    const problems = [];
    if (entry.emptyTables?.length) {
      const sql =
        "select " +
        entry.emptyTables
          .map((t, i) => `(select count(*) from ${tableName(t)})::int c${i}`)
          .join(", ");
      const row = query(sql)[0];
      entry.emptyTables.forEach((t, i) => {
        if (row[`c${i}`] !== 0)
          problems.push(`${t} holds ${row[`c${i}`]} row(s)`);
      });
    }
    const must = entry.mustExist ?? {};
    for (const ty of must.types ?? []) {
      const n = query(
        `select count(*)::int n from pg_type where typname = '${ty}' and typnamespace = 'public'::regnamespace`,
      )[0].n;
      if (n !== 1) problems.push(`type ${ty} is missing`);
    }
    for (const c of must.columns ?? []) {
      const [t, col] = c.split(".");
      const n = query(
        `select count(*)::int n from information_schema.columns where table_schema = 'public' and table_name = '${t}' and column_name = '${col}'`,
      )[0].n;
      if (n !== 1) problems.push(`column ${c} is missing`);
    }
    for (const c of must.constraints ?? []) {
      const n = query(
        `select count(*)::int n from pg_constraint where conname = '${c}' and connamespace = 'public'::regnamespace`,
      )[0].n;
      if (n !== 1) problems.push(`constraint ${c} is missing`);
    }
    if (entry.onlyDependants) {
      const types = entry.onlyDependants.types;
      const row = query(`select
        coalesce((select string_agg(p.proname, ',' order by p.proname) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
          and (${types.map((t) => `p.prosrc ~ '${t}' or pg_get_function_arguments(p.oid) ~ '${t}' or pg_get_function_result(p.oid) ~ '${t}'`).join(" or ")})), '') fns,
        (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v' and (${types.map((t) => `pg_get_viewdef(c.oid) ~ '${t}'`).join(" or ")}))::int views_,
        (select count(*) from pg_policies where ${types.map((t) => `qual ~ '${t}' or with_check ~ '${t}'`).join(" or ")})::int policies_`)[0];
      const got = row.fns ? row.fns.split(",") : [];
      const extra = got.filter(
        (f) => !entry.onlyDependants.functions.includes(f),
      );
      if (extra.length)
        problems.push(`unexpected dependent functions: ${extra.join(", ")}`);
      if (row.views_ !== 0)
        problems.push(`${row.views_} view(s) depend on the types`);
      if (row.policies_ !== 0)
        problems.push(`${row.policies_} policy(ies) depend on the types`);
    }
    for (const nc of entry.noConflict ?? []) {
      const n = query(
        `select count(*)::int n from ${tableName(nc.table)} where ${nc.column} in (${list(nc.values)})`,
      )[0].n;
      if (n !== 0)
        problems.push(
          `${n} row(s) in ${nc.table} already use ${nc.values.join("/")}`,
        );
    }
    check(
      id,
      `${mig.file}: declared preconditions hold (${entry.why ?? "see supabase/preflight.json"})`,
      problems.length === 0,
      problems.join("; "),
    );
  }

  // ---- P3 new objects absent, replaced functions present
  const created = new Set();
  const replaced = new Set();
  const newTables = new Set();
  const newPolicies = [];
  for (const mig of pending) {
    for (const f of definedFunctions(mig.sql))
      (f.replace ? replaced : created).add(f.name);
    for (const t of createdTables(mig.sql)) newTables.add(t);
    newPolicies.push(...createdPolicies(mig.sql));
  }
  // a function both created and replaced inside the pending set counts as created
  for (const n of created) replaced.delete(n);
  const k = query(`select
    (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (${list(created.size ? created : ["-"])}))::int new_fns_present,
    (select count(*) from (select distinct p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (${list(replaced.size ? replaced : ["-"])})) x)::int replaced_present,
    (select count(*) from pg_tables where schemaname = 'public' and tablename in (${list(newTables.size ? newTables : ["-"])}))::int new_tables_present`)[0];
  check(
    "P3",
    `none of the ${created.size} new function(s) and ${newTables.size} new table(s) exists; all ${replaced.size} replaced function(s) do`,
    k.new_fns_present === 0 &&
      k.new_tables_present === 0 &&
      k.replaced_present === replaced.size,
    `new functions present ${k.new_fns_present}, new tables present ${k.new_tables_present}, replaced present ${k.replaced_present}/${replaced.size}`,
  );

  // ---- P4 dry run
  const dry = cli(["db", "push", "--dry-run", "--skip-vault"]);
  const listed = [...dry.out.matchAll(/•\s*(\S+\.sql)/g)].map((m) => m[1]);
  check(
    "P4",
    "the Supabase CLI dry run lists exactly the pending files, in order",
    dry.status === 0 &&
      JSON.stringify(listed) === JSON.stringify(pending.map((p) => p.file)),
    `${listed.length} listed, ${pending.length} pending`,
  );

  // ---- P5 / P6 git
  const git = (args) => spawnSync("git", args, { encoding: "utf8" });
  git(["fetch", "origin"]);
  const clean = git(["status", "--short"]).stdout.trim() === "";
  const same =
    git(["rev-parse", "HEAD"]).stdout.trim() ===
    git(["rev-parse", "origin/main"]).stdout.trim();
  check(
    "P5",
    "working tree is clean and equals GitHub main (what is applied = what CI tested)",
    clean && same,
    `${clean ? "clean" : "UNCOMMITTED CHANGES"}, ${same ? "equals origin/main" : "differs from origin/main"}`,
  );
  const missing = pending.filter((p) => {
    const r = git(["show", `origin/main:${MIGRATIONS}/${p.file}`]);
    return r.status !== 0 || r.stdout.replace(/\r\n/g, "\n") !== p.sql;
  });
  check(
    "P6",
    "every pending migration file exists on origin/main, identical to the working copy",
    missing.length === 0,
    missing.length
      ? `not on origin/main or different: ${missing.map((m) => m.file).join(", ")}`
      : `${pending.length} file(s)`,
  );

  // ---- P7 unapproved destructive statements
  const unapproved = pending.flatMap((p) =>
    destructiveStatements(p.sql)
      .filter((d) => !d.approved)
      .map((d) => `${p.file}: ${d.text}`),
  );
  check(
    "P7",
    "no pending migration has a destructive statement without its approval comment",
    unapproved.length === 0,
    unapproved.join(" | "),
  );

  // ---- P8 numbering
  const versions = pending.map((p) => p.version);
  const increasing = versions.every((v, i) => i === 0 || v > versions[i - 1]);
  const latestApplied = hosted.at(-1)?.version ?? "";
  check(
    "P8",
    "pending versions come after the latest applied one and are strictly increasing",
    increasing && versions.every((v) => v > latestApplied),
    `${versions.join(", ")}`,
  );

  // ---- P9 baseline: replaced functions equal their last applied definition; new policies free
  const names = [...replaced];
  const base = baselineBodies(plan.applied, names);
  const missingBase = names.filter((n) => !(n in base));
  const rows = names.length
    ? query(
        `select p.proname n, md5(replace(p.prosrc, E'\\r\\n', E'\\n')) h from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (${list(names)})`,
      )
    : [];
  const differs = names.filter(
    (n) => n in base && !rows.some((r) => r.n === n && r.h === md5(base[n])),
  );
  const policyRows = newPolicies.length
    ? query(
        `select policyname, tablename from pg_policies where policyname in (${list(newPolicies.map((p) => p.name))})`,
      )
    : [];
  check(
    "P9",
    `the ${names.length} function(s) to be replaced have, on hosted, exactly the source of their last applied definition; ${newPolicies.length} new policy name(s) are free`,
    missingBase.length === 0 && differs.length === 0 && policyRows.length === 0,
    [
      missingBase.length
        ? `no applied definition found for: ${missingBase.join(", ")}`
        : "",
      differs.length ? `hosted source differs for: ${differs.join(", ")}` : "",
      policyRows.length
        ? `policy name(s) already used: ${policyRows.map((r) => r.policyname).join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("; ") || `${names.length} function(s) identical`,
  );
} catch (e) {
  console.error(redact(e.message));
  failed++;
}

console.log(
  failed === 0
    ? "\nPREFLIGHT PASSED (read-only; nothing was changed)"
    : `\nPREFLIGHT FAILED: ${failed} check(s). STOP; do not apply.`,
);
process.exit(failed === 0 ? 0 : 1);
