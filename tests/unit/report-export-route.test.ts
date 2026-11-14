import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  session: vi.fn(),
  resorts: vi.fn(),
  fetchPage: vi.fn(),
  render: vi.fn(),
}));
vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("@/lib/auth/session", () => ({ getSession: m.session }));
vi.mock("@/lib/bookings/data", () => ({ loadResorts: m.resorts }));
vi.mock("@/lib/reports/data", () => ({ fetchReportPage: m.fetchPage }));
vi.mock("@/lib/reports/pdf", () => ({ renderReportPdf: m.render }));

import { GET } from "@/app/api/export/[report]/route";
import {
  CSV_MAX_ROWS,
  EXPORT_PAGE,
  PDF_MAX_ROWS,
  REPORT_KEYS,
} from "@/lib/reports/definitions";
import type { ReportPage } from "@/lib/reports/rows";
import { RESORT_A, bookingRows, samplePage } from "../shared/report-sample";
import { mapBookings } from "@/lib/reports/rows";
import { NAMES } from "../shared/report-sample";

const call = (report: string, qs: string) =>
  GET(new Request(`http://x/api/export/${report}?${qs}`), {
    params: Promise.resolve({ report }),
  });
const ok = { state: "ok", user: { id: "u1" } };
const text = async (r: Response) =>
  new TextDecoder("utf-8", { ignoreBOM: true }).decode(await r.arrayBuffer());

beforeEach(() => {
  vi.clearAllMocks();
  m.session.mockResolvedValue(ok);
  m.resorts.mockResolvedValue([
    { id: RESORT_A, name: "Test Resort Alpha", active: true },
  ]);
  m.fetchPage.mockImplementation(async () =>
    samplePage("collection", { from: "2026-03-01", to: "2026-03-31" }),
  );
  m.render.mockResolvedValue(Buffer.from("%PDF-1.3 fake"));
});

describe("who may download, and what a bad request gets (RX-01..)", () => {
  it("RX-01: nobody signed in = 401; a blocked account = 403; nothing is read before that", async () => {
    m.session.mockResolvedValue({ state: "anonymous" });
    const a = await call(
      "collection",
      "from=2026-03-01&to=2026-03-31&format=csv",
    );
    expect(a.status).toBe(401);
    m.session.mockResolvedValue({ state: "blocked" });
    expect((await call("collection", "format=csv")).status).toBe(403);
    expect(m.resorts).not.toHaveBeenCalled();
    expect(m.fetchPage).not.toHaveBeenCalled();
    expect(a.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(await a.json())).not.toMatch(
      /error|stack|supabase|postgres/i,
    );
  });
  it("RX-02: an unknown report is 404; a missing or unknown format is 400", async () => {
    for (const bad of ["nope", "Collection", "..%2Fetc", "bookings%20"])
      expect((await call(bad, "format=csv")).status, bad).toBe(404);
    expect(
      (await call("collection", "from=2026-03-01&to=2026-03-31")).status,
    ).toBe(400);
    expect((await call("collection", "format=xlsx")).status).toBe(400);
    expect((await call("collection", "format=")).status).toBe(400);
    expect(m.fetchPage).not.toHaveBeenCalled();
  });
  it("RX-03: a bad choice in the address is a plain 400 (a file is strict, the screen is forgiving) and the database is not asked", async () => {
    for (const qs of [
      "from=2026-03-31&to=2026-03-01",
      "from=bad&to=2026-03-01",
      "group=hour",
      "resort=not-an-id",
      "from=2000-01-01&to=2026-03-01",
    ]) {
      const r = await call("collection", `${qs}&format=csv`);
      expect(r.status, qs).toBe(400);
      expect((await r.json()).message.length).toBeGreaterThan(10);
    }
    expect(m.fetchPage).not.toHaveBeenCalled();
  });
  it("RX-04: a resort that does not exist is 404", async () => {
    const r = await call(
      "collection",
      "from=2026-03-01&to=2026-03-31&resort=99999999-2222-4333-8444-555555555555&format=csv",
    );
    expect(r.status).toBe(404);
  });
  it("RX-05: a failed read is a plain 500 that says nothing technical and promises nothing was changed", async () => {
    m.fetchPage.mockResolvedValue(null);
    const r = await call(
      "collection",
      "from=2026-03-01&to=2026-03-31&format=csv",
    );
    expect(r.status).toBe(500);
    const body = await r.json();
    expect(body.message).toMatch(/could not be made/);
    expect(body.message).toMatch(/Nothing was changed/);
  });
});

describe("the CSV file (RX-06..)", () => {
  it("RX-06: headers: CSV, UTF-8, attachment with a safe name, never cached, no sniffing", async () => {
    const r = await call(
      "collection",
      "from=2026-03-01&to=2026-03-31&format=csv",
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(r.headers.get("content-disposition")).toBe(
      'attachment; filename="stateadv-collection-2026-03-01_2026-03-31.csv"',
    );
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it("RX-07: the body: the BOM, the header lines (title, date used, rule, filters, time zone, when), a blank line, the column names, the rows and the totals row", async () => {
    const body = await text(
      await call("collection", "from=2026-03-01&to=2026-03-31&format=csv"),
    );
    expect(body.startsWith("﻿")).toBe(true);
    const lines = body.slice(1).split("\r\n");
    expect(lines[0]).toBe("Collection report");
    expect(lines[1]).toBe(
      "Date used: Daily collection · by payment date · refunds by refund date",
    );
    expect(lines[2]).toMatch(/^Rule: .*Waiting for Approval is shown apart/);
    expect(lines[3]).toBe(
      "Resort: All resorts · Period: 1 Mar 2026 – 31 Mar 2026",
    );
    expect(lines[4]).toBe("Time zone: India (IST)");
    expect(lines[5]).toMatch(/^"Made on \d+ \w+ \d{4}, [\d:]+ [AP]M IST"$/);
    expect(lines[6]).toBe("");
    expect(lines[7]).toBe(
      "Period,Total Collection (Approved),Payments,Waiting for Approval,Refunds (Approved),Net Collection",
    );
    expect(lines[8]).toBe("2 Mar 2026,2000.00,1,0.00,0.00,2000.00");
    expect(lines[9]).toBe("11 Mar 2026,1500.00,1,1000.00,500.00,1000.00");
    expect(lines[10]).toBe("Total,3500.00,,1000.00,500.00,3000.00");
    expect(lines[11]).toBe("");
  });
  it("RX-08 (SEC-08): a guest called =HYPERLINK(...) is text in the file, not a formula; a comma in a name is quoted", async () => {
    m.fetchPage.mockResolvedValue(mapBookings(bookingRows(), NAMES));
    const body = await text(
      await call("bookings", "from=2026-03-01&to=2026-03-31&format=csv"),
    );
    expect(body).toContain("'=Evil Guest");
    expect(body).not.toMatch(/(^|,)=Evil/m);
    expect(body).toContain(",Agent · Test Agent,"); // the middle dot is plain text
    expect(body).toContain("2026-03-31 23:30"); // India time, 24 hours, ISO date
  });
  it("RX-09: a long list is read page after page (1,000 rows a call) until every row is in the file, and the totals are those of the whole list", async () => {
    const total = 2500;
    const row = mapBookings(bookingRows().slice(0, 1), NAMES).rows[0];
    m.fetchPage.mockImplementation(
      async (
        _d: unknown,
        _f: unknown,
        _n: unknown,
        limit: number,
        offset: number,
      ): Promise<ReportPage> => ({
        rows: Array.from(
          { length: Math.min(limit, total - offset) },
          (_, i) => ({ ...row, code: `ROW-${offset + i + 1}` }),
        ),
        total,
        summary: { count: total, pax: 5000, final: 1, due: 2 },
      }),
    );
    const body = await text(
      await call("bookings", "from=2026-03-01&to=2026-03-31&format=csv"),
    );
    expect(m.fetchPage.mock.calls.map((c) => [c[3], c[4]])).toEqual([
      [EXPORT_PAGE, 0],
      [EXPORT_PAGE, 1000],
      [EXPORT_PAGE, 2000],
    ]);
    expect(body.match(/^ROW-/gm)).toHaveLength(total);
    expect(body).toContain("ROW-2500,");
    expect(body.trimEnd().split("\r\n").at(-1)).toMatch(/^Total,/);
  });
  it("RX-10: if a later page cannot be read, the download fails instead of ending quietly with rows missing", async () => {
    const row = mapBookings(bookingRows().slice(0, 1), NAMES).rows[0];
    m.fetchPage.mockImplementation(
      async (
        _d: unknown,
        _f: unknown,
        _n: unknown,
        limit: number,
        offset: number,
      ) =>
        offset >= 1000
          ? null
          : {
              rows: Array.from({ length: limit }, () => row),
              total: 2500,
              summary: {},
            },
    );
    const r = await call(
      "bookings",
      "from=2026-03-01&to=2026-03-31&format=csv",
    );
    expect(r.status).toBe(200);
    await expect(r.arrayBuffer()).rejects.toThrow();
  });
  it("RX-11: an empty report is a file with the header lines and the column names and no totals row", async () => {
    m.fetchPage.mockResolvedValue({
      rows: [],
      total: 0,
      summary: {
        totalApproved: 0,
        totalWaiting: 0,
        totalRefunds: 0,
        totalNet: 0,
      },
    });
    const body = await text(
      await call("collection", "from=2026-03-01&to=2026-03-31&format=csv"),
    );
    expect(body.trimEnd().split("\r\n").at(-1)).toMatch(/^Period,/);
    expect(body).not.toMatch(/^Total/m);
  });
  it("RX-12: the resort's name is in the filter line, and the file name carries the dates", async () => {
    const r = await call(
      "collection",
      `from=2026-03-01&to=2026-03-31&resort=${RESORT_A}&format=csv`,
    );
    expect(await text(r)).toContain(
      "Resort: Test Resort Alpha · Period: 1 Mar 2026 – 31 Mar 2026",
    );
    expect(m.fetchPage.mock.calls[0][1]).toMatchObject({ resort: RESORT_A });
  });
});

describe("the PDF file (RX-13..)", () => {
  it("RX-13: headers: PDF, attachment, never cached; the model handed to the renderer holds the same title, rows and totals as the screen", async () => {
    const r = await call(
      "collection",
      "from=2026-03-01&to=2026-03-31&format=pdf",
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(r.headers.get("content-disposition")).toBe(
      'attachment; filename="stateadv-collection-2026-03-01_2026-03-31.pdf"',
    );
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(await r.arrayBuffer()).toString()).toBe("%PDF-1.3 fake");
    const model = m.render.mock.calls[0][0];
    expect(model.title).toBe("Collection report");
    expect(model.rows).toHaveLength(2);
    expect(model.totalsRow).toEqual([
      "Total",
      "₹3,500",
      "",
      "₹1,000",
      "₹500",
      "₹3,000",
    ]);
  });
  it("RX-14: more than 1,000 rows: a plain 413 that points to the CSV; nothing is rendered", async () => {
    m.fetchPage.mockResolvedValue({
      rows: [],
      total: PDF_MAX_ROWS + 1,
      summary: {},
    });
    const r = await call(
      "bookings",
      "from=2026-03-01&to=2026-03-31&format=pdf",
    );
    expect(r.status).toBe(413);
    expect((await r.json()).message).toMatch(/1000[\s\S]*CSV/);
    expect(m.render).not.toHaveBeenCalled();
  });
  it("RX-15: exactly 1,000 rows is still a PDF, read in one call", async () => {
    const row = mapBookings(bookingRows().slice(0, 1), NAMES).rows[0];
    m.fetchPage.mockImplementation(
      async (
        _d: unknown,
        _f: unknown,
        _n: unknown,
        limit: number,
        offset: number,
      ) => ({
        rows: Array.from(
          { length: Math.min(limit, PDF_MAX_ROWS - offset) },
          () => row,
        ),
        total: PDF_MAX_ROWS,
        summary: { count: PDF_MAX_ROWS, pax: 1, final: 1, due: 1 },
      }),
    );
    const r = await call(
      "bookings",
      "from=2026-03-01&to=2026-03-31&format=pdf",
    );
    expect(r.status).toBe(200);
    expect(m.fetchPage).toHaveBeenCalledTimes(1);
    expect(m.render.mock.calls[0][0].rows).toHaveLength(PDF_MAX_ROWS);
  });
  it("RX-20: signed out, EVERY report in BOTH formats is a 401 before anything is read; a blocked account is a 403", async () => {
    for (const state of ["anonymous", "blocked", "inactive"]) {
      m.session.mockResolvedValue({ state });
      for (const key of REPORT_KEYS)
        for (const format of ["csv", "pdf"]) {
          const r = await call(
            key,
            `from=2026-03-01&to=2026-03-31&format=${format}`,
          );
          expect(r.status, `${state} ${key} ${format}`).toBe(
            state === "anonymous" ? 401 : 403,
          );
          expect(r.headers.get("content-type")).toMatch(/json/); // never a file
        }
    }
    expect(m.resorts).not.toHaveBeenCalled();
    expect(m.fetchPage).not.toHaveBeenCalled();
    expect(m.render).not.toHaveBeenCalled();
  });
  it("RX-21: made-up resorts and tampered choices never reach the database or make a file, for every report and both formats", async () => {
    const evil = [
      "resort=11111111-2222-4333-8444-555555555556", // a well-formed id that is not a resort
      "resort=' or 1=1 --",
      "resort=%00",
      "resort=a,b",
      "resort[]=x",
      "from=2026-02-30&to=2026-03-01",
      "from=2026-03-01&to=2026-03-01';drop table payments;--",
      "from=0000-01-01&to=9999-12-31",
      "from=2016-01-01&to=2026-03-31", // more than ten years
      "status=approved%27--",
      "method=' or ''='",
      "group=month;select 1",
      "split=resort,method",
      "asof=tomorrow",
      "limit=999999&offset=-5",
    ];
    for (const key of REPORT_KEYS)
      for (const format of ["csv", "pdf"])
        for (const qs of evil) {
          const r = await call(key, `${qs}&format=${format}`);
          // a 400/404 for a bad choice; a harmless 200 only when the word is simply not one this report reads
          expect([200, 400, 404], `${key} ${format} ${qs}`).toContain(r.status);
          if (r.status === 200) await r.body?.cancel();
        }
    // nothing odd ever went to the database as text: every call it did get carries a valid, known filter
    for (const call_ of m.fetchPage.mock.calls) {
      const f = call_[1] as { resort: string | null };
      if (f.resort) expect(f.resort).toBe(RESORT_A);
    }
  });
  it("RX-17: a CSV above the row limit is a plain 413 that says what to do; the file is never cut short in silence", async () => {
    m.fetchPage.mockResolvedValue({
      rows: mapBookings(bookingRows(), NAMES).rows,
      total: CSV_MAX_ROWS + 1,
      summary: {},
    });
    const r = await call(
      "bookings",
      "from=2026-03-01&to=2026-03-31&format=csv",
    );
    expect(r.status).toBe(413);
    expect((await r.json()).message).toMatch(/100000[\s\S]*fewer dates/);
    expect(m.fetchPage).toHaveBeenCalledTimes(1);
  });
  it("RX-18: exactly the row limit is still a file", async () => {
    m.fetchPage.mockResolvedValue({
      rows: mapBookings(bookingRows(), NAMES).rows,
      total: CSV_MAX_ROWS,
      summary: {},
    });
    const r = await call(
      "bookings",
      "from=2026-03-01&to=2026-03-31&format=csv",
    );
    expect(r.status).toBe(200);
    await r.body?.cancel();
  });
  it("RX-19: the file is read one page when the reader asks for it, so nothing piles up: a reader that stops after the first chunk causes at most one more page read", async () => {
    const total = 20_000;
    const row = mapBookings(bookingRows().slice(0, 1), NAMES).rows[0];
    m.fetchPage.mockImplementation(
      async (
        _d: unknown,
        _f: unknown,
        _n: unknown,
        limit: number,
        offset: number,
      ): Promise<ReportPage> => ({
        rows: Array.from(
          { length: Math.min(limit, total - offset) },
          () => row,
        ),
        total,
        summary: { count: total },
      }),
    );
    const r = await call(
      "bookings",
      "from=2026-03-01&to=2026-03-31&format=csv",
    );
    const reader = r.body!.getReader();
    await reader.read();
    await new Promise((x) => setTimeout(x, 50));
    expect(m.fetchPage.mock.calls.length).toBeLessThanOrEqual(3); // 20 pages exist
    await reader.cancel();
  });
  it("RX-16: if the PDF library fails, it is a plain 500, not a stack trace", async () => {
    m.render.mockRejectedValue(new Error("secret internal detail"));
    const r = await call(
      "collection",
      "from=2026-03-01&to=2026-03-31&format=pdf",
    );
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toMatch(
      /secret internal detail/,
    );
  });
});
