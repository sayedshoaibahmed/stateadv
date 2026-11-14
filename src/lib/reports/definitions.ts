/**
 * The reports (PRD 5.16, UI spec 3.13): what each one is called, which date and approval rule it uses (every report header
 * must say so), which filters it has, and the columns of its table. Pure data and pure functions, no database and no
 * Next.js, so every rule is unit-tested. The figures themselves come from the database functions of migration 25;
 * nothing here calculates money. All dates are IST calendar dates ("2026-11-12").
 */
import {
  daysBetween,
  formatDisplayDate,
  isIsoDate,
  todayIst,
  type IsoDate,
} from "@/lib/dates";
import { periodText, presetRange } from "@/lib/dashboard/filters";

export const REPORT_KEYS = [
  "collection",
  "resort-wise",
  "payment-methods",
  "bookings",
  "pending",
  "waiting",
  "refunds",
  "cancellations",
  "expected-adjustments",
  "manual-adjustments",
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

/** How a value is written on the screen, in the PDF and in the CSV file. */
export type CellKind =
  | "text"
  | "code"
  | "int"
  | "money"
  | "date"
  | "datetime"
  | "approval" // Approved / Waiting for Approval / Rejected / Reversed
  | "booking-status";

export type Tone = "neutral" | "approved" | "waiting" | "pending" | "refund";

export interface Column {
  key: string;
  label: string;
  kind: CellKind;
  tone?: Tone;
  /** a wider column in the PDF (long text) */
  wide?: boolean;
}

export interface SummaryItem {
  key: string;
  label: string;
  kind: "money" | "int";
  tone?: Tone;
}

export type FilterName =
  | "resort"
  | "range"
  | "group"
  | "split"
  | "dateField"
  | "dateType"
  | "asOf"
  | "kind"
  | "status"
  | "method"
  | "source";

/** The values of the filters. A filter a report does not use keeps its default and is not written in the address. */
export interface ReportFilter {
  resort: string | null;
  from: IsoDate | null;
  to: IsoDate | null;
  group: "day" | "week" | "month" | "year";
  split: "none" | "resort" | "method";
  dateField: "booking" | "check_in";
  dateType: "entry" | "record";
  asOf: IsoDate | null;
  kind: "payment" | "refund" | null;
  status: string | null;
  method: string | null;
  source: string | null;
  page: number;
  problem: string | null;
}

export interface ReportDef {
  key: ReportKey;
  title: string;
  /** one sentence on the card */
  blurb: string;
  uses: readonly FilterName[];
  /** a list that is read a page at a time; the others (collection, resort-wise, methods) are one table */
  paged: boolean;
  /** the longest period the database accepts (days), for the one-table reports */
  maxDays: number | null;
  /** the range is open by default for this report (waiting items, all of them) */
  rangeOpenByDefault: boolean;
  columns: (f: ReportFilter) => Column[];
  summary: (f: ReportFilter) => SummaryItem[];
  /** the totals row at the foot of the table: column key -> summary key */
  totals: (f: ReportFilter) => Record<string, string>;
  /** "Collection by payment date · Refunds by refund date" */
  dateRule: (f: ReportFilter) => string;
  /** "Approved payments only · Waiting shown apart · Rejected and reversed never counted" */
  approvalRule: (f: ReportFilter) => string;
}

export const PAGE_SIZE = 25;
/** Rows per database call when a file is made, and the most rows a PDF takes (TRD 5.8). */
export const EXPORT_PAGE = 1000;
export const PDF_MAX_ROWS = 1000;
/** A safety stop for a CSV file (the file is streamed, so memory is not the limit); far above any real report. */
export const CSV_MAX_ROWS = 100_000;
export const MAX_PERIOD_DAYS = 3660;

const m = (key: string, label: string, tone?: Tone): Column => ({
  key,
  label,
  kind: "money",
  tone,
});
const t = (key: string, label: string, wide = false): Column => ({
  key,
  label,
  kind: "text",
  wide,
});
const code = (key: string, label: string): Column => ({
  key,
  label,
  kind: "code",
});
const n = (key: string, label: string): Column => ({ key, label, kind: "int" });
const d = (key: string, label: string): Column => ({
  key,
  label,
  kind: "date",
});
const sm = (key: string, label: string, tone?: Tone): SummaryItem => ({
  key,
  label,
  kind: "money",
  tone,
});
const si = (key: string, label: string): SummaryItem => ({
  key,
  label,
  kind: "int",
});

const GROUP_WORD = {
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
  year: "Yearly",
} as const;
const SPLIT_WORD = {
  none: "",
  resort: " by resort",
  method: " by payment method",
} as const;

const APPROVED_RULE =
  "Total Collection (Approved) counts approved payments only; Waiting for Approval is shown apart and never added; rejected and reversed are never counted";

export const REPORTS: Record<ReportKey, ReportDef> = {
  collection: {
    key: "collection",
    title: "Collection",
    blurb:
      "Money received and refunded by day, week, month or year, also split by resort or payment method.",
    uses: ["resort", "range", "group", "split"],
    paged: false,
    maxDays: MAX_PERIOD_DAYS,
    rangeOpenByDefault: false,
    columns: (f) => [
      t("period", "Period"),
      ...(f.split === "resort" ? [t("resort", "Resort")] : []),
      ...(f.split === "method" ? [t("method", "Paid by")] : []),
      m("approved", "Total Collection (Approved)", "approved"),
      n("approvedCount", "Payments"),
      m("waiting", "Waiting for Approval", "waiting"),
      m("refunds", "Refunds (Approved)", "refund"),
      m("net", "Net Collection"),
    ],
    summary: () => [
      sm("totalApproved", "Total Collection (Approved)", "approved"),
      sm("totalWaiting", "Waiting for Approval", "waiting"),
      sm("totalRefunds", "Refunds (Approved)", "refund"),
      sm("totalNet", "Net Collection"),
    ],
    totals: () => ({
      approved: "totalApproved",
      waiting: "totalWaiting",
      refunds: "totalRefunds",
      net: "totalNet",
    }),
    dateRule: (f) =>
      `${GROUP_WORD[f.group]} collection${SPLIT_WORD[f.split]} · by payment date · refunds by refund date`,
    approvalRule: () =>
      `${APPROVED_RULE}; Net Collection = Total Collection − Refunds`,
  },
  "resort-wise": {
    key: "resort-wise",
    title: "Resort-wise Collection",
    blurb:
      "For each resort: what was expected, what was collected, and the difference.",
    uses: ["resort", "range"],
    paged: false,
    maxDays: MAX_PERIOD_DAYS,
    rangeOpenByDefault: false,
    columns: () => [
      t("resort", "Resort"),
      m("originallyExpected", "Originally Expected"),
      m("adjustments", "Expected Adjustments"),
      m("expected", "Expected Collection"),
      m("approved", "Total Collection (Approved)", "approved"),
      m("waiting", "Waiting for Approval", "waiting"),
      m("refunds", "Refunds (Approved)", "refund"),
      m("net", "Net Collection"),
      m("difference", "Difference"),
    ],
    summary: () => [
      sm("totalExpected", "Expected Collection"),
      sm("totalApproved", "Total Collection (Approved)", "approved"),
      sm("totalNet", "Net Collection"),
      sm("totalDifference", "Difference", "pending"),
    ],
    totals: () => ({
      originallyExpected: "totalOriginallyExpected",
      adjustments: "totalAdjustments",
      expected: "totalExpected",
      approved: "totalApproved",
      waiting: "totalWaiting",
      refunds: "totalRefunds",
      net: "totalNet",
      difference: "totalDifference",
    }),
    dateRule: () =>
      "Expected by due date (plan rows) and adjustment date · collection by payment date · refunds by refund date",
    approvalRule: () =>
      `${APPROVED_RULE}; Expected Collection = Originally Expected + Expected Adjustments; Difference = Expected − Total Collection (Approved)`,
  },
  "payment-methods": {
    key: "payment-methods",
    title: "Payment Methods",
    blurb:
      "Cash, UPI, card and the apps or banks used: received, waiting and refunded.",
    uses: ["resort", "range"],
    paged: false,
    maxDays: MAX_PERIOD_DAYS,
    rangeOpenByDefault: false,
    columns: () => [
      t("method", "Paid by"),
      t("provider", "App or bank"),
      m("approved", "Total Collection (Approved)", "approved"),
      n("approvedCount", "Payments"),
      m("waiting", "Waiting for Approval", "waiting"),
      n("waitingCount", "Waiting items"),
      m("refunds", "Refunds (Approved)", "refund"),
      m("net", "Net Collection"),
    ],
    summary: () => [
      sm("totalApproved", "Total Collection (Approved)", "approved"),
      sm("totalWaiting", "Waiting for Approval", "waiting"),
      sm("totalRefunds", "Refunds (Approved)", "refund"),
      sm("totalNet", "Net Collection"),
    ],
    totals: () => ({
      approved: "totalApproved",
      waiting: "totalWaiting",
      refunds: "totalRefunds",
      net: "totalNet",
    }),
    dateRule: () => "By payment date · refunds by refund date",
    approvalRule: () => APPROVED_RULE,
  },
  bookings: {
    key: "bookings",
    title: "Bookings",
    blurb:
      "Bookings made or arriving in a period, with the guests, amounts and C/O.",
    uses: ["resort", "range", "dateField", "status"],
    paged: true,
    maxDays: null,
    rangeOpenByDefault: false,
    columns: () => [
      code("code", "Booking ID"),
      t("resort", "Resort"),
      t("guest", "Guest"),
      d("bookingDate", "Booking date"),
      { key: "checkIn", label: "Check-in", kind: "datetime" },
      n("pax", "PAX"),
      t("pricing", "Pricing method"),
      t("co", "C/O", true),
      { key: "status", label: "Status", kind: "booking-status" },
      m("final", "Final Amount"),
      m("due", "Amount Due"),
    ],
    summary: () => [
      si("count", "Bookings"),
      si("pax", "PAX"),
      sm("final", "Final Amount"),
      sm("due", "Amount Due"),
    ],
    totals: () => ({ pax: "pax", final: "final", due: "due" }),
    dateRule: (f) =>
      f.dateField === "check_in" ? "By check-in date" : "By booking date",
    approvalRule: () =>
      "Final Amount is the booking's final amount; Amount Due is the final amount, or the cancellation charge once a booking is cancelled or a no-show",
  },
  pending: {
    key: "pending",
    title: "Pending Amount",
    blurb: "Bookings that still owe money, and how much of it is overdue.",
    uses: ["resort", "asOf"],
    paged: true,
    maxDays: null,
    rangeOpenByDefault: true,
    columns: () => [
      code("code", "Booking ID"),
      t("resort", "Resort"),
      t("guest", "Guest"),
      { key: "checkIn", label: "Check-in", kind: "datetime" },
      { key: "status", label: "Status", kind: "booking-status" },
      m("due", "Amount Due"),
      m("approved", "Total Collection (Approved)", "approved"),
      m("waiting", "Waiting for Approval", "waiting"),
      m("pending", "Pending Amount", "pending"),
      m("verified", "Verified Remaining", "pending"),
      m("overdue", "Overdue", "pending"),
    ],
    summary: () => [
      si("count", "Bookings"),
      sm("pending", "Pending Amount", "pending"),
      sm("verified", "Verified Remaining", "pending"),
      sm("overdue", "Overdue", "pending"),
    ],
    totals: () => ({
      pending: "pending",
      verified: "verified",
      overdue: "overdue",
    }),
    dateRule: (f) =>
      `Overdue as of ${formatDisplayDate(f.asOf ?? todayIst())} · Pending and Verified Remaining are as of now`,
    approvalRule: () =>
      "Lists bookings with Pending Amount or Verified Remaining above zero. Pending counts approved and waiting payments; Verified Remaining counts approved payments only; both less approved refunds. Overdue = what should have been received by the date, less what was received (net of refunds)",
  },
  waiting: {
    key: "waiting",
    title: "Waiting for Approval",
    blurb:
      "Payments and refunds that still wait for a decision, oldest first, with their age in days.",
    uses: ["resort", "range", "dateType", "kind"],
    paged: true,
    maxDays: null,
    rangeOpenByDefault: true,
    columns: () => [
      t("kind", "Type"),
      code("code", "Number"),
      code("booking", "Booking ID"),
      t("resort", "Resort"),
      t("guest", "Guest"),
      m("amount", "Amount", "waiting"),
      t("method", "Paid by"),
      d("recordDate", "Dated"),
      d("enteredOn", "Typed in on"),
      t("by", "Entered by"),
      n("age", "Days waiting"),
    ],
    summary: () => [
      sm("payments", "Payments waiting", "waiting"),
      si("paymentsCount", "Number of payments"),
      sm("refunds", "Refunds waiting", "refund"),
      si("refundsCount", "Number of refunds"),
    ],
    totals: () => ({ amount: "payments" }),
    dateRule: (f) =>
      f.dateType === "record"
        ? "By payment or refund date"
        : "By the date it was typed in",
    approvalRule: () =>
      "Only items waiting for approval. They are never counted in Total Collection or Net Collection. Days waiting = today (India) less the day it was typed in",
  },
  refunds: {
    key: "refunds",
    title: "Refunds",
    blurb:
      "Every refund by its refund date, with the status, method and reason.",
    uses: ["resort", "range", "status", "method"],
    paged: true,
    maxDays: null,
    rangeOpenByDefault: false,
    columns: () => [
      code("code", "Refund number"),
      code("booking", "Booking ID"),
      t("resort", "Resort"),
      t("guest", "Guest"),
      m("amount", "Amount", "refund"),
      t("method", "Paid by"),
      { key: "status", label: "Status", kind: "approval" },
      t("reason", "Reason", true),
      d("refundDate", "Refund date"),
      d("enteredOn", "Typed in on"),
    ],
    summary: () => [
      sm("approved", "Refunds (Approved)", "refund"),
      sm("waiting", "Waiting for Approval", "waiting"),
      sm("rejected", "Rejected"),
      sm("reversed", "Reversed"),
    ],
    totals: () => ({ amount: "approved" }),
    dateRule: () => "By refund date",
    approvalRule: () =>
      "Approved refunds are the refunds that count; waiting, rejected and reversed refunds are listed with their status and shown in their own totals, never added to Refunds (Approved)",
  },
  cancellations: {
    key: "cancellations",
    title: "Cancellations",
    blurb:
      "Cancelled and no-show bookings: the original amount, the charge and the refund due.",
    uses: ["resort", "range", "status"],
    paged: true,
    maxDays: null,
    rangeOpenByDefault: false,
    columns: () => [
      code("code", "Booking ID"),
      t("resort", "Resort"),
      t("guest", "Guest"),
      { key: "status", label: "Status", kind: "booking-status" },
      d("cancelledOn", "Cancelled on"),
      { key: "checkIn", label: "Check-in", kind: "datetime" },
      m("original", "Original Amount"),
      m("charge", "Cancellation Charge"),
      m("approved", "Total Collection (Approved)", "approved"),
      m("refundDue", "Refund due", "refund"),
      t("reason", "Reason", true),
    ],
    summary: () => [
      si("count", "Bookings"),
      sm("original", "Original Amount"),
      sm("charge", "Cancellation Charge"),
      sm("refundDue", "Refund due", "refund"),
    ],
    totals: () => ({
      original: "original",
      charge: "charge",
      refundDue: "refundDue",
    }),
    dateRule: () => "By cancellation date",
    approvalRule: () =>
      "Original Amount is the booking's final amount before the cancellation; Refund due is the approved payments less approved refunds, above the charge (waiting refunds do not change it)",
  },
  "expected-adjustments": {
    key: "expected-adjustments",
    title: "Expected Adjustments",
    blurb:
      "Every change to what was expected, on its own date, with the reason and who made it.",
    uses: ["resort", "range", "source"],
    paged: true,
    maxDays: null,
    rangeOpenByDefault: false,
    columns: () => [
      d("date", "Date"),
      code("booking", "Booking ID"),
      t("resort", "Resort"),
      t("guest", "Guest"),
      m("amount", "Amount"),
      t("source", "Why"),
      t("reason", "Reason", true),
      t("by", "Made by"),
    ],
    summary: () => [si("count", "Adjustments"), sm("total", "Net adjustment")],
    totals: () => ({ amount: "total" }),
    dateRule: () => "By adjustment date",
    approvalRule: () =>
      "Adjustments are shown on the day they were made; a past month's Originally Expected never changes (a later change appears here as an adjustment)",
  },
  "manual-adjustments": {
    key: "manual-adjustments",
    title: "Manual Adjustments",
    blurb:
      "Bookings whose amount or cancellation charge was changed by hand, with the reason.",
    uses: ["resort", "range"],
    paged: true,
    maxDays: null,
    rangeOpenByDefault: false,
    columns: () => [
      code("code", "Booking ID"),
      t("resort", "Resort"),
      t("guest", "Guest"),
      d("bookingDate", "Booking date"),
      { key: "status", label: "Status", kind: "booking-status" },
      m("total", "Total"),
      m("discount", "Discount"),
      m("adjustment", "Manual adjustment"),
      t("adjustmentReason", "Adjustment reason", true),
      m("final", "Final Amount"),
      m("charge", "Cancellation Charge"),
      t("chargeReason", "Charge change reason", true),
    ],
    summary: () => [
      si("count", "Bookings"),
      sm("total", "Total manual adjustment"),
    ],
    totals: () => ({ adjustment: "total" }),
    dateRule: () => "By booking date",
    approvalRule: () =>
      "The stored figures are shown as they are. A manual adjustment always has a written reason",
  },
};

export function isReportKey(v: string | undefined | null): v is ReportKey {
  return !!v && (REPORT_KEYS as readonly string[]).includes(v);
}

// ------------------------------------------------------------------------------------------- reading the address
type Raw = string | string[] | undefined;
type Params = Record<string, Raw>;
const first = (v: Raw) => (Array.isArray(v) ? v[0] : v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GROUPS = ["day", "week", "month", "year"] as const;
export const GROUP_LABELS: Record<(typeof GROUPS)[number], string> = {
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
  year: "Yearly",
};
export const SPLITS = ["none", "resort", "method"] as const;
export const SPLIT_LABELS: Record<(typeof SPLITS)[number], string> = {
  none: "No split",
  resort: "By resort",
  method: "By payment method",
};
export const BOOKING_STATUSES = [
  "confirmed",
  "checked_in",
  "checked_out",
  "cancelled",
  "no_show",
] as const;
export const BOOKING_STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmed",
  checked_in: "Checked-in",
  checked_out: "Checked-out",
  cancelled: "Cancelled",
  no_show: "No-show",
};
export const CANCEL_STATUSES = ["cancelled", "no_show"] as const;
export const APPROVAL_STATUSES = [
  "approved",
  "waiting",
  "rejected",
  "reversed",
] as const;
export const APPROVAL_LABELS: Record<string, string> = {
  approved: "Approved",
  waiting: "Waiting for Approval",
  rejected: "Rejected",
  reversed: "Reversed",
};
export const METHODS = ["cash", "upi", "card", "cheque", "other"] as const;
export const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  cheque: "Cheque",
  other: "Other",
};
export const SOURCES = [
  "cancellation",
  "no_show",
  "amount_change",
  "plan_change",
  "charge_change",
  "move_overdue",
] as const;
export const SOURCE_LABELS: Record<string, string> = {
  cancellation: "Booking cancelled",
  no_show: "No-show",
  amount_change: "Amount changed",
  plan_change: "Payment plan changed",
  charge_change: "Cancellation charge changed",
  move_overdue: "Overdue amount moved",
};
export const DATE_FIELDS = ["booking", "check_in"] as const;
export const DATE_FIELD_LABELS = {
  booking: "Booking date",
  check_in: "Check-in date",
} as const;
export const DATE_TYPES = ["entry", "record"] as const;
export const DATE_TYPE_LABELS = {
  entry: "The day it was typed in",
  record: "The payment or refund date",
} as const;
export const KINDS = ["payment", "refund"] as const;
export const KIND_LABELS = { payment: "Payments", refund: "Refunds" } as const;

export function defaultFilter(
  def: ReportDef,
  today: IsoDate = todayIst(),
): ReportFilter {
  const month = presetRange("month", today);
  const range = def.uses.includes("range") && !def.rangeOpenByDefault;
  return {
    resort: null,
    from: range ? month.from : null,
    to: range ? month.to : null,
    group: "day",
    split: "none",
    dateField: "booking",
    dateType: "entry",
    asOf: def.uses.includes("asOf") ? today : null,
    kind: null,
    status: null,
    method: null,
    source: null,
    page: 1,
    problem: null,
  };
}

/**
 * Reads the filters of a report from the address. A filter the report does not have is ignored. Anything wrong is NOT an
 * error page: it falls back to the default and says why in `problem`.
 * A range is "this month" the first time; a range with both boxes left empty (`from=&to=`) means no limit on the dates
 * (only for reports that allow it).
 */
export function parseReportFilter(
  def: ReportDef,
  params: Params,
  today: IsoDate = todayIst(),
): ReportFilter {
  const f = defaultFilter(def, today);
  let problem: string | null = null;
  const note = (s: string) => (problem ??= s);
  const has = (name: FilterName) => def.uses.includes(name);
  const choice = <T extends string>(
    raw: Raw,
    list: readonly T[],
    what: string,
    allowAll = false,
  ): T | null => {
    const v = first(raw);
    if (!v || (allowAll && v === "all")) return null;
    if ((list as readonly string[]).includes(v)) return v as T;
    note(`That ${what} is not known, so the usual choice is used.`);
    return null;
  };

  if (has("resort")) {
    const v = first(params.resort);
    if (v && v !== "all") {
      if (UUID.test(v)) f.resort = v.toLowerCase();
      else note("That resort was not found, so all resorts are shown.");
    }
  }
  if (has("range")) {
    const fromRaw = first(params.from);
    const toRaw = first(params.to);
    if (fromRaw !== undefined || toRaw !== undefined) {
      const from = fromRaw || null;
      const to = toRaw || null;
      if ((from && !isIsoDate(from)) || (to && !isIsoDate(to))) {
        note("A date was not valid, so this month is shown.");
      } else if (from && to && to < from) {
        note(
          "The end date cannot be before the start date, so this month is shown.",
        );
      } else if (def.maxDays !== null && (!from || !to)) {
        note(
          "Please choose a start date and an end date, so this month is shown.",
        );
      } else if (
        def.maxDays !== null &&
        from &&
        to &&
        daysBetween(from, to) > def.maxDays
      ) {
        note(
          "Please choose a period of at most ten years, so this month is shown.",
        );
      } else {
        f.from = from;
        f.to = to;
      }
    }
  }
  if (has("asOf")) {
    const v = first(params.asOf);
    if (v) {
      if (isIsoDate(v)) f.asOf = v;
      else note("That date was not valid, so today is used.");
    }
  }
  if (has("group"))
    f.group = choice(params.group, GROUPS, "grouping") ?? f.group;
  if (has("split")) f.split = choice(params.split, SPLITS, "split") ?? f.split;
  if (has("dateField"))
    f.dateField =
      choice(params.dateField, DATE_FIELDS, "date choice") ?? f.dateField;
  if (has("dateType"))
    f.dateType =
      choice(params.dateType, DATE_TYPES, "date choice") ?? f.dateType;
  if (has("kind")) f.kind = choice(params.kind, KINDS, "choice", true);
  if (has("method"))
    f.method = choice(params.method, METHODS, "payment method", true);
  if (has("source")) f.source = choice(params.source, SOURCES, "reason", true);
  if (has("status")) {
    const list =
      def.key === "refunds"
        ? APPROVAL_STATUSES
        : def.key === "cancellations"
          ? CANCEL_STATUSES
          : BOOKING_STATUSES;
    f.status = choice(params.status, list, "status", true);
  }
  const pageRaw = first(params.page);
  if (def.paged && pageRaw && /^\d{1,6}$/.test(pageRaw) && Number(pageRaw) >= 1)
    f.page = Number(pageRaw);
  f.problem = problem;
  return f;
}

/** The address parts of a filter (only what the report uses). Used for the page's links and for the files. */
export function filterQuery(
  def: ReportDef,
  f: ReportFilter,
  over: Partial<ReportFilter> = {},
): URLSearchParams {
  const x = { ...f, ...over };
  const q = new URLSearchParams();
  const has = (name: FilterName) => def.uses.includes(name);
  if (has("resort") && x.resort) q.set("resort", x.resort);
  if (has("range")) {
    q.set("from", x.from ?? "");
    q.set("to", x.to ?? "");
  }
  if (has("asOf") && x.asOf) q.set("asOf", x.asOf);
  if (has("group") && x.group !== "day") q.set("group", x.group);
  if (has("split") && x.split !== "none") q.set("split", x.split);
  if (has("dateField") && x.dateField !== "booking")
    q.set("dateField", x.dateField);
  if (has("dateType") && x.dateType !== "entry") q.set("dateType", x.dateType);
  if (has("kind") && x.kind) q.set("kind", x.kind);
  if (has("method") && x.method) q.set("method", x.method);
  if (has("source") && x.source) q.set("source", x.source);
  if (has("status") && x.status) q.set("status", x.status);
  if (def.paged && x.page > 1) q.set("page", String(x.page));
  return q;
}

export function reportHref(
  def: ReportDef,
  f: ReportFilter,
  over: Partial<ReportFilter> = {},
): string {
  const s = filterQuery(def, f, over).toString();
  return s ? `/reports/${def.key}?${s}` : `/reports/${def.key}`;
}

export type ExportFormat = "csv" | "pdf";
export function exportHref(
  def: ReportDef,
  f: ReportFilter,
  format: ExportFormat,
): string {
  const q = filterQuery(def, f, { page: 1 });
  q.set("format", format);
  return `/api/export/${def.key}?${q.toString()}`;
}

/** A safe file name: letters, digits, dots, dashes and underscores only. */
export function exportFileName(
  def: ReportDef,
  f: ReportFilter,
  format: ExportFormat,
): string {
  const when =
    def.uses.includes("asOf") && !def.uses.includes("range")
      ? `as-of-${f.asOf ?? "today"}`
      : def.uses.includes("range")
        ? `${f.from ?? "start"}_${f.to ?? "end"}`
        : "all";
  return `stateadv-${def.key}-${when}.${format}`.replace(
    /[^a-zA-Z0-9._-]/g,
    "-",
  );
}

/** "Resort: All resorts · Period: 1 Mar 2026 – 31 Mar 2026 · Status: Cancelled" */
export function filterText(
  def: ReportDef,
  f: ReportFilter,
  resortName: string | null,
): string {
  const parts: string[] = [];
  if (def.uses.includes("resort"))
    parts.push(`Resort: ${resortName ?? "All resorts"}`);
  if (def.uses.includes("range")) {
    parts.push(
      f.from && f.to
        ? `Period: ${periodText(f.from, f.to)}`
        : f.from
          ? `From: ${formatDisplayDate(f.from)}`
          : f.to
            ? `Until: ${formatDisplayDate(f.to)}`
            : "Period: all dates",
    );
  }
  if (def.uses.includes("asOf") && f.asOf)
    parts.push(`As of: ${formatDisplayDate(f.asOf)}`);
  if (def.uses.includes("kind") && f.kind)
    parts.push(`Only: ${KIND_LABELS[f.kind]}`);
  if (def.uses.includes("status") && f.status)
    parts.push(
      `Status: ${APPROVAL_LABELS[f.status] ?? BOOKING_STATUS_LABELS[f.status] ?? f.status}`,
    );
  if (def.uses.includes("method") && f.method)
    parts.push(`Paid by: ${METHOD_LABELS[f.method]}`);
  if (def.uses.includes("source") && f.source)
    parts.push(`Why: ${SOURCE_LABELS[f.source]}`);
  return parts.join(" · ");
}

/** The ready-made periods offered above the dates. */
export function presetPeriods(
  today: IsoDate = todayIst(),
): { key: string; label: string; from: IsoDate; to: IsoDate }[] {
  const month = presetRange("month", today);
  const [y, mo] = today.split("-").map(Number);
  const lastEnd = new Date(Date.UTC(y, mo - 1, 0));
  const lastStart = new Date(Date.UTC(y, mo - 2, 1));
  const iso = (dt: Date) => dt.toISOString().slice(0, 10);
  return [
    { key: "month", label: "This month", ...month },
    {
      key: "last-month",
      label: "Last month",
      from: iso(lastStart),
      to: iso(lastEnd),
    },
    { key: "year", label: "This year", ...presetRange("year", today) },
  ];
}
