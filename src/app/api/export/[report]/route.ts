import { connection } from "next/server";
import { getSession } from "@/lib/auth/session";
import { loadResorts } from "@/lib/bookings/data";
import { formatDisplayDate, formatDisplayTime, todayIst } from "@/lib/dates";
import { BOM, csvHeader, csvNote, csvRow, csvTotals } from "@/lib/reports/csv";
import { fetchReportPage } from "@/lib/reports/data";
import {
  CSV_MAX_ROWS,
  EXPORT_PAGE,
  PDF_MAX_ROWS,
  REPORTS,
  exportFileName,
  filterText,
  isReportKey,
  parseReportFilter,
  type ExportFormat,
} from "@/lib/reports/definitions";
import { renderReportPdf } from "@/lib/reports/pdf";
import { buildPdfModel } from "@/lib/reports/pdf-model";
import type { ReportRow } from "@/lib/reports/format";
import { resortNameMap } from "@/lib/resorts";

/**
 * GET /api/export/[report]?format=csv|pdf&... : a report as a file (PRD 5.16, TRD 5.8).
 *   - Only a signed-in, active person gets a file (401 / 403 otherwise). The report is read AS that person, through the
 *     same database functions as the screen, so what the file holds is what the screen would show. The secret key is not used.
 *   - The address is checked strictly: a report or choice that is not known, or a date that is not valid, is a plain 400 or 404
 *     (the screen is forgiving, a file is not).
 *   - CSV is streamed one page per request from the reader (at most 100,000 rows, else 413), UTF-8 with a byte-order mark, rupees with two decimals, formulas stopped. PDF is A4 landscape and only
 *     for reports of at most 1,000 rows (413 with a plain sentence otherwise).
 *   - Nothing is cached, and nothing about a guest is written to a log. Error answers say what to do, never what broke.
 */
/** Asks the platform for up to 120 seconds: a CSV of 100,000 rows is read in 100 pages (about 34 s measured locally). The deployed plan decides what is granted. */
export const maxDuration = 120;

const NO_STORE = { "Cache-Control": "no-store" } as const;
const say = (status: number, message: string) =>
  Response.json({ message }, { status, headers: NO_STORE });

const istNow = (now: Date) =>
  `${formatDisplayDate(now)}, ${formatDisplayTime(now)} IST`;

export async function GET(
  request: Request,
  ctx: { params: Promise<{ report: string }> },
) {
  await connection();
  const session = await getSession();
  if (session.state === "anonymous") return say(401, "Please sign in first.");
  if (session.state !== "ok")
    return say(403, "This account cannot download reports.");

  const { report } = await ctx.params;
  if (!isReportKey(report)) return say(404, "That report was not found.");
  const def = REPORTS[report];

  const params = Object.fromEntries(
    new URL(request.url).searchParams.entries(),
  );
  const format = params.format;
  if (format !== "csv" && format !== "pdf")
    return say(400, "Please choose CSV or PDF.");
  const filter = parseReportFilter(def, params, todayIst());
  if (filter.problem) return say(400, filter.problem);

  const resorts = await loadResorts();
  const names = resortNameMap(resorts);
  const resortName = filter.resort ? (names.get(filter.resort) ?? null) : null;
  if (filter.resort && !resortName)
    return say(404, "That resort was not found.");

  const failed = () =>
    say(
      500,
      "The report could not be made. Nothing was changed. Please try again.",
    );
  const first = await fetchReportPage(def, filter, names, EXPORT_PAGE, 0);
  if (!first) return failed();

  const fileName = exportFileName(def, filter, format as ExportFormat);
  const headers = {
    ...NO_STORE,
    "Content-Disposition": `attachment; filename="${fileName}"`,
    "X-Content-Type-Options": "nosniff",
  };
  const now = new Date();

  if (format === "pdf") {
    if (first.total > PDF_MAX_ROWS)
      return say(
        413,
        `This report has ${first.total} rows. A PDF holds at most ${PDF_MAX_ROWS}; please download the CSV file, or choose fewer dates.`,
      );
    const rows: ReportRow[] = [...first.rows];
    while (def.paged && rows.length < first.total) {
      const next = await fetchReportPage(
        def,
        filter,
        names,
        EXPORT_PAGE,
        rows.length,
      );
      if (!next || next.rows.length === 0) return failed();
      rows.push(...next.rows);
    }
    try {
      const bytes = await renderReportPdf(
        buildPdfModel(def, filter, { ...first, rows }, resortName, now),
      );
      return new Response(new Uint8Array(bytes), {
        headers: { ...headers, "Content-Type": "application/pdf" },
      });
    } catch {
      return failed();
    }
  }

  // CSV: streamed page by page
  const columns = def.columns(filter);
  const enc = new TextEncoder();
  const preface =
    BOM +
    csvNote(`${def.title} report`) +
    csvNote(`Date used: ${def.dateRule(filter)}`) +
    csvNote(`Rule: ${def.approvalRule(filter)}`) +
    csvNote(filterText(def, filter, resortName)) +
    csvNote("Time zone: India (IST)") +
    csvNote(`Made on ${istNow(now)}`) +
    "\r\n" +
    csvHeader(columns);
  if (def.paged && first.total > CSV_MAX_ROWS)
    return say(
      413,
      `This report has ${first.total} rows. A CSV file holds at most ${CSV_MAX_ROWS}; please choose fewer dates or one resort.`,
    );
  // One page is read each time the reader asks for more ("pull"), so nothing piles up in memory.
  let sent = 0;
  let step: "first" | "more" | "done" = "first";
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (step === "first") {
          controller.enqueue(
            enc.encode(
              preface + first.rows.map((r) => csvRow(columns, r)).join(""),
            ),
          );
          sent = first.rows.length;
          step = "more";
        } else if (def.paged && sent < first.total) {
          const next = await fetchReportPage(
            def,
            filter,
            names,
            EXPORT_PAGE,
            sent,
          );
          if (!next || next.rows.length === 0) throw new Error("page");
          controller.enqueue(
            enc.encode(next.rows.map((r) => csvRow(columns, r)).join("")),
          );
          sent += next.rows.length;
        } else {
          if (first.rows.length > 0)
            controller.enqueue(
              enc.encode(csvTotals(columns, def.totals(filter), first.summary)),
            );
          step = "done";
          controller.close();
        }
      } catch {
        controller.error(new Error("export"));
      }
    },
  });
  return new Response(body, {
    headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" },
  });
}
