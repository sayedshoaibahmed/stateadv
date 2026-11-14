/**
 * How one cell of a report is written: the same value for the screen, the PDF and the CSV file (TRD 5.8: the UI, PDFs and
 * CSVs only format numbers, they never calculate them). Pure and unit-tested.
 */
import { formatDisplayDate, formatDisplayTime, isIsoDate } from "@/lib/dates";
import { formatPaise, paiseToDecimalString } from "@/lib/money";
import type { CellKind } from "@/lib/reports/definitions";

export type Cell = string | number | null;
export type ReportRow = Record<string, Cell>;

const STATUS_WORDS: Record<string, string> = {
  approved: "Approved",
  waiting: "Waiting for Approval",
  rejected: "Rejected",
  reversed: "Reversed",
  confirmed: "Confirmed",
  checked_in: "Checked-in",
  checked_out: "Checked-out",
  cancelled: "Cancelled",
  no_show: "No-show",
};
export const statusWord = (v: string): string => STATUS_WORDS[v] ?? v;

const hm = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const ymd = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "2026-03-31 23:30": a moment in India time, for the CSV file. */
export function istStamp(iso: string): string | null {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  return `${ymd.format(t)} ${hm.format(t)}`;
}

/** The text a person reads (screen and PDF). An empty value is a dash. */
export function cellText(kind: CellKind, value: Cell): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (kind) {
    case "money":
      return typeof value === "number" ? formatPaise(value) : "—";
    case "int":
      return String(value);
    case "date":
      return typeof value === "string" && isIsoDate(value)
        ? formatDisplayDate(value)
        : "—";
    case "datetime": {
      const t = new Date(String(value));
      return Number.isNaN(t.getTime())
        ? "—"
        : `${formatDisplayDate(t)}, ${formatDisplayTime(t)}`;
    }
    case "approval":
    case "booking-status":
      return statusWord(String(value));
    default:
      return String(value);
  }
}

/** The text in the CSV file (before quoting): rupees with two decimals, ISO dates, India time for moments. */
export function cellCsv(kind: CellKind, value: Cell): string {
  if (value === null || value === undefined || value === "") return "";
  switch (kind) {
    case "money":
      return typeof value === "number" ? paiseToDecimalString(value) : "";
    case "int":
      return typeof value === "number" || /^-?\d+$/.test(String(value))
        ? String(value)
        : ""; // a number only: text here would be a way to get a formula into the file
    case "date":
      return typeof value === "string" && isIsoDate(value) ? value : "";
    case "datetime":
      return istStamp(String(value)) ?? "";
    case "approval":
    case "booking-status":
      return statusWord(String(value));
    default:
      return String(value);
  }
}

/** Only text can carry a formula; numbers and dates cannot (they are rebuilt from numbers and valid dates). */
export const isFreeText = (kind: CellKind): boolean =>
  kind === "text" ||
  kind === "code" ||
  kind === "approval" ||
  kind === "booking-status"; // our own words, but an unknown value would pass through, so it is guarded too
