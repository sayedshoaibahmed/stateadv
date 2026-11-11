import { z } from "zod";
import { emailField } from "@/lib/auth/schemas";
import { PROTECTED_REASON_MIN } from "@/lib/accounts/rules";

/** Form rules for user management. Plain English; the server action checks them again. */

const name = z
  .string({ error: "Please enter the full name." })
  .trim()
  .min(1, "Please enter the full name.")
  .max(120, "That name is too long.");

const phone = z
  .string()
  .trim()
  .max(20, "That phone number is too long.")
  .optional()
  .transform((v) => (v ? v : undefined));

const role = z.enum(["owner", "manager"], {
  error: "Please choose Owner or Manager.",
});

const reason = (min: number) =>
  z
    .string({ error: "Please write a reason." })
    .trim()
    .min(
      min,
      min > 1
        ? `Please write at least ${min} characters.`
        : "Please write a reason.",
    )
    .max(500, "That reason is too long.");

/** The acting person's own password, typed again (O3). */
export const actorPassword = z
  .string({ error: "Please type your own password." })
  .min(1, "Please type your own password.")
  .max(200);

export const addUserSchema = z.object({
  full_name: name,
  email: emailField,
  phone,
  role,
});

export const editUserSchema = z.object({ full_name: name, phone });

export const changeRoleSchema = z.object({ role });

export const switchSchema = z.object({
  active: z.enum(["true", "false"]).transform((v) => v === "true"),
});

export const protectedFields = z.object({
  reason: reason(PROTECTED_REASON_MIN),
  actor_password: actorPassword,
});

export const optionalReason = z.object({
  reason: z
    .string()
    .trim()
    .max(500, "That reason is too long.")
    .optional()
    .transform((v) => (v ? v : undefined)),
});

export const changeEmailSchema = z.object({
  new_email: emailField,
});

/** My Account: change own password (current password is checked against Supabase Auth). */
export const ownPasswordSchema = z.object({
  current_password: z
    .string()
    .min(1, "Please type your current password.")
    .max(200),
});

export const ownEmailSchema = z.object({
  current_password: z
    .string()
    .min(1, "Please type your current password.")
    .max(200),
  new_email: emailField,
});
