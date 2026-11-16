import { describe, expect, it } from "vitest";
import {
  checkConfirmation,
  resetDatabase,
  type ResetDeps,
} from "../../scripts/lib/reset-database";

function fakeDeps(over: Partial<ResetDeps> = {}) {
  const calls: string[] = [];
  const logs: string[] = [];
  const deps: ResetDeps = {
    dropAndRecreateSchema: async () => void calls.push("dropAndRecreateSchema"),
    pushMigrations: async () => void calls.push("pushMigrations"),
    deleteAllAuthUsers: async () => {
      calls.push("deleteAllAuthUsers");
      return 3;
    },
    emptyAllBuckets: async () => {
      calls.push("emptyAllBuckets");
      return [
        { bucket: "payment-proofs", removed: 2 },
        { bucket: "booking-pdfs", removed: 1 },
        { bucket: "resort-logos", removed: 0 },
      ];
    },
    log: (m) => void logs.push(m),
    ...over,
  };
  return { deps, calls, logs };
}

describe("reset confirmation (RST-01..)", () => {
  it("RST-01: refuses when the typed host does not match", () => {
    const r = checkConfirmation("wrong.supabase.co", "right.supabase.co", "RESET DATABASE");
    expect(r.ok).toBe(false);
  });
  it("RST-02: refuses when the phrase is anything but the exact words", () => {
    for (const phrase of ["reset database", "RESET DATABASE ", "yes", ""]) {
      const r = checkConfirmation("right.supabase.co", "right.supabase.co", phrase);
      expect(r.ok).toBe(false);
    }
  });
  it("RST-03: passes only when both match exactly", () => {
    const r = checkConfirmation("right.supabase.co", "right.supabase.co", "RESET DATABASE");
    expect(r.ok).toBe(true);
  });
  it("RST-04: trims the typed host but not the phrase (no accidental pass from whitespace)", () => {
    const r = checkConfirmation("  right.supabase.co  ", "right.supabase.co", "RESET DATABASE");
    expect(r.ok).toBe(true);
  });
});

describe("resetDatabase orchestration (RST-10..)", () => {
  it("RST-10: a dry run calls nothing destructive", async () => {
    const { deps, calls } = fakeDeps();
    const r = await resetDatabase(deps, { dryRun: true });
    expect(r.status).toBe("dry-run");
    expect(calls).toEqual([]);
  });

  it("RST-11: a real run calls every step, in order: schema, migrations, Auth, Storage", async () => {
    const { deps, calls } = fakeDeps();
    const r = await resetDatabase(deps, { dryRun: false });
    expect(calls).toEqual([
      "dropAndRecreateSchema",
      "pushMigrations",
      "deleteAllAuthUsers",
      "emptyAllBuckets",
    ]);
    expect(r).toEqual({
      status: "done",
      authUsersDeleted: 3,
      buckets: [
        { bucket: "payment-proofs", removed: 2 },
        { bucket: "booking-pdfs", removed: 1 },
        { bucket: "resort-logos", removed: 0 },
      ],
    });
  });

  it("RST-12: a failure partway through stops the rest (no swallowed errors)", async () => {
    const { deps, calls } = fakeDeps({
      pushMigrations: async () => {
        calls.push("pushMigrations");
        throw new Error("db push failed");
      },
    });
    await expect(resetDatabase(deps, { dryRun: false })).rejects.toThrow(
      "db push failed",
    );
    expect(calls).toEqual(["dropAndRecreateSchema", "pushMigrations"]);
  });

  it("RST-13: logs progress without ever including a connection string or key", async () => {
    const { deps, logs } = fakeDeps();
    await resetDatabase(deps, { dryRun: false });
    const text = logs.join("\n");
    expect(text).not.toMatch(/postgres(ql)?:\/\//i);
    expect(text).not.toMatch(/sb_(secret|publishable)_/);
  });
});
