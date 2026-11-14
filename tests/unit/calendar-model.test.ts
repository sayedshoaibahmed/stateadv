import { describe, expect, it } from "vitest";
import {
  MAX_YEAR,
  MIN_YEAR,
  TABS,
  WEEKDAY_HEADS,
  addBookingHref,
  defaultBookingDay,
  addDays,
  agendaDays,
  dayHref,
  dayLabel,
  dayShort,
  dayTitle,
  daysInMonth,
  inRange,
  isQuiet,
  kindOf,
  monthGrid,
  monthHref,
  monthKey,
  monthLabel,
  monthOf,
  parseDay,
  parseMonth,
  parseResort,
  parseTab,
  shiftMonth,
  weekdayIndex,
  type CalendarDay,
} from "@/lib/calendar/model";

const RESORT = "11111111-2222-4333-8444-555555555555";
const quiet = (date: string): CalendarDay => ({
  date,
  checkIns: 0,
  checkOuts: 0,
  staying: 0,
  duePaise: 0,
  collectedPaise: 0,
  waitingPaise: 0,
  refundsPaise: 0,
});

describe("the month and its days (CALM-01..)", () => {
  it("CALM-01: month lengths, leap years and the century rule", () => {
    expect(daysInMonth({ year: 2026, month: 2 })).toBe(28);
    expect(daysInMonth({ year: 2028, month: 2 })).toBe(29);
    expect(daysInMonth({ year: 2100, month: 2 })).toBe(28); // not a leap year
    expect(daysInMonth({ year: 2000, month: 2 })).toBe(29); // a leap year
    expect(daysInMonth({ year: 2026, month: 4 })).toBe(30);
    expect(daysInMonth({ year: 2026, month: 12 })).toBe(31);
  });
  it("CALM-02: weekdays: Monday = 0 ... Sunday = 6", () => {
    expect(weekdayIndex("2026-03-09")).toBe(0); // Monday
    expect(weekdayIndex("2026-03-10")).toBe(1);
    expect(weekdayIndex("2026-03-15")).toBe(6); // Sunday
    expect(weekdayIndex("2020-02-29")).toBe(5); // Saturday
    expect(weekdayIndex("2035-12-31")).toBe(0); // Monday
    expect(WEEKDAY_HEADS[0]).toBe("Mon");
    expect(WEEKDAY_HEADS[6]).toBe("Sun");
  });
  it("CALM-03: the grid has whole weeks, starts on the right weekday and holds every day once", () => {
    for (const [year, month] of [
      [2026, 3], // starts on a Sunday: six empty places first
      [2026, 6], // starts on a Monday: none
      [2021, 2], // 28 days starting on a Monday: exactly four weeks
      [2028, 2], // leap
      [2035, 12],
      [1990, 1],
      [2100, 12],
    ]) {
      const ref = { year, month };
      const weeks = monthGrid(ref);
      expect(weeks.every((w) => w.length === 7)).toBe(true);
      const days = weeks.flat().filter((d): d is string => d !== null);
      expect(days).toHaveLength(daysInMonth(ref));
      expect(days[0]).toBe(`${monthKey(ref)}-01`);
      expect(new Set(days).size).toBe(days.length);
      expect(weeks.flat().indexOf(days[0])).toBe(weekdayIndex(days[0]));
      const trailing = weeks.at(-1)!;
      expect(trailing.some((d) => d !== null)).toBe(true); // no empty last week
    }
    expect(monthGrid({ year: 2026, month: 3 })[0].slice(0, 6)).toEqual(
      Array(6).fill(null),
    );
    expect(monthGrid({ year: 2021, month: 2 })).toHaveLength(4);
  });
  it("CALM-04: labels and titles in plain English", () => {
    expect(monthLabel({ year: 2026, month: 3 })).toBe("March 2026");
    expect(monthKey({ year: 2026, month: 3 })).toBe("2026-03");
    expect(dayTitle("2026-03-10")).toBe("Tuesday, 10 March 2026");
    expect(dayTitle("2020-02-29")).toBe("Saturday, 29 February 2020");
    expect(dayShort("2026-03-10")).toBe("Tue 10 Mar");
    expect(monthOf("2035-12-31")).toEqual({ year: 2035, month: 12 });
  });
  it("CALM-05: next and previous month cross the year, and stop at 1990 and 2100", () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({
      year: 2027,
      month: 1,
    });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({
      year: 2025,
      month: 12,
    });
    expect(shiftMonth({ year: MIN_YEAR, month: 1 }, -1)).toBeNull();
    expect(shiftMonth({ year: MAX_YEAR, month: 12 }, 1)).toBeNull();
    expect(shiftMonth({ year: MAX_YEAR, month: 12 }, -1)).toEqual({
      year: MAX_YEAR,
      month: 11,
    });
    expect(inRange({ year: 2026, month: 0 })).toBe(false);
    expect(inRange({ year: 2026, month: 13 })).toBe(false);
    expect(inRange({ year: 1989, month: 12 })).toBe(false);
  });
  it("CALM-06: adding days crosses months, years and leap days", () => {
    expect(addDays("2026-03-31", 1)).toBe("2026-04-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
    expect(addDays("2035-12-31", 1)).toBe("2036-01-01");
  });
});

describe("reading the address (CALM-07..)", () => {
  it("CALM-07: ?month= : a good month, a missing one, and bad ones fall back to this month with a plain note", () => {
    expect(parseMonth("2026-03", "2026-11-12")).toEqual({
      ref: { year: 2026, month: 3 },
      problem: null,
    });
    expect(parseMonth(undefined, "2026-11-12")).toEqual({
      ref: { year: 2026, month: 11 },
      problem: null,
    });
    expect(parseMonth(["2031-07", "x"], "2026-11-12").ref).toEqual({
      year: 2031,
      month: 7,
    });
    for (const bad of [
      "2026-13",
      "2026-00",
      "26-03",
      "march",
      "2026-3",
      "1989-12",
      "2101-01",
      "2026-03-01",
      "<script>",
    ]) {
      const r = parseMonth(bad, "2026-11-12");
      expect(r.ref).toEqual({ year: 2026, month: 11 });
      expect(r.problem).toMatch(/not valid/);
    }
  });
  it("CALM-08: ?resort= : only a real identifier counts; 'all' and nothing mean all resorts", () => {
    expect(parseResort(RESORT.toUpperCase())).toEqual({
      resort: RESORT,
      problem: null,
    });
    expect(parseResort("all")).toEqual({ resort: null, problem: null });
    expect(parseResort(undefined)).toEqual({ resort: null, problem: null });
    expect(parseResort("'; drop table resorts; --").resort).toBeNull();
    expect(parseResort("not-an-id").problem).toMatch(/not found/);
  });
  it("CALM-09: /calendar/[date] : real dates from 1990 to 2100 only", () => {
    expect(parseDay("2026-03-10")).toBe("2026-03-10");
    expect(parseDay("2020-02-29")).toBe("2020-02-29");
    expect(parseDay("2035-12-31")).toBe("2035-12-31");
    for (const bad of [
      undefined,
      "",
      "2026-02-30",
      "2027-02-29",
      "2026-13-01",
      "1989-12-31",
      "2101-01-01",
      "10-03-2026",
      "today",
      "2026-03-10x",
    ])
      expect(parseDay(bad as string | undefined)).toBeNull();
  });
  it("CALM-10: the six tabs, in the order of the spec, with a safe default", () => {
    expect(TABS.map((t) => t.label)).toEqual([
      "Check-ins",
      "Check-outs",
      "Staying",
      "Payments Received",
      "Refunds",
      "Payments Due",
    ]);
    expect(parseTab(undefined)).toBe("check-ins");
    expect(parseTab("nonsense")).toBe("check-ins");
    expect(parseTab(["refunds", "due"])).toBe("refunds");
    expect(kindOf("payments")).toBe("payment");
    expect(kindOf("due")).toBe("due");
    expect(new Set(TABS.map((t) => t.kind)).size).toBe(6);
  });
});

describe("links and quiet days (CALM-11..)", () => {
  it("CALM-11: addresses keep the resort and the tab, and write only what differs from the default", () => {
    expect(monthHref({ year: 2026, month: 3 }, null)).toBe(
      "/calendar?month=2026-03",
    );
    expect(monthHref({ year: 2026, month: 3 }, RESORT)).toBe(
      `/calendar?month=2026-03&resort=${RESORT}`,
    );
    expect(dayHref("2026-03-10", null)).toBe("/calendar/2026-03-10");
    expect(dayHref("2026-03-10", null, "refunds")).toBe(
      "/calendar/2026-03-10?tab=refunds",
    );
    expect(dayHref("2026-03-10", RESORT, "due")).toBe(
      `/calendar/2026-03-10?tab=due&resort=${RESORT}`,
    );
    expect(addBookingHref("2026-03-10", null)).toBe(
      "/bookings/new?checkin=2026-03-10",
    );
    expect(addBookingHref("2026-03-10", RESORT)).toBe(
      `/bookings/new?checkin=2026-03-10&resort=${RESORT}`,
    );
  });
  it("CALM-11b: Add Booking on the month page starts today in this month and on the first day of any other month (past, future, other year)", () => {
    const today = "2026-11-12";
    expect(defaultBookingDay({ year: 2026, month: 11 }, today)).toBe(today);
    expect(defaultBookingDay({ year: 2026, month: 12 }, today)).toBe(
      "2026-12-01",
    );
    expect(defaultBookingDay({ year: 2026, month: 3 }, today)).toBe(
      "2026-03-01",
    );
    expect(defaultBookingDay({ year: 2025, month: 11 }, today)).toBe(
      "2025-11-01",
    ); // same month number, other year
    expect(defaultBookingDay({ year: 2035, month: 1 }, today)).toBe(
      "2035-01-01",
    );
    expect(defaultBookingDay({ year: 1990, month: 1 }, "1990-01-31")).toBe(
      "1990-01-31",
    );
  });
  it("CALM-12: a quiet day is all zeros; any figure makes it busy (also money alone)", () => {
    expect(isQuiet(quiet("2026-03-01"))).toBe(true);
    for (const k of [
      "checkIns",
      "checkOuts",
      "staying",
      "duePaise",
      "collectedPaise",
      "waitingPaise",
      "refundsPaise",
    ] as const)
      expect(isQuiet({ ...quiet("2026-03-01"), [k]: 1 })).toBe(false);
    expect(isQuiet({ ...quiet("2026-03-01"), duePaise: -500 })).toBe(false); // a negative adjustment is something
  });
  it("CALM-13: the phone list keeps only busy days, in order", () => {
    const days = [
      quiet("2026-03-01"),
      { ...quiet("2026-03-02"), staying: 1 },
      quiet("2026-03-03"),
      { ...quiet("2026-03-04"), collectedPaise: 100 },
    ];
    expect(agendaDays(days).map((d) => d.date)).toEqual([
      "2026-03-02",
      "2026-03-04",
    ]);
    expect(agendaDays([quiet("2026-03-01")])).toEqual([]);
  });
  it("CALM-14: what a screen reader hears for a day", () => {
    expect(dayLabel(quiet("2026-03-01"))).toBe(
      "Sunday, 1 March 2026: nothing on this day",
    );
    expect(
      dayLabel({
        ...quiet("2026-03-10"),
        checkIns: 2,
        checkOuts: 1,
        staying: 3,
      }),
    ).toBe("Tuesday, 10 March 2026: 2 check-ins, 1 check-out, 3 staying");
    expect(dayLabel({ ...quiet("2026-03-10"), checkIns: 1 })).toContain(
      "1 check-in",
    );
    expect(dayLabel({ ...quiet("2026-03-10"), duePaise: 5 })).toContain(
      "money only",
    );
  });
});
