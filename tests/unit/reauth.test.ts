import { describe, expect, it } from "vitest";
import {
  confirmPassword,
  grantActionFor,
  grantDetail,
  isLockedError,
  issueGrant,
  type GrantAction,
  type ReauthDeps,
} from "@/lib/accounts/reauth";
import { isProtectedAction, type Role } from "@/lib/accounts/rules";

/** A fake of the four server-side steps that records every call, so the ORDER and what is passed can be checked. */
function fake(over: Partial<ReauthDeps> = {}) {
  const calls: Array<{ fn: string; args: unknown[] }> = [];
  const deps: ReauthDeps = {
    begin: async (...args) => {
      calls.push({ fn: "begin", args });
    },
    verifyPassword: async (...args) => {
      calls.push({ fn: "verifyPassword", args });
      return true;
    },
    recordFailure: async (...args) => {
      calls.push({ fn: "recordFailure", args });
    },
    issue: async (...args) => {
      calls.push({ fn: "issue", args });
    },
    ...over,
  };
  return { deps, calls, names: () => calls.map((c) => c.fn) };
}
const who = {
  actorId: "11111111-1111-4111-8111-111111111111",
  actorEmail: "owner@test.example",
  password: "correct horse battery staple",
};
const target = "22222222-2222-4222-8222-222222222222";

describe("re-authentication steps (REAUTH-U)", () => {
  it("REAUTH-U1: an attempt is reserved BEFORE the password is tried; a correct password passes; the password goes only to verifyPassword", async () => {
    const f = fake();
    expect(await confirmPassword(f.deps, who, "set_active", target)).toBe("ok");
    expect(f.names()).toEqual(["begin", "verifyPassword"]);
    await issueGrant(f.deps, who.actorId, "set_active", target, false);
    expect(f.names()).toEqual(["begin", "verifyPassword", "issue"]);
    const withPassword = f.calls.filter((c) =>
      JSON.stringify(c.args).includes(who.password),
    );
    expect(withPassword.map((c) => c.fn)).toEqual(["verifyPassword"]);
    // issue receives only actor, action, target and the operation
    expect(f.calls.at(-1)!.args).toEqual([
      who.actorId,
      "set_active",
      target,
      "false",
    ]);
  });

  it("REAUTH-U2: a wrong password is audited (without the password), refused, and no grant is issued", async () => {
    const f = fake({
      verifyPassword: async (...args) => {
        f.calls.push({ fn: "verifyPassword", args });
        return false;
      },
    });
    expect(await confirmPassword(f.deps, who, "reset_password", target)).toBe(
      "wrong_password",
    );
    expect(f.names()).toEqual(["begin", "verifyPassword", "recordFailure"]);
    const rec = f.calls.find((c) => c.fn === "recordFailure")!;
    expect(rec.args).toEqual([who.actorId, "reset_password", target]);
    expect(JSON.stringify(rec.args)).not.toContain(who.password);
  });

  it("REAUTH-U3: when the attempts are used up, the password is never tried", async () => {
    const f = fake({
      begin: async (...args) => {
        f.calls.push({ fn: "begin", args });
        throw { message: "REAUTH_LOCKED" };
      },
    });
    expect(await confirmPassword(f.deps, who, "set_active", target)).toBe(
      "locked",
    );
    expect(f.names()).toEqual(["begin"]);
  });

  it("REAUTH-U4: if an attempt cannot be reserved for any other reason, nothing is tried (fail closed)", async () => {
    for (const error of [
      new Error("service unavailable"),
      { message: "NOT_ALLOWED" },
      "boom",
    ]) {
      const f = fake({
        begin: async (...args) => {
          f.calls.push({ fn: "begin", args });
          throw error;
        },
      });
      await expect(
        confirmPassword(f.deps, who, "set_active", target),
      ).rejects.toBeDefined();
      expect(f.names()).toEqual(["begin"]);
    }
  });

  it("REAUTH-U5: if a wrong password cannot be recorded, the whole step fails; it never reads as a plain 'wrong password'", async () => {
    const f = fake({
      verifyPassword: async () => false,
      recordFailure: async () => {
        throw new Error("audit write failed");
      },
    });
    await expect(
      confirmPassword(f.deps, who, "set_active", target),
    ).rejects.toThrow("audit write failed");
  });

  it("REAUTH-U6: a refused issue is raised to the caller, never swallowed", async () => {
    const f = fake({
      issue: async () => {
        throw { message: "NOT_ALLOWED" };
      },
    });
    await expect(
      issueGrant(f.deps, who.actorId, "change_email", target, "a@test.example"),
    ).rejects.toEqual({ message: "NOT_ALLOWED" });
  });

  it("REAUTH-U7: one verification can be followed by a second grant (the undo call) without asking again", async () => {
    const f = fake();
    await confirmPassword(f.deps, who, "set_active", target);
    await issueGrant(f.deps, who.actorId, "set_active", target, false);
    await issueGrant(f.deps, who.actorId, "set_active", target, true); // the "undo" after a failed second step
    expect(f.calls.filter((c) => c.fn === "begin")).toHaveLength(1);
    expect(f.calls.filter((c) => c.fn === "verifyPassword")).toHaveLength(1);
    expect(f.calls.filter((c) => c.fn === "issue")).toHaveLength(2);
  });

  it("REAUTH-U8: isLockedError recognises only the lock error", () => {
    expect(isLockedError({ message: "REAUTH_LOCKED" })).toBe(true);
    expect(isLockedError(new Error("REAUTH_LOCKED"))).toBe(true);
    expect(isLockedError({ message: "NOT_ALLOWED" })).toBe(false);
    expect(isLockedError(new Error("network down"))).toBe(false);
  });
});

describe("the exact operation a grant is for (REAUTH-U9)", () => {
  it("REAUTH-U9: every grant carries the operation in the canonical form the database compares", () => {
    expect(grantDetail("set_active", true)).toBe("true");
    expect(grantDetail("set_active", false)).toBe("false");
    expect(grantDetail("change_role", "owner")).toBe("owner");
    expect(grantDetail("change_role", " Manager ")).toBe("manager");
    expect(grantDetail("change_email", "  New.Person@Test.Example ")).toBe(
      "new.person@test.example",
    );
    expect(grantDetail("add_owner", "Owner@Test.Example")).toBe(
      "owner@test.example",
    );
    expect(grantDetail("reset_password", "ignored")).toBeNull();
    expect(grantDetail("reset_password")).toBeNull();
  });

  it("REAUTH-U10: a grant can never be issued for 'anything': a missing or malformed operation throws", () => {
    expect(() => grantDetail("set_active")).toThrow();
    expect(() => grantDetail("set_active", "true")).toThrow();
    expect(() => grantDetail("change_role", "admin")).toThrow();
    expect(() => grantDetail("change_role", null)).toThrow();
    expect(() => grantDetail("change_email", "")).toThrow();
    expect(() => grantDetail("change_email", "not-an-email")).toThrow();
    expect(() => grantDetail("add_owner", undefined)).toThrow();
  });

  it("REAUTH-U11: issueGrant passes the canonical operation and refuses a bad one before calling the database", async () => {
    const f = fake();
    await issueGrant(f.deps, who.actorId, "change_email", target, " A@B.Test ");
    expect(f.calls.at(-1)!.args).toEqual([
      who.actorId,
      "change_email",
      target,
      "a@b.test",
    ]);
    await expect(
      issueGrant(f.deps, who.actorId, "set_active", target),
    ).rejects.toThrow();
    expect(f.calls.filter((c) => c.fn === "issue")).toHaveLength(1);
  });
});

describe("which grant belongs to which action (REAUTH-U12)", () => {
  const roles: Role[] = ["owner", "manager"];
  it("REAUTH-U12: a grant is asked for exactly when isProtectedAction says the password is required", () => {
    const actions = [
      "add_user",
      "edit_details",
      "change_role",
      "switch_off",
      "switch_on",
      "reset_password",
      "change_email",
    ] as const;
    for (const action of actions)
      for (const targetRole of roles)
        for (const newRole of [undefined, ...roles]) {
          const check = { action, targetRole, newRole };
          expect(grantActionFor(check) !== null, JSON.stringify(check)).toBe(
            isProtectedAction(check),
          );
        }
  });

  it("REAUTH-U13: each protected action maps to the grant name the database expects", () => {
    const expected: Array<[Parameters<typeof grantActionFor>[0], GrantAction]> =
      [
        [{ action: "add_user", targetRole: "owner" }, "add_owner"],
        [
          { action: "change_role", targetRole: "manager", newRole: "owner" },
          "change_role",
        ],
        [
          { action: "change_role", targetRole: "owner", newRole: "manager" },
          "change_role",
        ],
        [{ action: "switch_off", targetRole: "owner" }, "set_active"],
        [{ action: "switch_on", targetRole: "owner" }, "set_active"],
        [{ action: "reset_password", targetRole: "owner" }, "reset_password"],
        [{ action: "change_email", targetRole: "owner" }, "change_email"],
      ];
    for (const [check, grant] of expected)
      expect(grantActionFor(check), JSON.stringify(check)).toBe(grant);
    // never for a Manager account, or for editing a name
    expect(
      grantActionFor({ action: "switch_off", targetRole: "manager" }),
    ).toBeNull();
    expect(
      grantActionFor({ action: "edit_details", targetRole: "owner" }),
    ).toBeNull();
    expect(
      grantActionFor({ action: "add_user", targetRole: "manager" }),
    ).toBeNull();
  });
});
