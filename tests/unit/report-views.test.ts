import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportView } from "@/components/app/reports/report-view";
import { ReportsIndex } from "@/components/app/reports/reports-index";
import {
  PDF_MAX_ROWS,
  REPORTS,
  REPORT_KEYS,
  parseReportFilter,
  type ReportKey,
} from "@/lib/reports/definitions";
import type { ReportPage } from "@/lib/reports/rows";
import { RESORT_A, RESORT_B, samplePage } from "../shared/report-sample";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(el);
const text = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'");
const TODAY = "2026-03-31";
const RESORTS = [
  { id: RESORT_A, name: "Test Resort Alpha" },
  { id: RESORT_B, name: "Test Resort Beta (closed)" },
];
const view = (
  key: ReportKey,
  params: Record<string, string> = {},
  page: ReportPage | null | undefined = undefined,
) => {
  const def = REPORTS[key];
  const f = parseReportFilter(def, params, TODAY);
  return html(
    h(ReportView, {
      def,
      f,
      page: page === undefined ? samplePage(key, params) : page,
      resorts: RESORTS,
      today: TODAY,
    }),
  );
};

describe("the list of reports (RV-01..)", () => {
  it("RV-01: ten cards, each with its title, what it shows, the date it uses and an Open button to its page with this month in it", () => {
    const out = html(h(ReportsIndex, { today: "2026-03-31" }));
    const t = text(out);
    expect(t).toContain("Collection Reports");
    expect(t).toContain("CSV file");
    expect(out.match(/<li class="flex flex-col/g)).toHaveLength(10);
    for (const key of REPORT_KEYS) {
      expect(t).toContain(REPORTS[key].title);
      expect(out).toContain(
        `aria-label="Open the ${REPORTS[key].title} report"`,
      );
      expect(out).toContain(`href="/reports/${key}`);
    }
    expect(out).toContain(
      'href="/reports/collection?from=2026-03-01&amp;to=2026-03-31"',
    );
    expect(out).toContain('href="/reports/pending?asOf=2026-03-31"');
    expect(t).toContain("Date used:");
    expect(out).toContain("min-h-11");
  });
});

describe("one report (RV-02..)", () => {
  it("RV-02: the header says the DATE USED, the RULE applied and the TIME ZONE (PRD 5.16), and names the period", () => {
    const out = view("collection", { from: "2026-03-01", to: "2026-03-31" });
    const header = text(out.slice(out.indexOf('data-testid="report-header"')));
    expect(header).toContain(
      "Date used: Daily collection · by payment date · refunds by refund date",
    );
    expect(header).toContain(
      "Rule: Total Collection (Approved) counts approved payments only",
    );
    expect(header).toContain(
      "Showing: Resort: All resorts · Period: 1 Mar 2026 – 31 Mar 2026 · Time zone: India (IST)",
    );
  });
  it("RV-03: the totals cards use the database's totals: exactly one 'Total Collection (Approved)' and a separate 'Waiting for Approval'", () => {
    const out = view("collection", { from: "2026-03-01", to: "2026-03-31" });
    const totals = text(
      out.slice(
        out.indexOf('aria-label="Totals"'),
        out.indexOf('aria-label="Download this report"'),
      ),
    );
    expect(totals).toContain(
      "Total Collection (Approved) ₹3,500 Waiting for Approval ₹1,000 Refunds (Approved) −₹500 (refund) Net Collection ₹3,000",
    );
    expect(out.match(/Total Collection \(Approved\)/g)!.length).toBeGreaterThan(
      1,
    ); // in the totals and as a column
  });
  it("RV-04: a table for tablet and up, cards for phones, with the totals row at the foot of the table", () => {
    const out = view("collection", { from: "2026-03-01", to: "2026-03-31" });
    expect(out).toContain('data-testid="report-table"');
    expect(out).toContain('data-testid="report-cards"');
    expect(out).toContain("hidden overflow-x-auto md:block");
    expect(out).toContain("grid gap-3 md:hidden");
    const foot = text(
      out.slice(out.indexOf("<tfoot>"), out.indexOf("</tfoot>")),
    );
    expect(foot.trim()).toBe("Total ₹3,500 ₹1,000 −₹500 (refund) ₹3,000");
    expect(text(out)).toContain(
      "Days, weeks, months or years with no payment and no refund are not listed.",
    );
  });
  it("RV-05: the filter form has exactly the filters the report has: Collection has resort, period, show-by and split; Pending has resort and as-of only", () => {
    const col = view("collection", { from: "2026-03-01", to: "2026-03-31" });
    for (const name of ["resort", "from", "to", "group", "split"])
      expect(col).toContain(`name="${name}"`);
    for (const name of [
      "status",
      "method",
      "kind",
      "asOf",
      "source",
      "dateField",
    ])
      expect(col).not.toContain(`name="${name}"`);
    const pend = view("pending");
    for (const name of ["resort", "asOf"])
      expect(pend).toContain(`name="${name}"`);
    for (const name of ["from", "to", "group"])
      expect(pend).not.toContain(`name="${name}"`);
    expect(col).toContain('action="/reports/collection"');
    expect(col).toContain('method="get"');
    expect(text(col)).toContain(
      "Quick choice: This month Last month This year",
    );
  });
  it("RV-06: the choices come from the address and the quick choices link to a whole month or year", () => {
    const out = view("bookings", {
      from: "2026-03-01",
      to: "2026-03-31",
      dateField: "check_in",
      status: "cancelled",
      resort: RESORT_A,
    });
    expect(out).toMatch(/<option value="check_in" selected="">/);
    expect(out).toMatch(/<option value="cancelled" selected="">/);
    expect(out).toMatch(new RegExp(`<option value="${RESORT_A}" selected="">`));
    expect(out).toContain('value="2026-03-01"');
    expect(out).toContain(
      `href="/reports/bookings?resort=${RESORT_A}&amp;from=2026-02-01&amp;to=2026-02-28&amp;dateField=check_in&amp;status=cancelled"`,
    );
  });
  it("RV-07: downloads: CSV and PDF links carry the same choices; the PDF is withdrawn above 1,000 rows with the reason in words", () => {
    const out = view("refunds", {
      from: "2026-03-01",
      to: "2026-03-31",
      status: "approved",
    });
    expect(out).toContain(
      'href="/api/export/refunds?from=2026-03-01&amp;to=2026-03-31&amp;status=approved&amp;format=csv"',
    );
    expect(out).toContain(
      'href="/api/export/refunds?from=2026-03-01&amp;to=2026-03-31&amp;status=approved&amp;format=pdf"',
    );
    expect(text(out)).toContain("Download CSV");
    expect(text(out)).toContain("Download PDF");
    const big = view(
      "refunds",
      { from: "2026-03-01", to: "2026-03-31" },
      {
        rows: samplePage("refunds").rows,
        total: PDF_MAX_ROWS + 1,
        summary: samplePage("refunds").summary,
      },
    );
    expect(big).toContain("format=csv");
    expect(big).not.toContain("format=pdf");
    expect(text(big)).toContain(
      `This report has ${PDF_MAX_ROWS + 1} rows, more than a PDF holds (${PDF_MAX_ROWS}). Download the CSV`,
    );
  });
  it("RV-08: every one of the ten reports shows its title, its summary, its column names and its rows without error", () => {
    for (const key of REPORT_KEYS) {
      const def = REPORTS[key];
      const f = parseReportFilter(def, {}, TODAY);
      const out = view(key);
      const t = text(out);
      expect(t, key).toContain(def.title);
      for (const c of def.columns(f))
        expect(t, `${key}: ${c.label}`).toContain(c.label);
      for (const s of def.summary(f))
        expect(t, `${key}: ${s.label}`).toContain(s.label);
      expect(out, key).toContain("Time zone: India (IST)");
      expect(out, key).toContain("min-h-11");
    }
  });
  it("RV-09: money keeps its meaning: refunds with a minus, waiting in its own tone, status badges with words", () => {
    const refunds = view("refunds");
    expect(refunds).toContain("text-refund");
    expect(refunds).toContain('data-status="approved"');
    expect(text(refunds)).toContain("Approved");
    const waiting = view("waiting");
    expect(waiting).toContain("text-waiting");
    const pending = view("pending");
    expect(pending).toContain("text-pending");
    expect(pending).toContain('data-booking-status="confirmed"');
  });
  it("RV-10: booking IDs and payment or refund numbers are links to their own pages; other text is not", () => {
    const refunds = view("refunds");
    expect(refunds).toContain(
      'href="/refunds/dddddddd-2222-4333-8444-555555555555"',
    ); // the refund number
    expect(refunds).toContain(
      'href="/bookings/aaaaaaaa-2222-4333-8444-555555555555"',
    ); // the booking
    const waiting = view("waiting");
    expect(waiting).toContain(
      'href="/payments/cccccccc-2222-4333-8444-555555555555"',
    );
    expect(waiting).toContain(
      'href="/refunds/dddddddd-2222-4333-8444-555555555555"',
    );
    const bookings = view("bookings");
    expect(bookings).toContain(
      'href="/bookings/aaaaaaaa-2222-4333-8444-555555555555"',
    );
    expect(bookings).not.toContain('href="/bookings/undefined"');
  });
  it("RV-11: on a long list the foot says 'Total, all rows' and the line above says the totals cover all rows; paging links keep the choices", () => {
    const base = samplePage("bookings", {
      from: "2026-03-01",
      to: "2026-03-31",
    });
    const out = view(
      "bookings",
      { from: "2026-03-01", to: "2026-03-31", page: "2", status: "cancelled" },
      { ...base, total: 60 },
    );
    const t = text(out);
    expect(t).toContain(
      "60 rows · showing 26 to 50. The totals above and in the files cover all rows.",
    );
    expect(text(out.slice(out.indexOf("<tfoot>")))).toContain(
      "Total, all rows",
    );
    expect(t).toContain("Page 2 of 3");
    expect(out).toContain(
      'href="/reports/bookings?from=2026-03-01&amp;to=2026-03-31&amp;status=cancelled"',
    ); // Previous = page 1
    expect(out).toContain(
      'href="/reports/bookings?from=2026-03-01&amp;to=2026-03-31&amp;status=cancelled&amp;page=3"',
    );
  });
  it("RV-12: a one-table report has no pager and no 'showing' line; a short list says '2 rows'", () => {
    expect(
      text(view("collection", { from: "2026-03-01", to: "2026-03-31" })),
    ).not.toContain("Page 1 of");
    expect(
      text(view("bookings", { from: "2026-03-01", to: "2026-03-31" })),
    ).toContain("2 rows.");
  });
  it("RV-13: nothing to show, a failed read, and a note about a bad address", () => {
    const empty = view(
      "refunds",
      { from: "2031-01-01", to: "2031-01-31" },
      {
        rows: [],
        total: 0,
        summary: { approved: 0, waiting: 0, rejected: 0, reversed: 0 },
      },
    );
    expect(text(empty)).toContain("Nothing to show");
    expect(text(empty)).toContain(
      "There is nothing for 1 Jan 2031 – 31 Jan 2031 with these choices.",
    );
    expect(empty).toContain("format=csv"); // an empty report can still be downloaded (with its header lines)
    const failed = view("refunds", {}, null);
    expect(text(failed)).toContain("The report could not be loaded");
    expect(failed).toContain(
      'href="/reports/refunds?from=2026-03-01&amp;to=2026-03-31"',
    );
    expect(failed).not.toContain("Download CSV");
    expect(text(view("collection", { from: "bad", to: "bad" }))).toContain(
      "A date was not valid, so this month is shown.",
    );
  });
  it("RV-14: the resort name appears in the 'Showing' line when one resort is chosen", () => {
    expect(
      text(
        view("collection", {
          resort: RESORT_A,
          from: "2026-03-01",
          to: "2026-03-31",
        }),
      ),
    ).toContain("Resort: Test Resort Alpha");
  });
  it("RV-15: nothing in a cell can run as code or markup: a guest called <script> is shown as text", () => {
    const base = samplePage("bookings");
    const rows = base.rows.map((r, i) =>
      i === 0 ? { ...r, guest: "<script>alert(1)</script>" } : r,
    );
    const out = view(
      "bookings",
      { from: "2026-03-01", to: "2026-03-31" },
      { ...base, rows },
    );
    expect(out).not.toContain("<script>alert(1)</script>");
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
