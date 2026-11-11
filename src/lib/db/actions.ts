"use server";

import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { callRpc, type Result, type Saved } from "@/lib/db/call";

/**
 * Server actions for every database write function (migrations 13-15). Each one:
 *  1. checks on the server that the caller is a signed-in, active user;
 *  2. calls the database function with THE USER'S OWN LOGIN (never the secret key);
 *  3. returns a plain result with a plain-English message on failure.
 * The database validates every value again and enforces every business rule; nothing here is trusted by it.
 * Money is always in paise (whole numbers). The browser sends inputs only - never nights, totals or balances.
 */
type Json = Record<string, unknown>;

async function run<T = Saved>(name: string, args: Json): Promise<Result<T>> {
  await requireUser();
  const supabase = await createClient();
  return callRpc<T>(supabase, name, args);
}

// ---------------------------------------------------------------- bookings
export const createBooking = (
  payload: Json,
  plan: Json[],
  idempotencyKey: string,
) =>
  run("create_booking", {
    p_payload: payload,
    p_plan: plan,
    p_idem: idempotencyKey,
  });

export const updateBooking = (
  id: string,
  expectedVersion: number,
  payload: Json,
  opts: { plan?: Json[]; moveOverduePaise?: number; reason?: string } = {},
) =>
  run("update_booking", {
    p_id: id,
    p_expected_version: expectedVersion,
    p_payload: payload,
    p_plan: opts.plan ?? null,
    p_move_overdue: opts.moveOverduePaise ?? 0,
    p_reason: opts.reason ?? null,
  });

/** Going backwards (checked-in → confirmed, checked-out → checked-in) needs a reason of at least 5 characters. */
export const setBookingStatus = (
  id: string,
  expectedVersion: number,
  status: "confirmed" | "checked_in" | "checked_out",
  reason?: string,
) =>
  run("set_booking_status", {
    p_id: id,
    p_expected_version: expectedVersion,
    p_status: status,
    p_reason: reason ?? null,
  });

export const cancelBooking = (
  id: string,
  expectedVersion: number,
  o: {
    kind: "cancelled" | "no_show";
    date?: string;
    chargePaise?: number;
    reason: string;
    chargeChangeReason?: string;
    plan?: Json[];
  },
) =>
  run("cancel_booking", {
    p_id: id,
    p_expected_version: expectedVersion,
    p_kind: o.kind,
    p_date: o.date ?? null,
    p_charge: o.chargePaise ?? null,
    p_reason: o.reason,
    p_charge_change_reason: o.chargeChangeReason ?? null,
    p_plan: o.plan ?? null,
  });

export const changeCancellationCharge = (
  id: string,
  expectedVersion: number,
  chargePaise: number,
  reason: string,
  plan?: Json[],
) =>
  run("change_cancellation_charge", {
    p_id: id,
    p_expected_version: expectedVersion,
    p_charge: chargePaise,
    p_reason: reason,
    p_plan: plan ?? null,
  });

export const setPaymentSchedule = (
  id: string,
  expectedVersion: number,
  plan: Json[],
  reason: string,
  moveOverduePaise = 0,
) =>
  run("set_payment_schedule", {
    p_id: id,
    p_expected_version: expectedVersion,
    p_plan: plan,
    p_move_overdue: moveOverduePaise,
    p_reason: reason,
  });

export const planPreview = (id: string, newAmountDuePaise?: number) =>
  run<Record<string, number | string>>("plan_preview", {
    p_id: id,
    p_new_amount_due: newAmountDuePaise ?? null,
  });

// ---------------------------------------------------------------- payments
export const addPayment = (
  payload: Json,
  files: Json[],
  idempotencyKey: string,
) =>
  run("add_payment", {
    p_payload: payload,
    p_files: files,
    p_idem: idempotencyKey,
  });
export const updateWaitingPayment = (
  id: string,
  expectedVersion: number,
  payload: Json,
  reason: string,
) =>
  run("update_waiting_payment", {
    p_id: id,
    p_expected_version: expectedVersion,
    p_payload: payload,
    p_reason: reason,
  });
export const decidePayment = (
  id: string,
  expectedVersion: number,
  decision: "approve" | "reject" | "reverse",
  reason?: string,
) =>
  decision === "approve"
    ? run("approve_payment", { p_id: id, p_expected_version: expectedVersion })
    : run(decision === "reject" ? "reject_payment" : "reverse_payment", {
        p_id: id,
        p_expected_version: expectedVersion,
        p_reason: reason ?? "",
      });

// ----------------------------------------------------------------- refunds
export const addRefund = (
  payload: Json,
  files: Json[],
  idempotencyKey: string,
) =>
  run("add_refund", {
    p_payload: payload,
    p_files: files,
    p_idem: idempotencyKey,
  });
export const updateWaitingRefund = (
  id: string,
  expectedVersion: number,
  payload: Json,
  reason: string,
) =>
  run("update_waiting_refund", {
    p_id: id,
    p_expected_version: expectedVersion,
    p_payload: payload,
    p_reason: reason,
  });
export const decideRefund = (
  id: string,
  expectedVersion: number,
  decision: "approve" | "reject" | "reverse",
  reason?: string,
) =>
  decision === "approve"
    ? run("approve_refund", { p_id: id, p_expected_version: expectedVersion })
    : run(decision === "reject" ? "reject_refund" : "reverse_refund", {
        p_id: id,
        p_expected_version: expectedVersion,
        p_reason: reason ?? "",
      });

// ------------------------------------------------------------- proof files
export const addProofs = (
  kind: "payment" | "refund",
  parentId: string,
  files: Json[],
) => run("add_proofs", { p_kind: kind, p_parent: parentId, p_files: files });
export const hideProof = (proofId: string, reason: string) =>
  run("hide_proof", { p_id: proofId, p_reason: reason });
export const addCorrectionFiles = (
  kind: "payment" | "refund",
  parentId: string,
  reason: string,
  files: Json[],
) =>
  run("add_correction_files", {
    p_kind: kind,
    p_parent: parentId,
    p_reason: reason,
    p_files: files,
  });

// ------------------------------------------------------------- master data
export const upsertResort = (o: {
  id?: string;
  code: string;
  name: string;
  location?: string;
  contactNumber?: string;
  logoPath?: string;
}) =>
  run("upsert_resort", {
    p_id: o.id ?? null,
    p_code: o.code,
    p_name: o.name,
    p_location: o.location ?? null,
    p_contact_number: o.contactNumber ?? null,
    p_logo_path: o.logoPath ?? null,
  });
export const setResortActive = (id: string, active: boolean) =>
  run("set_resort_active", { p_id: id, p_active: active });
export const upsertGuest = (o: {
  id?: string;
  fullName: string;
  mobile: string;
  email?: string;
  address?: string;
  notes?: string;
}) =>
  run("upsert_guest", {
    p_id: o.id ?? null,
    p_full_name: o.fullName,
    p_mobile: o.mobile,
    p_email: o.email ?? null,
    p_address: o.address ?? null,
    p_notes: o.notes ?? null,
  });
export const upsertAgentPartner = (o: {
  id?: string;
  type: "agent" | "partner";
  name: string;
  mobile?: string;
  notes?: string;
  active?: boolean;
}) =>
  run("upsert_agent_partner", {
    p_id: o.id ?? null,
    p_type: o.type,
    p_name: o.name,
    p_mobile: o.mobile ?? null,
    p_notes: o.notes ?? null,
    p_is_active: o.active ?? true,
  });
export const upsertStayType = (o: {
  id?: number;
  name: string;
  active?: boolean;
  sortOrder?: number;
}) =>
  run("upsert_stay_type", {
    p_id: o.id ?? null,
    p_name: o.name,
    p_is_active: o.active ?? true,
    p_sort_order: o.sortOrder ?? 100,
  });
export const upsertProvider = (o: {
  id?: number;
  method: "upi" | "card";
  name: string;
  active?: boolean;
  sortOrder?: number;
}) =>
  run("upsert_provider", {
    p_id: o.id ?? null,
    p_method: o.method,
    p_name: o.name,
    p_is_active: o.active ?? true,
    p_sort_order: o.sortOrder ?? 100,
  });
