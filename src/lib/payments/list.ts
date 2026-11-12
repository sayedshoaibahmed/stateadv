/**
 * The Payments, Refunds and Waiting-for-Approval lists: the filters live in the page address (?status=waiting&...).
 * Pure and unit-tested. A bad value in the address is never an error page: it is ignored and says so in `problem`.
 * The database functions `payment_list` and `refund_list` do the filtering and counting (migration 22).
 */
import { isIsoDate } from "@/lib/dates";
import { cleanSearch } from "@/lib/bookings/list";
import { METHODS, type Method } from "@/lib/payments/form";
import { isStatus, type Kind, type Status } from "@/lib/payments/rules";

export const PAGE_SIZE = 25;
export const STATUSES: readonly Status[] = [
  "waiting",
  "approved",
  "rejected",
  "reversed",
];

export type DateType = "record" | "entry";

export interface MoneyFilter {
  kind: Kind;
  q: string;
  status: Status | null;
  method: Method | null;
  provider: number | null;
  resort: string | null;
  booking: string | null;
  dateType: DateType;
  from: string | null;
  to: string | null;
  recordedBy: string | null;
  selfApproved: boolean;
  /** the approval queue order */
  oldestFirst: boolean;
  page: number;
  /** rows per page (25 on the list screens, up to 100 where a whole booking's items are shown) */
  size: number;
  problem: string | null;
}

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) =>
  Array.isArray(v) ? v[0] : v;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseMoneyFilter(
  kind: Kind,
  params: Params,
  o: { queue?: boolean; size?: number } = {},
): MoneyFilter {
  let problem: string | null = null;
  const note = (s: string) => (problem ??= s);
  const uuid = (key: string, what: string) => {
    const raw = first(params[key]);
    if (!raw || raw === "all") return null;
    if (UUID.test(raw)) return raw.toLowerCase();
    note(`That ${what} was not found, so it was ignored.`);
    return null;
  };
  const statusRaw = first(params.status);
  let status: Status | null = o.queue ? "waiting" : null;
  if (!o.queue && statusRaw && statusRaw !== "all") {
    if (isStatus(statusRaw)) status = statusRaw;
    else note("That status is not known, so all statuses are shown.");
  }
  const methodRaw = first(params.method);
  let method: Method | null = null;
  if (methodRaw && methodRaw !== "all") {
    if ((METHODS as readonly string[]).includes(methodRaw))
      method = methodRaw as Method;
    else note("That payment method is not known, so all are shown.");
  }
  const provRaw = first(params.provider);
  let provider: number | null = null;
  if (provRaw && provRaw !== "all") {
    if (/^\d{1,5}$/.test(provRaw)) provider = Number(provRaw);
    else note("That payment app was not found, so all are shown.");
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
  const dtRaw = first(params.dateType);
  const dateType: DateType = dtRaw === "entry" ? "entry" : "record";
  if (dtRaw && dtRaw !== "entry" && dtRaw !== "record")
    note("That date type is not known, so the date on the record is used.");
  const pageRaw = first(params.page);
  return {
    kind,
    q: cleanSearch(first(params.q)),
    status,
    method,
    provider,
    resort: uuid("resort", "resort"),
    booking: uuid("booking", "booking"),
    dateType,
    from,
    to,
    recordedBy: uuid("by", "person"),
    selfApproved: first(params.self) === "1",
    oldestFirst: o.queue === true,
    page:
      pageRaw && /^\d{1,6}$/.test(pageRaw) && Number(pageRaw) >= 1
        ? Number(pageRaw)
        : 1,
    size: Math.min(Math.max(o.size ?? PAGE_SIZE, 1), 100),
    problem,
  };
}

/** The arguments of `payment_list` / `refund_list`. undefined = "do not filter" (how the generated types spell it). */
export function moneyArgs(f: MoneyFilter, size: number = f.size) {
  return {
    p_q: f.q === "" ? undefined : f.q,
    p_status: f.status ?? undefined,
    p_method: f.method ?? undefined,
    p_provider: f.provider ?? undefined,
    p_resort: f.resort ?? undefined,
    p_booking: f.booking ?? undefined,
    p_date_type: f.dateType === "entry" ? "entry" : f.kind,
    p_from: f.from ?? undefined,
    p_to: f.to ?? undefined,
    p_recorded_by: f.recordedBy ?? undefined,
    p_self_approved: f.selfApproved ? true : undefined,
    p_oldest_first: f.oldestFirst,
    p_limit: size,
    p_offset: (f.page - 1) * size,
  };
}

/** The address of a list page for a filter (only what differs from the default is written). */
export function moneyHref(
  base: string,
  f: MoneyFilter,
  over: Partial<MoneyFilter> = {},
): string {
  const x = { ...f, ...over };
  const q = new URLSearchParams();
  if (x.q) q.set("q", x.q);
  if (x.status && !x.oldestFirst) q.set("status", x.status);
  if (x.method) q.set("method", x.method);
  if (x.provider !== null) q.set("provider", String(x.provider));
  if (x.resort) q.set("resort", x.resort);
  if (x.booking) q.set("booking", x.booking);
  if (x.dateType === "entry") q.set("dateType", "entry");
  if (x.from) q.set("from", x.from);
  if (x.to) q.set("to", x.to);
  if (x.recordedBy) q.set("by", x.recordedBy);
  if (x.selfApproved) q.set("self", "1");
  if (x.page > 1) q.set("page", String(x.page));
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

export const pageCount = (total: number): number =>
  Math.max(1, Math.ceil(total / PAGE_SIZE));

export function activeFilterCount(f: MoneyFilter): number {
  return [
    f.status && !f.oldestFirst,
    f.method,
    f.provider !== null,
    f.resort,
    f.booking,
    f.from || f.to,
    f.recordedBy,
    f.selfApproved,
  ].filter(Boolean).length;
}
