import { describe, expect, it, vi } from "vitest";

// a PDF of several hundred rows takes seconds, more when the whole suite runs at once
vi.setConfig({ testTimeout: 120_000 });
import {
  PDF_TEXT_MAX,
  PDF_WIDE_TEXT_MAX,
  buildPdfModel,
  clipText,
} from "@/lib/reports/pdf-model";
import { renderReportPdf } from "@/lib/reports/pdf";
import {
  REPORTS,
  REPORT_KEYS,
  parseReportFilter,
} from "@/lib/reports/definitions";
import {
  mapBookings,
  mapCollection,
  mapRefunds,
  mapResortWise,
  periodLabel,
} from "@/lib/reports/rows";
import {
  BOOKING_1,
  NAMES,
  R,
  RESORT_A,
  bookingRows,
  collectionRows,
  refundRows,
  resortWiseRows,
  samplePage,
  waitingRows,
} from "../shared/report-sample";
import { mapWaiting } from "@/lib/reports/rows";

const TODAY = "2026-03-31";
const AT = new Date("2026-11-14T10:35:00Z");
const pages = (pdf: Buffer) =>
  (pdf.toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length;

describe("periods in words (RR-01..)", () => {
  it("RR-01: a day, a whole week or month or year, and a period cut by the chosen dates", () => {
    expect(periodLabel("day", "2026-03-10", "2026-03-10")).toBe("10 Mar 2026");
    expect(periodLabel("week", "2026-03-02", "2026-03-08")).toBe(
      "2 Mar 2026 – 8 Mar 2026",
    );
    expect(periodLabel("month", "2026-03-01", "2026-03-31")).toBe("March 2026");
    expect(periodLabel("month", "2028-02-01", "2028-02-29")).toBe(
      "February 2028",
    ); // a leap February
    expect(periodLabel("month", "2026-03-05", "2026-03-31")).toBe(
      "5 Mar 2026 – 31 Mar 2026",
    ); // cut at the start
    expect(periodLabel("month", "2026-03-01", "2026-03-20")).toBe(
      "1 Mar 2026 – 20 Mar 2026",
    ); // cut at the end
    expect(periodLabel("year", "2026-01-01", "2026-12-31")).toBe("2026");
    expect(periodLabel("year", "2026-02-01", "2026-12-31")).toBe(
      "1 Feb 2026 – 31 Dec 2026",
    );
    expect(periodLabel("week", "2026-03-30", "2026-03-31")).toBe(
      "30 Mar 2026 – 31 Mar 2026",
    );
  });
});

describe("rows and totals from the database's own figures (RR-02..)", () => {
  it("RR-02: nothing is added up here: the rows are the database's columns and the totals are the database's totals", () => {
    const f = parseReportFilter(
      REPORTS.collection,
      { from: "2026-03-01", to: "2026-03-31" },
      TODAY,
    );
    const p = mapCollection(collectionRows(), f);
    expect(p.rows.map((r) => r.approved)).toEqual([R(2000), R(1500)]);
    expect(p.summary).toEqual({
      totalApproved: R(3500),
      totalWaiting: R(1000),
      totalRefunds: R(500),
      totalNet: R(3000),
    });
    expect(p.total).toBe(2);
    // the screen's rows are NOT used for the total: change a row and the total stays the database's
    const edited = collectionRows();
    edited[0].approved_paise = 1;
    expect(mapCollection(edited, f).summary.totalApproved).toBe(R(3500));
  });
  it("RR-03: an empty report has no rows and zero totals, and nothing throws", () => {
    const f = parseReportFilter(REPORTS.collection, {}, TODAY);
    expect(mapCollection([], f)).toEqual({
      rows: [],
      total: 0,
      summary: {
        totalApproved: 0,
        totalWaiting: 0,
        totalRefunds: 0,
        totalNet: 0,
      },
    });
    expect(mapResortWise([]).total).toBe(0);
    expect(mapBookings([], NAMES).summary).toEqual({
      count: 0,
      pax: 0,
      final: 0,
      due: 0,
    });
    expect(mapWaiting([], NAMES).summary).toEqual({
      payments: 0,
      paymentsCount: 0,
      refunds: 0,
      refundsCount: 0,
    });
  });
  it("RR-04: a switched-off resort is marked closed; an unknown resort id is a dash; the C/O is category and name", () => {
    expect(mapResortWise(resortWiseRows()).rows.map((r) => r.resort)).toEqual([
      "Test Resort Alpha",
      "Old Beta (closed)",
    ]);
    const rows = mapBookings(
      bookingRows(),
      new Map([[RESORT_A, "Test Resort Alpha"]]),
    ).rows;
    expect(rows[0]).toMatchObject({
      resort: "Test Resort Alpha",
      co: "Agent · Test Agent",
      pricing: "Per person per stay",
      _booking: BOOKING_1,
    });
    expect(rows[1]).toMatchObject({
      resort: "—",
      co: "Direct",
      pricing: "Per person per night",
    });
  });
  it("RR-05: a payment or refund links to its own page and to its booking; the type and the way paid are in words", () => {
    const w = mapWaiting(waitingRows(), NAMES).rows;
    expect(w[0]).toMatchObject({
      kind: "Payment",
      method: "UPI · PhonePe",
      _href: "/payments/cccccccc-2222-4333-8444-555555555555",
      _booking: BOOKING_1,
      by: "Test Manager One",
    });
    expect(w[1]).toMatchObject({
      kind: "Refund",
      method: "Cash",
      _href: "/refunds/dddddddd-2222-4333-8444-555555555555",
      by: "—",
    });
    expect(mapRefunds(refundRows(), NAMES).rows[0]).toMatchObject({
      _href: "/refunds/dddddddd-2222-4333-8444-555555555555",
      method: "Cash",
    });
  });
  it("RR-06: every sample report maps with its summary keys all present", () => {
    for (const key of REPORT_KEYS) {
      const def = REPORTS[key];
      const f = parseReportFilter(def, {}, TODAY);
      const p = samplePage(key);
      expect(p.rows.length, key).toBeGreaterThan(0);
      for (const s of def.summary(f))
        expect(p.summary[s.key], `${key}.${s.key}`).not.toBeUndefined();
      const keys = def.columns(f).map((c) => c.key);
      for (const row of p.rows)
        for (const k of keys) expect(k in row, `${key}.${k}`).toBe(true);
    }
  });
});

describe("the PDF (RP-01..)", () => {
  it("RP-01: the model: header lines say the date used, the approval rule, the filters and the time zone (IST); cells are ready-made strings; the totals row follows the report", () => {
    const def = REPORTS.collection;
    const f = parseReportFilter(
      def,
      { from: "2026-03-01", to: "2026-03-31", group: "day" },
      TODAY,
    );
    const m = buildPdfModel(
      def,
      f,
      samplePage("collection", { from: "2026-03-01", to: "2026-03-31" }),
      null,
      AT,
    );
    expect(m.title).toBe("Collection report");
    expect(m.dateLine).toBe(
      "Date used: Daily collection · by payment date · refunds by refund date",
    );
    expect(m.ruleLine).toMatch(
      /^Rule: Total Collection \(Approved\) counts approved payments only/,
    );
    expect(m.filterLine).toBe(
      "Resort: All resorts · Period: 1 Mar 2026 – 31 Mar 2026 · Time zone: India (IST)",
    );
    expect(m.generatedLine).toBe("Made on 14 Nov 2026, 4:05 PM IST");
    expect(m.summary).toEqual([
      { label: "Total Collection (Approved)", value: "₹3,500" },
      { label: "Waiting for Approval", value: "₹1,000" },
      { label: "Refunds (Approved)", value: "₹500" },
      { label: "Net Collection", value: "₹3,000" },
    ]);
    expect(m.rows[0]).toEqual([
      "2 Mar 2026",
      "₹2,000",
      "1",
      "₹0",
      "₹0",
      "₹2,000",
    ]);
    expect(m.totalsRow).toEqual([
      "Total",
      "₹3,500",
      "",
      "₹1,000",
      "₹500",
      "₹3,000",
    ]);
    expect(m.columns.map((c) => c.align)).toEqual([
      "left",
      "right",
      "right",
      "right",
      "right",
      "right",
    ]);
  });
  it("RP-02: no rows means no totals row", () => {
    const def = REPORTS.refunds;
    const f = parseReportFilter(def, {}, TODAY);
    const m = buildPdfModel(
      def,
      f,
      { rows: [], total: 0, summary: {} },
      "Test Resort Alpha",
      AT,
    );
    expect(m.rows).toEqual([]);
    expect(m.totalsRow).toBeNull();
    expect(m.filterLine).toContain("Resort: Test Resort Alpha");
  });
  it("RP-03: a real PDF file for each of the ten reports: valid header and end, A4 LANDSCAPE, the title and the bundled font in it", async () => {
    for (const key of REPORT_KEYS) {
      const def = REPORTS[key];
      const f = parseReportFilter(def, {}, TODAY);
      const pdf = await renderReportPdf(
        buildPdfModel(def, f, samplePage(key), null, AT),
      );
      const text = pdf.toString("latin1");
      expect(text.startsWith("%PDF-1."), key).toBe(true);
      expect(text.trimEnd().endsWith("%%EOF"), key).toBe(true);
      expect(text, key).toMatch(/NotoSans-Regular/);
      expect(text, key).toContain(`${def.title} report`);
      const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(text);
      expect(Number(box![1]), key).toBeGreaterThan(Number(box![2])); // wider than tall = landscape
      expect(Math.round(Number(box![1])), key).toBe(842); // A4 is 842 x 595 points
      expect(pages(pdf), key).toBeGreaterThanOrEqual(1);
    }
  });
  it("RP-04: a long report runs over several pages; hostile and very long text does not break it", async () => {
    const def = REPORTS.bookings;
    const f = parseReportFilter(def, {}, TODAY);
    const rows = Array.from({ length: 200 }, (_, i) => ({
      ...bookingRows()[0],
      booking_code: `AAA-2026-${String(i + 1).padStart(6, "0")}`,
      guest_name:
        i === 0 ? "A".repeat(300) : i === 1 ? '=HYPERLINK("x")' : `Guest ${i}`,
    }));
    const page = mapBookings(rows, NAMES);
    const big = await renderReportPdf(buildPdfModel(def, f, page, null, AT));
    const small = await renderReportPdf(
      buildPdfModel(def, f, samplePage("bookings"), null, AT),
    );
    expect(pages(big)).toBeGreaterThan(3);
    expect(big.length).toBeGreaterThan(small.length);
    expect(big.length).toBeLessThan(10 * 1024 * 1024);
  });
  it("RP-05: every character printed has a glyph in the bundled font (the rupee sign, the minus sign, the dash, the dot)", async () => {
    const { createRequire } = await import("node:module");
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const fontkit = createRequire(import.meta.url)("fontkit") as {
      create(b: Buffer): { hasGlyphForCodePoint(c: number): boolean };
    };
    const font = fontkit.create(
      readFileSync(
        path.join(
          process.cwd(),
          "src",
          "lib",
          "pdf",
          "fonts",
          "NotoSans-Regular.ttf",
        ),
      ),
    );
    const printed = new Set<string>();
    for (const key of REPORT_KEYS) {
      const def = REPORTS[key];
      const f = parseReportFilter(def, {}, TODAY);
      const m = buildPdfModel(def, f, samplePage(key), null, AT);
      for (const line of [
        m.title,
        m.dateLine,
        m.ruleLine,
        m.filterLine,
        m.generatedLine,
        ...m.rows.flat(),
        ...(m.totalsRow ?? []),
        ...m.summary.flatMap((s) => [s.label, s.value]),
        ...m.columns.map((c) => c.label),
      ])
        for (const ch of line) printed.add(ch);
    }
    expect(printed.has("₹")).toBe(true);
    expect(printed.has("−")).toBe(true);
    for (const ch of printed)
      expect(
        font.hasGlyphForCodePoint(ch.codePointAt(0)!),
        `U+${ch.codePointAt(0)!.toString(16)} ${ch}`,
      ).toBe(true);
  });
  it("RP-06: very long text is cut to a length that always fits, with an ellipsis and a note; the CSV keeps the whole text; short text is left alone", () => {
    expect(clipText("short", PDF_TEXT_MAX)).toBe("short");
    expect(clipText("A".repeat(PDF_TEXT_MAX), PDF_TEXT_MAX)).toBe(
      "A".repeat(PDF_TEXT_MAX),
    );
    expect(clipText("A".repeat(PDF_TEXT_MAX + 1), PDF_TEXT_MAX)).toBe(
      `${"A".repeat(PDF_TEXT_MAX - 1)}…`,
    );
    expect(Array.from(clipText("नमस्ते".repeat(30), 10))).toHaveLength(10); // whole characters, not halves
    const def = REPORTS.bookings;
    const f = parseReportFilter(def, {}, TODAY);
    const rows = bookingRows();
    rows[0].guest_name = "W".repeat(300);
    const m = buildPdfModel(def, f, mapBookings(rows, NAMES), null, AT);
    expect(m.rows[0][2]).toBe(`${"W".repeat(PDF_TEXT_MAX - 1)}…`);
    expect(m.note).toMatch(/shortened in this PDF/);
    expect(
      buildPdfModel(def, f, samplePage("bookings"), null, AT).note,
    ).toBeNull();
    expect(PDF_WIDE_TEXT_MAX).toBeGreaterThan(PDF_TEXT_MAX);
  });
  it("RP-07: the worst case, every free-text cell of the widest report 300 letters long and 200 rows of it, still makes a PDF", async () => {
    const def = REPORTS["manual-adjustments"];
    const f = parseReportFilter(def, {}, TODAY);
    const row = { ...samplePage("manual-adjustments").rows[0] };
    for (const k of [
      "code",
      "resort",
      "guest",
      "adjustmentReason",
      "chargeReason",
    ])
      row[k] = "W".repeat(300);
    const pdf = await renderReportPdf(
      buildPdfModel(
        def,
        f,
        {
          rows: Array.from({ length: 200 }, () => row),
          total: 200,
          summary: { count: 200, total: -R(200) },
        },
        null,
        AT,
      ),
    );
    expect(pdf.toString("latin1").startsWith("%PDF-1.")).toBe(true);
    expect(pages(pdf)).toBeGreaterThan(5);
  }, 120_000);
});
