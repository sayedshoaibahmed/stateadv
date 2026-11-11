/**
 * Date helpers. All business dates are in Asia/Kolkata (IST, UTC+05:30,
 * no daylight saving). Business dates are plain "YYYY-MM-DD" strings,
 * matching the PostgreSQL `date` type.
 */

export const APP_TIME_ZONE = "Asia/Kolkata";

/** A calendar date "YYYY-MM-DD". */
export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

const isoDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The IST calendar date of an instant: 2026-11-11T20:00Z → "2026-11-12". */
export function toIstDate(instant: Date): IsoDate {
  if (Number.isNaN(instant.getTime())) throw new Error("Invalid date");
  return isoDateFormatter.format(instant); // en-CA gives YYYY-MM-DD
}

/** Today's date in IST. */
export function todayIst(now: Date = new Date()): IsoDate {
  return toIstDate(now);
}

export function isIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [, y, mo, d] = m.map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d
  );
}

function isoDateToUtcMs(value: IsoDate): number {
  if (!isIsoDate(value)) throw new Error(`Invalid date: ${value}`);
  const [y, m, d] = value.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Whole days from `from` to `to` (calendar dates). Can be negative. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((isoDateToUtcMs(to) - isoDateToUtcMs(from)) / DAY_MS);
}

/**
 * Number of nights (PRD FR-BK-4, decided D4): IST calendar date of
 * check-out minus IST calendar date of check-in. Times are ignored, so a
 * late check-out the next morning is still 1 night.
 */
export function nightsBetween(checkIn: Date, checkOut: Date): number {
  return daysBetween(toIstDate(checkIn), toIstDate(checkOut));
}

/** Year of a business date: "2026-12-30" → 2026 (Booking ID year, Q4). */
export function yearOf(value: IsoDate): number {
  isoDateToUtcMs(value);
  return Number(value.slice(0, 4));
}

/**
 * Build an instant from an IST wall-clock date + time ("2026-11-12", "14:30").
 * IST has a fixed +05:30 offset.
 */
export function istDateTimeToInstant(date: IsoDate, time: string): Date {
  if (!isIsoDate(date)) throw new Error(`Invalid date: ${date}`);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error(`Invalid time: ${time}`);
  }
  return new Date(`${date}T${time}:00+05:30`);
}

const displayDate = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
});
const displayTime = new Intl.DateTimeFormat("en-IN", {
  timeZone: APP_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** "12 Nov 2026" (UI spec §6 — never ambiguous numeric dates). */
export function formatDisplayDate(value: Date | IsoDate): string {
  const instant =
    typeof value === "string" ? istDateTimeToInstant(value, "12:00") : value;
  return displayDate.format(instant);
}

/** "4:05 PM" in IST. */
export function formatDisplayTime(instant: Date): string {
  const parts = displayTime.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("hour")}:${get("minute")} ${get("dayPeriod").toUpperCase()}`;
}
