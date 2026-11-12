/**
 * The dashboard's filters: which resort and which period (PRD FR-DSH-3, UI spec 3.2).
 * Pure functions, no Next.js and no database, so every rule is unit-tested. All dates are plain IST calendar dates
 * ("2026-11-12"), the same form PostgreSQL's `date` uses; nothing here depends on the computer's time zone.
 *
 * The filter lives in the page address (?resort=...&range=month), so a page can be bookmarked, shared or reloaded.
 * Anything wrong in the address (a made-up resort, a broken date, a period of ten years) is NOT an error page: the
 * filter falls back to the default and says why in `problem`, which the page shows in plain words.
 */
import {
  daysBetween,
  formatDisplayDate,
  isIsoDate,
  todayIst,
  type IsoDate,
} from "@/lib/dates";

export const RANGE_KEYS = ["today", "week", "month", "year", "custom"] as const;
export type RangeKey = (typeof RANGE_KEYS)[number];

export const RANGE_LABELS: Record<RangeKey, string> = {
  today: "Today",
  week: "This Week",
  month: "This Month",
  year: "This Year",
  custom: "Custom",
};

/** What a manager most often wants first: the month so far and the rest of it. */
export const DEFAULT_RANGE: RangeKey = "month";
/** The longest period a person can ask for by hand (the database allows ten years; one year is plenty here). */
export const MAX_CUSTOM_DAYS = 366;
/** Above this many days the chart groups by month instead of by day (a year of bars is unreadable on a phone). */
export const MONTHLY_CHART_OVER_DAYS = 62;

export interface DashboardFilter {
  /** null = all resorts */
  resort: string | null;
  range: RangeKey;
  from: IsoDate;
  to: IsoDate;
  /** plain-English reason the address was not used as given, or null */
  problem: string | null;
}

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) =>
  Array.isArray(v) ? v[0] : v;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toUtc = (d: IsoDate) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
};
const toIso = (dt: Date) => dt.toISOString().slice(0, 10);
export const addDays = (d: IsoDate, n: number): IsoDate => {
  const dt = toUtc(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return toIso(dt);
};

/** The dates a ready-made period covers, counted from `today`. The week runs Monday to Sunday. */
export function presetRange(
  key: Exclude<RangeKey, "custom">,
  today: IsoDate,
): { from: IsoDate; to: IsoDate } {
  const [y, m] = today.split("-").map(Number);
  switch (key) {
    case "today":
      return { from: today, to: today };
    case "week": {
      const sinceMonday = (toUtc(today).getUTCDay() + 6) % 7; // Monday = 0 ... Sunday = 6
      const from = addDays(today, -sinceMonday);
      return { from, to: addDays(from, 6) };
    }
    case "month":
      return {
        from: toIso(new Date(Date.UTC(y, m - 1, 1))),
        to: toIso(new Date(Date.UTC(y, m, 0))),
      };
    case "year":
      return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
}

export function parseDashboardFilter(
  params: Params,
  today: IsoDate = todayIst(),
): DashboardFilter {
  let problem: string | null = null;

  const rawResort = first(params.resort);
  let resort: string | null = null;
  if (rawResort && rawResort !== "all") {
    if (UUID.test(rawResort)) resort = rawResort.toLowerCase();
    else problem = "That resort was not found, so all resorts are shown.";
  }

  const rawRange = first(params.range);
  let range: RangeKey = DEFAULT_RANGE;
  if (rawRange) {
    if ((RANGE_KEYS as readonly string[]).includes(rawRange))
      range = rawRange as RangeKey;
    else
      problem ??= `"${rawRange.slice(0, 20)}" is not a period we know, so ${RANGE_LABELS[DEFAULT_RANGE]} is shown.`;
  }

  if (range === "custom") {
    const from = first(params.from);
    const to = first(params.to);
    if (!from || !to || !isIsoDate(from) || !isIsoDate(to)) {
      problem ??= "Please choose both dates for a custom period.";
      range = DEFAULT_RANGE;
    } else if (to < from) {
      problem ??= "The end date cannot be before the start date.";
      range = DEFAULT_RANGE;
    } else if (daysBetween(from, to) + 1 > MAX_CUSTOM_DAYS) {
      problem ??= "Please choose a period of at most one year.";
      range = DEFAULT_RANGE;
    } else {
      return { resort, range: "custom", from, to, problem };
    }
  }
  const { from, to } = presetRange(range as Exclude<RangeKey, "custom">, today);
  return { resort, range, from, to, problem };
}

/** "12 Nov 2026" for one day, "1 Nov 2026 – 30 Nov 2026" for a period. */
export function periodText(from: IsoDate, to: IsoDate): string {
  return from === to
    ? formatDisplayDate(from)
    : `${formatDisplayDate(from)} – ${formatDisplayDate(to)}`;
}

/** The chart groups by month for long periods, by day otherwise. */
export function chartGrain(from: IsoDate, to: IsoDate): "day" | "month" {
  return daysBetween(from, to) + 1 > MONTHLY_CHART_OVER_DAYS ? "month" : "day";
}

/** A dashboard address that keeps the filter (used by the links). */
export function dashboardHref(
  f: Pick<DashboardFilter, "resort" | "range" | "from" | "to">,
  over: Partial<DashboardFilter> = {},
): string {
  const x = { ...f, ...over };
  const q = new URLSearchParams();
  if (x.resort) q.set("resort", x.resort);
  q.set("range", x.range);
  if (x.range === "custom") {
    q.set("from", x.from);
    q.set("to", x.to);
  }
  return `/dashboard?${q.toString()}`;
}
