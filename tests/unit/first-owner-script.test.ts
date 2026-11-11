import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// The one-time script must keep two promises about its command line (no network is reached in either case):
// the name and email arguments exist for the dry run only, and a real run never takes them.
const run = (args: string[]) =>
  spawnSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/create-first-user.ts", ...args],
    {
      encoding: "utf8",
      timeout: 60_000,
      // fake values: a failing network call would only produce an error, never touch the real project
      env: {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: "https://example.invalid",
        SUPABASE_SECRET_KEY: "not-a-real-key",
      },
    },
  );

describe("create-first-user.ts command line (FOW-ARGS)", () => {
  it("FOW-ARGS-1: --name or --email without --dry-run is refused immediately", () => {
    for (const args of [
      ["--name=Test Owner"],
      ["--email=test-owner@example.com"],
      ["--name=Test Owner", "--email=test-owner@example.com"],
    ]) {
      const r = run(args);
      expect(r.status, args.join(" ")).toBe(1);
      expect(r.stderr).toContain("only accepted together with --dry-run");
      // it stopped before announcing anything or asking for a password
      expect(r.stdout).not.toContain("Project:");
      expect(r.stdout + r.stderr).not.toMatch(/password/i);
    }
  }, 120_000);

  it("FOW-ARGS-2: the dry run announces itself and never offers a password prompt", () => {
    // the fake project cannot be reached, so the dry run ends in a clear error and creates nothing
    const r = run([
      "--dry-run",
      "--name=Test Owner",
      "--email=test-owner@example.com",
    ]);
    expect(r.stdout).toContain("DRY RUN: nothing will be created");
    expect(r.stdout).not.toContain("Temporary password");
    expect(r.stdout).not.toContain("CREATE OWNER");
    expect(r.status).toBe(1); // unreachable fake project: refused, nothing created
  }, 120_000);
});
