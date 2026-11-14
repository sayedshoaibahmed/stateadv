import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Rules about the M7 code (calendar, old records, activity) that are checked by reading the source, because they would be
 * easy to break by accident later. M7S-01..
 */
const ROOT = process.cwd();
const rel = (p: string) => path.relative(ROOT, p).replace(/\\/g, "/");
const read = (p: string) => readFileSync(p, "utf8");
function files(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}
const m7 = [
  "src/lib/calendar",
  "src/lib/records",
  "src/lib/activity",
  "src/components/app/calendar",
  "src/components/app/records",
  "src/components/app/activity",
  "src/app/(app)/calendar",
  "src/app/(app)/old-records",
  "src/app/(app)/activity",
].flatMap((d) => files(path.join(ROOT, d)));
const pages = m7.filter((f) => /page\.tsx$/.test(f));
const dataFiles = m7.filter((f) => /\/data\.ts$/.test(rel(f)));
const migration = read(
  path.join(
    ROOT,
    "supabase/migrations/20261111000024_calendar_and_records.sql",
  ),
);

describe("M7 source rules (M7S-01..)", () => {
  it("M7S-01: the files exist (so the other checks cannot pass on nothing)", () => {
    expect(m7.length).toBeGreaterThan(20);
    expect(pages.map(rel).sort()).toEqual([
      "src/app/(app)/activity/page.tsx",
      "src/app/(app)/calendar/[date]/page.tsx",
      "src/app/(app)/calendar/page.tsx",
      "src/app/(app)/old-records/page.tsx",
    ]);
    expect(dataFiles).toHaveLength(3);
  });
  it("M7S-02: nothing in M7 uses the secret key, the PDF code, or writes to the console", () => {
    for (const f of m7) {
      const src = read(f);
      expect(src, rel(f)).not.toMatch(
        /supabase\/admin|SUPABASE_SECRET_KEY|createAdminClient|CRON_SECRET|@\/lib\/pdf\//,
      );
      expect(src, rel(f)).not.toMatch(/console\.(log|info|debug|warn|error)/);
    }
  });
  it("M7S-03: every page checks who is signed in BEFORE it loads anything", () => {
    for (const f of pages) {
      const src = read(f);
      const body = src.slice(src.indexOf("export default async function"));
      expect(body, rel(f)).toContain("await requireUser()");
      const firstLoad = body.search(/\bload[A-Z]\w*\(/);
      expect(body.indexOf("await requireUser()"), rel(f)).toBeLessThan(
        firstLoad,
      );
    }
  });
  it("M7S-04: the loaders read as the signed-in person (server client only), only through select/rpc, and never write", () => {
    for (const f of dataFiles) {
      const src = read(f);
      expect(src, rel(f)).toContain('import "server-only"');
      expect(src, rel(f)).toContain('from "@/lib/supabase/server"');
      expect(src, rel(f)).not.toMatch(
        /\.(insert|update|upsert|delete)\(|\.rpc\("(?!calendar_|old_records_|activity_)/,
      );
    }
    // the audit log is read ONLY through activity_list (so its filters, paging and Owners-only rows apply)
    expect(read(path.join(ROOT, "src/lib/activity/data.ts"))).not.toContain(
      'from("audit_logs")',
    );
  });
  it("M7S-05: the screens are server components; the error screens never show the error text", () => {
    for (const f of m7.filter((x) => /components\//.test(rel(x)))) {
      expect(read(f), rel(f)).not.toMatch(/^"use client"/);
    }
    for (const f of m7.filter((x) => /error\.tsx$/.test(x))) {
      expect(read(f), rel(f)).not.toMatch(/error\.(message|stack|digest)/);
    }
  });
  it("M7S-06: the database functions only read: no data-changing or structure-changing statement in migration 24", () => {
    const code = migration
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
      .toLowerCase();
    expect(code).not.toMatch(
      /\b(insert\s+into|update\s+public|delete\s+from|truncate|drop\s+|alter\s+|create\s+(table|view|policy|trigger|index|type|extension))\b/,
    );
    expect(code.match(/create function/g)).toHaveLength(4);
  });
  it("M7S-07: all four are SECURITY INVOKER with an empty search_path, no dynamic SQL, and only signed-in users may run them", () => {
    const code = migration
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
      .toLowerCase();
    expect(code).not.toContain("security definer");
    expect(code.match(/set search_path = ''/g)).toHaveLength(4);
    expect(code).not.toMatch(/\bexecute\b\s+(format|')/);
    expect(code).not.toContain("format(");
    expect(code.match(/revoke all on function/g)).toHaveLength(4);
    expect(code.match(/grant execute on function/g)).toHaveLength(4);
    const grantees = [
      ...code.matchAll(/grant execute on function [^;]*? to ([^;]*);/g),
    ].map((g) => g[1].trim());
    expect(grantees).toEqual(Array(4).fill("authenticated"));
    expect(code.match(/from public, anon;/g)).toHaveLength(4);
  });
  it("M7S-08: every function refuses people who are not active before reading anything", () => {
    const parts = migration.split("create function public.").slice(1);
    expect(parts).toHaveLength(4);
    for (const p of parts) {
      const body = p.slice(p.indexOf("begin"));
      const check = body.indexOf("public.is_active_user()");
      expect(check, p.slice(0, 30)).toBeGreaterThan(-1);
      expect(check, p.slice(0, 30)).toBeLessThan(body.indexOf("return query"));
      expect(body).toContain("'NOT_ALLOWED'");
    }
  });
  it("M7S-09: the new booking link only fills in a valid check-in date and an active resort of the form's own list", () => {
    const src = read(path.join(ROOT, "src/app/(app)/bookings/new/page.tsx"));
    expect(src).toContain("isIsoDate(checkinParam)");
    expect(src).toMatch(
      /options\.data\.resorts\.some\(\s*\(r\) => r\.id === resortParam && r\.active/,
    );
  });
});
