import { z } from "zod";

/**
 * Shape checks for what the booking screens send to the server (server actions receive plain objects from the browser,
 * so every value is checked again before it is used). The business rules are in form.ts / plan.ts / cancel.ts and,
 * finally, in the database. Plain English messages.
 */
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Please choose a date.");
const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Please enter a time like 14:00.");
const short = (max: number) =>
  z.string().max(max, `That is too long (at most ${max} characters).`);
const uuid = z.uuid("That choice is not valid.");

const planRow = z.object({
  label: short(60),
  dueDate: z.string().max(10),
  amount: short(20),
});

export const bookingFormSchema = z.object({
  resortId: z.union([uuid, z.literal("")]),
  guestId: uuid.nullable(),
  guestName: short(120),
  guestMobile: short(30),
  guestEmail: short(200),
  stayTypeId: z.union([z.string().regex(/^\d{1,5}$/), z.literal("")]),
  bookingDate: date,
  checkInDate: z.union([date, z.literal("")]),
  checkInTime: time,
  checkOutDate: z.union([date, z.literal("")]),
  checkOutTime: time,
  pax: short(6),
  coCategoryId: z.union([z.string().regex(/^\d{1,5}$/), z.literal("")]),
  coEntryId: uuid.nullable(),
  coName: short(120),
  pricingMethod: z.enum(["per_person_per_night", "per_person_per_stay", ""]),
  tariff: short(20),
  extra: short(20),
  extraNote: short(200),
  discount: short(20),
  changeFinal: z.boolean(),
  finalOverride: short(20),
  adjustmentReason: short(300),
  plan: z.array(planRow).max(24, "A payment plan can have at most 24 rows."),
  remarks: short(1000),
  changeReason: short(300),
});

export const saveNewBookingSchema = z.object({
  values: bookingFormSchema,
  idempotencyKey: uuid,
});

export const saveEditBookingSchema = z.object({
  bookingId: uuid,
  expectedVersion: z.number().int().min(1),
  values: bookingFormSchema,
  /** the plan is sent only when the plan section was used; null = leave the plan as it is */
  sendPlan: z.boolean(),
  movePaise: z.number().int().min(0).max(1_000_000_000_000_000),
});

export const statusSchema = z.object({
  bookingId: uuid,
  expectedVersion: z.number().int().min(1),
  status: z.enum(["confirmed", "checked_in", "checked_out"]),
  reason: short(300).optional(),
});

export const cancelSchema = z.object({
  bookingId: uuid,
  expectedVersion: z.number().int().min(1),
  kind: z.enum(["cancelled", "no_show"]),
  date,
  charge: short(20),
  reason: short(300),
  chargeChangeReason: short(300),
  plan: z.array(planRow).max(24),
});

export const chargeChangeSchema = z.object({
  bookingId: uuid,
  expectedVersion: z.number().int().min(1),
  charge: short(20),
  reason: short(300),
  plan: z.array(planRow).max(24),
});

export const planChangeSchema = z.object({
  bookingId: uuid,
  expectedVersion: z.number().int().min(1),
  reason: short(300),
  movePaise: z.number().int().min(0).max(1_000_000_000_000_000),
  plan: z.array(planRow).max(24),
});

export const guestFormSchema = z.object({
  id: uuid.optional(),
  fullName: short(120),
  mobile: short(30),
  email: short(200),
  address: short(300),
  notes: short(1000),
});
