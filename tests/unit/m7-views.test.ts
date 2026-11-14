import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CalendarMonthView } from "@/components/app/calendar/month-view";
import { CalendarDayView } from "@/components/app/calendar/day-view";
import { OldRecordsView } from "@/components/app/records/old-records-view";
import { ActivityView } from "@/components/app/activity/activity-view";
import { BackdatedTag } from "@/components/app/status-badge";
import type { DayData, DayItem } from "@/lib/calendar/data";
import type { CalendarDay } from "@/lib/calendar/model";
import type { RecordRow } from "@/lib/records/data";
import { parseRecordFilter } from "@/lib/records/filters";
import { parseActivityFilter } from "@/lib/activity/filters";
import type { ActivityEntry } from "@/lib/activity/diff";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(el);
const text = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'");

/** the whole <input ...> tag that contains a piece of text, so the order of its attributes does not matter */
const inputTag = (markup: string, piece: string) =>
  [...markup.matchAll(/<input[^>]*>/g)]
    .map((m) => m[0])
    .find((t) => t.includes(piece)) ?? "";

const RESORT = "11111111-2222-4333-8444-555555555555";
const names = new Map([[RESORT, "Test Resort Alpha"]]);
const zero = (date: string): CalendarDay => ({
  date,
  checkIns: 0,
  checkOuts: 0,
  staying: 0,
  duePaise: 0,
  collectedPaise: 0,
  waitingPaise: 0,
  refundsPaise: 0,
});
const march = (): CalendarDay[] =>
  Array.from({ length: 31 }, (_, i) =>
    zero(`2026-03-${String(i + 1).padStart(2, "0")}`),
  ).map((d) =>
    d.date === "2026-03-10"
      ? {
          ...d,
          checkIns: 2,
          staying: 2,
          duePaise: 250000,
          collectedPaise: 200000,
          waitingPaise: 150000,
        }
      : d.date === "2026-03-11"
        ? { ...d, checkOuts: 1, staying: 1, refundsPaise: 50000 }
        : d,
  );

describe("the month page (M7V-01..)", () => {
  const view = (over: Record<string, unknown> = {}) =>
    html(
      h(CalendarMonthView, {
        month: { year: 2026, month: 3 },
        resort: null,
        resortName: null,
        today: "2026-03-10",
        problem: null,
        days: { ok: true, data: march() },
        ...over,
      } as never),
    );
  it("M7V-01: a grid with seven weekday columns, every day a link to its page, today marked, money in rupees", () => {
    const out = view();
    expect(out).toContain('data-testid="calendar-grid"');
    for (const w of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])
      expect(out).toContain(`>${w}</th>`);
    for (let d = 1; d <= 31; d++)
      expect(out).toContain(
        `href="/calendar/2026-03-${String(d).padStart(2, "0")}"`,
      );
    expect(out.match(/aria-current="date"/g)).toHaveLength(1);
    const t = text(out);
    expect(t).toContain("March 2026");
    expect(t).toContain("₹2,500"); // due on the 10th
    expect(t).toContain("₹2,000"); // collected
    expect(t).toContain("₹1,500"); // waiting, shown apart
    expect(t).toContain("−₹500"); // refunds
    expect(out).toContain("Tuesday, 10 March 2026: 2 check-ins, 2 staying");
  });
  it("M7V-02: the phone list shows only busy days and says so", () => {
    const out = view();
    const agenda = out.slice(out.indexOf('data-testid="calendar-agenda"'));
    expect(agenda).toContain("Tue 10 Mar");
    expect(agenda).toContain("Wed 11 Mar");
    expect(agenda).not.toContain("Thu 12 Mar");
    expect(text(agenda)).toContain(
      "Only days with something on them are listed",
    );
    expect(out).toContain('class="md:hidden"');
    expect(out).toContain('class="hidden md:block"');
  });
  it("M7V-03: a month with nothing on it: friendly words, not a blank screen", () => {
    const out = view({
      days: { ok: true, data: march().map((d) => zero(d.date)) },
    });
    expect(text(out)).toContain("Nothing on this month's calendar");
  });
  it("M7V-04: previous and next keep the resort; the first and last allowed months have no dead link", () => {
    const out = view({ resort: RESORT, resortName: "Test Resort Alpha" });
    expect(out).toContain(
      `href="/calendar?month=2026-02&amp;resort=${RESORT}"`,
    );
    expect(out).toContain(
      `href="/calendar?month=2026-04&amp;resort=${RESORT}"`,
    );
    expect(out).toContain(`href="/calendar/2026-03-10?resort=${RESORT}"`);
    expect(text(out)).toContain("Test Resort Alpha");
    const first = view({ month: { year: 1990, month: 1 } });
    expect(first).not.toContain("month=1989-12");
    expect(first).toContain("pointer-events-none");
    const last = view({ month: { year: 2100, month: 12 } });
    expect(last).not.toContain("month=2101-01");
  });
  it("M7V-05: Add Booking carries today's date; the month picker keeps the resort; targets are at least 44 px", () => {
    const out = view({ resort: RESORT });
    expect(out).toContain(
      `href="/bookings/new?checkin=2026-03-10&amp;resort=${RESORT}"`,
    );
    expect(out).toContain(
      `<input type="hidden" name="resort" value="${RESORT}"/>`,
    );
    expect(out).toContain('name="month"');
    expect(out).toContain("min-h-11");
  });
  it("M7V-05b: Add Booking carries today in this month and the first day of any other month", () => {
    expect(view()).toContain('href="/bookings/new?checkin=2026-03-10"'); // March 2026 is today's month
    const other = view({ month: { year: 2026, month: 7 } });
    expect(other).toContain('href="/bookings/new?checkin=2026-07-01"');
    expect(other).not.toContain("checkin=2026-03-10");
  });
  it("M7V-06: a note about a bad address is shown; a failed load shows Try again, nothing technical", () => {
    expect(
      text(
        view({ problem: "That month was not valid, so this month is shown." }),
      ),
    ).toContain("That month was not valid");
    const err = view({ days: { ok: false } });
    expect(text(err)).toContain("The calendar could not be loaded");
    expect(err).toContain('href="/calendar?month=2026-03"');
    expect(err).not.toContain("calendar-grid");
  });
});

const item = (over: Partial<DayItem>): DayItem => ({
  kind: "check_in",
  bookingId: "b1",
  bookingCode: "AAA-2026-000001",
  resortId: RESORT,
  guestName: "Asha Rao",
  guestMobile: "9811100001",
  bookingStatus: "confirmed",
  checkInAt: "2026-03-10T08:30:00Z",
  checkOutAt: "2026-03-12T05:30:00Z",
  pax: 2,
  recordId: null,
  recordCode: null,
  amountPaise: null,
  recordStatus: null,
  method: null,
  label: null,
  recordDate: null,
  enteredOn: null,
  backdated: false,
  pendingPaise: 100000,
  ...over,
});
const totals = (o: Partial<DayData["totals"]> = {}) => ({
  check_in: 0,
  check_out: 0,
  staying: 0,
  payment: 0,
  refund: 0,
  due: 0,
  ...o,
});

describe("the day page (M7V-07..)", () => {
  const view = (
    items: DayItem[],
    tot: DayData["totals"],
    tab = "check-ins",
    over: Record<string, unknown> = {},
  ) =>
    html(
      h(CalendarDayView, {
        date: "2026-03-10",
        resort: null,
        resortName: null,
        today: "2026-03-10",
        tab,
        day: { ok: true, data: { items, totals: tot } },
        resortNames: names,
        ...over,
      } as never),
    );
  it("M7V-07: the title, the six tabs with their counts, previous/next day, back to the month, Add Booking for this date", () => {
    const out = view(
      [item({})],
      totals({ check_in: 1, staying: 3, payment: 4 }),
    );
    const t = text(out);
    expect(t).toContain("Tuesday, 10 March 2026");
    expect(t).toContain("Today");
    for (const label of [
      "Check-ins",
      "Check-outs",
      "Staying",
      "Payments Received",
      "Refunds",
      "Payments Due",
    ])
      expect(t).toContain(label);
    expect(out).toContain('href="/calendar/2026-03-10?tab=staying"');
    expect(out).toContain('href="/calendar/2026-03-09"');
    expect(out).toContain('href="/calendar/2026-03-11"');
    expect(out).toContain('href="/calendar?month=2026-03"');
    expect(out).toContain('href="/bookings/new?checkin=2026-03-10"');
    expect(t).toContain("Add Booking for this date");
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
  });
  it("M7V-08: a check-in row: guest, booking, resort, status, pending, and quick actions (open booking, add payment while money is pending)", () => {
    const out = view([item({})], totals({ check_in: 1 }));
    const t = text(out);
    expect(t).toContain("AAA-2026-000001");
    expect(t).toContain("Asha Rao · 9811100001");
    expect(t).toContain("Test Resort Alpha");
    expect(t).toContain("Confirmed");
    expect(t).toContain("Pending on this booking: ₹1,000");
    expect(out).toContain('href="/bookings/b1"');
    expect(out).toContain('href="/payments/new?booking=b1"');
    const paid = text(
      view([item({ pendingPaise: 0 })], totals({ check_in: 1 })),
    );
    expect(paid).not.toContain("Add Payment");
  });
  it("M7V-09: payments received: every status with its words, only the stored amount, a backdated one shows both dates", () => {
    const items = [
      item({
        kind: "payment",
        recordId: "p1",
        recordCode: "P-1",
        amountPaise: 200000,
        recordStatus: "approved",
        method: "cash",
        recordDate: "2026-03-10",
        enteredOn: "2026-03-10",
      }),
      item({
        kind: "payment",
        recordId: "p2",
        recordCode: "P-2",
        amountPaise: 150000,
        recordStatus: "waiting",
        method: "upi",
        label: "PhonePe",
        recordDate: "2026-03-10",
        enteredOn: "2026-03-20",
        backdated: true,
      }),
      item({
        kind: "payment",
        recordId: "p3",
        recordCode: "P-3",
        amountPaise: 70000,
        recordStatus: "rejected",
        method: "cash",
        recordDate: "2026-03-10",
        enteredOn: "2026-03-10",
      }),
      item({
        kind: "payment",
        recordId: "p4",
        recordCode: "P-4",
        amountPaise: 90000,
        recordStatus: "reversed",
        method: "cash",
        recordDate: "2026-03-10",
        enteredOn: "2026-03-10",
      }),
    ];
    const out = view(items, totals({ payment: 4 }), "payments");
    const t = text(out);
    for (const w of [
      "Approved",
      "Waiting for Approval",
      "Rejected",
      "Reversed",
    ])
      expect(t).toContain(w);
    expect(t).toContain("₹2,000");
    expect(t).toContain("P-2 · UPI · PhonePe");
    expect(t).toContain("Backdated");
    expect(t).toMatch(/Dated 10 Mar 2026\s*, entered on 20 Mar 2026/);
    expect(out.match(/Backdated/g)).toHaveLength(1); // only the one that was typed in later
    expect(out).toContain('href="/payments/p1"');
    expect(t).toContain("Only approved money is counted");
  });
  it("M7V-10: refunds are shown as money going out (minus sign) with their status", () => {
    const out = view(
      [
        item({
          kind: "refund",
          recordId: "r1",
          recordCode: "R-1",
          amountPaise: 50000,
          recordStatus: "approved",
          method: "cash",
          recordDate: "2026-03-10",
          enteredOn: "2026-03-10",
        }),
      ],
      totals({ refund: 1 }),
      "refunds",
    );
    expect(text(out)).toContain("−₹500");
    expect(out).toContain('href="/refunds/r1"');
    expect(text(out)).toContain("Approved");
  });
  it("M7V-11: payments due: the plan row's name or the adjustment's reason, and the amount", () => {
    const out = view(
      [
        item({
          kind: "due",
          recordId: "s1",
          amountPaise: 300000,
          method: "plan",
          label: "Balance",
        }),
        item({
          kind: "due",
          bookingId: "b2",
          bookingCode: "AAA-2026-000002",
          recordId: "a1",
          amountPaise: -50000,
          method: "adjustment",
          label: "Guest request",
        }),
      ],
      totals({ due: 2 }),
      "due",
    );
    const t = text(out);
    expect(t).toContain("Planned payment: Balance");
    expect(t).toContain("Adjustment: Guest request");
    expect(t).toContain("₹3,000");
  });
  it("M7V-12: an empty list says so in words for each tab", () => {
    for (const [tab, words] of [
      ["check-ins", "Nobody is arriving"],
      ["check-outs", "Nobody is leaving"],
      ["staying", "Nobody is staying overnight"],
      ["payments", "No payments are dated this day"],
      ["refunds", "No refunds are dated this day"],
      ["due", "No payments are due on this day"],
    ] as const)
      expect(text(view([], totals(), tab))).toContain(words);
  });
  it("M7V-13: a list cut at 300 says how many there really are", () => {
    const out = view(
      Array.from({ length: 300 }, (_, i) =>
        item({
          bookingId: `b${i}`,
          bookingCode: `AAA-2026-${String(i).padStart(6, "0")}`,
        }),
      ),
      totals({ check_in: 305 }),
    );
    expect(text(out)).toContain("Showing the first 300 of 305");
  });
  it("M7V-14: a failed day shows Try again; the resort is kept in links", () => {
    const err = view([], totals(), "check-ins", { day: { ok: false } });
    expect(text(err)).toContain("This day could not be loaded");
    const withResort = view([item({})], totals({ check_in: 1 }), "check-ins", {
      resort: RESORT,
      resortName: "Test Resort Alpha",
    });
    expect(withResort).toContain(
      `href="/calendar/2026-03-09?resort=${RESORT}"`,
    );
    expect(text(withResort)).toContain("Test Resort Alpha");
  });
});

const rec = (over: Partial<RecordRow>): RecordRow => ({
  type: "booking",
  id: "b1",
  code: "AAA-2026-000001",
  bookingId: "b1",
  bookingCode: "AAA-2026-000001",
  resortId: RESORT,
  guestName: "Asha Rao",
  guestMobile: "9811100001",
  status: "confirmed",
  amountPaise: 500000,
  recordDate: "2026-03-10",
  enteredOn: "2026-03-10",
  matchedDate: "2026-03-10",
  backdated: false,
  fileCount: 2,
  ...over,
});

describe("Old Records page (M7V-15..)", () => {
  const view = (
    rows: RecordRow[],
    total = rows.length,
    params: Record<string, string | string[]> = {},
    list: unknown = undefined,
  ) =>
    html(
      h(OldRecordsView, {
        f: parseRecordFilter(params),
        list: list ?? { ok: true, data: { rows, total } },
        resorts: [{ id: RESORT, name: "Test Resort Alpha" }],
        resortNames: names,
      } as never),
    );
  const rows = [
    rec({}),
    rec({
      type: "payment",
      id: "p1",
      code: "P-1",
      status: "approved",
      amountPaise: 200000,
      fileCount: 1,
      backdated: true,
      enteredOn: "2026-03-20",
      recordDate: "2026-03-11",
    }),
    rec({
      type: "refund",
      id: "r1",
      code: "R-1",
      status: "waiting",
      amountPaise: 50000,
      fileCount: 0,
    }),
  ];
  it("M7V-15: bookings, payments and refunds in one list, each linked to its own page, with files and PDFs reachable", () => {
    const out = view(rows);
    expect(out).toContain('href="/bookings/b1"');
    expect(out).toContain('href="/payments/p1"');
    expect(out).toContain('href="/refunds/r1"');
    expect(out).toContain('href="/bookings/b1?tab=pdfs"');
    const t = text(out);
    expect(t).toContain("2 PDF versions");
    expect(t).toContain("1 file");
    expect(t).toContain("No files");
    expect(t).toContain("Amount Due");
    expect(t).toContain("3 records");
    expect(out).toContain('data-testid="record-table"');
    expect(out).toContain('data-testid="record-cards"');
  });
  it("M7V-16: a backdated payment shows the tag with both dates", () => {
    const t = text(view(rows));
    expect(t).toContain("Backdated");
    expect(t).toContain("entered 20 Mar 2026");
    expect(t).toContain("11 Mar 2026");
  });
  it("M7V-17: the form: search, resort, date type, From/To, the three kinds as ticks; filled in from the address", () => {
    const out = view(rows, 3, {
      q: "Asha",
      types: ["payment"],
      basis: "entry",
      from: "2026-03-01",
      to: "2026-03-31",
      resort: RESORT,
    });
    expect(out).toContain('value="Asha"');
    expect(out).toContain('name="types"');
    expect(inputTag(out, 'value="payment"')).toContain('checked=""');
    expect(inputTag(out, 'value="booking"')).not.toContain('checked=""');
    expect(out).toContain('value="2026-03-01"');
    expect(out).toContain('value="2026-03-31"');
    expect(text(out)).toContain("The day it was typed in");
    expect(out).toContain("min-h-11");
  });
  it("M7V-17b: all five date choices are offered, in plain words, with a hint that booking dates bring the payments along", () => {
    const out = view(rows);
    for (const v of [
      "record",
      "entry",
      "check_in",
      "check_out",
      "cancellation",
    ])
      expect(out).toContain(`<option value="${v}"`);
    const t = text(out);
    expect(t).toContain("Check-in date of the booking");
    expect(t).toContain("Check-out date of the booking");
    expect(t).toContain(
      "Cancellation date (cancelled and no-show bookings only)",
    );
    expect(t).toContain("its payments and refunds are listed with it");
    expect(view(rows, 3, { basis: "check_out" })).toMatch(
      /<option value="check_out" selected="">/,
    );
  });
  it("M7V-17c: the row says which stored date matched, but only when it is not the record's own date", () => {
    const withCheckIn = text(
      view([rec({ matchedDate: "2026-03-10" })], 1, { basis: "check_in" }),
    );
    expect(withCheckIn).toContain("Booking checks in 10 Mar 2026");
    const cancelled = text(
      view([rec({ matchedDate: "2026-03-09" })], 1, { basis: "cancellation" }),
    );
    expect(cancelled).toContain("Booking cancelled 9 Mar 2026");
    const entered = text(
      view(
        [
          rec({
            type: "payment",
            status: "approved",
            id: "p1",
            code: "P-1",
            backdated: true,
            recordDate: "2026-03-11",
            enteredOn: "2026-03-20",
            matchedDate: "2026-03-20",
          }),
        ],
        1,
        { basis: "entry" },
      ),
    );
    expect(entered).toContain("Typed in 20 Mar 2026");
    expect(entered).toContain("Backdated"); // still marked
    expect(entered).not.toContain("entered 20 Mar 2026"); // not said twice
    const plain = text(view([rec({})], 1, {}));
    expect(plain).not.toContain("Booking checks in");
    expect(plain).not.toContain("Typed in");
    const backdatedElsewhere = text(
      view(
        [
          rec({
            type: "payment",
            status: "approved",
            id: "p1",
            code: "P-1",
            backdated: true,
            recordDate: "2026-03-11",
            enteredOn: "2026-03-20",
            matchedDate: "2026-03-10",
          }),
        ],
        1,
        { basis: "check_in" },
      ),
    );
    expect(backdatedElsewhere).toContain("Backdated");
    expect(backdatedElsewhere).toContain("entered 20 Mar 2026");
  });
  it("M7V-18: nothing found, nothing yet, bad address note, failed load, paging", () => {
    expect(text(view([], 0, { q: "zzz" }))).toContain("No records match");
    expect(text(view([], 0))).toContain("No records yet");
    expect(text(view(rows, 3, { from: "bad" }))).toContain(
      "A date in the address was not valid",
    );
    expect(text(view([], 0, {}, { ok: false }))).toContain(
      "The records could not be loaded",
    );
    const paged = view(rows, 60, { page: "2" });
    expect(text(paged)).toContain("Page 2 of 3");
    expect(paged).toContain('href="/old-records?page=3"');
    expect(paged).toContain('href="/old-records"');
    expect(text(paged)).toContain("showing 26 to 50");
  });
});

const act = (over: Partial<ActivityEntry>): ActivityEntry => ({
  id: 41,
  at: "2026-03-10T08:30:00Z",
  actorName: "Asha Rao",
  action: "update",
  recordType: "payment",
  tableName: "payments",
  recordId: "p1",
  recordCode: "P-1",
  bookingId: "b1",
  bookingCode: "AAA-2026-000001",
  resortId: RESORT,
  targetUserName: null,
  changedFields: ["status", "approved_by"],
  oldValues: {
    status: "waiting",
    approved_by: "99999999-2222-4333-8444-555555555555",
  },
  newValues: {
    status: "approved",
    approved_by: "88888888-2222-4333-8444-555555555555",
  },
  reason: null,
  ...over,
});

describe("Activity page (M7V-19..)", () => {
  const view = (
    rows: ActivityEntry[],
    total = rows.length,
    params: Record<string, string> = {},
    list: unknown = undefined,
  ) =>
    html(
      h(ActivityView, {
        f: parseActivityFilter(params),
        list: list ?? { ok: true, data: { rows, total } },
        people: [
          { id: "99999999-2222-4333-8444-555555555555", name: "Asha Rao" },
        ],
        resorts: [{ id: RESORT, name: "Test Resort Alpha" }],
        resortNames: names,
      } as never),
    );
  it("M7V-19: an entry has a plain sentence, the time in IST, a link to the record, and a 'What changed' table with before and after", () => {
    const out = view([act({})]);
    const t = text(out);
    expect(t).toContain("Asha Rao approved a payment.");
    expect(t).toContain("Activity no. 41"); // a simple number to quote; not a technical "entry"
    expect(t).not.toContain("Entry 41");
    expect(t).toContain("10 Mar 2026, 2:00 PM");
    expect(out).toContain('href="/payments/p1"');
    expect(t).toContain("What changed (1)");
    expect(t).toContain("Status Waiting for Approval Approved");
    expect(t).toContain("Test Resort Alpha");
    expect(t).toContain("Booking AAA-2026-000001");
  });
  it("M7V-20: no raw identifiers are shown anywhere (who-did-it ids are hidden)", () => {
    const out = view([act({})]);
    expect(out).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"?\s*<\/td>/,
    );
    expect(text(out)).not.toContain("99999999-2222");
  });
  it("M7V-21: a new record lists its values; a reason is shown; account actions have no table and name the person", () => {
    const created = view([
      act({
        action: "insert",
        recordType: "booking",
        recordId: "b1",
        recordCode: "AAA-2026-000001",
        changedFields: null,
        oldValues: null,
        newValues: { guest_name: "Asha Rao", pax: 2 },
      }),
    ]);
    expect(text(created)).toContain("Asha Rao added a booking.");
    expect(text(created)).toContain("Guest name Asha Rao");
    expect(text(created)).toContain("What Filled in");
    expect(created).not.toContain("Before");
    const reset = view([
      act({
        action: "password_reset",
        recordType: "user",
        tableName: "user_profiles",
        recordCode: null,
        bookingId: null,
        bookingCode: null,
        resortId: null,
        targetUserName: "Ravi",
        changedFields: null,
        oldValues: null,
        newValues: null,
        reason: "Forgot it",
      }),
    ]);
    expect(text(reset)).toContain(
      "Asha Rao set a new temporary password for Ravi.",
    );
    expect(text(reset)).toContain("Reason: Forgot it");
    expect(reset).not.toContain("What changed");
  });
  it("M7V-22: the filters: who, what, kind, resort, dates, and the corrections tick; filled in from the address", () => {
    const out = view([act({})], 1, {
      action: "update",
      type: "payment",
      corrections: "1",
      from: "2026-03-01",
    });
    expect(out).toContain('name="actor"');
    expect(out).toContain("Everybody");
    expect(out).toContain("Account actions");
    expect(out).toContain("Only files added after approval");
    expect(inputTag(out, 'name="corrections"')).toContain('checked=""');
    expect(out).toContain('value="2026-03-01"');
  });
  it("M7V-23: empty states, bad address, failed load, paging", () => {
    expect(text(view([], 0))).toContain("No activity yet");
    expect(text(view([], 0, { type: "payment" }))).toContain("Nothing matches");
    expect(text(view([act({})], 1, { action: "delete" }))).toContain(
      "That kind of action is not known",
    );
    expect(text(view([], 0, {}, { ok: false }))).toContain(
      "The activity could not be loaded",
    );
    const paged = view([act({})], 80, { page: "2", type: "payment" });
    expect(text(paged)).toContain("Page 2 of 4");
    expect(paged).toContain('href="/activity?type=payment&amp;page=3"');
    expect(text(paged)).toContain("This list can only grow");
  });
});

describe("shared pieces (M7V-24)", () => {
  it("M7V-24: the Backdated tag is words, not only colour", () => {
    const out = html(h(BackdatedTag, { entered: "20 Mar 2026" }));
    expect(text(out)).toContain("Backdated");
    expect(out).toContain('title="Entered on 20 Mar 2026"');
  });
});
