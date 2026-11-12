"use server";

import { revalidatePath } from "next/cache";
import { fieldErrors, type FieldErrors } from "@/lib/auth/schemas";
import { requireUser } from "@/lib/auth/session";
import {
  cancelBooking,
  changeCancellationCharge,
  createBooking,
  planPreview,
  setBookingStatus,
  setPaymentSchedule,
  updateBooking,
  upsertCoEntry,
  upsertGuest,
  upsertProvider,
} from "@/lib/db/actions";
import type { Result } from "@/lib/db/call";
import { schedulePdf } from "@/lib/pdf/schedule";
import { createClient } from "@/lib/supabase/server";
import { todayIst } from "@/lib/dates";
import { checkCancel, parseCharge } from "@/lib/bookings/cancel";
import {
  buildPayload,
  buildPlanRows,
  previewAmounts,
  validateBooking,
} from "@/lib/bookings/form";
import {
  checkEditPlan,
  isPlanPreview,
  type PlanPreview,
} from "@/lib/bookings/plan";
import {
  cancelSchema,
  chargeChangeSchema,
  guestFormSchema,
  planChangeSchema,
  saveEditBookingSchema,
  saveNewBookingSchema,
  statusSchema,
} from "@/lib/bookings/schemas";

/**
 * Server actions for the booking, guest and payment-app screens (M4). Each one:
 *  1. checks on the server that the caller is a signed-in, active user;
 *  2. re-validates what the browser sent (shape with zod, then the same plain rules the form uses);
 *  3. calls the database function with THE USER'S OWN LOGIN (never the secret key).
 * The database checks everything again, recalculates every amount and enforces every business rule. Messages are plain
 * English; no database detail is ever shown. Money is whole paise.
 */
export type ActionResult<T extends object = object> =
  | ({ ok: true; message?: string } & T)
  | { ok: false; message: string; errors?: Record<string, string> };

const fail = (message: string, errors?: Record<string, string>) => ({
  ok: false as const,
  message,
  errors,
});
const CHECK = "Please check the form.";

function asFail(r: Extract<Result<unknown>, { ok: false }>) {
  return fail(r.message);
}

const zodFail = (e: import("zod").ZodError) => fail(CHECK, fieldErrors(e));

// ------------------------------------------------------------------ bookings
export async function createBookingAction(
  input: unknown,
): Promise<ActionResult<{ id: string; code: string; duplicate: boolean }>> {
  await requireUser();
  const p = saveNewBookingSchema.safeParse(input);
  if (!p.success) return zodFail(p.error);
  const errors = validateBooking(p.data.values, { mode: "create" });
  if (Object.keys(errors).length > 0)
    return fail(CHECK, errors as Record<string, string>);
  const { payload, plan } = buildPayload(p.data.values, "create");
  const r = await createBooking(payload, plan, p.data.idempotencyKey);
  if (!r.ok) return asFail(r);
  const d = r.data as { id: string; booking_code: string; duplicate?: boolean };
  schedulePdf(d.id);
  revalidatePath("/bookings");
  return {
    ok: true,
    id: d.id,
    code: d.booking_code,
    duplicate: d.duplicate === true,
    message: `Booking ${d.booking_code} saved.`,
  };
}

/** The booking as the database holds it, for the checks below (read as the signed-in user: RLS applies). */
async function currentBooking(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("bookings")
    .select(
      "id, version, status, final_amount_paise, amount_due_paise, cancellation_charge_paise",
    )
    .eq("id", id)
    .maybeSingle();
  return data;
}

export async function planPreviewAction(
  bookingId: string,
  newAmountDuePaise: number | null,
): Promise<ActionResult<{ preview: PlanPreview }>> {
  await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(bookingId))
    return fail("That booking was not found.");
  if (
    newAmountDuePaise !== null &&
    (!Number.isSafeInteger(newAmountDuePaise) || newAmountDuePaise < 0)
  ) {
    return fail("That amount is not valid.");
  }
  const r = await planPreview(bookingId, newAmountDuePaise ?? undefined);
  if (!r.ok) return asFail(r);
  if (!isPlanPreview(r.data))
    return fail("We could not work out the plan. Please try again.");
  return { ok: true, preview: r.data };
}

export async function updateBookingAction(
  input: unknown,
): Promise<ActionResult<{ version: number }>> {
  await requireUser();
  const p = saveEditBookingSchema.safeParse(input);
  if (!p.success) return zodFail(p.error);
  const { bookingId, expectedVersion, values, sendPlan, movePaise } = p.data;
  const cur = await currentBooking(bookingId);
  if (!cur) return fail("We could not find that booking.");
  if (cur.status === "cancelled" || cur.status === "no_show") {
    return fail(
      "A cancelled booking cannot be edited. Its charge can be changed from the booking page.",
    );
  }
  const a = previewAmounts(values);
  const amountChanged = a.ok && a.finalPaise !== cur.final_amount_paise;
  const errors = validateBooking(values, { mode: "edit", amountChanged });
  if (Object.keys(errors).length > 0)
    return fail(CHECK, errors as Record<string, string>);
  const { payload, plan } = buildPayload(values, "edit");

  let planRows: ReturnType<typeof buildPlanRows> | undefined;
  if (sendPlan || amountChanged || movePaise > 0) {
    const pv = await planPreview(bookingId, a.ok ? a.finalPaise : undefined);
    if (!pv.ok) return asFail(pv);
    if (!isPlanPreview(pv.data))
      return fail("We could not work out the plan. Please try again.");
    const c = checkEditPlan(pv.data, values.plan, {
      movePaise,
      reason: values.changeReason,
    });
    if (c.problems.length > 0)
      return fail(c.problems[0], { plan: c.problems[0] });
    planRows = plan;
  }
  const r = await updateBooking(bookingId, expectedVersion, payload, {
    plan: planRows,
    moveOverduePaise: movePaise,
    reason:
      values.changeReason.trim() === ""
        ? undefined
        : values.changeReason.trim(),
  });
  if (!r.ok) return asFail(r);
  revalidatePath("/bookings");
  revalidatePath(`/bookings/${bookingId}`);
  const d = r.data as { version?: number };
  schedulePdf(bookingId);
  return {
    ok: true,
    version: d.version ?? expectedVersion + 1,
    message: "The booking was saved.",
  };
}

export async function setStatusAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const p = statusSchema.safeParse(input);
  if (!p.success) return zodFail(p.error);
  const r = await setBookingStatus(
    p.data.bookingId,
    p.data.expectedVersion,
    p.data.status,
    p.data.reason?.trim() || undefined,
  );
  if (!r.ok) return asFail(r);
  revalidatePath("/bookings");
  revalidatePath(`/bookings/${p.data.bookingId}`);
  schedulePdf(p.data.bookingId);
  return { ok: true, message: "The status was changed." };
}

export async function cancelBookingAction(
  input: unknown,
): Promise<ActionResult> {
  await requireUser();
  const p = cancelSchema.safeParse(input);
  if (!p.success) return zodFail(p.error);
  const v = p.data;
  const cur = await currentBooking(v.bookingId);
  if (!cur || cur.final_amount_paise === null)
    return fail("We could not find that booking.");
  const charge = parseCharge({ charge: v.charge }, cur.final_amount_paise);
  if (!charge.ok) return fail(CHECK, { charge: charge.problem });
  const pv = await planPreview(v.bookingId, charge.paise);
  if (!pv.ok) return asFail(pv);
  if (!isPlanPreview(pv.data))
    return fail("We could not work out the plan. Please try again.");
  const c = checkCancel(v, {
    finalPaise: cur.final_amount_paise,
    today: todayIst(),
    preview: pv.data,
  });
  if (Object.keys(c.errors).length > 0) return fail(CHECK, c.errors);
  const r = await cancelBooking(v.bookingId, v.expectedVersion, {
    kind: v.kind,
    date: v.date,
    chargePaise: charge.paise,
    reason: v.reason.trim(),
    chargeChangeReason:
      v.chargeChangeReason.trim() === ""
        ? undefined
        : v.chargeChangeReason.trim(),
    plan: buildPlanRows(v.plan),
  });
  if (!r.ok) return asFail(r);
  revalidatePath("/bookings");
  revalidatePath(`/bookings/${v.bookingId}`);
  schedulePdf(v.bookingId);
  return {
    ok: true,
    message:
      v.kind === "cancelled"
        ? "The booking was cancelled."
        : "The booking was marked as no-show.",
  };
}

export async function changeChargeAction(
  input: unknown,
): Promise<ActionResult> {
  await requireUser();
  const p = chargeChangeSchema.safeParse(input);
  if (!p.success) return zodFail(p.error);
  const v = p.data;
  const cur = await currentBooking(v.bookingId);
  if (!cur || cur.final_amount_paise === null)
    return fail("We could not find that booking.");
  if (cur.status !== "cancelled" && cur.status !== "no_show")
    return fail("Only a cancelled or no-show booking has a charge.");
  const charge = parseCharge({ charge: v.charge }, cur.final_amount_paise);
  if (!charge.ok) return fail(CHECK, { charge: charge.problem });
  const pv = await planPreview(v.bookingId, charge.paise);
  if (!pv.ok) return asFail(pv);
  if (!isPlanPreview(pv.data))
    return fail("We could not work out the plan. Please try again.");
  const c = checkCancel(
    {
      kind: cur.status,
      reason: v.reason,
      date: todayIst(),
      charge: v.charge,
      chargeChangeReason: v.reason,
      plan: v.plan,
    },
    {
      finalPaise: cur.final_amount_paise,
      today: todayIst(),
      preview: pv.data,
      forChange: true,
    },
  );
  if (Object.keys(c.errors).length > 0) return fail(CHECK, c.errors);
  const r = await changeCancellationCharge(
    v.bookingId,
    v.expectedVersion,
    charge.paise,
    v.reason.trim(),
    buildPlanRows(v.plan),
  );
  if (!r.ok) return asFail(r);
  revalidatePath(`/bookings/${v.bookingId}`);
  schedulePdf(v.bookingId);
  return { ok: true, message: "The cancellation charge was changed." };
}

export async function changePlanAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const p = planChangeSchema.safeParse(input);
  if (!p.success) return zodFail(p.error);
  const v = p.data;
  const pv = await planPreview(v.bookingId);
  if (!pv.ok) return asFail(pv);
  if (!isPlanPreview(pv.data))
    return fail("We could not work out the plan. Please try again.");
  const c = checkEditPlan(pv.data, v.plan, {
    movePaise: v.movePaise,
    reason: v.reason,
  });
  if (c.problems.length > 0)
    return fail(c.problems[0], { plan: c.problems[0] });
  const r = await setPaymentSchedule(
    v.bookingId,
    v.expectedVersion,
    buildPlanRows(v.plan),
    v.reason.trim(),
    v.movePaise,
  );
  if (!r.ok) return asFail(r);
  revalidatePath(`/bookings/${v.bookingId}`);
  schedulePdf(v.bookingId);
  return { ok: true, message: "The payment plan was changed." };
}

// -------------------------------------------------------------------- guests
export interface GuestSuggestion {
  id: string;
  fullName: string;
  mobile: string;
  bookings: number;
}

/** Guests who match a typed mobile number or name, for "Use this guest" (duplicate suggestions). */
export async function findGuestsAction(
  text: string,
): Promise<GuestSuggestion[]> {
  await requireUser();
  const q = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  const digits = q.replace(/\D/g, "");
  if (
    q.length < 3 ||
    (digits.length > 0 && digits.length < 3 && !/[a-z]/i.test(q))
  )
    return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("guest_list", {
    p_q: q,
    p_limit: 5,
    p_offset: 0,
  });
  if (error || !data) return [];
  return data.map((g) => ({
    id: g.guest_id,
    fullName: g.full_name,
    mobile: g.mobile,
    bookings: Number(g.bookings),
  }));
}

export interface GuestFormState {
  ok?: boolean;
  message?: string;
  errors?: FieldErrors;
}

export async function saveGuestAction(
  _prev: GuestFormState | undefined,
  fd: FormData,
): Promise<GuestFormState> {
  await requireUser();
  const raw = Object.fromEntries(
    ["id", "fullName", "mobile", "email", "address", "notes"].map((k) => [
      k,
      String(fd.get(k) ?? ""),
    ]),
  );
  const p = guestFormSchema.safeParse({
    ...raw,
    id: raw.id === "" ? undefined : raw.id,
  });
  if (!p.success) return { message: CHECK, errors: fieldErrors(p.error) };
  if (p.data.fullName.trim() === "")
    return {
      message: CHECK,
      errors: { fullName: "Please enter the guest's name." },
    };
  const r = await upsertGuest({
    id: p.data.id,
    fullName: p.data.fullName,
    mobile: p.data.mobile,
    email: p.data.email.trim() === "" ? undefined : p.data.email,
    address: p.data.address.trim() === "" ? undefined : p.data.address,
    notes: p.data.notes.trim() === "" ? undefined : p.data.notes,
  });
  if (!r.ok) return { message: r.message };
  revalidatePath("/guests");
  if (p.data.id) revalidatePath(`/guests/${p.data.id}`);
  return { ok: true, message: p.data.id ? "Saved." : "The guest was added." };
}

// ------------------------------------------------------- quick add and settings
/** "+ add new" inside the booking form: an Agent or Partner name, usable at once. */
export async function quickAddCoEntryAction(
  categoryId: number,
  name: string,
  mobile: string,
): Promise<ActionResult<{ id: string; name: string }>> {
  await requireUser();
  const n = String(name ?? "").trim();
  if (!Number.isInteger(categoryId) || categoryId < 1)
    return fail("Please choose the category first.");
  if (n === "" || n.length > 120)
    return fail("Please enter the name (up to 120 letters).");
  const r = await upsertCoEntry({
    categoryId,
    name: n,
    mobile:
      String(mobile ?? "")
        .trim()
        .slice(0, 20) || undefined,
  });
  if (!r.ok) return asFail(r);
  return {
    ok: true,
    id: String(r.data),
    name: n,
    message: "The name was added.",
  };
}

export interface ProviderState {
  ok?: boolean;
  message?: string;
  errors?: FieldErrors;
}

export async function saveProviderAction(
  _prev: ProviderState | undefined,
  fd: FormData,
): Promise<ProviderState> {
  await requireUser();
  const name = String(fd.get("name") ?? "").trim();
  const method = String(fd.get("method") ?? "");
  const idRaw = String(fd.get("id") ?? "");
  if (name === "" || name.length > 60)
    return {
      message: CHECK,
      errors: { name: "Please enter the name (up to 60 letters)." },
    };
  if (method !== "upi" && method !== "card")
    return { message: CHECK, errors: { method: "Please choose UPI or Card." } };
  if (idRaw !== "" && !/^\d{1,5}$/.test(idRaw))
    return { message: "That app was not found." };
  const r = await upsertProvider({
    id: idRaw === "" ? undefined : Number(idRaw),
    method,
    name,
    active:
      fd.get("active") === "on" || fd.get("active") === "true" || idRaw === "",
  });
  if (!r.ok) return { message: r.message };
  revalidatePath("/settings/payment-apps");
  return { ok: true, message: idRaw === "" ? "The app was added." : "Saved." };
}
