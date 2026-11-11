/**
 * The planning document DATABASE_SCHEMA.md must agree with the real migrations.
 * If someone changes one without the other, this fails.
 *
 * Checked: the list of tables, the enum types and their values, and that every column
 * named in a table description really exists.
 * (Statements about planned work, such as the functions still to be written, are not checked.)
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type TestDb } from "./harness";

let db: TestDb;
const doc = readFileSync("DATABASE_SCHEMA.md", "utf8").replace(/\r/g, "");

beforeAll(async () => {
  db = await createDb();
}, 120_000);

/** The part of the document that starts at a heading and runs to the next "###" / "##" heading. */
function sections(): Array<{ table: string; body: string }> {
  const out: Array<{ table: string; body: string }> = [];
  const re = /^### 2\.\d+[a-z]? `([a-z_]+)`[^\n]*\n([\s\S]*?)(?=^### |^## )/gm;
  for (const m of doc.matchAll(re)) out.push({ table: m[1], body: m[2] });
  return out;
}

describe("DATABASE_SCHEMA.md matches the database", () => {
  it("describes exactly the tables that exist", async () => {
    const actual = (
      await db.q<{ tablename: string }>(
        `select tablename from pg_tables where schemaname = 'public' order by 1`,
      )
    ).map((r) => r.tablename);
    const documented = sections()
      .map((s) => s.table)
      .sort();
    expect(documented).toEqual(actual);
  });

  it("lists exactly the enum types, with exactly their values and order", async () => {
    const block =
      doc.match(/^## 1\. Enum types\n```sql\n([\s\S]*?)```/m)?.[1] ?? "";
    const documented: Record<string, string[]> = {};
    for (const m of block.matchAll(
      /create type (\w+)\s+as enum \(([^)]*)\)/g,
    )) {
      documented[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    }
    const rows = await db.q<{ typname: string; enumlabel: string }>(
      `select t.typname, e.enumlabel from pg_type t
         join pg_enum e on e.enumtypid = t.oid
         join pg_namespace n on n.oid = t.typnamespace and n.nspname = 'public'
        order by t.typname, e.enumsortorder`,
    );
    const actual: Record<string, string[]> = {};
    for (const r of rows) (actual[r.typname] ??= []).push(r.enumlabel);
    expect(documented).toEqual(actual);
  });

  it("every column named in a table description exists in that table", async () => {
    const cols = await db.q<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns where table_schema = 'public'`,
    );
    const have = new Map<string, Set<string>>();
    for (const c of cols)
      (
        have.get(c.table_name) ??
        have.set(c.table_name, new Set()).get(c.table_name)!
      ).add(c.column_name);

    const missing: string[] = [];
    let checked = 0;
    for (const { table, body } of sections()) {
      for (const line of body.split("\n")) {
        if (
          !line.startsWith("| ") ||
          /^\|\s*-/.test(line) ||
          /^\|\s*Column\s*\|/.test(line)
        )
          continue;
        const firstCell = line.split("|")[1] ?? "";
        // names are separated by "/" or ","; ignore wildcards (recorded_*), prose and "audit columns"
        for (const raw of firstCell.split(/[\/,]/)) {
          if (raw.includes("*")) continue; // wildcard shorthand such as recorded_*
          const name = raw.replace(/`/g, "").trim();
          if (!/^[a-z][a-z0-9_]*$/.test(name) || name === "audit") continue;
          checked++;
          if (!have.get(table)?.has(name)) missing.push(`${table}.${name}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(150); // the check really looked at the document
    expect(missing).toEqual([]);
  });
});
