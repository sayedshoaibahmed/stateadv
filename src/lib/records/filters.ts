/**
 * Old Records: the filters live in the page address (?q=...&types=payment&from=...), so a page can be bookmarked or
 * reloaded. Pure and unit-tested. A bad value in the address is never an error page: it is ignored and says so in
 * `problem`. The database function `old_records_search` (migration 24) does the searching and counting.
 */
import { isIsoDate } from "@/lib/dates";

export const PAGE_SIZE = 25;

export const TYPES = ["booking", "payment", "refund"] as const;
export type RecordType = (typeof TYPES)[number];
export const TYPE_LABELS: Record<RecordType, string> = {
  booking: "Bookings",
  payment: "Payments",
  refund: "Refunds",
};
export const TYPE_SINGULAR: Record<RecordType, string> = {
  booking: "Booking",
  payment: "Payment",
  refund: "Refund",
};

/**
 * Which stored date the range applies to (PRD FR-CAL-3). The last three are dates of the BOOKING: a payment or refund
 * is found through the date of its booking and listed with it.
 */
export const BASES = [
  "record",
  "entry",
  "check_in",
  "check_out",
  "cancellation",
] as const;
export type Basis = (typeof BASES)[number];
export const BASIS_LABELS: Record<Basis, string> = {
  record: "The date on the record (booking, payment or refund date)",
  entry: "The day it was typed in",
  check_in: "Check-in date of the booking",
  check_out: "Check-out date of the booking",
  cancellation: "Cancellation date (cancelled and no-show bookings only)",
};
/** The short name shown under a row's date, so it is clear which date matched. */
export const BASIS_SHORT: Record<Basis, string> = {
  record: "Dated",
  entry: "Typed in",
  check_in: "Booking checks in",
  check_out: "Booking checks out",
  cancellation: "Booking cancelled",
};
/** True for the dates that belong to the booking (payments and refunds are matched through their booking). */
export const isBookingDate = (b: Basis): boolean =>
  b === "check_in" || b === "check_out" || b === "cancellation";

export interface RecordFilter {
  q: string;
  resort: string | null;
  /** empty = all three kinds */
  types: RecordType[];
  basis: Basis;
  from: string | null;
  to: string | null;
  page: number;
  problem: string | null;
}

type Raw = string | string[] | undefined;
type Params = Record<string, Raw>;
const first = (v: Raw) => (Array.isArray(v) ? v[0] : v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Capitals do not matter and extra spaces are removed; very long text is cut. */
export function cleanSearch(text: string | undefined | null): string {
  return (text ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
}

export function parseRecordFilter(params: Params): RecordFilter {
  let problem: string | null = null;
  const note = (s: string) => (problem ??= s);
  const resortRaw = first(params.resort);
  let resort: string | null = null;
  if (resortRaw && resortRaw !== "all") {
    if (UUID.test(resortRaw)) resort = resortRaw.toLowerCase();
    else note("That resort was not found, so all resorts are shown.");
  }
  const rawTypes = ([] as string[]).concat(params.types ?? []);
  const types: RecordType[] = [];
  for (const t of rawTypes) {
    if ((TYPES as readonly string[]).includes(t)) {
      if (!types.includes(t as RecordType)) types.push(t as RecordType);
    } else if (t && t !== "all") {
      note("A kind of record in the address was not known, so it was ignored.");
    }
  }
  const basisRaw = first(params.basis);
  let basis: Basis = "record";
  if (basisRaw) {
    if ((BASES as readonly string[]).includes(basisRaw))
      basis = basisRaw as Basis;
    else
      note("That date type is not known, so the date on the record is used.");
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
  const pageRaw = first(params.page);
  const page =
    pageRaw && /^\d{1,6}$/.test(pageRaw) && Number(pageRaw) >= 1
      ? Number(pageRaw)
      : 1;
  return {
    q: cleanSearch(first(params.q)),
    resort,
    types: TYPES.filter((t) => types.includes(t)),
    basis,
    from,
    to,
    page,
    problem,
  };
}

/** The arguments of the database function `old_records_search` for a filter. */
export function searchArgs(f: RecordFilter) {
  // undefined (not null) = "do not filter": that is how the generated database types spell an omitted argument
  return {
    p_q: f.q === "" ? undefined : f.q,
    p_resort: f.resort ?? undefined,
    p_types: f.types.length ? [...f.types] : undefined,
    p_basis: f.basis,
    p_from: f.from ?? undefined,
    p_to: f.to ?? undefined,
    p_limit: PAGE_SIZE,
    p_offset: (f.page - 1) * PAGE_SIZE,
  };
}

/** The address for a filter (only what differs from the default is written). */
export function recordsHref(
  f: RecordFilter,
  over: Partial<RecordFilter> = {},
): string {
  const x = { ...f, ...over };
  const q = new URLSearchParams();
  if (x.q) q.set("q", x.q);
  if (x.resort) q.set("resort", x.resort);
  for (const t of x.types) q.append("types", t);
  if (x.basis !== "record") q.set("basis", x.basis);
  if (x.from) q.set("from", x.from);
  if (x.to) q.set("to", x.to);
  if (x.page > 1) q.set("page", String(x.page));
  const s = q.toString();
  return s ? `/old-records?${s}` : "/old-records";
}

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

export function activeFilterCount(f: RecordFilter): number {
  return [
    f.resort,
    f.types.length > 0,
    f.from || f.to,
    f.basis !== "record",
  ].filter(Boolean).length;
}

/** The address of the record's own page. */
export function recordHref(type: RecordType, id: string): string {
  if (type === "booking") return `/bookings/${id}`;
  if (type === "payment") return `/payments/${id}`;
  return `/refunds/${id}`;
}
