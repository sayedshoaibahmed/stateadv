/**
 * The generated TypeScript types (src/lib/supabase/database.types.ts) must describe the database that the migrations
 * build. If someone adds a migration and forgets to regenerate the types (or edits the file by hand), this fails.
 *
 * Regenerate: build a throw-away database from the migrations and run
 *   supabase gen types typescript --schema public --remote=<throw-away database URL>
 * (see README, "Regenerating the database types").
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type TestDb } from "./harness";

let db: TestDb;
const file = readFileSync("src/lib/supabase/database.types.ts", "utf8").replace(
  /\r/g,
  "",
);
const lines = file.split("\n");

beforeAll(async () => {
  db = await createDb();
}, 120_000);

/** The names listed directly under `public: { <section>: { ... } }` in the generated file. */
function names(section: "Tables" | "Views" | "Functions" | "Enums"): string[] {
  const start = lines.findIndex((l) => l === `    ${section}: {`);
  if (start < 0) throw new Error(`${section} not found in the generated types`);
  const out: string[] = [];
  for (
    let i = start + 1;
    i < lines.length && lines[i] !== "    };" && lines[i] !== "    }";
    i++
  ) {
    const m = /^      ([a-z_0-9]+)[:?]/.exec(lines[i]);
    if (m) out.push(m[1]);
  }
  return out;
}

describe("TYP: generated database types match the migrations", () => {
  it("TYP-01: the same tables", async () => {
    const actual = (
      await db.q<{ n: string }>(
        `select tablename n from pg_tables where schemaname = 'public' order by 1`,
      )
    ).map((r) => r.n);
    expect(names("Tables").sort()).toEqual(actual);
  });
  it("TYP-02: the same views", async () => {
    const actual = (
      await db.q<{ n: string }>(
        `select viewname n from pg_views where schemaname = 'public' order by 1`,
      )
    ).map((r) => r.n);
    expect(names("Views").sort()).toEqual(actual);
  });
  it("TYP-03: the same enum types", async () => {
    const actual = (
      await db.q<{ n: string }>(
        `select t.typname n from pg_type t join pg_namespace s on s.oid = t.typnamespace where s.nspname = 'public' and t.typtype = 'e' order by 1`,
      )
    ).map((r) => r.n);
    expect(names("Enums").sort()).toEqual(actual);
  });
  it("TYP-04: every function the app may call (and every other public function) is typed", async () => {
    const actual = (
      await db.q<{ n: string }>(
        `select distinct p.proname n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
          where s.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype order by 1`,
      )
    ).map((r) => r.n);
    expect(names("Functions").sort()).toEqual(actual);
  });
  it("TYP-05: every column of every table is in the types (spot check on the tables the app reads most)", async () => {
    const cols = await db.q<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public' and table_name in ('bookings', 'co_categories', 'co_entries', 'resorts', 'stay_types', 'payments', 'refunds', 'user_profiles')`,
    );
    for (const c of cols)
      expect(file, `${c.table_name}.${c.column_name}`).toMatch(
        new RegExp(`\\b${c.column_name}\\??:`),
      );
    expect(file).toContain("co_category_name");
    expect(file).not.toContain("agent_partner_id");
    expect(file).not.toContain("partner_type");
  });
});
