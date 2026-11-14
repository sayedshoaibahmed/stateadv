/**
 * What goes on the pages of a report PDF (TRD 5.8: A4 landscape, at most 1,000 rows). Every cell is already a string:
 * the layout (pdf.tsx) only draws them and never formats or calculates. Pure and unit-tested.
 */
import { formatDisplayDate, formatDisplayTime } from "@/lib/dates";
import { cellText, type ReportRow } from "@/lib/reports/format";
import type {
  CellKind,
  ReportDef,
  ReportFilter,
} from "@/lib/reports/definitions";
import { filterText } from "@/lib/reports/definitions";
import type { ReportPage } from "@/lib/reports/rows";

export interface PdfColumn {
  label: string;
  /** the share of the page width this column takes (relative) */
  weight: number;
  align: "left" | "right";
}

export interface ReportPdfModel {
  title: string;
  dateLine: string;
  ruleLine: string;
  filterLine: string;
  generatedLine: string;
  /** set when some long text was shortened; the PDF says so (the CSV file has the full text) */
  note: string | null;
  summary: { label: string; value: string }[];
  columns: PdfColumn[];
  rows: string[][];
  totalsRow: string[] | null;
}

const WEIGHT: Record<CellKind, number> = {
  text: 1.3,
  code: 1.4,
  int: 0.6,
  money: 1.15,
  date: 1,
  datetime: 1.5,
  approval: 1.2,
  "booking-status": 1.1,
};

/**
 * A cell with a very long unbroken word (a name of 300 letters) in a narrow column would make a row taller than a page, and
 * the PDF library cannot lay that out. So free text is cut to a length that always fits, with an ellipsis; the CSV file keeps
 * the full text. The limits give at most about six lines in the widest case.
 */
export const PDF_TEXT_MAX = 32;
export const PDF_WIDE_TEXT_MAX = 120;
export function clipText(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : text;
}

export function buildPdfModel(
  def: ReportDef,
  f: ReportFilter,
  page: ReportPage,
  resortName: string | null,
  now: Date,
): ReportPdfModel {
  const columns = def.columns(f);
  const totals = def.totals(f);
  let clipped = false;
  const show = (c: (typeof columns)[number], v: ReportRow[string]): string => {
    const text = cellText(c.kind, v ?? null);
    if (c.kind !== "text" && c.kind !== "code") return text;
    const out = clipText(text, c.wide ? PDF_WIDE_TEXT_MAX : PDF_TEXT_MAX);
    if (out !== text) clipped = true;
    return out;
  };
  const totalsRow = page.rows.length
    ? columns.map((c, i) => {
        const key = totals[c.key];
        if (key === undefined || page.summary[key] === undefined)
          return i === 0 ? "Total" : "";
        return cellText(c.kind, page.summary[key]);
      })
    : null;
  if (totalsRow && !(columns[0].key in totals)) totalsRow[0] = "Total";
  const model: ReportPdfModel = {
    title: `${def.title} report`,
    dateLine: `Date used: ${def.dateRule(f)}`,
    ruleLine: `Rule: ${def.approvalRule(f)}`,
    filterLine: `${filterText(def, f, resortName)} · Time zone: India (IST)`,
    generatedLine: `Made on ${formatDisplayDate(now)}, ${formatDisplayTime(now)} IST`,
    summary: def.summary(f).map((s) => ({
      label: s.label,
      value: cellText(s.kind, page.summary[s.key] ?? 0),
    })),
    columns: columns.map((c) => ({
      label: c.label,
      weight: c.wide ? 2.2 : WEIGHT[c.kind],
      align: c.kind === "money" || c.kind === "int" ? "right" : "left",
    })),
    rows: page.rows.map((r: ReportRow) =>
      columns.map((c) => show(c, r[c.key])),
    ),
    totalsRow,
    note: null,
  };
  return clipped
    ? {
        ...model,
        note: "Some long text is shortened in this PDF. The CSV file has it in full.",
      }
    : model;
}
