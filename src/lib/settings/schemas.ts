import { z } from "zod";

/**
 * Form rules for Settings (C/O categories and names, resorts, stay types). Plain English messages.
 * The database checks everything again; these give quick, friendly feedback and are used by the server actions.
 */
const text = (label: string, max: number) =>
  z
    .string({ error: `Please enter ${label}.` })
    .trim()
    .min(1, `Please enter ${label}.`)
    .max(max, `That is too long (at most ${max} characters).`);

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `That is too long (at most ${max} characters).`)
    .optional()
    .transform((v) => (v ? v : undefined));

/** A checkbox: present = on. */
export const checkbox = z
  .string()
  .optional()
  .transform((v) => v === "on" || v === "true");

const smallId = z.coerce.number().int().positive().max(32767);

export const coCategorySchema = z.object({
  id: smallId.optional(),
  name: text("the category name", 60),
  name_mode: z.enum(["listed", "typed", "none"], {
    error: "Please choose how bookings use this category.",
  }),
  active: checkbox,
});

export const coEntrySchema = z.object({
  id: z.uuid().optional(),
  category_id: smallId,
  name: text("the name", 120),
  mobile: optional(20),
  notes: optional(500),
  active: checkbox,
});

export const resortSchema = z.object({
  id: z.uuid().optional(),
  code: z
    .string({ error: "Please enter the resort code." })
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{2,10}$/, "Use 2 to 10 letters or numbers, no spaces."),
  name: text("the resort name", 120),
  location: optional(200),
  contact_number: optional(40),
});

export const stayTypeSchema = z.object({
  id: smallId.optional(),
  name: text("the stay type name", 60),
  active: checkbox,
});

/** FormData → plain object (empty ids dropped). */
export function formToObject(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v === "string" && !(k === "id" && v === "")) out[k] = v;
  }
  return out;
}
