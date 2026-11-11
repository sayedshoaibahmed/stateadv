import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { askHidden } from "../../scripts/lib/prompt";

// Tests for scripts/create-first-owner.ps1 (the launcher) and for the safeguards of the script it starts.
// No test reaches Supabase, creates anything or needs a real secret: every environment file below is fake.
const LAUNCHER = "scripts/create-first-owner.ps1";
const launcherSource = readFileSync(LAUNCHER, "utf8");
const scriptSource = readFileSync("scripts/create-first-user.ts", "utf8");
const REF = "prfarsersxoeavcqydez";
const FAKE_KEY = "sb_secret_FAKE_KEY_FOR_TESTS_ONLY_0123456789";

const shell = ["powershell", "pwsh"].find(
  (s) =>
    spawnSync(s, ["-NoProfile", "-Command", "exit 0"], { encoding: "utf8" })
      .status === 0,
);

const dir = mkdtempSync(join(tmpdir(), "stateadv-launcher-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const envFile = (name: string, body: string) => {
  const p = join(dir, name);
  writeFileSync(p, body);
  return p;
};
const run = (args: string[], env: Record<string, string> = {}) => {
  const clean = { ...process.env };
  delete clean.NEXT_PUBLIC_SUPABASE_URL;
  delete clean.SUPABASE_SECRET_KEY;
  return spawnSync(
    shell!,
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", LAUNCHER, ...args],
    { encoding: "utf8", timeout: 60_000, env: { ...clean, ...env } },
  );
};
const out = (r: ReturnType<typeof run>) => `${r.stdout}\n${r.stderr}`;

describe("launcher source (FOW-PS static)", () => {
  it("FOW-PS-1: never reads, stores or forwards a password", () => {
    // comments may talk about passwords; code must not handle them
    const code = launcherSource
      .replace(/<#[\s\S]*?#>/g, "")
      .split("\n")
      .filter((l) => !l.trim().startsWith("#") && !/Write-Host/.test(l))
      .join("\n");
    for (const forbidden of [
      "Read-Host",
      "AsSecureString",
      "SecureString",
      "ConvertFrom-SecureString",
      "ConvertTo-SecureString",
      "Out-File",
      "Set-Content",
      "Add-Content",
      "Start-Transcript",
      "-Password",
      "$env:",
      "SetEnvironmentVariable",
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it("FOW-PS-2: its only parameters are -DryRun, -CheckOnly and -EnvFile (no password, name, email or confirmation)", () => {
    const block =
      /\[CmdletBinding\(\)\]\s*param\(([\s\S]*?)\)\s*\n\$ErrorActionPreference/.exec(
        launcherSource,
      );
    expect(block).not.toBeNull();
    const names = [...block![1].matchAll(/\$(\w+)/g)].map((m) => m[1]);
    expect(names).toEqual(["DryRun", "CheckOnly", "EnvFile"]);
  });

  it("FOW-PS-3: the project ref is a constant, and the script it starts is the existing protected one", () => {
    expect(launcherSource).toContain(`$ExpectedRef = "${REF}"`);
    // ... and it is not one of the parameters, so nobody can point the launcher at another project
    const paramBlock = launcherSource.slice(
      launcherSource.indexOf("param("),
      launcherSource.indexOf("$ErrorActionPreference"),
    );
    expect(paramBlock).not.toContain("ExpectedRef");
    expect(launcherSource).toContain("scripts/create-first-user.ts");
    expect(launcherSource).not.toContain("--name");
    expect(launcherSource).not.toContain("--email");
  });
});

describe("the protected script keeps its safeguards (FOW-ARGS)", () => {
  it("FOW-ARGS-3: the hidden password prompt refuses piped input, so a password can never come from a pipe, file or argument", async () => {
    // vitest runs without a terminal: exactly the situation of a pipe
    await expect(askHidden("Temporary password: ")).rejects.toThrow(
      /real terminal/,
    );
  });

  it("FOW-ARGS-4: a real run stops at the key-rotation question when the answer is not yes (nothing is asked or created afterwards)", () => {
    const r = spawnSync(
      process.execPath,
      ["node_modules/tsx/dist/cli.mjs", "scripts/create-first-user.ts"],
      {
        encoding: "utf8",
        timeout: 60_000,
        input: "no\n",
        env: {
          ...process.env,
          NEXT_PUBLIC_SUPABASE_URL: "https://example.invalid",
          SUPABASE_SECRET_KEY: FAKE_KEY,
        },
      },
    );
    expect(r.stdout).toContain(
      "Stopped. Replace the key and get approval first.",
    );
    expect(r.stdout).not.toContain("Owner's full name");
    expect(r.stdout).not.toContain("Temporary password");
    expect(r.status).toBe(0);
  }, 120_000);

  it("FOW-ARGS-5: creation is reachable only after the literal CREATE OWNER, and never in a dry run", () => {
    const guard = scriptSource.indexOf('confirm !== "CREATE OWNER"');
    const create = scriptSource.indexOf("await createFirstOwner(");
    expect(guard).toBeGreaterThan(0);
    expect(create).toBeGreaterThan(guard); // the confirmation comes first
    // the confirmation block exists only for real runs, and the dry-run flag is passed to the creator
    expect(scriptSource).toMatch(
      /if \(!dryRun\) \{\s*const confirm = await ask\(/,
    );
    expect(scriptSource).toMatch(/\{ dryRun \}/);
    // the real run asks for the key-rotation confirmation first
    expect(
      scriptSource.indexOf('rotated.toLowerCase() !== "yes"'),
    ).toBeLessThan(guard);
  });
});

describe.skipIf(!shell)("launcher behaviour (FOW-PS run)", () => {
  it("FOW-PS-4: a wrong project is refused, and neither key nor address is printed", () => {
    const f = envFile(
      "wrong.env",
      `NEXT_PUBLIC_SUPABASE_URL=https://someotherprojectref00.supabase.co\nSUPABASE_SECRET_KEY=${FAKE_KEY}\n`,
    );
    const r = run(["-CheckOnly", "-EnvFile", f]);
    expect(r.status).toBe(1);
    expect(out(r)).toContain("not the expected project");
    expect(out(r)).toContain("Nothing was created");
    expect(out(r)).not.toContain(FAKE_KEY);
    expect(out(r)).not.toContain("someotherprojectref00");
  });

  it("FOW-PS-5: a missing or old-style key is refused", () => {
    const missing = envFile(
      "nokey.env",
      `NEXT_PUBLIC_SUPABASE_URL=https://${REF}.supabase.co\n`,
    );
    expect(out(run(["-CheckOnly", "-EnvFile", missing]))).toContain(
      "SUPABASE_SECRET_KEY is missing",
    );
    const old = envFile(
      "oldkey.env",
      `NEXT_PUBLIC_SUPABASE_URL=https://${REF}.supabase.co\nSUPABASE_SECRET_KEY=eyJhbGciOiJIUzI1NiJ9.legacy\n`,
    );
    const r = run(["-CheckOnly", "-EnvFile", old]);
    expect(r.status).toBe(1);
    expect(out(r)).toContain("sb_secret_ format");
    expect(out(r)).not.toContain("legacy");
  });

  it("FOW-PS-6: the right project passes the checks, and only the existing script (with or without --dry-run) would run", () => {
    const f = envFile(
      "ok.env",
      `NEXT_PUBLIC_SUPABASE_URL="https://${REF}.supabase.co"\nSUPABASE_SECRET_KEY=${FAKE_KEY}\n`,
    );
    const real = run(["-CheckOnly", "-EnvFile", f]);
    expect(real.status).toBe(0);
    expect(out(real)).toContain(
      "Would run: npx tsx scripts/create-first-user.ts",
    );
    expect(out(real)).not.toContain("--dry-run");
    const dry = run(["-CheckOnly", "-DryRun", "-EnvFile", f]);
    expect(dry.status).toBe(0);
    expect(out(dry)).toContain(
      "Would run: npx tsx scripts/create-first-user.ts --dry-run",
    );
    expect(out(real) + out(dry)).not.toContain(FAKE_KEY);
  });

  it("FOW-PS-7: no password, name, email or confirmation is accepted on the command line", () => {
    const f = envFile(
      "ok2.env",
      `NEXT_PUBLIC_SUPABASE_URL=https://${REF}.supabase.co\nSUPABASE_SECRET_KEY=${FAKE_KEY}\n`,
    );
    for (const extra of [
      ["-Password", "hunter2hunter2"],
      ["-Name", "Test Owner"],
      ["-Email", "a@example.com"],
      ["-Confirm", "CREATE OWNER"],
      ["hunter2hunter2"],
    ]) {
      const r = run(["-CheckOnly", "-EnvFile", f, ...extra]);
      expect(r.status, extra.join(" ")).not.toBe(0);
      // PowerShell's own error for a stray positional value may name that value; named parameters never echo it
      if (extra[0].startsWith("-"))
        expect(out(r)).not.toContain("hunter2hunter2");
      expect(out(r)).not.toContain("Would run");
    }
  });

  it("FOW-PS-8: a real run refuses any file other than the repository's .env.local, and refuses a redirected (non-interactive) console", () => {
    const f = envFile(
      "ok3.env",
      `NEXT_PUBLIC_SUPABASE_URL=https://${REF}.supabase.co\nSUPABASE_SECRET_KEY=${FAKE_KEY}\n`,
    );
    const other = run(["-EnvFile", f]); // not -CheckOnly
    expect(other.status).toBe(1);
    expect(out(other)).toContain("only uses the repository's own .env.local");
    const piped = run([]); // output is captured here, so the console is not interactive
    expect(piped.status).toBe(1);
    expect(out(piped)).toContain("interactive PowerShell window");
    expect(out(piped)).not.toContain("Temporary password");
  });

  it("FOW-PS-9: an environment variable that would override .env.local is refused", () => {
    const f = envFile(
      "ok4.env",
      `NEXT_PUBLIC_SUPABASE_URL=https://${REF}.supabase.co\nSUPABASE_SECRET_KEY=${FAKE_KEY}\n`,
    );
    const r = run(["-CheckOnly", "-EnvFile", f], {
      NEXT_PUBLIC_SUPABASE_URL: "https://someotherprojectref00.supabase.co",
    });
    expect(r.status).toBe(1);
    expect(out(r)).toContain("would override .env.local");
    expect(out(r)).not.toContain("someotherprojectref00");
  });
});
