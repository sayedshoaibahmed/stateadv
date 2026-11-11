import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  baselineBodies,
  createdPolicies,
  createdTables,
  definedFunctions,
  destructiveStatements,
  listMigrations,
  planPending,
} from "../../scripts/lib/migrations.mjs";

const f = (version: string, name: string, sql = "select 1;") => ({
  version,
  name,
  file: `${version}_${name}.sql`,
  sql,
});
const files = [f("01", "a"), f("02", "b"), f("03", "c"), f("04", "d")];

describe("hosted history versus the repository (PRE-U1..U3)", () => {
  it("PRE-U1: the pending migrations are whatever follows the hosted history, with no hard-coded range", () => {
    expect(
      planPending(files, []).pending.map(
        (x: { version: string; name: string }) => x.version,
      ),
    ).toEqual(["01", "02", "03", "04"]);
    const two = planPending(files, [
      { version: "01", name: "a" },
      { version: "02", name: "b" },
    ]);
    expect(two.problems).toEqual([]);
    expect(
      two.applied.map((x: { version: string; name: string }) => x.version),
    ).toEqual(["01", "02"]);
    expect(
      two.pending.map((x: { version: string; name: string }) => x.version),
    ).toEqual(["03", "04"]);
    expect(
      planPending(
        files,
        files.map((x: { version: string; name: string }) => ({
          version: x.version,
          name: x.name,
        })),
      ).pending,
    ).toEqual([]);
    // a future migration is simply "the next pending one"
    const more = [...files, f("05", "e")];
    expect(
      planPending(
        more,
        files.map((x: { version: string; name: string }) => ({
          version: x.version,
          name: x.name,
        })),
      ).pending.map((x: { version: string; name: string }) => x.version),
    ).toEqual(["05"]);
  });

  it("PRE-U2: a hosted history that differs from the repository is reported, and nothing is called pending", () => {
    const renamed = planPending(files, [
      { version: "01", name: "a" },
      { version: "02", name: "other" },
    ]);
    expect(renamed.problems[0]).toContain("position 2");
    expect(renamed.pending).toEqual([]);
    const gap = planPending(files, [
      { version: "01", name: "a" },
      { version: "03", name: "c" },
    ]);
    expect(gap.problems.length).toBeGreaterThan(0);
    const extra = planPending(files, [
      ...files.map((x: { version: string; name: string }) => ({
        version: x.version,
        name: x.name,
      })),
      { version: "09", name: "unknown" },
    ]);
    expect(extra.problems[0]).toContain("only");
    expect(extra.pending).toEqual([]);
  });

  it("PRE-U3: the real migration files are read in order with their versions and names", () => {
    const real = listMigrations("supabase/migrations");
    expect(real.length).toBeGreaterThanOrEqual(19);
    expect(real.map((m) => m.version)).toEqual(
      [...real.map((m) => m.version)].sort(),
    );
    expect(real[0].version).toBe("20261111000001");
    expect(real.find((m) => m.version === "20261111000019")?.name).toBe(
      "reauth_grants",
    );
  });
});

describe("what a migration does (PRE-U4..U7)", () => {
  it("PRE-U4: destructive statements are found, with or without their approval comment; additive ones are not", () => {
    expect(
      destructiveStatements(
        "create table t (id int);\ncreate index i on t(id);\n",
      ),
    ).toEqual([]);
    const d = destructiveStatements(
      "-- DESTRUCTIVE-APPROVED: reviewed\nalter table t drop column x;\ndrop type y;\ndelete from z;\n",
    );
    expect(d).toHaveLength(3);
    expect(d[0].approved).toBe(true);
    expect(d[1].approved).toBe(false);
    // the word "truncate" in a trigger definition is not a TRUNCATE statement
    expect(
      destructiveStatements(
        "create trigger a before truncate on t for each statement execute function f();\n",
      ),
    ).toEqual([]);
  });

  it("PRE-U5: every migration with a destructive statement has declared preconditions in supabase/preflight.json", () => {
    const manifest = JSON.parse(
      readFileSync("supabase/preflight.json", "utf8"),
    );
    for (const m of listMigrations("supabase/migrations")) {
      if (destructiveStatements(m.sql).length > 0)
        expect(manifest[m.version], `${m.file} needs an entry`).toBeDefined();
    }
    // the entries describe real, listed migrations
    const versions = listMigrations("supabase/migrations").map(
      (m) => m.version,
    );
    for (const v of Object.keys(manifest).filter((k) => !k.startsWith("_")))
      expect(versions).toContain(v);
  });

  it("PRE-U6: functions, tables and policies defined by a migration are read from its text", () => {
    const sql = `create table public.t1 (id int);
create function public.alpha(a int) returns int language sql as $$ select a + 1 $$;
create or replace function public.beta(x text)
returns void language plpgsql as $fn$
begin -- a comment inside
  null;
end
$fn$;
create policy "only owners" on public.audit_logs as restrictive for select using (true);
-- create function public.not_real() returns int as $$ select 1 $$;
`;
    expect(createdTables(sql)).toEqual(["t1"]);
    expect(createdPolicies(sql)).toEqual([
      { name: "only owners", table: "audit_logs" },
    ]);
    const fns = definedFunctions(sql);
    expect(fns.map((x) => [x.name, x.replace])).toEqual([
      ["alpha", false],
      ["beta", true],
    ]);
    expect(fns[0].body).toBe(" select a + 1 ");
    expect(fns[1].body).toContain("-- a comment inside"); // bodies are kept exactly, comments included
  });

  it("PRE-U7: the baseline of a function is its LAST applied definition", () => {
    const applied = [
      f(
        "01",
        "a",
        "create function public.g() returns int language sql as $$ select 1 $$;",
      ),
      f(
        "02",
        "b",
        "create or replace function public.g() returns int language sql as $$ select 2 $$;",
      ),
      f(
        "03",
        "c",
        "create function public.h() returns int language sql as $$ select 9 $$;",
      ),
    ];
    expect(baselineBodies(applied, ["g", "missing"])).toEqual({
      g: " select 2 ",
    });
  });

  it("PRE-U8: migration 19 replaces exactly the five protected account functions and creates the four grant functions and one table", () => {
    const m = listMigrations("supabase/migrations").find(
      (x) => x.version === "20261111000019",
    )!;
    const fns = definedFunctions(m.sql);
    expect(
      fns
        .filter((x) => x.replace)
        .map((x) => x.name)
        .sort(),
    ).toEqual([
      "profile_change_email",
      "profile_create",
      "profile_reset_password",
      "profile_set_active",
      "profile_update",
    ]);
    expect(
      fns
        .filter((x) => !x.replace)
        .map((x) => x.name)
        .sort(),
    ).toEqual([
      "consume_reauth",
      "issue_reauth",
      "reauth_begin",
      "record_reauth_failure",
    ]);
    expect(createdTables(m.sql)).toEqual(["reauth_grants"]);
    expect(destructiveStatements(m.sql)).toEqual([]);
  });
});
