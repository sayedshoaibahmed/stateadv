import { describe, expect, it } from "vitest";
import { findViolations } from "../../scripts/check-migrations.mjs";

describe("migration safety check (TEST_PLAN BKP-03)", () => {
  it("allows additive migrations", () => {
    const sql = `create table resorts (id uuid primary key);\nalter table resorts add column name text;\ncreate index on resorts(name);\n`;
    expect(findViolations("001.sql", sql)).toEqual([]);
  });

  it.each([
    "drop table bookings;",
    "DROP COLUMN x;",
    "alter table bookings drop column remarks;",
    "truncate payments;",
    "delete from payments where true;",
    "alter table bookings alter column pax type bigint;",
  ])("blocks %j without approval", (sql) => {
    expect(findViolations("002.sql", sql + "\n")).toHaveLength(1);
  });

  it("allows a destructive statement with an approval comment", () => {
    const sql = `-- DESTRUCTIVE-APPROVED: remove unused temp table (owner approved 2026-12-01)\ndrop table tmp_import;\n`;
    expect(findViolations("003.sql", sql)).toEqual([]);
  });

  it("ignores destructive words inside comments", () => {
    const sql = `-- we never drop table bookings\ncreate table x (id int);\n`;
    expect(findViolations("004.sql", sql)).toEqual([]);
  });

  it("does not treat 'revoke delete' grants as data deletion", () => {
    const sql = `revoke delete on all tables in schema public from authenticated;\n`;
    expect(findViolations("005.sql", sql)).toEqual([]);
  });
});
