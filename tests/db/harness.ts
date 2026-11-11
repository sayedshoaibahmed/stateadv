/**
 * Database test harness.
 *
 * Runs the REAL migration files against PGlite (PostgreSQL compiled to
 * WebAssembly) in memory. It never connects to Supabase.
 *
 * Because there is no Supabase here, the parts Supabase provides are stood in
 * for - exactly as Supabase defines them:
 *   - roles anon / authenticated / service_role (+ Supabase's broad DEFAULT
 *     privileges, so our "take it all away first" migration is really tested)
 *   - auth.users table and auth.uid() (reads the JWT claim setting)
 *   - storage.buckets / storage.objects with RLS enabled
 *
 * Limits (stated honestly): PGlite is a single connection, so true
 * multi-connection concurrency tests (parallel bookings, two Owners disabling
 * each other at once) run later in CI against a real Postgres.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

// (the override exists only so the mutation check below can point the tests at a deliberately broken copy)
export const MIGRATIONS_DIR =
  process.env.STATEADV_MIGRATIONS_DIR ??
  join(process.cwd(), "supabase", "migrations");

const SUPABASE_STANDIN = `
  create role anon          nologin;
  create role authenticated nologin;
  create role service_role  nologin bypassrls;

  create schema if not exists extensions;
  create schema auth;
  create schema storage;
  grant usage on schema public, extensions, auth, storage to anon, authenticated, service_role;

  create table auth.users (id uuid primary key, email text);

  -- Same behaviour as Supabase's auth.uid(): the user id inside the verified JWT.
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $$;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  create table storage.buckets (
    id text primary key, name text not null, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id),
    name text, owner uuid, metadata jsonb, created_at timestamptz default now()
  );
  alter table storage.objects enable row level security;
  grant select, insert, update, delete on storage.objects to anon, authenticated, service_role;
  grant select on storage.buckets to anon, authenticated, service_role;

  -- Supabase hands anon/authenticated/service_role broad rights on every new object
  -- in schema public. Reproduce that, so we prove our migration removes it.
  alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

export interface TestDb {
  pg: PGlite;
  /** Run SQL, return rows. Runs as the CURRENT session (see `as`). */
  q<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  /** Run `fn` as a database role + logged-in user, then restore. */
  as<T>(who: Who, fn: () => Promise<T>): Promise<T>;
  /** BEGIN ... COMMIT (deferred checks run at COMMIT). Rolls back on error. */
  tx<T>(who: Who, fn: () => Promise<T>): Promise<T>;
}

export type Who =
  | { role: "postgres"; uid?: string | null } // superuser (migrations / maintenance), optional simulated user
  | { role: "authenticated"; uid: string | null }
  | { role: "anon" }
  | { role: "service_role" };

function applySession(who: Who): string {
  const uid = "uid" in who && who.uid ? who.uid : "";
  const role = who.role === "postgres" ? "none" : who.role; // "none" => session user (superuser)
  return `select set_config('request.jwt.claim.sub', '${uid}', false); ${
    role === "none" ? "reset role" : `set role ${role}`
  };`;
}

export function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

export async function createDb(): Promise<TestDb> {
  const pg = new PGlite({ extensions: { pg_trgm } });
  await pg.exec(SUPABASE_STANDIN);
  for (const file of listMigrationFiles()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    try {
      await pg.exec(sql);
    } catch (e) {
      throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
    }
  }

  const db: TestDb = {
    pg,
    async q(sql, params) {
      const r = await pg.query(sql, params as unknown[]);
      return r.rows as never;
    },
    async exec(sql) {
      await pg.exec(sql);
    },
    async as(who, fn) {
      await pg.exec(applySession(who));
      try {
        return await fn();
      } finally {
        await pg.exec(applySession({ role: "postgres" }));
      }
    },
    async tx(who, fn) {
      await pg.exec(applySession(who));
      await pg.exec("begin");
      try {
        const result = await fn();
        await pg.exec("commit"); // deferred constraint triggers fire here
        return result;
      } catch (e) {
        await pg.exec("rollback").catch(() => undefined);
        throw e;
      } finally {
        await pg.exec(applySession({ role: "postgres" }));
      }
    },
  };
  return db;
}

/** Assert that `promise` fails with a database error whose message contains `code`. */
export async function expectDbError(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await promise;
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    if (!msg.includes(code)) {
      throw new Error(`Expected database error "${code}" but got: ${msg}`);
    }
    return;
  }
  throw new Error(
    `Expected database error "${code}" but the statement succeeded`,
  );
}
