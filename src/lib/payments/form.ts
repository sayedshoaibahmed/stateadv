/**
 * The Add Payment / Add Refund rules, as plain functions (no Next.js, no database), so every rule is unit-tested.
 * The screen sends INPUTS only (amount, method, app, date, reference, files). The database decides everything that
 * matters (D1 limits, the proof rule D3 at commit, who may do what, duplicates) and re-checks all of this; these checks
 * only give quick, friendly messages first and never let the screen save something the database would refuse without
 * a plain explanation. Money is whole paise; dates are plain IST dates ("2026-11-12"), times 24-hour ("14:30").
 */
import { isIsoDate, todayIst } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import { rupees } from "@/lib/bookings/form";

export const METHODS = ["cash", "upi", "card", "cheque", "other"] as const;
export type Method = (typeof METHODS)[number];
export const METHOD_LABELS: Record<Method, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  cheque: "Cheque",
  other: "Other",
};

/** D3: a screenshot or receipt is REQUIRED for these; optional for Cash and Other. */
export const PROOF_REQUIRED: readonly Method[] = ["upi", "card", "cheque"];
export const needsProof = (m: Method | ""): boolean =>
  m !== "" && PROOF_REQUIRED.includes(m);
/** The app / card type is chosen for UPI and Card only. */
export const needsProvider = (m: Method | ""): boolean =>
  m === "upi" || m === "card";

export const MIN_REASON = 5;
export const MAX_FILES = 5;

export interface ProviderChoice {
  id: number;
  name: string;
  method: Method;
  active: boolean;
}

export interface MoneyFormValues {
  bookingId: string;
  /** rupees as typed */
  amount: string;
  method: Method | "";
  providerId: string;
  /** the typed name when the chosen app is called "Other" */
  providerOther: string;
  date: string;
  time: string;
  reference: string;
  remarks: string;
  /** refunds only */
  reason: string;
}

export function emptyMoneyForm(
  bookingId: string,
  today: string = todayIst(),
): MoneyFormValues {
  return {
    bookingId,
    amount: "",
    method: "",
    providerId: "",
    providerOther: "",
    date: today,
    time: "",
    reference: "",
    remarks: "",
    reason: "",
  };
}

/** The label of the reference box changes with the method (UI spec 3.7). */
export function referenceLabel(
  m: Method | "",
  kind: "payment" | "refund" = "payment",
): string {
  const base: Record<Method, string> = {
    cash: "Receipt number (optional)",
    upi: "UPI transaction ID (UTR)",
    card: "Card slip or approval number",
    cheque: "Cheque number",
    other: "Reference (optional)",
  };
  const t = m === "" ? "Reference number (optional)" : base[m];
  return kind === "refund" ? t.replace("Receipt number", "Voucher number") : t;
}

export const proofLabel = (
  m: Method | "",
  kind: "payment" | "refund" = "payment",
): string => {
  const what =
    kind === "payment"
      ? "Payment screenshot or receipt"
      : "Refund screenshot or receipt";
  return `${what} (${needsProof(m) ? "required" : "optional"})`;
};

export const REFUND_QUICK_REASONS = [
  "Booking cancelled",
  "Guest paid extra",
] as const;
export const REJECT_QUICK_REASONS = [
  "Wrong amount",
  "Wrong booking",
  "Screenshot not clear",
  "Money not received",
] as const;

export type FormErrors = Partial<Record<string, string>>;

/** Friendly checks before saving; plain English keyed by field. */
export function validateMoney(
  v: MoneyFormValues,
  o: {
    kind: "payment" | "refund";
    today?: string;
    files: number;
    providers: readonly ProviderChoice[];
  },
): FormErrors {
  const e: FormErrors = {};
  const today = o.today ?? todayIst();
  const word = o.kind === "payment" ? "payment" : "refund";
  const a = rupees(v.amount, null);
  if ("error" in a)
    e.amount = v.amount.trim() === "" ? "Please enter the amount." : a.error;
  else if (a.paise <= 0) e.amount = "The amount must be more than zero.";
  if (v.method === "")
    e.method =
      o.kind === "payment"
        ? "Please choose how the money was paid."
        : "Please choose how the money was sent back.";
  if (needsProvider(v.method)) {
    const p = o.providers.find((x) => String(x.id) === v.providerId);
    if (!v.providerId)
      e.providerId =
        v.method === "upi"
          ? "Please choose the payment app."
          : "Please choose the card type.";
    else if (!p || p.method !== v.method || !p.active)
      e.providerId = "That choice is not available.";
    else if (p.name === "Other" && v.providerOther.trim() === "")
      e.providerOther = "Please write the name.";
    else if (v.providerOther.trim().length > 60)
      e.providerOther = "That name is too long (60 letters at most).";
  }
  if (!isIsoDate(v.date)) e.date = `Please enter the ${word} date.`;
  else if (v.date > today) e.date = `The ${word} date cannot be in the future.`;
  if (v.time.trim() !== "" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v.time))
    e.time = "Please enter a time like 14:30.";
  if (v.reference.length > 100)
    e.reference = "That is too long (100 letters at most).";
  if (v.remarks.length > 500)
    e.remarks = "That is too long (500 letters at most).";
  if (needsProof(v.method) && o.files === 0)
    e.files = `A screenshot or receipt is required for ${METHOD_LABELS[v.method as Method]} ${word}s.`;
  if (o.files > MAX_FILES) e.files = `You can add at most ${MAX_FILES} files.`;
  if (o.kind === "refund" && v.reason.trim().length < MIN_REASON)
    e.reason = "Please write the reason for the refund (at least 5 letters).";
  return e;
}

export interface MoneyPayload {
  payload: Record<string, unknown>;
}

/** The inputs the database function wants. Throws if the form is not valid (callers validate first). */
export function buildMoneyPayload(
  v: MoneyFormValues,
  kind: "payment" | "refund",
): MoneyPayload {
  const a = rupees(v.amount, null);
  if ("error" in a || a.paise <= 0 || v.method === "")
    throw new Error("The form is not complete.");
  const p: Record<string, unknown> = {
    booking_id: v.bookingId,
    amount_paise: a.paise,
    method: v.method,
    provider_id:
      needsProvider(v.method) && v.providerId ? Number(v.providerId) : null,
    provider_other:
      needsProvider(v.method) && v.providerOther.trim() !== ""
        ? v.providerOther.trim()
        : null,
    reference_number: v.reference.trim() === "" ? null : v.reference.trim(),
    remarks: v.remarks.trim() === "" ? null : v.remarks.trim(),
  };
  if (kind === "payment") {
    p.payment_date = v.date;
    p.payment_time = v.time.trim() === "" ? null : v.time;
  } else {
    p.refund_date = v.date;
    p.refund_time = v.time.trim() === "" ? null : v.time;
    p.reason = v.reason.trim();
  }
  return { payload: p };
}

/** Warnings come back with a saved item. They never block saving (FR-PAY-6). */
export const WARNING_TEXT: Record<string, string> = {
  DUPLICATE_REFERENCE:
    "Another payment or refund already uses this reference number. Please check it.",
  DUPLICATE_FILE:
    "This screenshot was already used for another payment or refund. Please check it.",
  ABOVE_AMOUNT_DUE:
    "This is more than the amount still pending on the booking.",
  ABOVE_REFUND_DUE: "This is more than the refund due for this booking.",
};
export const warningText = (code: string): string =>
  WARNING_TEXT[code] ?? "Please check the details of this entry.";

/** "Payment of ₹1,500 added. Waiting for approval." plus any warnings. */
export function savedMessage(
  kind: "payment" | "refund",
  paise: number,
  warnings: readonly string[],
): string {
  const base = `${kind === "payment" ? "Payment" : "Refund"} of ${formatPaise(paise)} ${kind === "payment" ? "added" : "recorded"}. Waiting for approval.`;
  return warnings.length === 0
    ? base
    : `${base} ${warnings.map(warningText).join(" ")}`;
}

/** The figures shown above the Add Refund form, straight from the database view (never calculated here). */
export interface RefundFigures {
  approvedPaise: number;
  refundsApprovedPaise: number;
  refundDuePaise: number;
  /** the most that can still be refunded: approved - approved refunds - waiting refunds */
  mostPaise: number;
}
export function refundHelp(f: RefundFigures): string[] {
  return [
    `Approved ${formatPaise(f.approvedPaise)}`,
    `Refunds so far ${formatPaise(f.refundsApprovedPaise)}`,
    `Refund due ${formatPaise(f.refundDuePaise)}`,
    `Most you can refund: ${formatPaise(Math.max(f.mostPaise, 0))}`,
  ];
}
