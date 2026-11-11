"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser, type SessionUser } from "@/lib/auth/session";
import {
  fieldErrors,
  newPasswordSchema,
  type FieldErrors,
} from "@/lib/auth/schemas";
import { authErrorMessage } from "@/lib/auth/routes";
import { friendlyError } from "@/lib/errors";
import { verifyPassword } from "@/lib/accounts/password";
import {
  generateTempPassword,
  isProtectedAction,
  mayAttempt,
  type AccountAction,
  type Role,
} from "@/lib/accounts/rules";
import {
  addUserSchema,
  changeEmailSchema,
  changeRoleSchema,
  editUserSchema,
  optionalReason,
  ownEmailSchema,
  ownPasswordSchema,
  protectedFields,
  switchSchema,
} from "@/lib/accounts/schemas";

/** What an account form shows after it was sent. Passwords appear only in `tempPassword`, once. */
export interface AccountState {
  ok?: boolean;
  message?: string;
  errors?: FieldErrors;
  /** Temporary password for a new or reset account. Shown once to the person who did it. */
  tempPassword?: string;
}

const uuid = z.uuid({ error: "That person was not found." });
const text = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v : "";
};
const fail = (message: string, errors?: FieldErrors): AccountState => ({
  message,
  errors,
});

/**
 * The common gate for protected actions (O1-O3, O6): who may try it, a written reason of 10+
 * characters and the acting person's own password. Returns the reason to record, or an error.
 * The DATABASE re-checks who may do what; this adds what the database cannot see (the password).
 */
async function gate(
  actor: SessionUser,
  fd: FormData,
  action: AccountAction,
  targetRole: Role,
  newRole?: Role,
): Promise<{ reason?: string } | { error: AccountState }> {
  const check = { action, targetRole, newRole };
  if (!mayAttempt(actor.role, check)) {
    return { error: fail("Only an Owner can do this.") };
  }
  if (isProtectedAction(check)) {
    const p = protectedFields.safeParse({
      reason: text(fd, "reason"),
      actor_password: text(fd, "actor_password"),
    });
    if (!p.success)
      return { error: fail("Please check the form.", fieldErrors(p.error)) };
    if (!(await verifyPassword(actor.email, p.data.actor_password))) {
      return {
        error: fail("Please check the form.", {
          actor_password: "That password is not correct.",
        }),
      };
    }
    return { reason: p.data.reason };
  }
  const o = optionalReason.safeParse({ reason: text(fd, "reason") });
  return { reason: o.success ? o.data.reason : undefined };
}

/** Role of the person being acted on, read with the actor's own login (RLS). */
async function targetProfile(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_profiles")
    .select("id, full_name, email, role, is_active")
    .eq("id", id)
    .maybeSingle();
  return data as {
    id: string;
    full_name: string;
    email: string;
    role: Role;
    is_active: boolean;
  } | null;
}

// ------------------------------------------------------------------ add user
export async function addUser(
  _prev: AccountState | undefined,
  fd: FormData,
): Promise<AccountState> {
  const actor = await requireUser();
  const parsed = addUserSchema.safeParse({
    full_name: text(fd, "full_name"),
    email: text(fd, "email"),
    phone: text(fd, "phone"),
    role: text(fd, "role"),
  });
  if (!parsed.success)
    return fail("Please check the form.", fieldErrors(parsed.error));
  const { full_name, email, phone, role } = parsed.data;

  const g = await gate(actor, fd, "add_user", role);
  if ("error" in g) return g.error;

  const admin = createAdminClient();
  const tempPassword = generateTempPassword();
  // 1. the login (Supabase Auth). Email is marked confirmed: there is no invitation email in version 1 (O6).
  const created = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    return created.error?.code === "email_exists"
      ? fail("Please check the form.", {
          email: "An account with this email already exists.",
        })
      : fail(authErrorMessage(created.error?.code));
  }
  // 2. the profile + every rule (database). If it refuses, the new login is removed again.
  const supabase = await createClient();
  const { error } = await supabase.rpc("profile_create", {
    p_id: created.data.user.id,
    p_full_name: full_name,
    p_email: email,
    p_role: role,
    p_phone: phone ?? null,
    p_reason: g.reason ?? null,
  });
  if (error) {
    await admin.auth.admin.deleteUser(created.data.user.id);
    return fail(friendlyError(error));
  }
  return {
    ok: true,
    message: `${full_name} can now sign in with this temporary password. It is shown only once.`,
    tempPassword,
  };
}

// ----------------------------------------------------------- edit name / phone
export async function editUser(
  _prev: AccountState | undefined,
  fd: FormData,
): Promise<AccountState> {
  await requireUser();
  const id = uuid.safeParse(text(fd, "id"));
  const parsed = editUserSchema.safeParse({
    full_name: text(fd, "full_name"),
    phone: text(fd, "phone"),
  });
  if (!id.success) return fail(id.error.issues[0].message);
  if (!parsed.success)
    return fail("Please check the form.", fieldErrors(parsed.error));
  const supabase = await createClient();
  const { error } = await supabase.rpc("profile_update", {
    p_id: id.data,
    p_full_name: parsed.data.full_name,
    p_phone: parsed.data.phone ?? "",
    p_role: null,
    p_reason: null,
  });
  return error ? fail(friendlyError(error)) : { ok: true, message: "Saved." };
}

// ----------------------------------------------------------------- change role
export async function changeRole(
  _prev: AccountState | undefined,
  fd: FormData,
): Promise<AccountState> {
  const actor = await requireUser();
  const id = uuid.safeParse(text(fd, "id"));
  const parsed = changeRoleSchema.safeParse({ role: text(fd, "role") });
  if (!id.success) return fail(id.error.issues[0].message);
  if (!parsed.success)
    return fail("Please check the form.", fieldErrors(parsed.error));
  const target = await targetProfile(id.data);
  if (!target) return fail("That person was not found.");
  if (target.id === actor.id) return fail("You cannot change your own role.");
  if (target.role === parsed.data.role)
    return { ok: true, message: "Nothing to change." };

  const g = await gate(actor, fd, "change_role", target.role, parsed.data.role);
  if ("error" in g) return g.error;
  // Role changes always carry a written reason (also for Manager -> Manager style label changes).
  const reason = g.reason ?? text(fd, "reason").trim();
  const supabase = await createClient();
  const { error } = await supabase.rpc("profile_update", {
    p_id: id.data,
    p_full_name: null,
    p_phone: null,
    p_role: parsed.data.role,
    p_reason: reason,
  });
  return error
    ? fail(friendlyError(error))
    : { ok: true, message: "The role was changed." };
}

// ------------------------------------------------------ switch off / switch on
export async function setUserActive(
  _prev: AccountState | undefined,
  fd: FormData,
): Promise<AccountState> {
  const actor = await requireUser();
  const id = uuid.safeParse(text(fd, "id"));
  const sw = switchSchema.safeParse({ active: text(fd, "active") });
  if (!id.success) return fail(id.error.issues[0].message);
  if (!sw.success) return fail("Please check the form.");
  const target = await targetProfile(id.data);
  if (!target) return fail("That person was not found.");
  if (id.data === actor.id && !sw.data.active)
    return fail("You cannot switch off your own account.");

  const g = await gate(
    actor,
    fd,
    sw.data.active ? "switch_on" : "switch_off",
    target.role,
  );
  if ("error" in g) return g.error;

  const supabase = await createClient();
  // 1. database rules + record (blocks the account's data access at once)
  const { error } = await supabase.rpc("profile_set_active", {
    p_id: id.data,
    p_active: sw.data.active,
    p_reason: g.reason ?? null,
  });
  if (error) return fail(friendlyError(error));
  // 2. Supabase Auth: stop (or allow) sign-in. If this fails, undo step 1 so both sides agree.
  const admin = createAdminClient();
  const res = await admin.auth.admin.updateUserById(id.data, {
    ban_duration: sw.data.active ? "none" : "876000h",
  });
  if (res.error) {
    const { error: undo } = await supabase.rpc("profile_set_active", {
      p_id: id.data,
      p_active: !sw.data.active,
      p_reason: "Undo: the sign-in could not be updated",
    });
    return fail(
      undo
        ? "The account was changed only partly. Please ask for help and check the Users page."
        : "We could not finish. Nothing was changed. Please try again.",
    );
  }
  return {
    ok: true,
    message: sw.data.active
      ? "The account is switched on."
      : "The account is switched off.",
  };
}

// -------------------------------------------------------------- reset password
export async function resetUserPassword(
  _prev: AccountState | undefined,
  fd: FormData,
): Promise<AccountState> {
  const actor = await requireUser();
  const id = uuid.safeParse(text(fd, "id"));
  if (!id.success) return fail(id.error.issues[0].message);
  const target = await targetProfile(id.data);
  if (!target) return fail("That person was not found.");
  if (target.id === actor.id)
    return fail("To change your own password, use My Account.");

  const g = await gate(actor, fd, "reset_password", target.role);
  if ("error" in g) return g.error;

  const supabase = await createClient();
  const { error } = await supabase.rpc("profile_reset_password", {
    p_target: id.data,
    p_reason: g.reason ?? null,
  });
  if (error) return fail(friendlyError(error));
  const tempPassword = generateTempPassword();
  const res = await createAdminClient().auth.admin.updateUserById(id.data, {
    password: tempPassword,
  });
  if (res.error)
    return fail(
      "We could not set the new password. The old password still works. Please try again.",
    );
  return {
    ok: true,
    message: `${target.full_name} must choose their own password at the next sign-in. Give them this temporary password. It is shown only once.`,
    tempPassword,
  };
}

// ------------------------------------------------------ change ANOTHER person's email
export async function changeUserEmail(
  _prev: AccountState | undefined,
  fd: FormData,
): Promise<AccountState> {
  const actor = await requireUser();
  const id = uuid.safeParse(text(fd, "id"));
  const parsed = changeEmailSchema.safeParse({
    new_email: text(fd, "new_email"),
  });
  if (!id.success) return fail(id.error.issues[0].message);
  if (!parsed.success)
    return fail("Please check the form.", fieldErrors(parsed.error));
  const target = await targetProfile(id.data);
  if (!target) return fail("That person was not found.");
  if (target.id === actor.id)
    return fail("To change your own email, use My Account.");

  // Changing someone's email needs a reason of 10+ characters for everyone (the database requires it);
  // for an Owner account the acting Owner's password is also required (O1, O3).
  const reasonCheck = protectedFields.shape.reason.safeParse(
    text(fd, "reason"),
  );
  if (!reasonCheck.success)
    return fail("Please check the form.", {
      reason: reasonCheck.error.issues[0].message,
    });
  const g = await gate(actor, fd, "change_email", target.role);
  if ("error" in g) return g.error;

  const supabase = await createClient();
  const { error } = await supabase.rpc("profile_change_email", {
    p_id: id.data,
    p_new_email: parsed.data.new_email,
    p_reason: reasonCheck.data,
  });
  if (error) return fail(friendlyError(error));
  const res = await createAdminClient().auth.admin.updateUserById(id.data, {
    email: parsed.data.new_email,
    email_confirm: true,
  });
  if (res.error) {
    const { error: undo } = await supabase.rpc("profile_change_email", {
      p_id: id.data,
      p_new_email: target.email,
      p_reason: "Undo: the login email could not be updated",
    });
    return fail(
      undo
        ? "The email was changed only partly. Please ask for help."
        : "We could not finish. Nothing was changed. Please try again.",
    );
  }
  return {
    ok: true,
    message: "The email was changed. The person signs in with the new address.",
  };
}

// ============================================================ My Account ======
/** Change my own password: current password first, then the new one (twice). */
export async function changeOwnPassword(
  _prev: AccountState | undefined,
  fd: FormData,
): Promise<AccountState> {
  const actor = await requireUser();
  const cur = ownPasswordSchema.safeParse({
    current_password: text(fd, "current_password"),
  });
  const next = newPasswordSchema.safeParse({
    password: text(fd, "password"),
    confirm: text(fd, "confirm"),
  });
  if (!cur.success || !next.success) {
    return fail("Please check the form.", {
      ...(cur.success ? {} : fieldErrors(cur.error)),
      ...(next.success ? {} : fieldErrors(next.error)),
    });
  }
  if (!(await verifyPassword(actor.email, cur.data.current_password))) {
    return fail("Please check the form.", {
      current_password: "That password is not correct.",
    });
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    password: next.data.password,
  });
  if (error) return fail(authErrorMessage(error.code));
  await supabase.auth.signOut({ scope: "others" });
  return {
    ok: true,
    message: "Your password was changed. Other devices were signed out.",
  };
}

/**
 * Change my own email (O7, FR-AUTH-16): current password first, then Supabase Auth sends the confirmation
 * link(s). NOTHING changes until every required link is used: the login email and the profile stay as they are.
 */
export async function changeOwnEmail(
  _prev: AccountState | undefined,
  fd: FormData,
): Promise<AccountState> {
  const actor = await requireUser();
  const parsed = ownEmailSchema.safeParse({
    current_password: text(fd, "current_password"),
    new_email: text(fd, "new_email"),
  });
  if (!parsed.success)
    return fail("Please check the form.", fieldErrors(parsed.error));
  if (parsed.data.new_email === actor.email)
    return fail("Please check the form.", {
      new_email: "That is already your email.",
    });
  if (!(await verifyPassword(actor.email, parsed.data.current_password))) {
    return fail("Please check the form.", {
      current_password: "That password is not correct.",
    });
  }
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser(
    { email: parsed.data.new_email },
    host ? { emailRedirectTo: `${proto}://${host}/account` } : undefined,
  );
  if (error) return fail(authErrorMessage(error.code));
  return {
    ok: true,
    message:
      "We sent a link to the new address and, for safety, to your current address too. Your email changes only after you open every link. Until then, keep signing in with your current email.",
  };
}
