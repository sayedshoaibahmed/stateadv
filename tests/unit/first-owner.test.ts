import { describe, expect, it } from "vitest";
import {
  createFirstOwner,
  type FirstOwnerDeps,
} from "../../scripts/lib/first-owner";
import {
  recoverOwner,
  type RecoverDeps,
} from "../../scripts/lib/recover-owner";
import { generateTempPassword } from "@/lib/accounts/rules";

const PASSWORD = "Test-Only-Password-123";

function fakeFirst(over: Partial<FirstOwnerDeps> = {}) {
  const calls: string[] = [];
  const logs: string[] = [];
  const deps: FirstOwnerDeps = {
    countProfiles: async () => 0,
    authUserExists: async () => false,
    createAuthUser: async (email, password) => {
      calls.push(`createAuthUser:${email}`);
      void password;
      return "11111111-1111-4111-8111-111111111111";
    },
    insertOwnerProfile: async (p) =>
      void calls.push(`insertOwnerProfile:${p.email}`),
    deleteAuthUser: async (id) => void calls.push(`deleteAuthUser:${id}`),
    log: (m) => void logs.push(m),
    ...over,
  };
  return { deps, calls, logs };
}
const input = {
  fullName: "Test Owner",
  email: " Owner@Test.Example ",
  password: PASSWORD,
};

describe("create the first Owner (script logic)", () => {
  it("FUO-01: creates exactly one login and one Owner profile, and never reveals the password", async () => {
    const { deps, calls, logs } = fakeFirst();
    const r = await createFirstOwner(deps, input, { dryRun: false });
    expect(r.status).toBe("created");
    expect(calls).toEqual([
      "createAuthUser:owner@test.example",
      "insertOwnerProfile:owner@test.example",
    ]);
    expect(JSON.stringify([logs, r])).not.toContain(PASSWORD);
  });

  it("FUO-02: refuses when ANY account already exists (no second Owner, no hidden account)", async () => {
    for (const n of [1, 2, 50]) {
      const { deps, calls } = fakeFirst({ countProfiles: async () => n });
      const r = await createFirstOwner(deps, input, { dryRun: false });
      expect(r.status).toBe("refused");
      expect(calls).toEqual([]);
    }
  });

  it("FUO-03: refuses when a login with this email already exists; creates nothing", async () => {
    const { deps, calls } = fakeFirst({ authUserExists: async () => true });
    expect(
      (await createFirstOwner(deps, input, { dryRun: false })).status,
    ).toBe("refused");
    expect(calls).toEqual([]);
  });

  it("FUO-04: a dry run checks everything and creates nothing", async () => {
    const { deps, calls, logs } = fakeFirst();
    const r = await createFirstOwner(deps, input, { dryRun: true });
    expect(r.status).toBe("dry-run");
    expect(calls).toEqual([]);
    expect(logs.join("\n")).toContain("nothing was created");
  });

  it("FUO-05: if the profile cannot be saved the new login is removed again", async () => {
    const { deps, calls } = fakeFirst({
      insertOwnerProfile: async () => {
        throw new Error("profile refused");
      },
    });
    const r = await createFirstOwner(deps, input, { dryRun: false });
    expect(r.status).toBe("refused");
    expect(calls).toEqual([
      "createAuthUser:owner@test.example",
      "deleteAuthUser:11111111-1111-4111-8111-111111111111",
    ]);
  });

  it("FUO-06: bad input is refused before anything is touched", async () => {
    for (const bad of [
      { ...input, fullName: "  " },
      { ...input, email: "nope" },
      { ...input, password: "short" },
      { ...input, password: "x".repeat(73) },
    ]) {
      const { deps, calls } = fakeFirst({
        countProfiles: async () => {
          throw new Error("must not be called");
        },
      });
      expect(
        (await createFirstOwner(deps, bad, { dryRun: false })).status,
      ).toBe("refused");
      expect(calls).toEqual([]);
    }
  });
});

function fakeRecover(over: Partial<RecoverDeps> = {}) {
  const calls: string[] = [];
  const deps: RecoverDeps = {
    findOwnerByEmail: async () => ({
      id: "22222222-2222-4222-8222-222222222222",
      fullName: "Test Owner",
    }),
    recoverInDatabase: async (id, reason) =>
      void calls.push(`db:${id}:${reason}`),
    restoreLogin: async (id, pw, mfa) =>
      void calls.push(`login:${id}:${pw.length}:${mfa}`),
    log: () => undefined,
    ...over,
  };
  return { deps, calls };
}
const rin = {
  email: "Owner@Test.Example",
  reason: "Owner lost the phone and password",
  resetMfa: true,
};

describe("recover an Owner account (script logic)", () => {
  it("REC-01: database first (with the reason), then the login with a strong temporary password", async () => {
    const { deps, calls } = fakeRecover();
    const r = await recoverOwner(deps, rin, {
      dryRun: false,
      makePassword: generateTempPassword,
    });
    expect(r.status).toBe("recovered");
    expect(calls).toEqual([
      "db:22222222-2222-4222-8222-222222222222:Owner lost the phone and password",
      "login:22222222-2222-4222-8222-222222222222:16:true",
    ]);
  });
  it("REC-02: works only for an existing Owner; otherwise nothing is touched", async () => {
    const { deps, calls } = fakeRecover({ findOwnerByEmail: async () => null });
    expect(
      (
        await recoverOwner(deps, rin, {
          dryRun: false,
          makePassword: generateTempPassword,
        })
      ).status,
    ).toBe("refused");
    expect(calls).toEqual([]);
  });
  it("REC-03: a reason of 10+ characters is mandatory; a dry run changes nothing", async () => {
    const a = fakeRecover();
    expect(
      (
        await recoverOwner(
          a.deps,
          { ...rin, reason: "short" },
          { dryRun: false, makePassword: generateTempPassword },
        )
      ).status,
    ).toBe("refused");
    expect(a.calls).toEqual([]);
    const b = fakeRecover();
    expect(
      (
        await recoverOwner(b.deps, rin, {
          dryRun: true,
          makePassword: generateTempPassword,
        })
      ).status,
    ).toBe("dry-run");
    expect(b.calls).toEqual([]);
  });
  it("REC-04: if the database refuses (for example the last-Owner rule) the login is not touched", async () => {
    const { deps, calls } = fakeRecover({
      recoverInDatabase: async () => {
        throw new Error("refused");
      },
    });
    await expect(
      recoverOwner(deps, rin, {
        dryRun: false,
        makePassword: generateTempPassword,
      }),
    ).rejects.toThrow("refused");
    expect(calls).toEqual([]);
  });
});
