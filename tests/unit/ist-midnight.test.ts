import { afterEach, describe, expect, it } from "vitest";
import {
  daysBetween,
  istDateTimeToInstant,
  nightsBetween,
  toIstDate,
  todayIst,
  yearOf,
} from "@/lib/dates";

// The business day changes at 18:30 UTC (00:00 IST). None of this may depend on the machine's own time zone.
const MACHINE_ZONES = [
  "UTC",
  "Asia/Kolkata",
  "America/Los_Angeles",
  "Pacific/Kiritimati",
  "Pacific/Pago_Pago",
];

const original = process.env.TZ;
afterEach(() => {
  if (original === undefined) delete process.env.TZ;
  else process.env.TZ = original;
});

describe.each(MACHINE_ZONES)(
  "IST midnight, machine zone %s (IST-U)",
  (zone) => {
    it("toIstDate flips exactly at 18:30:00 UTC", () => {
      process.env.TZ = zone;
      expect(toIstDate(new Date("2027-03-10T18:29:59.999Z"))).toBe(
        "2027-03-10",
      );
      expect(toIstDate(new Date("2027-03-10T18:30:00.000Z"))).toBe(
        "2027-03-11",
      );
      expect(toIstDate(new Date("2027-12-31T18:30:00Z"))).toBe("2028-01-01");
      expect(toIstDate(new Date("2028-02-28T18:30:00Z"))).toBe("2028-02-29");
    });

    it("todayIst follows IST around midnight", () => {
      process.env.TZ = zone;
      expect(todayIst(new Date("2027-03-10T18:29:00Z"))).toBe("2027-03-10");
      expect(todayIst(new Date("2027-03-10T18:31:00Z"))).toBe("2027-03-11");
    });

    it("nights: 23:59:59 IST -> 00:00:00 IST is one night; the same IST day is zero", () => {
      process.env.TZ = zone;
      const t = (s: string) => new Date(s);
      expect(
        nightsBetween(
          t("2027-03-10T23:59:59+05:30"),
          t("2027-03-11T00:00:00+05:30"),
        ),
      ).toBe(1);
      expect(
        nightsBetween(
          t("2027-03-10T00:00:00+05:30"),
          t("2027-03-10T23:59:59+05:30"),
        ),
      ).toBe(0);
      expect(
        nightsBetween(t("2027-03-10T18:29:59Z"), t("2027-03-10T18:30:00Z")),
      ).toBe(1);
    });

    it("an IST wall-clock time round-trips to the same IST date and year", () => {
      process.env.TZ = zone;
      for (const [date, time] of [
        ["2026-12-31", "23:59"],
        ["2027-01-01", "00:00"],
        ["2028-02-29", "00:30"],
      ] as const) {
        expect(toIstDate(istDateTimeToInstant(date, time))).toBe(date);
      }
      expect(
        yearOf(toIstDate(istDateTimeToInstant("2026-12-31", "23:59"))),
      ).toBe(2026);
      expect(
        yearOf(toIstDate(istDateTimeToInstant("2027-01-01", "00:00"))),
      ).toBe(2027);
    });

    it("calendar-day arithmetic is exact across month, year and leap-day ends", () => {
      process.env.TZ = zone;
      expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
      expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
      expect(daysBetween("2027-02-28", "2027-03-01")).toBe(1);
      // US daylight-saving change days must not make a day 23 or 25 hours long
      expect(daysBetween("2027-03-13", "2027-03-15")).toBe(2);
      expect(daysBetween("2027-11-06", "2027-11-08")).toBe(2);
    });
  },
);
