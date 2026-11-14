import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import CalendarDayNotFound from "@/app/(app)/calendar/[date]/not-found";
import { resortChoices, resortNameMap } from "@/lib/resorts";

/**
 * The M7 pages against the Next.js 16.4 documentation the repository requires (AGENTS.md: node_modules/next/dist/docs):
 *   file-conventions/page      params and searchParams are Promises, read with await
 *   file-conventions/loading   a loading.tsx wraps the page in Suspense (needed with Cache Components, which is ON here,
 *                              because the pages read cookies and the address); dynamic routes should have their own
 *   file-conventions/error     an error boundary is a Client Component and receives `retry` (re-fetch) and `reset`
 *   functions/not-found        notFound() renders the nearest not-found.tsx
 * Checked by reading the source, because they are easy to break by accident. M7N-01..
 */
const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const APP = "src/app/(app)";
const SEGMENTS = ["calendar", "calendar/[date]", "old-records", "activity"];
const PAGES = SEGMENTS.map((s) => `${APP}/${s}/page.tsx`);
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(el);

describe("Next.js conventions (M7N-01..)", () => {
  it("M7N-01: params and searchParams are Promises and are awaited, never read directly", () => {
    for (const f of PAGES) {
      const src = read(f);
      expect(src, f).toMatch(
        /searchParams: Promise<|searchParams: SearchParams/,
      );
      expect(src, f).toContain("await searchParams");
      expect(src, f).not.toMatch(/\bsearchParams\.[a-z]/);
      expect(src, f).not.toMatch(/\bparams\.[a-z]/);
    }
    const day = read(`${APP}/calendar/[date]/page.tsx`);
    expect(day).toContain("params: Promise<{ date: string }>");
    expect(day).toContain("await params");
  });
  it("M7N-02: every page folder has a loading screen and an error screen; the day page (a dynamic route) has its own loading and not-found screens", () => {
    for (const s of ["calendar", "old-records", "activity"]) {
      expect(() => read(`${APP}/${s}/loading.tsx`)).not.toThrow();
      expect(() => read(`${APP}/${s}/error.tsx`)).not.toThrow();
    }
    expect(() => read(`${APP}/calendar/[date]/loading.tsx`)).not.toThrow();
    expect(() => read(`${APP}/calendar/[date]/not-found.tsx`)).not.toThrow();
  });
  it("M7N-03: the error screens are Client Components that use retry() (the documented way to try again), not only reset(), and never show the error", () => {
    for (const s of ["calendar", "old-records", "activity"]) {
      const src = read(`${APP}/${s}/error.tsx`);
      expect(src.trimStart().startsWith('"use client"'), s).toBe(true);
      expect(src, s).toMatch(/\bretry\b/);
      expect(src, s).toContain("onRetry={retry}");
      expect(src, s).not.toMatch(/onRetry=\{reset\}|\breset\b\s*[,}:)]/);
      expect(src, s).not.toMatch(/error\.(message|stack|digest)/);
    }
  });
  it("M7N-04: the loading screens are plain Server Components and light (no data, no client code)", () => {
    for (const f of [
      ...["calendar", "old-records", "activity"].map(
        (s) => `${APP}/${s}/loading.tsx`,
      ),
      `${APP}/calendar/[date]/loading.tsx`,
    ]) {
      const src = read(f);
      expect(src, f).not.toMatch(/^"use client"/);
      expect(src, f).not.toMatch(/supabase|fetch\(|load[A-Z]/);
      expect(src, f).toContain("aria-busy");
    }
  });
  it("M7N-05: a bad date calls notFound() AFTER the sign-in check, and the not-found screen says what to do next", () => {
    const day = read(`${APP}/calendar/[date]/page.tsx`);
    expect(day).toContain('import { notFound } from "next/navigation"');
    expect(day.indexOf("await requireUser()")).toBeLessThan(
      day.indexOf("notFound()"),
    );
    expect(day).not.toMatch(/try\s*\{[^}]*notFound\(\)/); // a try/catch would swallow it (docs: functions/not-found)
    const out = html(h(CalendarDayNotFound));
    expect(out).toContain("That date was not found");
    expect(out).toContain('href="/calendar"');
    expect(out).toContain("min-h-11");
  });
  it("M7N-06: nothing in M7 is cached: the screens show one signed-in person's data, so there is no 'use cache' anywhere in M7", () => {
    for (const f of [
      ...PAGES,
      "src/lib/calendar/data.ts",
      "src/lib/records/data.ts",
      "src/lib/activity/data.ts",
    ])
      expect(read(f), f).not.toMatch(/['"]use cache['"]/);
  });
  it("M7N-07: links to other pages use <Link> (prefetched, no full reload); only the filter forms use plain GET forms", () => {
    for (const f of [
      "src/components/app/calendar/month-view.tsx",
      "src/components/app/calendar/day-view.tsx",
      "src/components/app/records/old-records-view.tsx",
      "src/components/app/activity/activity-view.tsx",
    ]) {
      const src = read(f);
      expect(src, f).toContain('from "next/link"');
      expect(src, f).not.toMatch(/<a\s+href=/);
    }
  });
});

describe("one read of the resorts (M7N-08..)", () => {
  it("M7N-08: Old Records and Activity read the resorts ONCE and build both the choices and the names from it", () => {
    for (const f of [
      `${APP}/old-records/page.tsx`,
      `${APP}/activity/page.tsx`,
    ]) {
      const src = read(f);
      expect(src.match(/loadResorts\(/g), f).toHaveLength(1);
      expect(src, f).not.toMatch(/loadResortNames|loadResortChoices/);
      expect(src, f).toContain("resortChoices(resorts)");
      expect(src, f).toContain("resortNameMap(resorts)");
    }
  });
  it("M7N-09: the choices keep a switched-off resort (marked closed) and the names are the plain names", () => {
    const list = [
      { id: "a", name: "Alpha", active: true },
      { id: "b", name: "Beta", active: false },
    ];
    expect(resortChoices(list)).toEqual([
      { id: "a", name: "Alpha" },
      { id: "b", name: "Beta (closed)" },
    ]);
    expect([...resortNameMap(list)]).toEqual([
      ["a", "Alpha"],
      ["b", "Beta"],
    ]);
    expect(resortChoices([])).toEqual([]);
    expect(resortNameMap([]).size).toBe(0);
  });
  it("M7N-10: the one read runs as the signed-in person (server client, plain select, same table as before)", () => {
    const src = read("src/lib/bookings/data.ts");
    const fn = src.slice(src.indexOf("export async function loadResorts"));
    const body = fn.slice(
      0,
      fn.indexOf("export async function loadResortNames"),
    );
    expect(body).toContain("await createClient()");
    expect(body).toContain('.from("resorts")');
    expect(body).toContain('.select("id, name, is_active")');
    expect(body).not.toMatch(/admin|SECRET/);
  });
});
