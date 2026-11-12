/**
 * The Bookings list: the filters live in the page address (?q=...&status=...), so a page can be bookmarked or reloaded.
 * Pure and unit-tested. A bad value in the address is never an error page: it is ignored and says so in `problem`.
 * The database function `booking_list` does the filtering and counting (migration 21).
 */
import { isIsoDate } from "@/lib/dates";

export const PAGE_SIZE = 25;

export const STATUSES = [
  "confirmed",
  "checked_in",
  "checked_out",
  "cancelled",
  "no_show",
] as const;
export type BookingStatus = (typeof STATUSES)[number];
export const STATUS_LABELS: Record<BookingStatus, string> = {
  confirmed: "Confirmed",
  checked_in: "Checked-in",
  checked_out: "Checked-out",
  cancelled: "Cancelled",
  no_show: "No-show",
};

export const DATE_TYPES = ["booking", "check_in", "check_out"] as const;
export type DateType = (typeof DATE_TYPES)[number];
export const DATE_TYPE_LABELS: Record<DateType, string> = {
  booking: "Booking date",
  check_in: "Check-in date",
  check_out: "Check-out date",
};

export const METHODS = ["per_person_per_night", "per_person_per_stay"] as const;
export type Method = (typeof METHODS)[number];
export const METHOD_LABELS: Record<Method, string> = {
  per_person_per_night: "Per person per night",
  per_person_per_stay: "Per person per stay",
};

export interface BookingFilter {
  q: string;
  resort: string | null;
  status: BookingStatus | null;
  dateType: DateType;
  from: string | null;
  to: string | null;
  coCategory: number | null;
  method: Method | null;
  hasPending: boolean;
  hasWaiting: boolean;
  refundDue: boolean;
  adjusted: boolean;
  page: number;
  problem: string | null;
}

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) =>
  Array.isArray(v) ? v[0] : v;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Capitals do not matter and extra spaces are removed; very long text is cut. */
export function cleanSearch(text: string | undefined | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
}

export function parseBookingFilter(params: Params): BookingFilter {
  let problem: string | null = null;
  const note = (s: string) => (problem ??= s);
  const resortRaw = first(params.resort);
  let resort: string | null = null;
  if (resortRaw && resortRaw !== "all") {
    if (UUID.test(resortRaw)) resort = resortRaw.toLowerCase();
    else note("That resort was not found, so all resorts are shown.");
  }
  const statusRaw = first(params.status);
  let status: BookingStatus | null = null;
  if (statusRaw && statusRaw !== "all") {
    if ((STATUSES as readonly string[]).includes(statusRaw))
      status = statusRaw as BookingStatus;
    else note("That status is not known, so all statuses are shown.");
  }
  const dtRaw = first(params.dateType);
  let dateType: DateType = "booking";
  if (dtRaw) {
    if ((DATE_TYPES as readonly string[]).includes(dtRaw))
      dateType = dtRaw as DateType;
    else note("That date type is not known, so the booking date is used.");
  }
  let from = first(params.from) || null;
  let to = first(params.to) || null;
  if ((from && !isIsoDate(from)) || (to && !isIsoDate(to))) {
    note("A date in the address was not valid, so the dates were ignored.");
    from = null;
    to = null;
  } else if (from && to && to < from) {
    note(
      "The end date cannot be before the start date, so the dates were ignored.",
    );
    from = null;
    to = null;
  }
  const coRaw = first(params.co);
  let coCategory: number | null = null;
  if (coRaw && coRaw !== "all") {
    if (/^\d{1,5}$/.test(coRaw)) coCategory = Number(coRaw);
    else note("That C/O type was not found, so all are shown.");
  }
  const mRaw = first(params.method);
  let method: Method | null = null;
  if (mRaw && mRaw !== "all") {
    if ((METHODS as readonly string[]).includes(mRaw)) method = mRaw as Method;
    else note("That pricing method is not known, so all are shown.");
  }
  const flag = (k: string) => first(params[k]) === "1";
  const pageRaw = first(params.page);
  const page =
    pageRaw && /^\d{1,6}$/.test(pageRaw) && Number(pageRaw) >= 1
      ? Number(pageRaw)
      : 1;
  return {
    q: cleanSearch(first(params.q)),
    resort,
    status,
    dateType,
    from,
    to,
    coCategory,
    method,
    hasPending: flag("pending"),
    hasWaiting: flag("waiting"),
    refundDue: flag("refund"),
    adjusted: flag("adjusted"),
    page,
    problem,
  };
}

/** The arguments of the database function `booking_list` for a filter. */
export function listArgs(f: BookingFilter) {
  // undefined (not null) = "do not filter": that is how the generated database types spell an omitted argument
  return {
    p_q: f.q === "" ? undefined : f.q,
    p_resort: f.resort ?? undefined,
    p_status: f.status ?? undefined,
    p_date_type: f.dateType,
    p_from: f.from ?? undefined,
    p_to: f.to ?? undefined,
    p_co_category: f.coCategory ?? undefined,
    p_method: f.method ?? undefined,
    p_has_pending: f.hasPending ? true : undefined,
    p_has_waiting: f.hasWaiting ? true : undefined,
    p_refund_due: f.refundDue ? true : undefined,
    p_adjusted: f.adjusted ? true : undefined,
    p_limit: PAGE_SIZE,
    p_offset: (f.page - 1) * PAGE_SIZE,
  };
}

/** The address for a filter (only what differs from the default is written). */
export function listHref(
  f: BookingFilter,
  over: Partial<BookingFilter> = {},
): string {
  const x = { ...f, ...over };
  const q = new URLSearchParams();
  if (x.q) q.set("q", x.q);
  if (x.resort) q.set("resort", x.resort);
  if (x.status) q.set("status", x.status);
  if (x.dateType !== "booking") q.set("dateType", x.dateType);
  if (x.from) q.set("from", x.from);
  if (x.to) q.set("to", x.to);
  if (x.coCategory !== null) q.set("co", String(x.coCategory));
  if (x.method) q.set("method", x.method);
  if (x.hasPending) q.set("pending", "1");
  if (x.hasWaiting) q.set("waiting", "1");
  if (x.refundDue) q.set("refund", "1");
  if (x.adjusted) q.set("adjusted", "1");
  if (x.page > 1) q.set("page", String(x.page));
  const s = q.toString();
  return s ? `/bookings?${s}` : "/bookings";
}

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

export function activeFilterCount(f: BookingFilter): number {
  return [
    f.resort,
    f.status,
    f.from || f.to,
    f.coCategory !== null,
    f.method,
    f.hasPending,
    f.hasWaiting,
    f.refundDue,
    f.adjusted,
  ].filter(Boolean).length;
}
