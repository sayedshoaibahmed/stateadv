/**
 * Builds a throw-away LOCAL PostgreSQL from the migration files up to a version and writes a catalog fingerprint
 * (every function, constraint, index, trigger, policy, column, grant, ...) to a JSON file. Part of the post-apply
 * comparison (supabase/HOSTED_VERIFICATION.md section 0j):
 *
 *   STATEADV_PG_URL=postgres://...local throw-away server...  npm run catalog:local -- --out=catalog-19.json [--upto=20261111000019]
 *   npm run catalog:compare -- catalog-19.json
 *
 * It never touches Supabase: the test harness refuses any Supabase address. `--upto` defaults to the latest migration.
 */
import { mkdtempSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listMigrations } from "./lib/migrations.mjs";
import { CATALOG_QUERIES, ROW_COUNT_QUERY } from "./lib/catalog-queries.mjs";

const arg = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const out = arg("out");
if (!out) {
  console.error(
    "Usage: npm run catalog:local -- --out=<file.json> [--upto=<version>]",
  );
  process.exit(2);
}
if (!process.env.STATEADV_PG_URL) {
  console.error(
    "Set STATEADV_PG_URL to a throw-away local PostgreSQL (never a Supabase address). See README.",
  );
  process.exit(2);
}

const all = listMigrations("supabase/migrations");
const upto = arg("upto") ?? all.at(-1)!.version;
const used = all.filter((m) => m.version <= upto);
if (used.length === 0 || used.at(-1)!.version !== upto) {
  console.error(
    `--upto=${upto} is not a migration version in supabase/migrations.`,
  );
  process.exit(2);
}
const dir = mkdtempSync(join(tmpdir(), "stateadv-catalog-"));
for (const m of used)
  copyFileSync(join("supabase/migrations", m.file), join(dir, m.file));
process.env.STATEADV_MIGRATIONS_DIR = dir;

const { createDb } = await import("../tests/db/harness");
try {
  const db = await createDb();
  const catalog: Record<string, unknown> = {
    meta: { upto, migrations: used.map((m) => `${m.version}_${m.name}`) },
  };
  for (const [k, sql] of Object.entries(CATALOG_QUERIES))
    catalog[k] = (await db.q<{ h: string }>(sql)).map((r) => r.h).sort();
  catalog.rows = (await db.q(ROW_COUNT_QUERY))[0];
  writeFileSync(out, JSON.stringify(catalog, null, 1));
  console.log(
    `catalog written to ${out}: migrations 1..${used.length} (up to ${upto}); ` +
      Object.entries(catalog)
        .filter(([, v]) => Array.isArray(v))
        .map(([k, v]) => `${k}=${(v as unknown[]).length}`)
        .join(" "),
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exit(0);
