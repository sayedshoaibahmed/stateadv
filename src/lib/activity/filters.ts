/**
 * Activity: the filters live in the page address (?type=payment&action=update&from=...), so a page can be bookmarked or
 * reloaded. Pure and unit-tested. A bad value in the address is never an error page: it is ignored and says so in
 * `problem`. The database function `activity_list` (migration 24) does the filtering and counting; the audit log itself
 * can only be added to (PRD FR-AUD-2).
 */
import { isIsoDate } from "@/lib/dates";

export const PAGE_SIZE = 25;

export const ACTIONS = ["insert", "update", "account"] as const;
export type ActionFilter = (typeof ACTIONS)[number];
export const ACTION_LABELS: Record<ActionFilter, string> = {
  insert: "Added",
  update: "Changed",
  account: "Account actions (password resets and similar)",
};

export const RECORD_TYPES = [
  "booking",
  "payment",
  "refund",
  "file",
  "plan",
  "guest",
  "resort",
  "setting",
  "user",
  "approval",
  "pdf",
] as const;
export type RecordKind = (typeof RECORD_TYPES)[number];
export const RECORD_LABELS: Record<RecordKind, string> = {
  booking: "Bookings",
  payment: "Payments",
  refund: "Refunds",
  file: "Screenshots and receipts",
  plan: "Payment plans and adjustments",
  guest: "Guests",
  resort: "Resorts",
  setting: "Lists and settings",
  user: "People and accounts",
  approval: "Approval steps",
  pdf: "PDF versions",
};

export interface ActivityFilter {
  actor: string | null;
  action: ActionFilter | null;
  type: RecordKind | null;
  resort: string | null;
  booking: string | null;
  from: string | null;
  to: string | null;
  /** only files added after approval */
  corrections: boolean;
  page: number;
  problem: string | null;
}

type Raw = string | string[] | undefined;
type Params = Record<string, Raw>;
const first = (v: Raw) => (Array.isArray(v) ? v[0] : v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseActivityFilter(params: Params): ActivityFilter {
  let problem: string | null = null;
  const note = (s: string) => (problem ??= s);
  const uuid = (raw: Raw, what: string): string | null => {
    const v = first(raw);
    if (!v || v === "all") return null;
    if (UUID.test(v)) return v.toLowerCase();
    note(`That ${what} was not found, so it was ignored.`);
    return null;
  };
  const actor = uuid(params.actor, "person");
  const resort = uuid(params.resort, "resort");
  const booking = uuid(params.booking, "booking");
  const actionRaw = first(params.action);
  let action: ActionFilter | null = null;
  if (actionRaw && actionRaw !== "all") {
    if ((ACTIONS as readonly string[]).includes(actionRaw))
      action = actionRaw as ActionFilter;
    else note("That kind of action is not known, so all are shown.");
  }
  const typeRaw = first(params.type);
  let type: RecordKind | null = null;
  if (typeRaw && typeRaw !== "all") {
    if ((RECORD_TYPES as readonly string[]).includes(typeRaw))
      type = typeRaw as RecordKind;
    else note("That kind of record is not known, so all are shown.");
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
    actor,
    action,
    type,
    resort,
    booking,
    from,
    to,
    corrections: first(params.corrections) === "1",
    page,
    problem,
  };
}

/** The arguments of the database function `activity_list` for a filter. */
export function listArgs(f: ActivityFilter) {
  // undefined (not null) = "do not filter": that is how the generated database types spell an omitted argument
  return {
    p_actor: f.actor ?? undefined,
    p_action: f.action ?? undefined,
    p_record_type: f.type ?? undefined,
    p_resort: f.resort ?? undefined,
    p_booking: f.booking ?? undefined,
    p_from: f.from ?? undefined,
    p_to: f.to ?? undefined,
    p_corrections: f.corrections ? true : undefined,
    p_limit: PAGE_SIZE,
    p_offset: (f.page - 1) * PAGE_SIZE,
  };
}

/** The address for a filter (only what differs from the default is written). */
export function activityHref(
  f: ActivityFilter,
  over: Partial<ActivityFilter> = {},
): string {
  const x = { ...f, ...over };
  const q = new URLSearchParams();
  if (x.actor) q.set("actor", x.actor);
  if (x.action) q.set("action", x.action);
  if (x.type) q.set("type", x.type);
  if (x.resort) q.set("resort", x.resort);
  if (x.booking) q.set("booking", x.booking);
  if (x.from) q.set("from", x.from);
  if (x.to) q.set("to", x.to);
  if (x.corrections) q.set("corrections", "1");
  if (x.page > 1) q.set("page", String(x.page));
  const s = q.toString();
  return s ? `/activity?${s}` : "/activity";
}

export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

export function activeFilterCount(f: ActivityFilter): number {
  return [
    f.actor,
    f.action,
    f.type,
    f.resort,
    f.booking,
    f.from || f.to,
    f.corrections,
  ].filter(Boolean).length;
}
