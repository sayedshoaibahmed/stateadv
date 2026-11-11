"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  fieldErrors,
  forgotPasswordSchema,
  loginSchema,
  newPasswordSchema,
  type FieldErrors,
} from "@/lib/auth/schemas";
import { authErrorMessage, safeNext } from "@/lib/auth/routes";
import { requireUser } from "@/lib/auth/session";

/** What a form shows after it was sent. Never contains a password. */
export interface FormState {
  ok?: boolean;
  message?: string;
  errors?: FieldErrors;
  email?: string;
}

function text(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

// ---------------------------------------------------------------- sign in
export async function login(
  _prev: FormState | undefined,
  formData: FormData,
): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: text(formData, "email"),
    password: text(formData, "password"),
  });
  if (!parsed.success) {
    return {
      errors: fieldErrors(parsed.error),
      email: text(formData, "email").trim(),
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return { message: authErrorMessage(error.code), email: parsed.data.email };
  }

  // A correct password is not enough: the account must also be active.
  // (Row-level security returns no profile for a switched-off account.)
  const { data: authUser } = await supabase.auth.getUser();
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("id")
    .eq("id", authUser.user?.id ?? "")
    .maybeSingle();
  if (!profile) {
    await supabase.auth.signOut();
    return {
      message: "This account cannot be used. Please ask the owner.",
      email: parsed.data.email,
    };
  }

  redirect(safeNext(text(formData, "next")));
}

// --------------------------------------------------------------- sign out
export async function logout(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login?reason=signed-out");
}

// -------------------------------------------------------- forgot password
const RESET_SENT: FormState = {
  ok: true,
  message:
    "If this email belongs to an Owner account, we have sent a link to it. The link works once and soon expires. Managers should ask an Owner to reset their password.",
};

/**
 * "Forgot password" is for Owner accounts only (PRD FR-AUTH-13.1). The answer
 * is always the same, so nobody can use this form to find out which email
 * addresses have accounts.
 */
export async function requestPasswordReset(
  _prev: FormState | undefined,
  formData: FormData,
): Promise<FormState> {
  const parsed = forgotPasswordSchema.safeParse({
    email: text(formData, "email"),
  });
  if (!parsed.success) {
    return {
      errors: fieldErrors(parsed.error),
      email: text(formData, "email").trim(),
    };
  }
  const { email } = parsed.data;

  // Narrow, server-only use of the secret key (SECURITY.md section 4): look up
  // whether this address is an active Owner. The result never leaves this function.
  let isActiveOwner = false;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("user_profiles")
      .select("role, is_active")
      .eq("email", email)
      .maybeSingle();
    isActiveOwner = data?.role === "owner" && data.is_active === true;
  } catch {
    // Secret key missing or lookup failed: behave as "not an Owner".
    isActiveOwner = false;
  }

  if (isActiveOwner) {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "https";
    if (host) {
      const supabase = await createClient();
      // Supabase only accepts addresses on its own allow-list, so a forged
      // host header cannot send the link anywhere else.
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${proto}://${host}/auth/callback?next=/reset-password`,
      });
    }
  }
  return { ...RESET_SENT, email };
}

// ------------------------------------------------- choose a new password
/**
 * Used after a password-reset link and for the forced change of a temporary
 * password. Needs a genuine session (the email link or the temporary login).
 */
export async function setNewPassword(
  _prev: FormState | undefined,
  formData: FormData,
): Promise<FormState> {
  await requireUser({ allowPasswordChange: true });

  const parsed = newPasswordSchema.safeParse({
    password: text(formData, "password"),
    confirm: text(formData, "confirm"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) return { message: authErrorMessage(error.code) };

  const { error: flagError } = await supabase.rpc("complete_password_change");
  if (flagError) {
    return {
      message:
        "Your password was changed, but we could not finish. Please sign in again with the new password.",
    };
  }
  // Any other device that was signed in with the old password is signed out.
  await supabase.auth.signOut({ scope: "others" });
  redirect("/");
}
