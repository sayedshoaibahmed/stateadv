import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Rules about the M8 report code and migration 25 that are checked by reading the source, because they would be easy to
 * break by accident later. M8S-01..
 */
const ROOT = process.cwd();
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
function files(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(path.join(ROOT, dir))) {
    const p = path.join(dir, f);
    if (statSync(path.join(ROOT, p)).isDirectory()) files(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p.replace(/\\/g, "/"));
  }
  return out;
}
const m8 = [
  "src/lib/reports",
  "src/components/app/reports",
  "src/app/(app)/reports",
  "src/app/api/export",
].flatMap((d) => files(d));
const migration = read("supabase/migrations/20261111000025_reports.sql");
const sqlCode = migration
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n")
  .toLowerCase();

describe("M8 source rules (M8S-01..)", () => {
  it("M8S-01: the files exist, so the other checks cannot pass on nothing", () => {
    expect(m8.length).toBeGreaterThan(15);
    for (const f of [
      "src/app/(app)/reports/page.tsx",
      "src/app/(app)/reports/[report]/page.tsx",
      "src/app/(app)/reports/[report]/not-found.tsx",
      "src/app/(app)/reports/loading.tsx",
      "src/app/(app)/reports/[report]/loading.tsx",
      "src/app/(app)/reports/error.tsx",
      "src/app/api/export/[report]/route.ts",
    ])
      expect(m8, f).toContain(f);
  });
  it("M8S-02: nothing in M8 uses the secret key or a secret, and nothing writes to the console (no guest data reaches a log)", () => {
    for (const f of m8) {
      const src = read(f);
      expect(src, f).not.toMatch(
        /supabase\/admin|SUPABASE_SECRET_KEY|createAdminClient|CRON_SECRET/,
      );
      expect(src, f).not.toMatch(/console\.(log|info|debug|warn|error)/);
    }
  });
  it("M8S-03: the database is read as the signed-in person, only through the eleven report functions, and nothing is ever written", () => {
    const data = read("src/lib/reports/data.ts");
    expect(data).toContain('import "server-only"');
    expect(data).toContain('from "@/lib/supabase/server"');
    expect(data).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    const rpcs = [...data.matchAll(/\.rpc\(\s*"([a-z_]+)"/g)]
      .map((m) => m[1])
      .sort();
    expect(rpcs).toEqual([
      "report_bookings",
      "report_cancellations",
      "report_collection",
      "report_expected_adjustments",
      "report_expected_vs_actual",
      "report_manual_adjustments",
      "report_payment_methods",
      "report_pending",
      "report_refunds",
      "report_waiting",
    ]);
    for (const f of m8.filter((x) => !x.endsWith("data.ts")))
      expect(read(f), f).not.toMatch(/\.rpc\(|\.from\("/);
  });
  it("M8S-04: the pages check who is signed in BEFORE they read anything", () => {
    for (const f of [
      "src/app/(app)/reports/page.tsx",
      "src/app/(app)/reports/[report]/page.tsx",
    ]) {
      const src = read(f);
      const body = src.slice(src.indexOf("export default async function"));
      expect(body, f).toContain("await requireUser()");
      const firstRead = body.search(/\b(load|fetch)[A-Z]\w*\(/);
      if (firstRead >= 0)
        expect(body.indexOf("await requireUser()"), f).toBeLessThan(firstRead);
    }
  });
  it("M8S-05: the file route opens the request (connection), checks the session FIRST, then the report, the format and the choices, and only then reads", () => {
    const src = read("src/app/api/export/[report]/route.ts");
    const at = (s: string) => src.indexOf(s);
    expect(at("await connection()")).toBeGreaterThan(-1);
    expect(at("await connection()")).toBeLessThan(at("await getSession()"));
    expect(at("await getSession()")).toBeLessThan(at("isReportKey(report)"));
    expect(at("isReportKey(report)")).toBeLessThan(at("parseReportFilter("));
    expect(at("parseReportFilter(")).toBeLessThan(at("await loadResorts()"));
    expect(at("await loadResorts()")).toBeLessThan(at("fetchReportPage("));
    expect(src).toContain("await ctx.params");
    expect(src).not.toMatch(/export const (runtime|dynamic|revalidate)/); // Cache Components: route segment config is not used
    expect(src).toMatch(/"Cache-Control": "no-store"/);
    expect(src).toMatch(/"X-Content-Type-Options": "nosniff"/);
  });
  it("M8S-06: the CSV is made only through the guarded cell functions; the route never joins values itself", () => {
    const src = read("src/app/api/export/[report]/route.ts");
    expect(src).toContain('from "@/lib/reports/csv"');
    expect(src).not.toMatch(/\.join\(","\)|\+ ","|`\$\{[^}]+\},\$\{/);
    const csv = read("src/lib/reports/csv.ts");
    expect(csv).toContain("^[=+\\-@\\t\\r]");
    expect(csv).toContain("﻿".length === 1 ? String.fromCharCode(0xfeff) : "");
  });
  it("M8S-07: the PDF and the CSV only format; nothing in the report code adds money figures or recalculates (no reduce over amounts, no calculators)", () => {
    for (const f of m8.filter((x) => x.startsWith("src/lib/reports/"))) {
      const src = read(f);
      expect(src, f).not.toMatch(
        /computeBookingAmounts|computeFinancials|from "@\/lib\/calc"/,
      );
      expect(src, f).not.toMatch(/\.reduce\(/);
      expect(src, f).not.toMatch(/_paise\s*[-+*/]\s*[a-z.]*_?paise/);
    }
  });
  it("M8S-08: the Next.js conventions: params and searchParams are awaited; loading and error screens exist; errors use retry and never show the error; nothing is cached", () => {
    const page = read("src/app/(app)/reports/[report]/page.tsx");
    expect(page).toContain("await params");
    expect(page).toContain("await searchParams");
    expect(page).toContain("notFound()");
    for (const f of ["src/app/(app)/reports/error.tsx"]) {
      const src = read(f);
      expect(src.trimStart().startsWith('"use client"')).toBe(true);
      expect(src).toContain("onRetry={retry}");
      expect(src).not.toMatch(/error\.(message|stack|digest)/);
    }
    for (const f of m8) expect(read(f), f).not.toMatch(/['"]use cache['"]/);
    for (const f of m8.filter((x) => x.includes("components/")))
      expect(read(f), f).not.toMatch(/^"use client"/);
  });
  it("M8S-13: the screen and the file read through the SAME function with the same filter, so a file can never show more than the screen", () => {
    const page = read("src/app/(app)/reports/[report]/page.tsx");
    const route = read("src/app/api/export/[report]/route.ts");
    for (const src of [page, route]) {
      expect(src).toContain("fetchReportPage(");
      expect(src).toContain("parseReportFilter(");
    }
    const data = read("src/lib/reports/data.ts");
    expect(data.match(/createClient\(/g)?.length ?? 0).toBeGreaterThan(0);
  });
});

describe("migration 25 rules (M8S-09..)", () => {
  it("M8S-09: it only adds eleven read-only functions: no table, view, policy, trigger or data change, nothing destructive", () => {
    expect(sqlCode.match(/create function/g)).toHaveLength(11);
    expect(sqlCode).not.toMatch(
      /\b(insert\s+into|update\s+public|delete\s+from|truncate|drop\s+|alter\s+|create\s+(table|view|policy|trigger|index|type|extension|or replace))\b/,
    );
  });
  it("M8S-10: all eleven are SECURITY INVOKER with an empty search_path, no dynamic SQL, and only signed-in users may run them", () => {
    expect(sqlCode).not.toContain("security definer");
    expect(sqlCode.match(/set search_path = ''/g)).toHaveLength(11);
    expect(sqlCode).not.toContain("format(");
    expect(sqlCode).not.toMatch(/\bexecute\b\s+(format|')/);
    expect(sqlCode.match(/revoke all on function/g)).toHaveLength(11);
    expect(sqlCode.match(/from public, anon;/g)).toHaveLength(11);
    const grantees = [
      ...sqlCode.matchAll(/grant execute on function [^;]*? to ([^;]*);/g),
    ].map((g) => g[1].trim());
    expect(grantees).toEqual(Array(11).fill("authenticated"));
  });
  it("M8S-11: every report function refuses people who are not active (through report_check) before it reads anything", () => {
    const parts = migration.split("create function public.").slice(1);
    expect(parts).toHaveLength(11);
    for (const p of parts) {
      const name = p.slice(0, p.indexOf("("));
      const body = p.slice(p.indexOf("begin"));
      if (name === "report_check") {
        expect(body).toContain("public.is_active_user()");
        expect(body).toContain("'NOT_ALLOWED'");
      } else {
        expect(body, name).toContain("perform public.report_check(");
        expect(body.indexOf("perform public.report_check("), name).toBeLessThan(
          body.indexOf("return query"),
        );
      }
    }
  });
  it("M8S-12: the pages are bounded: at most 1,000 rows a call, ten years for the one-table reports", () => {
    expect(
      sqlCode.match(/least\(greatest\(coalesce\(p_limit, 100\), 1\), 1000\)/g),
    ).toHaveLength(7);
    expect(
      sqlCode.match(/perform public\.report_check\(p_from, p_to, 3660\)/g),
    ).toHaveLength(3);
  });
});
