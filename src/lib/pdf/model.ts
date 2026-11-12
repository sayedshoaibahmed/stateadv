/**
 * The booking PDF as plain data (PRD 5.14, FR-PDF-2/3). Pure: no Next.js, no database, no PDF library, so every
 * word and number on the page is unit-tested. The database function `pdf_booking_data` supplies the figures (money
 * comes from booking_financials, rule D1); this file only FORMATS them. Nothing here adds, subtracts or recalculates
 * a balance. Dates are IST ("12 Nov 2026"), money is Indian style ("₹1,50,000"), and a missing optional field is
 * simply left out or shown as a dash.
 */
import { z } from "zod";
import { formatDisplayDate } from "@/lib/dates";
import { formatPaise } from "@/lib/money";

const paise = z.number().int();
const text = z.string();
const maybe = z.string().nullable();

const payment = z.object({
  code: text,
  amount_paise: paise,
  method: text,
  provider: maybe,
  date: text,
  status: z.enum(["waiting", "approved", "rejected", "reversed"]),
  self_approved: z.boolean(),
});
const refund = payment.extend({ reason: maybe });

export const pdfDataSchema = z.object({
  booking: z.object({
    code: text,
    status: z.enum([
      "confirmed",
      "checked_in",
      "checked_out",
      "cancelled",
      "no_show",
    ]),
    resort_name: text,
    resort_code: text,
    logo_path: maybe,
    booking_date: text,
    check_in: text,
    check_out: text,
    nights: z.number().int(),
    pax: z.number().int(),
    stay_type: text,
    co_category: text,
    co_name: maybe,
    pricing_method: z.enum(["per_person_per_night", "per_person_per_stay"]),
    tariff_paise: paise,
    base_paise: paise,
    extra_paise: paise,
    extra_note: maybe,
    total_paise: paise,
    discount_paise: paise,
    adjustment_paise: paise,
    adjustment_reason: maybe,
    final_paise: paise,
    remarks: maybe,
  }),
  guest: z.object({ name: text, mobile: text }),
  cancellation: z
    .object({
      kind: z.enum(["cancelled", "no_show"]),
      date: text,
      reason: maybe,
      charge_paise: paise,
      original_final_paise: paise,
      charge_change_reason: maybe,
    })
    .nullable(),
  plan: z.array(z.object({ label: text, due_date: text, amount_paise: paise })),
  adjustments: z.array(
    z.object({ date: text, amount_paise: paise, reason: text }),
  ),
  payments: z.array(payment),
  refunds: z.array(refund),
  corrections: z.array(
    z.object({
      record_code: maybe,
      kind: text,
      file_name: maybe,
      date: text,
      by: maybe,
      reason: maybe,
    }),
  ),
  totals: z.object({
    amount_due_paise: paise,
    total_collection_paise: paise,
    waiting_paise: paise,
    refunds_approved_paise: paise,
    refunds_waiting_paise: paise,
    net_collection_paise: paise,
    pending_paise: paise,
    verified_remaining_paise: paise,
    extra_paise: paise,
    refund_due_paise: paise,
  }),
});
export type PdfData = z.infer<typeof pdfDataSchema>;

export class PdfDataError extends Error {
  constructor() {
    super("The booking details could not be read for the PDF.");
    this.name = "PdfDataError";
  }
}
/** The database's JSON, checked. Throws PdfDataError (with no booking data in the message) when it is not what we expect. */
export function parsePdfData(raw: unknown): PdfData {
  const r = pdfDataSchema.safeParse(raw);
  if (!r.success) throw new PdfDataError();
  return r.data;
}

export const DISCLAIMER =
  "Internal booking and payment statement. This is not a tax invoice. Amounts marked 'Waiting for Approval' are not yet verified.";

const STATUS_LABEL: Record<PdfData["booking"]["status"], string> = {
  confirmed: "Confirmed",
  checked_in: "Checked-in",
  checked_out: "Checked-out",
  cancelled: "Cancelled",
  no_show: "No-show",
};
const MONEY_STATUS: Record<
  "waiting" | "approved" | "rejected" | "reversed",
  string
> = {
  waiting: "Waiting for Approval",
  approved: "Approved",
  rejected: "Rejected",
  reversed: "Reversed",
};
const METHOD: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  cheque: "Cheque",
  other: "Other",
};
const PRICING: Record<PdfData["booking"]["pricing_method"], string> = {
  per_person_per_night: "Per person per night",
  per_person_per_stay: "Per person per stay",
};

const DASH = "—";
const orDash = (v: string | null | undefined) =>
  v && v.trim() !== "" ? v : DASH;

/** "2026-11-12T14:00" (IST wall clock) -> "12 Nov 2026, 2:00 PM". A plain date gives the date only. */
export function istText(v: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(v);
  if (!m) return DASH;
  const date = formatDisplayDate(m[1]);
  if (!m[2]) return date;
  const h = Number(m[2]);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${date}, ${h12}:${m[3]} ${h < 12 ? "AM" : "PM"}`;
}

/** The generation moment, shown in IST whatever the server's own time zone is. */
export function generatedText(at: Date): string {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const parts = f.formatToParts(at);
  const g = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value ?? "";
  return `${g("day")} ${g("month")} ${g("year")}, ${g("hour")}:${g("minute")} ${g("dayPeriod").toUpperCase()} IST`;
}

export type Pair = { label: string; value: string };
export type Table = { head: string[]; rows: string[][]; empty: string };
export interface PdfModel {
  resortName: string;
  code: string;
  statusLabel: string;
  cancelled: boolean;
  version: number;
  generatedLine: string;
  guestBlock: Pair[];
  stayBlock: Pair[];
  amountBlock: Pair[];
  finalLine: Pair;
  remarks: string | null;
  cancellationBlock: Pair[] | null;
  plan: Table;
  adjustments: Table | null;
  payments: Table;
  refunds: Table;
  corrections: string[];
  totals: Pair[];
  footer: string;
}

const methodText = (method: string, provider: string | null) =>
  `${METHOD[method] ?? method}${provider ? ` · ${provider}` : ""}`;
const signed = (p: number) => (p < 0 ? `−${formatPaise(-p)}` : formatPaise(p));

/** Everything the PDF prints, as formatted strings. `version` and `generatedAt` are the only things not from the database data. */
export function buildModel(
  d: PdfData,
  meta: { version: number; generatedAt: Date },
): PdfModel {
  const b = d.booking;
  const c = d.cancellation;
  const perNight = b.pricing_method === "per_person_per_night";
  const moneyRow = (p: PdfData["payments"][number]): string[] => [
    p.code,
    formatPaise(p.amount_paise),
    methodText(p.method, p.provider),
    formatDisplayDate(p.date),
    p.self_approved && p.status === "approved"
      ? `${MONEY_STATUS[p.status]} · Self-approved`
      : MONEY_STATUS[p.status],
  ];
  const amountBlock: Pair[] = [
    { label: "Pricing method", value: PRICING[b.pricing_method] },
    { label: "Tariff per person", value: formatPaise(b.tariff_paise) },
    {
      label: perNight
        ? `Base amount (${b.pax} × ${formatPaise(b.tariff_paise)} × ${b.nights} ${b.nights === 1 ? "night" : "nights"})`
        : `Base amount (${b.pax} × ${formatPaise(b.tariff_paise)})`,
      value: formatPaise(b.base_paise),
    },
    {
      label: b.extra_note ? `Extra charges (${b.extra_note})` : "Extra charges",
      value: formatPaise(b.extra_paise),
    },
    { label: "Total Amount", value: formatPaise(b.total_paise) },
    { label: "Discount", value: formatPaise(b.discount_paise) },
  ];
  if (b.adjustment_paise !== 0) {
    amountBlock.push({
      label: `Final amount changed by hand${b.adjustment_reason ? ` (${b.adjustment_reason})` : ""}`,
      value: signed(b.adjustment_paise),
    });
  }
  const totals: Pair[] = [
    {
      label: c ? "Amount Due (Cancellation Charge)" : "Amount Due",
      value: formatPaise(d.totals.amount_due_paise),
    },
    {
      label: "Total Collection (Approved)",
      value: formatPaise(d.totals.total_collection_paise),
    },
    {
      label: "Waiting for Approval",
      value: formatPaise(d.totals.waiting_paise),
    },
    {
      label: "Refunds (Approved)",
      value: formatPaise(d.totals.refunds_approved_paise),
    },
    {
      label: "Net Collection",
      value: formatPaise(d.totals.net_collection_paise),
    },
    { label: "Pending Amount", value: formatPaise(d.totals.pending_paise) },
  ];
  if (d.totals.extra_paise > 0)
    totals.push({
      label: "Extra Payment",
      value: formatPaise(d.totals.extra_paise),
    });
  if (d.totals.refund_due_paise > 0)
    totals.push({
      label: "Refund due",
      value: formatPaise(d.totals.refund_due_paise),
    });
  if (d.totals.refunds_waiting_paise > 0)
    totals.push({
      label: "Refunds waiting for approval (not counted above)",
      value: formatPaise(d.totals.refunds_waiting_paise),
    });

  return {
    resortName: b.resort_name,
    code: b.code,
    statusLabel: STATUS_LABEL[b.status],
    cancelled: c !== null,
    version: meta.version,
    generatedLine: `Version ${meta.version} · Generated ${generatedText(meta.generatedAt)}`,
    guestBlock: [
      { label: "Guest", value: orDash(d.guest.name) },
      { label: "Mobile", value: orDash(d.guest.mobile) },
      { label: "People (PAX)", value: String(b.pax) },
      {
        label: "C/O",
        value: `${b.co_category}${b.co_name ? ` – ${b.co_name}` : ""}`,
      },
    ],
    stayBlock: [
      { label: "Stay type", value: orDash(b.stay_type) },
      { label: "Booking date", value: istText(b.booking_date) },
      { label: "Check-in", value: istText(b.check_in) },
      { label: "Check-out", value: istText(b.check_out) },
      { label: "Nights", value: String(b.nights) },
    ],
    amountBlock,
    finalLine: {
      label: c ? "Original Booking Amount" : "Final Booking Amount",
      value: formatPaise(b.final_paise),
    },
    remarks: b.remarks && b.remarks.trim() !== "" ? b.remarks : null,
    cancellationBlock: c
      ? [
          {
            label:
              c.kind === "cancelled" ? "Cancelled on" : "Marked as No-show on",
            value: istText(c.date),
          },
          { label: "Reason", value: orDash(c.reason) },
          {
            label: "Cancellation Charge (Amount Due)",
            value: formatPaise(c.charge_paise),
          },
          {
            label: "Original Booking Amount",
            value: formatPaise(c.original_final_paise),
          },
          ...(c.charge_change_reason
            ? [
                {
                  label: "Why the charge was changed",
                  value: c.charge_change_reason,
                },
              ]
            : []),
        ]
      : null,
    plan: {
      head: ["Payment", "Due", "Amount"],
      rows: d.plan.map((r) => [
        r.label,
        formatDisplayDate(r.due_date),
        formatPaise(r.amount_paise),
      ]),
      empty: "No payment plan rows.",
    },
    adjustments:
      d.adjustments.length === 0
        ? null
        : {
            head: ["Date", "Amount", "Reason"],
            rows: d.adjustments.map((a) => [
              formatDisplayDate(a.date),
              signed(a.amount_paise),
              a.reason,
            ]),
            empty: "",
          },
    payments: {
      head: ["Payment", "Amount", "Method", "Date", "Status"],
      rows: d.payments.map(moneyRow),
      empty: "No payments yet.",
    },
    refunds: {
      head: ["Refund", "Amount", "Method", "Date", "Status"],
      rows: d.refunds.map((r) => moneyRow(r)),
      empty: "No refunds.",
    },
    corrections: d.corrections.map(
      (x) =>
        `Added after approval on ${x.date.length >= 10 ? formatDisplayDate(x.date) : DASH} by ${orDash(x.by)}${x.record_code ? ` (${x.record_code})` : ""}: ${orDash(x.reason)}`,
    ),
    totals,
    footer: DISCLAIMER,
  };
}

/** The stored name of a downloaded file: letters, digits, dot, dash and underscore only. */
export function downloadName(code: string, version: number): string {
  const safe = code.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 60) || "booking";
  return `${safe}-v${Math.max(1, Math.trunc(version))}.pdf`;
}
