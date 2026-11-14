import { describe, expect, it } from "vitest";
import {
  daysBetween,
  formatDisplayDate,
  formatDisplayTime,
  isBackdated,
  isIsoDate,
  istDateTimeToInstant,
  nightsBetween,
  toIstDate,
  todayIst,
  yearOf,
} from "@/lib/dates";

describe("IST dates", () => {
  it("converts UTC instants to the IST calendar date", () => {
    // 18:29 UTC = 23:59 IST same day; 18:30 UTC = 00:00 IST next day
    expect(toIstDate(new Date("2026-11-11T18:29:59Z"))).toBe("2026-11-11");
    expect(toIstDate(new Date("2026-11-11T18:30:00Z"))).toBe("2026-11-12");
  });

  it("todayIst uses IST, not the machine time zone", () => {
    expect(todayIst(new Date("2026-12-31T19:00:00Z"))).toBe("2027-01-01");
  });

  it("validates ISO dates", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("26-1-1")).toBe(false);
  });

  it("daysBetween across month/year ends", () => {
    expect(daysBetween("2026-12-30", "2027-01-02")).toBe(3);
    expect(daysBetween("2026-11-12", "2026-11-12")).toBe(0);
    expect(daysBetween("2026-11-12", "2026-11-10")).toBe(-2);
  });

  it("yearOf gives the Booking ID year from the booking date (Q4)", () => {
    expect(yearOf("2026-12-30")).toBe(2026);
    expect(() => yearOf("2026-02-30")).toThrow();
  });

  it("builds instants from IST wall-clock time", () => {
    expect(istDateTimeToInstant("2026-11-12", "14:00").toISOString()).toBe(
      "2026-11-12T08:30:00.000Z",
    );
    expect(() => istDateTimeToInstant("2026-11-12", "24:00")).toThrow();
  });
});

describe("nightsBetween (D4)", () => {
  const at = (d: string, t: string) => istDateTimeToInstant(d, t);

  it("AMT-03: 12 Nov 14:00 → 14 Nov 11:00 = 2 nights", () => {
    expect(
      nightsBetween(at("2026-11-12", "14:00"), at("2026-11-14", "11:00")),
    ).toBe(2);
  });
  it("AMT-12: 23:30 → next day 00:30 = 1 night", () => {
    expect(
      nightsBetween(at("2026-11-12", "23:30"), at("2026-11-13", "00:30")),
    ).toBe(1);
  });
  it("same-day day outing = 0 nights", () => {
    expect(
      nightsBetween(at("2026-11-12", "09:00"), at("2026-11-12", "18:00")),
    ).toBe(0);
  });
  it("late check-out next afternoon is still 1 night", () => {
    expect(
      nightsBetween(at("2026-11-12", "12:00"), at("2026-11-13", "17:00")),
    ).toBe(1);
  });
});

describe("display formats (UI spec §6)", () => {
  it("formats dates unambiguously", () => {
    expect(formatDisplayDate("2026-11-12")).toBe("12 Nov 2026");
  });
  it("formats times in IST with AM/PM", () => {
    expect(formatDisplayTime(new Date("2026-11-12T10:35:00Z"))).toBe("4:05 PM");
    expect(formatDisplayTime(new Date("2026-11-11T18:30:00Z"))).toBe(
      "12:00 AM",
    );
  });
});

describe("test environment", () => {
  it("runs with a non-IST machine time zone (proves IST logic is explicit)", () => {
    expect(new Date("2026-06-01T00:00:00Z").getTimezoneOffset()).not.toBe(-330);
  });
});

describe("backdated payments and refunds (BD-01..)", () => {
  it("BD-01: the date written is earlier than the IST day it was typed in", () => {
    expect(isBackdated("2026-03-11", "2026-03-20T03:30:00Z")).toBe(true);
    expect(isBackdated("2026-03-20", "2026-03-20T03:30:00Z")).toBe(false); // same day
    expect(isBackdated("2026-03-21", "2026-03-20T03:30:00Z")).toBe(false); // future dates are not allowed, but are not "backdated"
  });
  it("BD-02: the IST day decides, not the UTC day: 18:30 UTC is already the next day in India", () => {
    // typed in at 00:00 IST on 21 March (= 18:30 UTC on 20 March)
    expect(isBackdated("2026-03-20", "2026-03-20T18:30:00Z")).toBe(true);
    // 23:59:59 IST on 20 March (= 18:29:59 UTC)
    expect(isBackdated("2026-03-20", "2026-03-20T18:29:59Z")).toBe(false);
    // 01:00 IST on 20 March is still 19 March in UTC
    expect(isBackdated("2026-03-20", "2026-03-19T19:30:00Z")).toBe(false);
  });
  it("BD-03: works with a Date, across year ends, and never throws on bad input", () => {
    expect(isBackdated("2025-12-31", new Date("2026-01-01T00:00:00Z"))).toBe(
      true,
    );
    expect(isBackdated("2026-01-01", new Date("2026-01-01T00:00:00Z"))).toBe(
      false,
    );
    expect(isBackdated("not a date", "2026-03-20T03:30:00Z")).toBe(false);
    expect(isBackdated("2026-03-20", "garbage")).toBe(false);
  });
});
