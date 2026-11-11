#!/usr/bin/env node
/**
 * READ-ONLY comparison of the hosted project with a local rebuild of the migrations (npm run catalog:local).
 *
 *   npm run catalog:compare -- catalog-19.json
 *
 * It checks that the hosted migration history is exactly the migrations the file was built from (same versions, same
 * names, same order) and that every catalog category (functions with their definitions, security-definer flags and
 * privileges, constraints, indexes, triggers, policies, columns, grants, RLS, enums, views) is IDENTICAL on both sides.
 * Row counts are printed for information only (data legitimately changes after an apply). Only SELECTs run; every part
 * of the connection string is redacted from the output. Exit code 0 only if everything matches.
 */
import { readFileSync } from "node:fs";
import { connectHosted } from "./lib/hosted-cli.mjs";
import { CATALOG_QUERIES, ROW_COUNT_QUERY } from "./lib/catalog-queries.mjs";

const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
if (!file) {
  console.error(
    "Usage: npm run catalog:compare -- <catalog.json made by npm run catalog:local>",
  );
  process.exit(2);
}
const expected = JSON.parse(readFileSync(file, "utf8"));
const { redact, query } = connectHosted();

let bad = 0;
const check = (name, ok, detail = "") => {
  if (!ok) bad++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  [" + detail + "]" : ""}`,
  );
};

try {
  const hist = query(
    "select version, name from supabase_migrations.schema_migrations order by version",
  ).map((r) => `${r.version}_${r.name}`);
  check(
    `migration history equals the ${expected.meta.migrations.length} migrations the local rebuild was made from`,
    JSON.stringify(hist) === JSON.stringify(expected.meta.migrations),
    `hosted ${hist.length}, expected ${expected.meta.migrations.length}, up to ${expected.meta.upto}`,
  );
  for (const [k, sql] of Object.entries(CATALOG_QUERIES)) {
    const hosted = query(sql)
      .map((r) => r.h)
      .sort();
    const exp = expected[k] ?? [];
    const hs = new Set(hosted);
    const es = new Set(exp);
    const onlyHosted = hosted.filter((x) => !es.has(x));
    const onlyExpected = exp.filter((x) => !hs.has(x));
    check(
      `${k}: hosted == local rebuild`,
      hosted.length === exp.length &&
        onlyHosted.length === 0 &&
        onlyExpected.length === 0,
      `${hosted.length} items`,
    );
    for (const x of onlyHosted.slice(0, 3))
      console.log("      only on hosted  :", redact(x).slice(0, 200));
    for (const x of onlyExpected.slice(0, 3))
      console.log("      only in rebuild :", redact(x).slice(0, 200));
  }
  console.log(
    "      row counts on hosted (information only):",
    JSON.stringify(query(ROW_COUNT_QUERY)[0]),
  );
  console.log(
    "      row counts in the rebuild              :",
    JSON.stringify(expected.rows),
  );
} catch (e) {
  console.error(redact(e.message));
  bad++;
}
console.log(
  bad === 0
    ? "\nHOSTED STATE EQUALS THE LOCAL REBUILD"
    : `\n${bad} DIFFERENCE(S): see FAIL lines`,
);
process.exit(bad === 0 ? 0 : 1);
