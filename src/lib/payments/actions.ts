"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fieldErrors } from "@/lib/auth/schemas";
import { requireUser } from "@/lib/auth/session";
import {
  addCorrectionFiles,
  addPayment,
  addProofs,
  addRefund,
  decidePayment,
  decideRefund,
  hideProof,
  updateWaitingPayment,
  updateWaitingRefund,
} from "@/lib/db/actions";
import type { Result } from "@/lib/db/call";
import { schedulePdf, schedulePdfForItem } from "@/lib/pdf/schedule";
import { loadProviderChoices } from "@/lib/payments/data";
import {
  buildMoneyPayload,
  savedMessage,
  validateMoney,
  type FormErrors,
  type MoneyFormValues,
} from "@/lib/payments/form";
import { MIN_CORRECTION_REASON, MIN_REASON } from "@/lib/payments/rules";
import { rupees } from "@/lib/bookings/form";

/**
 * Server actions for payments, refunds, approvals and proof files (M5). Each one:
 *  1. checks on the server that the caller is a signed-in, active user (requireUser);
 *  2. re-validates the shape (zod) and the same plain rules the form shows;
 *  3. calls the database function with THE USER'S OWN LOGIN (never the secret key).
 * The database enforces every financial rule again and has the final say: the refund limit and reversal protection
 * (D1, D5), who decided and when, locked decided records, the proof rule (D3), correction files (Q9a), self-approval
 * flags and the history. The browser never sends balances; the files it names were checked by the server after upload
 * (confirmProofUploads) and are checked against what storage recorded by the database. Messages are plain English.
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
const asFail = (r: Extract<Result<unknown>, { ok: false }>) => fail(r.message);

const uuid = z.uuid("That choice is not valid.");
const short = (max: number) =>
  z.string().max(max, `That is too long (at most ${max} characters).`);
const kindSchema = z.enum(["payment", "refund"]);

const fileSchema = z.object({
  storage_path: short(300),
  original_file_name: short(200),
  mime_type: short(100),
  size_bytes: z
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, "The file fingerprint is missing."),
});
const filesSchema = z.array(fileSchema).max(5, "You can add at most 5 files.");

const valuesSchema = z.object({
  bookingId: uuid,
  amount: short(20),
  method: z.enum(["cash", "upi", "card", "cheque", "other", ""]),
  providerId: z.union([z.string().regex(/^\d{1,5}$/), z.literal("")]),
  providerOther: short(60),
  date: z.string().max(10),
  time: z.string().max(5),
  reference: short(100),
  remarks: short(500),
  reason: short(500),
});

const addSchema = z.object({
  kind: kindSchema,
  values: valuesSchema,
  files: filesSchema,
  idempotencyKey: uuid,
});

export async function addMoneyAction(input: unknown): Promise<
  ActionResult<{
    id: string;
    code: string;
    duplicate: boolean;
    warnings: string[];
  }>
> {
  await requireUser();
  const p = addSchema.safeParse(input);
  if (!p.success) return fail(CHECK, fieldErrors(p.error));
  const { kind, files, idempotencyKey } = p.data;
  const values = p.data.values as MoneyFormValues;
  const providers = await loadProviderChoices();
  const errors: FormErrors = validateMoney(values, {
    kind,
    files: files.length,
    providers,
  });
  if (Object.keys(errors).length > 0)
    return fail(CHECK, errors as Record<string, string>);
  const { payload } = buildMoneyPayload(values, kind);
  const r =
    kind === "payment"
      ? await addPayment(payload, files, idempotencyKey)
      : await addRefund(payload, files, idempotencyKey);
  if (!r.ok) return asFail(r);
  const d = r.data as {
    id: string;
    payment_code?: string;
    refund_code?: string;
    duplicate?: boolean;
    warnings?: { code: string }[];
  };
  const warnings = (d.warnings ?? []).map((w) => w.code);
  const amount = rupees(values.amount);
  revalidatePath("/payments");
  revalidatePath("/refunds");
  revalidatePath("/approvals");
  revalidatePath(`/bookings/${values.bookingId}`);
  schedulePdf(values.bookingId);
  return {
    ok: true,
    id: d.id,
    code: d.payment_code ?? d.refund_code ?? "",
    duplicate: d.duplicate === true,
    warnings,
    message:
      "paise" in amount
        ? savedMessage(kind, amount.paise, warnings)
        : undefined,
  };
}

const editSchema = z.object({
  kind: kindSchema,
  id: uuid,
  expectedVersion: z.number().int().min(1),
  values: valuesSchema,
  reason: short(500),
});

/** Change a payment or refund that is still waiting. A reason is required and kept in the history. */
export async function updateWaitingAction(
  input: unknown,
): Promise<ActionResult<{ version: number }>> {
  await requireUser();
  const p = editSchema.safeParse(input);
  if (!p.success) return fail(CHECK, fieldErrors(p.error));
  const { kind, id, expectedVersion, reason } = p.data;
  const values = p.data.values as MoneyFormValues;
  const providers = await loadProviderChoices();
  // files already attached are not re-sent here, so the proof rule is not asked again on this screen (the database asks at commit)
  const errors = validateMoney(values, { kind, files: 5, providers });
  if (reason.trim().length < MIN_REASON)
    errors.reason =
      errors.reason ??
      "Please write why you are changing it (at least 5 letters).";
  if (kind === "refund" && values.reason.trim().length < MIN_REASON)
    errors.refundReason =
      "Please write the reason for the refund (at least 5 letters).";
  if (Object.keys(errors).length > 0)
    return fail(CHECK, errors as Record<string, string>);
  const { payload } = buildMoneyPayload(values, kind);
  const r =
    kind === "payment"
      ? await updateWaitingPayment(id, expectedVersion, payload, reason.trim())
      : await updateWaitingRefund(id, expectedVersion, payload, reason.trim());
  if (!r.ok) return asFail(r);
  revalidatePath(`/${kind}s/${id}`);
  revalidatePath("/approvals");
  revalidatePath(`/bookings/${values.bookingId}`);
  schedulePdf(values.bookingId);
  return {
    ok: true,
    version: (r.data as { version?: number }).version ?? expectedVersion + 1,
    message: "Saved.",
  };
}

const decideSchema = z.object({
  kind: kindSchema,
  id: uuid,
  expectedVersion: z.number().int().min(1),
  decision: z.enum(["approve", "reject", "reverse"]),
  reason: short(500).optional(),
});

/** Approve, reject (reason) or reverse (reason). Anyone active may decide, including the person who recorded it (Q8). */
export async function decideAction(
  input: unknown,
): Promise<ActionResult<{ nextStatus: string }>> {
  await requireUser();
  const p = decideSchema.safeParse(input);
  if (!p.success) return fail(CHECK, fieldErrors(p.error));
  const { kind, id, expectedVersion, decision } = p.data;
  const reason = (p.data.reason ?? "").trim();
  if (decision !== "approve" && reason.length < MIN_REASON) {
    return fail(CHECK, {
      reason: "Please write the reason (at least 5 letters).",
    });
  }
  const r =
    kind === "payment"
      ? await decidePayment(id, expectedVersion, decision, reason)
      : await decideRefund(id, expectedVersion, decision, reason);
  if (!r.ok) return asFail(r);
  revalidatePath("/approvals");
  revalidatePath("/payments");
  revalidatePath("/refunds");
  revalidatePath(`/${kind}s/${id}`);
  revalidatePath("/dashboard");
  schedulePdfForItem(kind, id);
  const status =
    decision === "approve"
      ? "approved"
      : decision === "reject"
        ? "rejected"
        : "reversed";
  return {
    ok: true,
    nextStatus: status,
    message:
      decision === "approve"
        ? "Approved."
        : decision === "reject"
          ? "Rejected."
          : "Reversed.",
  };
}

const addFilesSchema = z.object({
  kind: kindSchema,
  parentId: uuid,
  files: filesSchema.min(1, "Please add a file."),
});

/** More files on a payment or refund that is still waiting (at most 5 visible files in all). */
export async function addFilesAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const p = addFilesSchema.safeParse(input);
  if (!p.success) return fail(CHECK, fieldErrors(p.error));
  const r = await addProofs(p.data.kind, p.data.parentId, p.data.files);
  if (!r.ok) return asFail(r);
  revalidatePath(`/${p.data.kind}s/${p.data.parentId}`);
  schedulePdfForItem(p.data.kind, p.data.parentId);
  return { ok: true, message: "The file was added." };
}

const hideSchema = z.object({
  proofId: uuid,
  reason: short(500),
  itemKind: kindSchema,
  itemId: uuid,
});

/** Hide (never delete) a wrong file on a waiting item. The last file of a UPI, card or cheque item cannot be hidden. */
export async function hideFileAction(input: unknown): Promise<ActionResult> {
  await requireUser();
  const p = hideSchema.safeParse(input);
  if (!p.success) return fail(CHECK, fieldErrors(p.error));
  if (p.data.reason.trim().length < MIN_REASON)
    return fail(CHECK, {
      reason: "Please write the reason (at least 5 letters).",
    });
  const r = await hideProof(p.data.proofId, p.data.reason.trim());
  if (!r.ok) return asFail(r);
  revalidatePath(`/${p.data.itemKind}s/${p.data.itemId}`);
  schedulePdfForItem(p.data.itemKind, p.data.itemId);
  return {
    ok: true,
    message: "The file was hidden. It is kept in the history.",
  };
}

const correctionSchema = z.object({
  kind: kindSchema,
  parentId: uuid,
  reason: short(500),
  files: filesSchema.min(1, "Please add a file."),
});

/** Q9a: a correction file on an APPROVED item. Reason of at least 10 letters; the originals and the money never change. */
export async function addCorrectionAction(
  input: unknown,
): Promise<ActionResult> {
  await requireUser();
  const p = correctionSchema.safeParse(input);
  if (!p.success) return fail(CHECK, fieldErrors(p.error));
  if (p.data.reason.trim().length < MIN_CORRECTION_REASON) {
    return fail(CHECK, {
      reason:
        "Please write the reason (at least 10 letters). The original files and the amounts will not change.",
    });
  }
  const r = await addCorrectionFiles(
    p.data.kind,
    p.data.parentId,
    p.data.reason.trim(),
    p.data.files,
  );
  if (!r.ok) return asFail(r);
  revalidatePath(`/${p.data.kind}s/${p.data.parentId}`);
  schedulePdfForItem(p.data.kind, p.data.parentId);
  return {
    ok: true,
    message:
      "The correction file was added. The original files and the amounts did not change.",
  };
}
