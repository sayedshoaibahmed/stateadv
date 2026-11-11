/**
 * The preflight's baseline check (P9 in scripts/hosted-preflight.mjs) compares a function's source on the hosted project
 * with its last applied definition in the repository. That only works if the text read from the migration files is
 * exactly what PostgreSQL stores (pg_proc.prosrc). This proves it on a database built from every migration. (PRE-DB)
 */
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  baselineBodies,
  definedFunctions,
  listMigrations,
} from "../../scripts/lib/migrations.mjs";
import { createDb, type TestDb } from "./harness";

let db: TestDb;
beforeAll(async () => {
  db = await createDb();
}, 120_000);

const md5 = (s: string) =>
  createHash("md5").update(s.replace(/\r\n/g, "\n")).digest("hex");

describe("migration text equals the stored function source (PRE-DB)", () => {
  it("PRE-DB-1: for every function a migration defines, the LAST definition's text is exactly pg_proc.prosrc", async () => {
    const all = listMigrations("supabase/migrations");
    const names = [
      ...new Set(
        all.flatMap((m) => definedFunctions(m.sql).map((f) => f.name)),
      ),
    ];
    expect(names.length).toBeGreaterThan(80);
    const base = baselineBodies(all, names);
    const stored = await db.q<{ n: string; h: string }>(
      `select p.proname n, md5(p.prosrc) h from pg_proc p where p.pronamespace = 'public'::regnamespace`,
    );
    const byName = new Map<string, Set<string>>();
    for (const r of stored)
      (byName.get(r.n) ?? byName.set(r.n, new Set()).get(r.n)!).add(r.h);
    const wrong: string[] = [];
    for (const n of names) {
      const hashes = byName.get(n);
      if (!hashes) {
        wrong.push(`${n}: not in the database`);
        continue;
      }
      if (!hashes.has(md5((base as Record<string, string>)[n])))
        wrong.push(`${n}: source differs`);
    }
    expect(wrong).toEqual([]);
  });
});
