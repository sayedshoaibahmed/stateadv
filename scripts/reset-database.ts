/**
 * DEV-ONLY, ONE-TIME-USE script: wipes a Supabase project back to a pristine, freshly-migrated, empty state.
 *
 *   npx tsx scripts/reset-database.ts --dry-run     (checks everything, changes NOTHING)
 *   npx tsx scripts/reset-database.ts               (wipes schema+data, Auth users and Storage files, then
 *                                                      re-applies every migration from scratch)
 *
 * This is NOT an app feature and must never become one. The application itself can never hard-delete a
 * business or financial record (PRD section 18): every real table has a `prevent_delete` trigger that
 * refuses ordinary DELETE/TRUNCATE, on purpose. This script only works at all because it bypasses that at
 * the infrastructure level — DROP SCHEMA removes the tables (trigger included) instead of deleting rows from
 * them, and Auth/Storage are cleared through the admin APIs directly — never through the app's own code path.
 *
 * Use this ONLY on a development/test project that holds no real data. It cannot tell a real project from a
 * test one; that is entirely on you, which is why it makes you type the project's own hostname back before
 * doing anything.
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and SUPABASE_DB_URL from .env.local (never from the
 * command line, never printed anywhere). A real run also needs the Supabase CLI already linked to this
 * project (`supabase link --project-ref <ref>`), since migrations are re-applied with `supabase db push`.
 */
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { ask } from "./lib/prompt";
import {
  checkConfirmation,
  resetDatabase,
  type ResetDeps,
} from "./lib/reset-database";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* .env.local missing: the check below explains */
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
const dbUrl = process.env.SUPABASE_DB_URL;
const dryRun = process.argv.includes("--dry-run");

if (!url || !key || (!dryRun && !dbUrl)) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local" +
      (dryRun
        ? "."
        : ", and SUPABASE_DB_URL for a real run (direct Postgres access, used only to drop and rebuild the schema)."),
  );
  process.exit(1);
}

const host = new URL(url).hostname;
const BUCKETS = ["payment-proofs", "booking-pdfs", "resort-logos"];

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function listAllFiles(bucket: string, prefix: string): Promise<string[]> {
  const { data, error } = await admin.storage
    .from(bucket)
    .list(prefix, { limit: 1000 });
  if (error) throw new Error(`Could not list bucket ${bucket}: ${error.message}`);
  const files: string[] = [];
  for (const entry of data ?? []) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    // Supabase Storage represents a folder as an entry with no id; a real file always has one.
    if (entry.id === null) files.push(...(await listAllFiles(bucket, path)));
    else files.push(path);
  }
  return files;
}

const deps: ResetDeps = {
  async dropAndRecreateSchema() {
    const client = new pg.Client({ connectionString: dbUrl });
    await client.connect();
    try {
      // Also drop the Supabase CLI's own migration-history tracking table: it lives in a separate
      // "supabase_migrations" schema, so dropping only "public" leaves it believing every migration is
      // already applied, and `supabase db push` then reports "up to date" without rebuilding anything.
      // The CLI recreates this schema automatically on its next run.
      //
      // Re-grant what Supabase's own platform sets up ONCE when a project is first created (never part
      // of our migrations, since every migration assumes it's already there): schema USAGE for the
      // standard roles, and blanket table/function/sequence access for service_role (the secret key).
      // A fresh "create schema public" does not carry any of this over.
      await client.query(
        "drop schema public cascade; create schema public; " +
          "drop schema if exists supabase_migrations cascade; " +
          "grant usage on schema public to postgres, anon, authenticated, service_role; " +
          "alter default privileges in schema public grant all on tables to postgres, service_role; " +
          "alter default privileges in schema public grant all on functions to postgres, service_role; " +
          "alter default privileges in schema public grant all on sequences to postgres, service_role;",
      );
    } finally {
      await client.end();
    }
  },
  async pushMigrations() {
    // shell: true so Windows can resolve npx.cmd (execFileSync without it only finds real binaries,
    // not the .cmd wrapper npm installs on Windows).
    execFileSync("npx", ["supabase", "db", "push", "--remote", "--yes"], {
      stdio: "inherit",
      shell: true,
    });
  },
  async deleteAllAuthUsers() {
    let deleted = 0;
    for (let page = 1; page <= 50; page++) {
      const { data, error } = await admin.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (error) throw new Error("Could not list Auth users.");
      for (const u of data.users) {
        await admin.auth.admin.deleteUser(u.id);
        deleted++;
      }
      if (data.users.length < 200) break;
    }
    return deleted;
  },
  async emptyAllBuckets() {
    const results: { bucket: string; removed: number }[] = [];
    for (const bucket of BUCKETS) {
      const paths = await listAllFiles(bucket, "");
      if (paths.length > 0) {
        const { error } = await admin.storage.from(bucket).remove(paths);
        if (error)
          throw new Error(`Could not empty bucket ${bucket}: ${error.message}`);
      }
      results.push({ bucket, removed: paths.length });
    }
    return results;
  },
  log: (m) => console.log(m),
};

async function main() {
  console.log(
    `Project: ${host}${dryRun ? "   (DRY RUN: nothing will be changed)" : ""}`,
  );
  console.log(
    "This wipes the ENTIRE database (schema and data), every Auth user and every Storage file, then " +
      "re-applies every migration from scratch. Use only on a development/test project with no real data.",
  );
  if (dryRun) {
    await resetDatabase(deps, { dryRun: true });
    return;
  }
  const hostTyped = await ask(
    `Type the project host shown above (${host}) to confirm this is the RIGHT project: `,
  );
  const phraseTyped = await ask("Type RESET DATABASE to wipe everything above: ");
  const check = checkConfirmation(hostTyped, host, phraseTyped);
  if (!check.ok) {
    console.log(check.reason);
    return;
  }
  const result = await resetDatabase(deps, { dryRun: false });
  if (result.status === "done") {
    console.log(
      "\nDone. The project is now empty and freshly migrated. Create a new first Owner with " +
        "scripts/create-first-user.ts.",
    );
  }
}

main().catch((e) => {
  console.error(
    e instanceof Error
      ? e.message
      : "Something went wrong. The project may be left half-reset — check before trying again.",
  );
  process.exit(1);
});
