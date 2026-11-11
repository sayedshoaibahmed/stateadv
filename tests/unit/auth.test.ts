import { describe, expect, it } from "vitest";
import {
  fieldErrors,
  forgotPasswordSchema,
  loginSchema,
  newPasswordSchema,
} from "@/lib/auth/schemas";
import {
  authErrorMessage,
  isPublicPath,
  proxyRedirect,
  safeNext,
} from "@/lib/auth/routes";

describe("login form", () => {
  it("AUTH-U1: trims and lower-cases the email", () => {
    const r = loginSchema.parse({
      email: "  Test@Example.COM ",
      password: "x",
    });
    expect(r.email).toBe("test@example.com");
  });
  it("AUTH-U2: rejects an empty or invalid email and an empty password", () => {
    for (const email of ["", "abc", "a@b", "a b@c.com"]) {
      expect(loginSchema.safeParse({ email, password: "x" }).success).toBe(
        false,
      );
    }
    const r = loginSchema.safeParse({ email: "a@b.com", password: "" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(fieldErrors(r.error).password).toMatch(/enter your password/);
    }
  });
  it("AUTH-U3: missing fields give friendly messages (no technical text)", () => {
    const r = loginSchema.safeParse({});
    expect(r.success).toBe(false);
    if (!r.success) {
      const e = fieldErrors(r.error);
      expect(e.email).toBe("Please enter your email address.");
      expect(e.password).toBe("Please enter your password.");
    }
  });
  it("AUTH-U4: forgot-password takes only an email", () => {
    expect(forgotPasswordSchema.safeParse({ email: "a@b.co" }).success).toBe(
      true,
    );
    expect(forgotPasswordSchema.safeParse({ email: "nope" }).success).toBe(
      false,
    );
  });
});

describe("new password form", () => {
  const ok = "correct-horse-battery";
  it("AUTH-U5: accepts a long password that matches", () => {
    expect(
      newPasswordSchema.safeParse({ password: ok, confirm: ok }).success,
    ).toBe(true);
  });
  it("AUTH-U6: rejects short, mismatching, too-long and very repetitive passwords", () => {
    const bad = [
      { password: "short1", confirm: "short1" },
      { password: ok, confirm: ok + "x" },
      { password: "a".repeat(73), confirm: "a".repeat(73) },
      { password: "aaaaaaaaaaaaaaaa", confirm: "aaaaaaaaaaaaaaaa" },
    ];
    for (const b of bad) {
      expect(newPasswordSchema.safeParse(b).success).toBe(false);
    }
  });
  it("AUTH-U7: the 72-byte limit counts bytes, not letters", () => {
    const p = "é".repeat(40); // 80 bytes
    expect(
      newPasswordSchema.safeParse({ password: p, confirm: p }).success,
    ).toBe(false);
  });
});

describe("where a visitor may go", () => {
  it("AUTH-U8: only the sign-in pages and email links are public", () => {
    for (const p of [
      "/login",
      "/forgot-password",
      "/auth/callback",
      "/auth/signout",
    ]) {
      expect(isPublicPath(p)).toBe(true);
    }
    for (const p of [
      "/",
      "/users",
      "/reset-password",
      "/change-password",
      "/loginx",
      "/authx",
    ]) {
      expect(isPublicPath(p)).toBe(false);
    }
  });
  it("AUTH-U9: signed-out visitors are sent to sign in and remembered", () => {
    expect(proxyRedirect("/", "", false)).toBe("/login");
    expect(proxyRedirect("/users", "?a=1", false)).toBe(
      "/login?next=%2Fusers%3Fa%3D1",
    );
    expect(proxyRedirect("/login", "", false)).toBeNull();
    expect(proxyRedirect("/users", "", true)).toBeNull();
  });
  it("AUTH-U10: 'next' cannot leave the app", () => {
    for (const bad of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "/ok\nx",
      "",
      null,
      undefined,
      42,
      "/login",
      "/" + "a".repeat(600),
    ]) {
      expect(safeNext(bad)).toBe("/");
    }
    expect(safeNext("/users?x=1")).toBe("/users?x=1");
  });
});

describe("error wording", () => {
  it("AUTH-U11: wrong email and wrong password give the same message", () => {
    expect(authErrorMessage("invalid_credentials")).toBe(
      authErrorMessage("user_not_found"),
    );
  });
  it("AUTH-U12: unknown codes give a safe general message", () => {
    expect(authErrorMessage("something_new")).toBe(
      "Something went wrong. Please try again.",
    );
    expect(authErrorMessage(undefined)).toMatch(/Something went wrong/);
  });
});
