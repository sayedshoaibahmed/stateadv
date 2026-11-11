import { z } from "zod";

/**
 * Form rules for the sign-in screens. Plain English messages only: the
 * managers using this app are not technical.
 * Used by the browser form (quick feedback) AND again by the server action
 * (the real check). Never trust the browser alone.
 */

export const PASSWORD_MIN = 12;
// Supabase hashes passwords with bcrypt, which ignores everything after 72 bytes.
export const PASSWORD_MAX_BYTES = 72;

export const emailField = z
  .string({ error: "Please enter your email address." })
  .trim()
  .toLowerCase()
  .min(1, "Please enter your email address.")
  .max(254, "That email address is too long.")
  .pipe(z.email("That does not look like an email address."));

export const loginSchema = z.object({
  email: emailField,
  password: z
    .string({ error: "Please enter your password." })
    .min(1, "Please enter your password.")
    .max(200, "That password is too long."),
});

export const forgotPasswordSchema = z.object({ email: emailField });

export const newPasswordSchema = z
  .object({
    password: z
      .string({ error: "Please choose a new password." })
      .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
      .refine(
        (v) => new TextEncoder().encode(v).length <= PASSWORD_MAX_BYTES,
        "That password is too long. Use fewer than 72 characters.",
      ),
    confirm: z.string({ error: "Please type the new password again." }),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "The two passwords are not the same.",
  })
  .refine((v) => new Set(v.password).size >= 5, {
    path: ["password"],
    message: "Please choose a password that is harder to guess.",
  });

export type FieldErrors = Record<string, string>;

/** First message per field, as { email: "...", password: "..." }. */
export function fieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
