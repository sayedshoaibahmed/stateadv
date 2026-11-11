import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DB_ERROR_MESSAGES,
  GENERIC_ERROR,
  WARNING_MESSAGES,
  friendlyError,
} from "@/lib/errors";

const DIR = join(process.cwd(), "supabase", "migrations");
const sql = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(DIR, f), "utf8"))
  .join("\n")
  .replace(/--[^\n]*/g, ""); // ignore comments (they contain examples)

describe("plain-English database errors", () => {
  it("ERR-01: every error code used in a migration has a message for the screen", () => {
    const codes = new Set(
      [...sql.matchAll(/raise exception\s+'([A-Z][A-Z0-9_]+)'/gi)].map(
        (m) => m[1],
      ),
    );
    expect(codes.size).toBeGreaterThan(50); // the scan itself works
    const missing = [...codes].filter((c) => !(c in DB_ERROR_MESSAGES));
    expect(missing).toEqual([]);
  });

  it("ERR-02: no message shows a code, SQL words or a stack trace", () => {
    for (const [code, text] of Object.entries(DB_ERROR_MESSAGES)) {
      expect(text, code).not.toMatch(/[A-Z]{2,}_[A-Z_]+/);
      expect(text, code).not.toMatch(
        /\b(sql|postgres|exception|constraint|trigger|null)\b/i,
      );
      expect(text.length, code).toBeGreaterThan(10);
    }
  });

  it("ERR-03: friendlyError uses only the code; unknown or odd input gives the general message", () => {
    expect(friendlyError({ message: "REFUND_TOO_LARGE", details: "x" })).toBe(
      DB_ERROR_MESSAGES.REFUND_TOO_LARGE,
    );
    expect(friendlyError(new Error("LAST_OWNER_PROTECTED"))).toBe(
      DB_ERROR_MESSAGES.LAST_OWNER_PROTECTED,
    );
    for (const bad of [
      { message: 'duplicate key value violates unique constraint "x"' },
      { message: "permission denied for table bookings" },
      "boom",
      null,
      undefined,
      42,
      {},
    ]) {
      expect(friendlyError(bad)).toBe(GENERIC_ERROR);
    }
  });

  it("ERR-04: warnings have messages", () => {
    const codes = [...sql.matchAll(/'code', '([A-Z_]+)'/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(0);
    for (const c of new Set(codes)) expect(WARNING_MESSAGES[c], c).toBeTruthy();
  });
});
