import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Rules about the PDF code that are checked by reading the source (they would be easy to break by accident later).
 * PDFS-01..
 */
const SRC = path.join(process.cwd(), "src");
function files(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}
const rel = (p: string) => path.relative(process.cwd(), p).replace(/\\/g, "/");
const read = (p: string) => readFileSync(p, "utf8");
const all = files(SRC);

describe("secret key and client code (PDFS-01..)", () => {
  it("PDFS-01: the secret-key client is imported only by the places SECURITY.md allows: user management, the one file-discard step and the PDF retry job", () => {
    const users = all
      .filter((f) => /from "@\/lib\/supabase\/admin"/.test(read(f)))
      .map(rel);
    expect(users.sort()).toEqual(
      [
        "src/app/api/cron/pdf-retry/route.ts",
        "src/lib/accounts/actions.ts",
        "src/lib/auth/actions.ts",
        "src/lib/storage/actions.ts",
      ].sort(),
    );
  });
  it("PDFS-02: the PDF code that runs for people (actions, scheduling, pipeline, layout) never imports the secret-key client", () => {
    for (const f of [
      "src/lib/pdf/actions.ts",
      "src/lib/pdf/schedule.ts",
      "src/lib/pdf/pipeline.ts",
      "src/lib/pdf/render.tsx",
      "src/lib/pdf/document.tsx",
      "src/lib/pdf/model.ts",
    ]) {
      expect(read(path.join(process.cwd(), f)), f).not.toMatch(
        /supabase\/admin|SUPABASE_SECRET_KEY|createAdminClient/,
      );
    }
  });
  it("PDFS-03: no client component imports the PDF code, the server database client or any secret", () => {
    for (const f of all.filter((x) => /^"use client"/.test(read(x)))) {
      const src = read(f);
      expect(src, rel(f)).not.toMatch(
        /@\/lib\/pdf\/(render|document|pipeline|schedule|model)/,
      );
      expect(src, rel(f)).not.toMatch(
        /supabase\/(admin|server)|SUPABASE_SECRET_KEY|CRON_SECRET|react-pdf/,
      );
    }
  });
  it("PDFS-04: the PDF code and the retry route write nothing to the console (nothing about a guest reaches a log)", () => {
    for (const f of all.filter(
      (x) =>
        rel(x).startsWith("src/lib/pdf/") ||
        rel(x).startsWith("src/app/api/cron/") ||
        rel(x).startsWith("src/components/app/pdf/"),
    )) {
      expect(read(f), rel(f)).not.toMatch(
        /console\.(log|info|debug|warn|error)/,
      );
    }
  });
});

describe("the PDF never calculates money (PDFS-05..)", () => {
  it("PDFS-05: the PDF code does not import the calculators; it formats the database's figures", () => {
    for (const f of all.filter((x) => rel(x).startsWith("src/lib/pdf/"))) {
      expect(read(f), rel(f)).not.toMatch(
        /computeBookingAmounts|computeFinancials|from "@\/lib\/calc"/,
      );
    }
  });
  it("PDFS-06: the model only formats: no arithmetic between money figures and no summing", () => {
    const src = read(path.join(SRC, "lib/pdf/model.ts"));
    expect(src).not.toMatch(/_paise\s*[-+*/]\s*[a-z.]*_?paise/);
    expect(src).not.toMatch(/\.reduce\(/);
  });
  it("PDFS-07: the browser cannot hand the PDF code a path, an amount or a hash: the actions take only a booking or a version id", () => {
    const actions = read(path.join(SRC, "lib/pdf/actions.ts"));
    for (const exported of actions.match(
      /export async function \w+\([^)]*\)/g,
    ) ?? [])
      expect(exported).not.toMatch(/path|amount|total|paise|hash/i);
    expect(read(path.join(SRC, "lib/pdf/schedule.ts"))).toMatch(
      /schedulePdf\(bookingId: string\)/,
    );
  });
});

describe("files and configuration (PDFS-08..)", () => {
  it("PDFS-08: the retry job is scheduled every 10 minutes at the documented path", () => {
    const v = JSON.parse(read(path.join(process.cwd(), "vercel.json")));
    expect(v.crons).toEqual([
      { path: "/api/cron/pdf-retry", schedule: "*/10 * * * *" },
    ]);
  });
  it("PDFS-09: the bundled fonts are shipped with the server functions", () => {
    const cfg = read(path.join(process.cwd(), "next.config.ts"));
    expect(cfg).toMatch(/outputFileTracingIncludes/);
    expect(cfg).toMatch(/src\/lib\/pdf\/fonts/);
  });
  it("PDFS-10: the cron route compares the secret in constant time and does not export a runtime", () => {
    const src = read(path.join(SRC, "app/api/cron/pdf-retry/route.ts"));
    expect(src).toMatch(/timingSafeEqual/);
    expect(src).not.toMatch(/export const runtime/);
  });
});
