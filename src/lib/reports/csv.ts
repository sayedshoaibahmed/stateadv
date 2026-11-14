/**
 * CSV files (TRD 5.8): UTF-8 with a byte-order mark so Excel reads rupee signs and names correctly, amounts in rupees with
 * two decimals, quoted when needed (RFC 4180), lines end with CRLF, and FORMULA INJECTION is stopped (SEC-08): free text
 * that starts with = + - @ or a tab or a carriage return gets a leading apostrophe, so a guest called "=HYPERLINK(...)"
 * is shown as text and never run. Pure and unit-tested.
 */
import {
  cellCsv,
  isFreeText,
  type Cell,
  type ReportRow,
} from "@/lib/reports/format";
import type { Column } from "@/lib/reports/definitions";

export const BOM = "﻿";
const EOL = "\r\n";

/** One value, safe to place in a CSV line. `freeText` turns on the formula guard. */
export function csvCell(value: string, freeText: boolean): string {
  let v = value;
  if (freeText && /^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function csvLine(cells: string[]): string {
  return cells.join(",") + EOL;
}

/** A line of one cell, for the lines above the table (title, date used, rule, filters, time zone). Always guarded. */
export function csvNote(text: string): string {
  return csvLine([csvCell(text, true)]);
}

export function csvHeader(columns: Column[]): string {
  return csvLine(columns.map((c) => csvCell(c.label, true)));
}

export function csvRow(columns: Column[], row: ReportRow): string {
  return csvLine(
    columns.map((c) =>
      csvCell(cellCsv(c.kind, row[c.key] ?? null), isFreeText(c.kind)),
    ),
  );
}

/** The totals row: "Total" in the first column and the summary figures under the columns that have one. */
export function csvTotals(
  columns: Column[],
  totals: Record<string, string>,
  summary: Record<string, number>,
): string {
  const cells: string[] = columns.map((c, i) => {
    const key = totals[c.key];
    if (key === undefined || summary[key] === undefined)
      return i === 0 ? "Total" : "";
    return csvCell(cellCsv(c.kind, summary[key] as Cell), false);
  });
  if (columns.length > 0 && !(columns[0].key in totals)) cells[0] = "Total";
  return csvLine(cells);
}
