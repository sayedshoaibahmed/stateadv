import { describe, expect, it } from "vitest";
import {
  describeOwnerEvent,
  generateTempPassword,
  isProtectedAction,
  mayAttempt,
  type AuditRow,
} from "@/lib/accounts/rules";
import {
  addUserSchema,
  protectedFields,
  switchSchema,
} from "@/lib/accounts/schemas";
import { newPasswordSchema } from "@/lib/auth/schemas";

describe("which account actions are protected (O1, O2, O3, O6)", () => {
  it("ACU-01: every change to an Owner account except editing the name/phone is protected", () => {
    for (const action of [
      "switch_off",
      "switch_on",
      "reset_password",
      "change_email",
      "change_role",
    ] as const) {
      expect(isProtectedAction({ action, targetRole: "owner" }), action).toBe(
        true,
      );
    }
    expect(
      isProtectedAction({ action: "edit_details", targetRole: "owner" }),
    ).toBe(false);
  });
  it("ACU-02: the same actions on a Manager are not protected", () => {
    for (const action of [
      "switch_off",
      "switch_on",
      "reset_password",
      "change_email",
      "edit_details",
      "add_user",
    ] as const) {
      expect(isProtectedAction({ action, targetRole: "manager" }), action).toBe(
        false,
      );
    }
  });
  it("ACU-03: adding an Owner (O6) and promoting to Owner (O2) are protected", () => {
    expect(isProtectedAction({ action: "add_user", targetRole: "owner" })).toBe(
      true,
    );
    expect(
      isProtectedAction({
        action: "change_role",
        targetRole: "manager",
        newRole: "owner",
      }),
    ).toBe(true);
    expect(
      isProtectedAction({
        action: "change_role",
        targetRole: "manager",
        newRole: "manager",
      }),
    ).toBe(false);
  });
  it("ACU-04: a Manager may not even attempt protected actions; an Owner may", () => {
    expect(
      mayAttempt("manager", { action: "switch_off", targetRole: "owner" }),
    ).toBe(false);
    expect(
      mayAttempt("manager", { action: "add_user", targetRole: "owner" }),
    ).toBe(false);
    expect(
      mayAttempt("manager", {
        action: "change_role",
        targetRole: "manager",
        newRole: "owner",
      }),
    ).toBe(false);
    expect(
      mayAttempt("manager", { action: "switch_off", targetRole: "manager" }),
    ).toBe(true);
    expect(
      mayAttempt("owner", { action: "switch_off", targetRole: "owner" }),
    ).toBe(true);
  });
});

describe("temporary passwords", () => {
  it("ACU-05: strong, readable, different every time and acceptable to the password rules", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = generateTempPassword();
      expect(p).toHaveLength(16);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[2-9]/);
      expect(p).not.toMatch(/[01OIl]/); // no look-alike characters
      expect(
        newPasswordSchema.safeParse({ password: p, confirm: p }).success,
      ).toBe(true);
      seen.add(p);
    }
    expect(seen.size).toBe(200);
  });
});

describe("user forms", () => {
  it("ACU-06: add user: trims, lower-cases the email, rejects bad input", () => {
    const ok = addUserSchema.parse({
      full_name: "  Test Person ",
      email: " A@B.Co ",
      role: "manager",
    });
    expect(ok).toMatchObject({
      full_name: "Test Person",
      email: "a@b.co",
      role: "manager",
    });
    for (const bad of [
      { full_name: "", email: "a@b.co", role: "manager" },
      { full_name: "T", email: "nope", role: "manager" },
      { full_name: "T", email: "a@b.co", role: "admin" },
      { full_name: "T", email: "a@b.co" },
    ]) {
      expect(addUserSchema.safeParse(bad).success).toBe(false);
    }
  });
  it("ACU-07: a protected action needs a reason of 10+ characters and the password", () => {
    expect(
      protectedFields.safeParse({ reason: "too short", actor_password: "x" })
        .success,
    ).toBe(false);
    expect(
      protectedFields.safeParse({
        reason: "long enough reason",
        actor_password: "",
      }).success,
    ).toBe(false);
    expect(
      protectedFields.safeParse({
        reason: "long enough reason",
        actor_password: "x",
      }).success,
    ).toBe(true);
  });
  it("ACU-08: switch on/off accepts only true or false", () => {
    expect(switchSchema.parse({ active: "false" }).active).toBe(false);
    expect(switchSchema.safeParse({ active: "maybe" }).success).toBe(false);
  });
});

describe("dashboard alerts about Owner accounts (FR-AUTH-12)", () => {
  const base: AuditRow = {
    action: "update",
    actor_name: "Sunita Rao",
    occurred_at: "2026-11-11T10:00:00Z",
    reason: "Left the company",
    changed_fields: ["is_active"],
    old_data: { role: "owner", is_active: true },
    new_data: { role: "owner", is_active: false, full_name: "Ravi Kumar" },
  };
  it("ACU-09: switched off", () => {
    expect(describeOwnerEvent(base)).toBe(
      "Owner account Ravi Kumar was switched off by Sunita Rao. Reason: Left the company",
    );
  });
  it("ACU-10: switched on, password reset, new Owner, recovered", () => {
    expect(
      describeOwnerEvent({
        ...base,
        new_data: { ...base.new_data!, is_active: true },
      }),
    ).toContain("switched on");
    expect(
      describeOwnerEvent({
        ...base,
        action: "password_reset",
        changed_fields: null,
      }),
    ).toContain("password of Owner account Ravi Kumar was reset by Sunita Rao");
    expect(
      describeOwnerEvent({ ...base, action: "insert", changed_fields: null }),
    ).toContain("A new Owner account, Ravi Kumar, was added");
    expect(
      describeOwnerEvent({
        ...base,
        action: "owner_recovered",
        actor_name: null,
      }),
    ).toContain("recovered by the server script");
  });
  it("ACU-11: role changes and email changes (including a verified own-email change)", () => {
    const promoted = {
      ...base,
      changed_fields: ["role"],
      old_data: { role: "manager" },
      new_data: { role: "owner", full_name: "Ravi Kumar" },
    };
    expect(describeOwnerEvent(promoted)).toContain(
      "was made an Owner by Sunita Rao",
    );
    const demoted = {
      ...base,
      changed_fields: ["role"],
      old_data: { role: "owner" },
      new_data: { role: "manager", full_name: "Ravi Kumar" },
    };
    expect(describeOwnerEvent(demoted)).toContain("no longer an Owner");
    const byOther = {
      ...base,
      changed_fields: ["email"],
      new_data: { role: "owner", full_name: "Ravi Kumar" },
    };
    expect(describeOwnerEvent(byOther)).toContain(
      "email of Owner account Ravi Kumar was changed by Sunita Rao",
    );
    expect(describeOwnerEvent({ ...byOther, actor_name: null })).toContain(
      "after confirming the link",
    );
  });
  it("ACU-12: events about Managers or plain name edits produce no alert", () => {
    const manager = {
      ...base,
      old_data: { role: "manager" },
      new_data: { role: "manager", full_name: "Mina", is_active: false },
    };
    expect(describeOwnerEvent(manager)).toBeNull();
    expect(
      describeOwnerEvent({ ...base, changed_fields: ["full_name"] }),
    ).toBeNull();
    expect(
      describeOwnerEvent({ ...manager, action: "password_reset" }),
    ).toBeNull();
  });
});
