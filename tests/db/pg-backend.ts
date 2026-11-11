/**
 * Real PostgreSQL backend for the database tests.
 *
 * Used when STATEADV_PG_URL is set (for example a PostgreSQL 17 service container in GitHub Actions, or a
 * throw-away local server). The URL must point at a DISPOSABLE server whose user may create databases and roles.
 * NEVER the Supabase project: every test file creates its own scratch database, and the harness refuses
 * any URL that points at a *.supabase.co / *.supabase.com host.
 *
 * Same stand-in for the parts Supabase provides (roles, auth.uid(), auth.users, storage) as the PGlite
 * backend, so the same tests run on both.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import type { TestDb } from "./harness";

// PGlite hands back bigint/numeric as JS numbers. Match it so one set of tests serves both engines.
// (All money values in the tests are far below 2^53.)
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

function assertDisposable(url: string): URL {
  const u = new URL(url);
  if (
    /supabase\.(co|com)$/i.test(u.hostname) ||
    /pooler\.supabase/i.test(u.hostname)
  ) {
    throw new Error(
      "STATEADV_PG_URL points at Supabase. The tests only run against a disposable local/CI database.",
    );
  }
  return u;
}

export async function createPgDb(
  standin: string,
  migrationsDir: string,
  files: string[],
  applySession: (who: never) => string,
): Promise<TestDb> {
  const base = assertDisposable(process.env.STATEADV_PG_URL as string);
  const name = `t_${randomUUID().replace(/-/g, "")}`;

  // Roles are cluster-wide: create them once, safely, even when test files start at the same moment.
  const admin = new pg.Client({ connectionString: base.toString() });
  await admin.connect();
  try {
    await admin.query("select pg_advisory_lock(7770001)");
    await admin.query(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon          nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role  nologin bypassrls; end if;
      end $$;`);
    await admin.query("select pg_advisory_unlock(7770001)");
    await admin.query(`create database ${name}`);
  } finally {
    await admin.end();
  }

  const url = new URL(base.toString());
  url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();

  await client.query(standin.replace(/create role [^;]+;/g, ""));
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    try {
      await client.query(sql);
    } catch (e) {
      throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
    }
  }

  const db: TestDb = {
    pg: client,
    url: url.toString(),
    async q(sql, params) {
      const r = await client.query(sql, params as unknown[]);
      return r.rows as never;
    },
    async exec(sql) {
      await client.query(sql);
    },
    async as(who, fn) {
      await client.query(applySession(who as never));
      try {
        return await fn();
      } finally {
        await client.query(applySession({ role: "postgres" } as never));
      }
    },
    async tx(who, fn) {
      await client.query(applySession(who as never));
      await client.query("begin");
      try {
        const result = await fn();
        await client.query("commit");
        return result;
      } catch (e) {
        await client.query("rollback").catch(() => undefined);
        throw e;
      } finally {
        await client.query(applySession({ role: "postgres" } as never));
      }
    },
  };
  return db;
}
