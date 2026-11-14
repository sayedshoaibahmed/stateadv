/**
 * The calendar's rules that need no database: reading the address, the month grid, the six tabs of a day, the links.
 * Pure and unit-tested. A bad value in the address is never an error page: it is ignored and says so in `problem`.
 * The figures themselves come from the database functions `calendar_month` and `calendar_day` (migration 24); nothing
 * here calculates money.
 *
 * All dates are IST calendar dates written "YYYY-MM-DD". Weeks start on Monday (as on the dashboard).
 */
import { isIsoDate, todayIst } from "@/lib/dates";

/** The database accepts months from 1990 to 2100; there is no other limit on looking back or ahead. */
export const MIN_YEAR = 1990;
export const MAX_YEAR = 2100;

export interface MonthRef {
  year: number;
  month: number; // 1 to 12
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Raw = string | string[] | undefined;
const first = (v: Raw) => (Array.isArray(v) ? v[0] : v);

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;
const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
export const WEEKDAY_HEADS = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
] as const;

const pad = (n: number) => String(n).padStart(2, "0");

export function inRange(ref: MonthRef): boolean {
  return (
    Number.isInteger(ref.year) &&
    Number.isInteger(ref.month) &&
    ref.year >= MIN_YEAR &&
    ref.year <= MAX_YEAR &&
    ref.month >= 1 &&
    ref.month <= 12
  );
}

export function monthKey(ref: MonthRef): string {
  return `${ref.year}-${pad(ref.month)}`;
}

export function monthLabel(ref: MonthRef): string {
  return `${MONTH_NAMES[ref.month - 1]} ${ref.year}`;
}

export function monthOf(date: string): MonthRef {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}

export function daysInMonth(ref: MonthRef): number {
  return new Date(Date.UTC(ref.year, ref.month, 0)).getUTCDate();
}

/** The month before (-1) or after (+1); null when that would leave 1990 to 2100. */
export function shiftMonth(ref: MonthRef, delta: number): MonthRef | null {
  const index = ref.year * 12 + (ref.month - 1) + delta;
  const next = { year: Math.floor(index / 12), month: (index % 12) + 1 };
  return inRange(next) ? next : null;
}

export function firstOfMonth(ref: MonthRef): string {
  return `${monthKey(ref)}-01`;
}

/** 0 = Monday ... 6 = Sunday */
export function weekdayIndex(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** "Tuesday, 10 March 2026" */
export function dayTitle(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd}, ${d} ${MONTH_NAMES[m - 1]} ${y}`;
}

/** The shorter form for the agenda list: "Tue 10 Mar" */
export function dayShort(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()].slice(0, 3);
  return `${wd} ${d} ${MONTH_NAMES[m - 1].slice(0, 3)}`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export interface MonthParam {
  ref: MonthRef;
  problem: string | null;
}

/** ?month=2026-03 (missing = this month; anything else = this month and a plain note) */
export function parseMonth(raw: Raw, today: string = todayIst()): MonthParam {
  const fallback = monthOf(today);
  const text = first(raw);
  if (!text) return { ref: fallback, problem: null };
  const m = /^(\d{4})-(\d{2})$/.exec(text);
  const ref = m ? { year: Number(m[1]), month: Number(m[2]) } : null;
  if (!ref || !inRange(ref))
    return {
      ref: fallback,
      problem: "That month was not valid, so this month is shown.",
    };
  return { ref, problem: null };
}

export function parseResort(raw: Raw): {
  resort: string | null;
  problem: string | null;
} {
  const text = first(raw);
  if (!text || text === "all") return { resort: null, problem: null };
  if (UUID.test(text)) return { resort: text.toLowerCase(), problem: null };
  return {
    resort: null,
    problem: "That resort was not found, so all resorts are shown.",
  };
}

/** The date in /calendar/[date]: a real date from 1990 to 2100, else null (the page then says "not found"). */
export function parseDay(raw: string | undefined): string | null {
  if (!raw || !isIsoDate(raw)) return null;
  const y = Number(raw.slice(0, 4));
  return y >= MIN_YEAR && y <= MAX_YEAR ? raw : null;
}

/**
 * The weeks of a month for the grid: each week has seven places (Monday first); a place outside the month is null.
 */
export function monthGrid(ref: MonthRef): (string | null)[][] {
  const first = firstOfMonth(ref);
  const lead = weekdayIndex(first);
  const n = daysInMonth(ref);
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: n }, (_, i) => `${monthKey(ref)}-${pad(i + 1)}`),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** One day of the month, as the database function gives it (money is whole paise). */
export interface CalendarDay {
  date: string;
  checkIns: number;
  checkOuts: number;
  staying: number;
  duePaise: number;
  collectedPaise: number;
  waitingPaise: number;
  refundsPaise: number;
}

/** A day with nothing on it. */
export function isQuiet(d: CalendarDay): boolean {
  return (
    d.checkIns === 0 &&
    d.checkOuts === 0 &&
    d.staying === 0 &&
    d.duePaise === 0 &&
    d.collectedPaise === 0 &&
    d.waitingPaise === 0 &&
    d.refundsPaise === 0
  );
}

/** The phone view: only the days that have something on them, in date order. */
export function agendaDays(days: CalendarDay[]): CalendarDay[] {
  return days.filter((d) => !isQuiet(d));
}

/** What the screen reader says for a day cell. */
export function dayLabel(d: CalendarDay): string {
  if (isQuiet(d)) return `${dayTitle(d.date)}: nothing on this day`;
  const parts: string[] = [];
  const plural = (n: number, one: string, many: string) =>
    `${n} ${n === 1 ? one : many}`;
  if (d.checkIns) parts.push(plural(d.checkIns, "check-in", "check-ins"));
  if (d.checkOuts) parts.push(plural(d.checkOuts, "check-out", "check-outs"));
  if (d.staying) parts.push(`${d.staying} staying`);
  return `${dayTitle(d.date)}: ${parts.join(", ") || "money only"}`;
}

// ------------------------------------------------------------------------ the day page
export const TABS = [
  { key: "check-ins", kind: "check_in", label: "Check-ins" },
  { key: "check-outs", kind: "check_out", label: "Check-outs" },
  { key: "staying", kind: "staying", label: "Staying" },
  { key: "payments", kind: "payment", label: "Payments Received" },
  { key: "refunds", kind: "refund", label: "Refunds" },
  { key: "due", kind: "due", label: "Payments Due" },
] as const;
export type TabKey = (typeof TABS)[number]["key"];
export type Kind = (typeof TABS)[number]["kind"];

export function parseTab(raw: Raw): TabKey {
  const t = first(raw);
  return TABS.find((x) => x.key === t)?.key ?? "check-ins";
}

export function kindOf(tab: TabKey): Kind {
  return TABS.find((x) => x.key === tab)!.kind;
}

/** The address of the month page. */
export function monthHref(ref: MonthRef, resort: string | null): string {
  const q = new URLSearchParams();
  q.set("month", monthKey(ref));
  if (resort) q.set("resort", resort);
  return `/calendar?${q.toString()}`;
}

/** The address of a day page (the tab is written only when it is not the first). */
export function dayHref(
  date: string,
  resort: string | null,
  tab: TabKey = "check-ins",
): string {
  const q = new URLSearchParams();
  if (tab !== "check-ins") q.set("tab", tab);
  if (resort) q.set("resort", resort);
  const s = q.toString();
  return s ? `/calendar/${date}?${s}` : `/calendar/${date}`;
}

/**
 * The check-in date that "Add Booking" on the MONTH page fills in: today while the month shown is this month, otherwise
 * the first day of the month shown (so a booking for a month you are looking at starts in that month).
 */
export function defaultBookingDay(month: MonthRef, today: string): string {
  return monthKey(month) === monthKey(monthOf(today))
    ? today
    : firstOfMonth(month);
}

/** "Add Booking for this date" opens the booking form with that check-in date (and resort) already filled in. */
export function addBookingHref(date: string, resort: string | null): string {
  const q = new URLSearchParams({ checkin: date });
  if (resort) q.set("resort", resort);
  return `/bookings/new?${q.toString()}`;
}
