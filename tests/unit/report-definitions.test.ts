import { describe, expect, it } from "vitest";
import {
  CSV_MAX_ROWS,
  EXPORT_PAGE,
  MAX_PERIOD_DAYS,
  PAGE_SIZE,
  PDF_MAX_ROWS,
  REPORTS,
  REPORT_KEYS,
  defaultFilter,
  exportFileName,
  exportHref,
  filterQuery,
  filterText,
  isReportKey,
  parseReportFilter,
  presetPeriods,
  reportHref,
} from "@/lib/reports/definitions";

const TODAY = "2026-11-14";
const RESORT = "11111111-2222-4333-8444-555555555555";
const parse = (
  key: (typeof REPORT_KEYS)[number],
  params: Record<string, string | string[]> = {},
) => parseReportFilter(REPORTS[key], params, TODAY);

describe("the list of reports (RD-01..)", () => {
  it("RD-01: ten reports, in the order of the plan, each with a title, a card sentence and the three header rules", () => {
    expect([...REPORT_KEYS]).toEqual([
      "collection",
      "resort-wise",
      "payment-methods",
      "bookings",
      "pending",
      "waiting",
      "refunds",
      "cancellations",
      "expected-adjustments",
      "manual-adjustments",
    ]);
    for (const key of REPORT_KEYS) {
      const def = REPORTS[key];
      const f = defaultFilter(def, TODAY);
      expect(def.key).toBe(key);
      expect(def.title.length).toBeGreaterThan(3);
      expect(def.blurb.length).toBeGreaterThan(20);
      expect(def.dateRule(f)).toMatch(/\bdate\b|Overdue as of/i); // every header says which date it uses (PRD 5.16)
      expect(def.approvalRule(f).length).toBeGreaterThan(20); // and the rule that was applied
      expect(filterText(def, f, null)).not.toBe("");
    }
  });
  it("RD-02: the report keys are the only ones accepted", () => {
    expect(isReportKey("collection")).toBe(true);
    expect(isReportKey("manual-adjustments")).toBe(true);
    for (const bad of [
      "",
      "Collection",
      "collections",
      "../etc/passwd",
      "bookings ",
      "dashboard",
      undefined,
      null,
    ])
      expect(isReportKey(bad as string | undefined | null)).toBe(false);
  });
  it("RD-03: the columns: every key is unique, every column has a label, and the totals and the summary only point at real keys", () => {
    for (const key of REPORT_KEYS) {
      const def = REPORTS[key];
      for (const split of ["none", "resort", "method"] as const) {
        const f = { ...defaultFilter(def, TODAY), split };
        const cols = def.columns(f);
        const keys = cols.map((c) => c.key);
        expect(new Set(keys).size).toBe(keys.length);
        expect(cols.every((c) => c.label.length > 0)).toBe(true);
        for (const col of Object.keys(def.totals(f)))
          expect(keys).toContain(col);
        const summaryKeys = def.summary(f).map((s) => s.key);
        for (const sk of Object.values(def.totals(f)))
          expect(summaryKeys.includes(sk) || sk.length > 0).toBe(true);
      }
    }
  });
  it("RD-04: the Collection report's columns follow the split", () => {
    const col = (split: "none" | "resort" | "method") =>
      REPORTS.collection
        .columns({ ...defaultFilter(REPORTS.collection, TODAY), split })
        .map((c) => c.key);
    expect(col("none")).toEqual([
      "period",
      "approved",
      "approvedCount",
      "waiting",
      "refunds",
      "net",
    ]);
    expect(col("resort")).toEqual([
      "period",
      "resort",
      "approved",
      "approvedCount",
      "waiting",
      "refunds",
      "net",
    ]);
    expect(col("method")).toEqual([
      "period",
      "method",
      "approved",
      "approvedCount",
      "waiting",
      "refunds",
      "net",
    ]);
  });
  it("RD-05: the money words are the ones of the rest of the app, and 'Waiting' is never part of a collection total", () => {
    const labels = REPORT_KEYS.flatMap((k) =>
      REPORTS[k].columns(defaultFilter(REPORTS[k], TODAY)).map((c) => c.label),
    );
    expect(labels).toContain("Total Collection (Approved)");
    expect(labels).toContain("Waiting for Approval");
    expect(labels.join("|")).not.toMatch(/Paid and Approved/);
    for (const k of ["collection", "resort-wise", "payment-methods"] as const)
      expect(REPORTS[k].approvalRule(defaultFilter(REPORTS[k], TODAY))).toMatch(
        /Waiting for Approval is shown apart/,
      );
  });
  it("RD-06: the page sizes: 25 on the screen, 1,000 a call for a file, 1,000 rows at most in a PDF", () => {
    expect([PAGE_SIZE, EXPORT_PAGE, PDF_MAX_ROWS, MAX_PERIOD_DAYS]).toEqual([
      25, 1000, 1000, 3660,
    ]);
    expect(CSV_MAX_ROWS).toBeGreaterThan(PDF_MAX_ROWS);
  });
});

describe("reading the address (RD-07..)", () => {
  it("RD-07: the first visit is this month (1 to 30 November) for a report with a period, and nothing else is filtered", () => {
    const f = parse("collection");
    expect(f).toMatchObject({
      resort: null,
      from: "2026-11-01",
      to: "2026-11-30",
      group: "day",
      split: "none",
      problem: null,
      page: 1,
    });
    expect(parse("bookings")).toMatchObject({
      from: "2026-11-01",
      to: "2026-11-30",
      dateField: "booking",
    });
    expect(parse("pending")).toMatchObject({
      from: null,
      to: null,
      asOf: TODAY,
    });
    expect(parse("waiting")).toMatchObject({
      from: null,
      to: null,
      dateType: "entry",
      kind: null,
    }); // the whole queue
  });
  it("RD-08: a period typed in is used; both boxes left empty mean no limit on the dates (only for the lists)", () => {
    expect(
      parse("refunds", { from: "2026-03-01", to: "2026-03-31" }),
    ).toMatchObject({ from: "2026-03-01", to: "2026-03-31", problem: null });
    expect(parse("refunds", { from: "", to: "" })).toMatchObject({
      from: null,
      to: null,
      problem: null,
    });
    expect(parse("refunds", { from: "2026-03-01", to: "" })).toMatchObject({
      from: "2026-03-01",
      to: null,
    });
    const open = parse("collection", { from: "", to: "" });
    expect(open).toMatchObject({ from: "2026-11-01", to: "2026-11-30" }); // a period report needs both dates
    expect(open.problem).toMatch(/start date and an end date/);
  });
  it("RD-09: bad dates fall back to this month with a plain note: not a date, backwards, more than ten years", () => {
    for (const p of [
      { from: "2026-02-30", to: "2026-03-31" },
      { from: "x", to: "y" },
      { from: "2026-03-31", to: "2026-03-01" },
    ]) {
      const f = parse("collection", p);
      expect([f.from, f.to]).toEqual(["2026-11-01", "2026-11-30"]);
      expect(f.problem).toBeTruthy();
    }
    expect(
      parse("collection", { from: "2010-01-01", to: "2026-01-01" }).problem,
    ).toMatch(/ten years/);
    expect(
      parse("collection", { from: "2016-01-01", to: "2026-01-08" }).problem,
    ).toBeNull(); // exactly 3,660 days
    expect(
      parse("collection", { from: "2016-01-01", to: "2026-01-09" }).problem,
    ).toMatch(/ten years/);
    expect(
      parse("refunds", { from: "2000-01-01", to: "2026-01-01" }).problem,
    ).toBeNull(); // a list has no limit
  });
  it("RD-10: only the filters a report has are read: a status on the Collection report is ignored", () => {
    const f = parse("collection", {
      status: "cancelled",
      method: "upi",
      kind: "refund",
      resort: RESORT,
    });
    expect(f).toMatchObject({
      status: null,
      method: null,
      kind: null,
      resort: RESORT,
    });
    expect(
      parse("pending", { from: "2026-01-01", to: "2026-01-31" }),
    ).toMatchObject({ from: null, to: null });
  });
  it("RD-11: the resort must be a real identifier; 'all' and nothing mean all resorts", () => {
    expect(parse("bookings", { resort: RESORT.toUpperCase() }).resort).toBe(
      RESORT,
    );
    expect(parse("bookings", { resort: "all" })).toMatchObject({
      resort: null,
      problem: null,
    });
    const bad = parse("bookings", { resort: "'; drop table resorts; --" });
    expect(bad.resort).toBeNull();
    expect(bad.problem).toMatch(/resort/);
  });
  it("RD-12: group, split, date choices, kind, method, source and status are checked against their lists", () => {
    expect(
      parse("collection", { group: "week", split: "method" }),
    ).toMatchObject({ group: "week", split: "method" });
    expect(parse("collection", { group: "hour" })).toMatchObject({
      group: "day",
    });
    expect(parse("collection", { group: "hour" }).problem).toBeTruthy();
    expect(
      parse("bookings", { dateField: "check_in", status: "no_show" }),
    ).toMatchObject({ dateField: "check_in", status: "no_show" });
    expect(parse("bookings", { status: "approved" }).status).toBeNull(); // an approval status is not a booking status
    expect(
      parse("refunds", { status: "approved", method: "upi" }),
    ).toMatchObject({ status: "approved", method: "upi" });
    expect(parse("refunds", { status: "confirmed" }).status).toBeNull();
    expect(parse("cancellations", { status: "no_show" }).status).toBe(
      "no_show",
    );
    expect(parse("cancellations", { status: "confirmed" }).status).toBeNull();
    expect(
      parse("waiting", { dateType: "record", kind: "refund" }),
    ).toMatchObject({ dateType: "record", kind: "refund" });
    expect(parse("waiting", { kind: "booking" }).kind).toBeNull();
    expect(
      parse("expected-adjustments", { source: "move_overdue" }).source,
    ).toBe("move_overdue");
    expect(
      parse("expected-adjustments", { source: "magic" }).source,
    ).toBeNull();
  });
  it("RD-13: as-of date and page number", () => {
    expect(parse("pending", { asOf: "2026-03-31" }).asOf).toBe("2026-03-31");
    expect(parse("pending", { asOf: "31/03/2026" })).toMatchObject({
      asOf: TODAY,
      problem: expect.stringMatching(/today/),
    });
    expect(parse("bookings", { page: "3" }).page).toBe(3);
    for (const bad of ["0", "-1", "abc", "9999999", "2.5"])
      expect(parse("bookings", { page: bad }).page).toBe(1);
    expect(parse("collection", { page: "4" }).page).toBe(1); // a one-table report has no pages
  });
  it("RD-14: arrays in the address (a repeated name) use the first value", () => {
    expect(parse("collection", { group: ["month", "year"] }).group).toBe(
      "month",
    );
  });
});

describe("links and file names (RD-15..)", () => {
  it("RD-15: the address of a report keeps the period (also an empty one), the resort and every choice that differs from the default", () => {
    const f = {
      ...parse("bookings", {
        resort: RESORT,
        dateField: "check_in",
        status: "cancelled",
        page: "2",
      }),
    };
    const q = filterQuery(REPORTS.bookings, f).toString();
    expect(q).toBe(
      `resort=${RESORT}&from=2026-11-01&to=2026-11-30&dateField=check_in&status=cancelled&page=2`,
    );
    expect(reportHref(REPORTS.bookings, f)).toBe(`/reports/bookings?${q}`);
    expect(reportHref(REPORTS.bookings, f, { page: 1 })).not.toContain("page=");
    expect(
      reportHref(REPORTS.refunds, {
        ...defaultFilter(REPORTS.refunds, TODAY),
        from: null,
        to: null,
      }),
    ).toBe("/reports/refunds?from=&to=");
    expect(
      reportHref(REPORTS.waiting, defaultFilter(REPORTS.waiting, TODAY)),
    ).toBe("/reports/waiting?from=&to=");
  });
  it("RD-16: what a report does not use is never written (the as-of date is only for Pending)", () => {
    expect(
      filterQuery(REPORTS.collection, {
        ...defaultFilter(REPORTS.collection, TODAY),
        asOf: "2026-01-01",
        status: "x",
        kind: "refund",
      }).toString(),
    ).toBe("from=2026-11-01&to=2026-11-30");
    expect(
      filterQuery(
        REPORTS.pending,
        defaultFilter(REPORTS.pending, TODAY),
      ).toString(),
    ).toBe(`asOf=${TODAY}`);
  });
  it("RD-17: the file address asks for the same filters and always the first page; the format is last", () => {
    const f = parse("bookings", { page: "5", status: "cancelled" });
    expect(exportHref(REPORTS.bookings, f, "csv")).toBe(
      "/api/export/bookings?from=2026-11-01&to=2026-11-30&status=cancelled&format=csv",
    );
    expect(
      exportHref(REPORTS.pending, defaultFilter(REPORTS.pending, TODAY), "pdf"),
    ).toBe(`/api/export/pending?asOf=${TODAY}&format=pdf`);
  });
  it("RD-18: file names are made of letters, digits, dots, dashes and underscores only", () => {
    const f = parse("collection", { from: "2026-03-01", to: "2026-03-31" });
    expect(exportFileName(REPORTS.collection, f, "csv")).toBe(
      "stateadv-collection-2026-03-01_2026-03-31.csv",
    );
    expect(
      exportFileName(REPORTS.pending, { ...f, asOf: "2026-03-31" }, "pdf"),
    ).toBe("stateadv-pending-as-of-2026-03-31.pdf");
    expect(
      exportFileName(REPORTS.refunds, { ...f, from: null, to: null }, "csv"),
    ).toBe("stateadv-refunds-start_end.csv");
    for (const key of REPORT_KEYS)
      expect(
        exportFileName(REPORTS[key], defaultFilter(REPORTS[key], TODAY), "csv"),
      ).toMatch(/^[a-zA-Z0-9._-]+$/);
  });
  it("RD-19: the 'Showing' sentence names the resort, the period and the choices in plain words", () => {
    const f = parse("refunds", {
      from: "2026-03-01",
      to: "2026-03-31",
      status: "waiting",
      method: "upi",
    });
    expect(filterText(REPORTS.refunds, f, "Test Resort Alpha")).toBe(
      "Resort: Test Resort Alpha · Period: 1 Mar 2026 – 31 Mar 2026 · Status: Waiting for Approval · Paid by: UPI",
    );
    expect(
      filterText(
        REPORTS.refunds,
        { ...f, from: null, to: null, status: null, method: null },
        null,
      ),
    ).toBe("Resort: All resorts · Period: all dates");
    expect(
      filterText(REPORTS.pending, defaultFilter(REPORTS.pending, TODAY), null),
    ).toBe("Resort: All resorts · As of: 14 Nov 2026");
  });
  it("RD-20: the ready-made periods: this month, last month (also across a year end), this year", () => {
    expect(presetPeriods("2026-11-14")).toEqual([
      {
        key: "month",
        label: "This month",
        from: "2026-11-01",
        to: "2026-11-30",
      },
      {
        key: "last-month",
        label: "Last month",
        from: "2026-10-01",
        to: "2026-10-31",
      },
      { key: "year", label: "This year", from: "2026-01-01", to: "2026-12-31" },
    ]);
    expect(presetPeriods("2026-01-05")[1]).toMatchObject({
      from: "2025-12-01",
      to: "2025-12-31",
    });
    expect(presetPeriods("2028-03-10")[1]).toMatchObject({
      from: "2028-02-01",
      to: "2028-02-29",
    }); // leap year
  });
});
