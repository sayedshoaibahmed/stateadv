/**
 * IST midnight (Asia/Kolkata, UTC+05:30, no daylight saving): the business day changes at 18:30 UTC, never at the
 * database session's or the machine's midnight. Decision D4: nights = IST calendar date of check-out minus IST
 * calendar date of check-in. Everything is fictional. (IST-01..IST-09)
 */
import { beforeAll, describe, expect, it } from "vitest";
import { expectDbError } from "./harness";
import { dateOffset, setupWorld, uid, type World } from "./fixtures";

let w: World;
beforeAll(async () => {
  w = await setupWorld();
}, 120_000);

const q = <T = Record<string, unknown>>(sql: string, p?: unknown[]) =>
  w.db.q<T>(sql, p);

const ZONES = [
  "UTC",
  "Asia/Kolkata",
  "America/Los_Angeles", // has daylight saving
  "Pacific/Kiritimati", // UTC+14: its calendar day is far ahead of India's
  "Pacific/Pago_Pago", // UTC-11: far behind
];

async function nights(
  method: string,
  checkIn: string,
  checkOut: string,
): Promise<number> {
  const r = await q<{ nights: number }>(
    `select nights from public.calc_booking_amounts($1::public.pricing_method, 2, 100000, 0, 0, 0, null, $2::timestamptz, $3::timestamptz)`,
    [method, checkIn, checkOut],
  );
  return r[0].nights;
}

describe("IST midnight", () => {
  it("IST-01: nights count IST calendar days across the midnight boundary", async () => {
    // 23:59:59 IST and 00:00:00 IST the next day are one second apart but are different business days
    expect(
      await nights(
        "per_person_per_stay",
        "2027-03-10T23:59:59+05:30",
        "2027-03-11T00:00:00+05:30",
      ),
    ).toBe(1);
    // the same IST day, however long: 0 nights
    expect(
      await nights(
        "per_person_per_stay",
        "2027-03-10T00:00:00+05:30",
        "2027-03-10T23:59:59+05:30",
      ),
    ).toBe(0);
    // exactly 24 hours apart but starting at 00:00 IST: 1 night; 47 hours later: still 1 night; 48 hours: 2
    expect(
      await nights(
        "per_person_per_stay",
        "2027-03-10T00:00:00+05:30",
        "2027-03-11T00:00:00+05:30",
      ),
    ).toBe(1);
    expect(
      await nights(
        "per_person_per_stay",
        "2027-03-10T00:00:00+05:30",
        "2027-03-11T23:00:00+05:30",
      ),
    ).toBe(1);
    expect(
      await nights(
        "per_person_per_stay",
        "2027-03-10T00:00:00+05:30",
        "2027-03-12T00:00:00+05:30",
      ),
    ).toBe(2);
  });

  it("IST-02: the same instants given in UTC or another offset give the same nights", async () => {
    // 2027-03-10 18:29:59Z is 23:59:59 IST on the 10th; 18:30:00Z is 00:00:00 IST on the 11th
    expect(
      await nights(
        "per_person_per_stay",
        "2027-03-10T18:29:59Z",
        "2027-03-10T18:30:00Z",
      ),
    ).toBe(1);
    expect(
      await nights(
        "per_person_per_stay",
        "2027-03-10T18:00:00Z",
        "2027-03-10T18:29:59Z",
      ),
    ).toBe(0);
    // 2027-03-10 20:00 in New York (UTC-4 in March after DST) is already the 11th in India
    expect(
      await nights(
        "per_person_per_stay",
        "2027-03-10T10:00:00-04:00",
        "2027-03-11T10:00:00-04:00",
      ),
    ).toBe(1);
  });

  it("IST-03: results never depend on the database session time zone", async () => {
    const results = new Set<string>();
    for (const zone of ZONES) {
      await q(`set time zone '${zone}'`);
      try {
        results.add(
          [
            await nights(
              "per_person_per_stay",
              "2027-03-10T23:59:59+05:30",
              "2027-03-11T00:00:00+05:30",
            ),
            await nights(
              "per_person_per_night",
              "2027-03-10T18:29:59Z",
              "2027-03-10T18:30:00Z",
            ),
            await nights(
              "per_person_per_stay",
              "2027-03-10T12:00:00Z",
              "2027-03-12T12:00:00Z",
            ),
            (
              await q<{ d: string; e: string }>(
                `select public.today_ist()::text d, (now() at time zone 'Asia/Kolkata')::date::text e`,
              )
            ).map((x) => (x.d === x.e ? "same" : "DIFFERENT"))[0],
          ].join(","),
        );
      } finally {
        await q(`reset time zone`);
      }
    }
    expect([...results]).toEqual(["1,1,2,same"]);
  });

  it("IST-04: a per-night stay needs at least one IST night; the minimum is exactly one", async () => {
    // 00:30 IST to 23:30 IST the same day is 23 hours but 0 nights: refused for per-night pricing
    await expectDbError(
      nights(
        "per_person_per_night",
        "2027-03-10T00:30:00+05:30",
        "2027-03-10T23:30:00+05:30",
      ),
      "INVALID_DATES",
    );
    // 23:30 IST to 00:30 IST next day is only one hour but one night
    expect(
      await nights(
        "per_person_per_night",
        "2027-03-10T23:30:00+05:30",
        "2027-03-11T00:30:00+05:30",
      ),
    ).toBe(1);
    // check-out must be after check-in, also at the very same second
    await expectDbError(
      nights(
        "per_person_per_stay",
        "2027-03-10T00:00:00+05:30",
        "2027-03-10T00:00:00+05:30",
      ),
      "INVALID_DATES",
    );
  });

  it("IST-05: the per-night price follows the IST nights across month, year and leap-day ends", async () => {
    const price = async (a: string, b: string) =>
      (
        await q<{ base_paise: string }>(
          `select base_paise::text from public.calc_booking_amounts('per_person_per_night', 2, 100000, 0, 0, 0, null, $1::timestamptz, $2::timestamptz)`,
          [a, b],
        )
      )[0].base_paise;
    // 31 Dec 23:00 IST -> 1 Jan 01:00 IST: one night
    expect(
      await price("2026-12-31T23:00:00+05:30", "2027-01-01T01:00:00+05:30"),
    ).toBe("200000");
    // 28 Feb -> 1 Mar 2028 is two nights (2028 is a leap year, 29 Feb exists)
    expect(
      await price("2028-02-28T14:00:00+05:30", "2028-03-01T11:00:00+05:30"),
    ).toBe("400000");
    // 28 Feb -> 1 Mar 2027 is one night (no leap day)
    expect(
      await price("2027-02-28T14:00:00+05:30", "2027-03-01T11:00:00+05:30"),
    ).toBe("200000");
  });

  it("IST-06: booking numbers take their year from the IST booking date and restart each year", async () => {
    const resort = w.resorts.A.id;
    const code = async (date: string) =>
      (
        await q<{ c: string }>(
          `select booking_code c from public.next_booking_code($1::uuid, $2::date)`,
          [resort, date],
        )
      )[0].c;
    const a = await code("2031-12-31");
    const b = await code("2032-01-01");
    const c = await code("2031-12-31");
    expect(a).toMatch(/^AAA-2031-\d{6}$/);
    expect(b).toBe("AAA-2032-000001");
    // the 2031 counter carries on from where it was, unaffected by the 2032 booking
    expect(Number(c.slice(-6))).toBe(Number(a.slice(-6)) + 1);
  });

  it("IST-07: a booking made through the real function stores the same nights whatever the session zone", async () => {
    for (const zone of ZONES) {
      await q(`set time zone '${zone}'`);
      try {
        const d = await dateOffset(w.db, 3);
        const d2 = await dateOffset(w.db, 4);
        const payload = {
          resort_id: w.resorts.A.id,
          guest_id: w.guestId,
          pax: 2,
          co_category_id: w.cat.direct,
          stay_type_id: w.stayTypeId,
          booking_date: await dateOffset(w.db, 0),
          check_in_at: `${d}T23:30:00+05:30`,
          check_out_at: `${d2}T00:30:00+05:30`,
          pricing_method: "per_person_per_night",
          tariff_paise: 100000,
        };
        const plan = [
          {
            label: "Balance",
            due_date: await dateOffset(w.db, 3),
            amount_paise: 200000,
          },
        ];
        const r = await w.db.as({ role: "authenticated", uid: w.manager }, () =>
          q<{ r: { id: string } }>(
            `select public.create_booking($1::jsonb, $2::jsonb, $3::uuid) as r`,
            [JSON.stringify(payload), JSON.stringify(plan), uid()],
          ),
        );
        const b = await q<{ nights: number; final_amount_paise: string }>(
          `select nights, final_amount_paise::text from public.bookings where id = $1`,
          [r[0].r.id],
        );
        expect(b[0], `session zone ${zone}`).toEqual({
          nights: 1,
          final_amount_paise: "200000",
        });
      } finally {
        await q(`reset time zone`);
      }
    }
  });

  it("IST-08: plan due dates are plain IST dates (a date is never shifted by the session zone)", async () => {
    const results = new Set<string>();
    for (const zone of ZONES) {
      await q(`set time zone '${zone}'`);
      try {
        const r = await q<{ d: string }>(
          `select ('2027-03-10'::date + 1)::text d`,
        );
        results.add(r[0].d);
      } finally {
        await q(`reset time zone`);
      }
    }
    expect([...results]).toEqual(["2027-03-11"]);
  });

  it("IST-09: India has no daylight saving: wall-clock offsets are +05:30 on every date", async () => {
    const r = await q<{ off: string }>(
      `select distinct to_char((ts at time zone 'Asia/Kolkata') - (ts at time zone 'UTC'), 'HH24:MI') off
       from generate_series('2026-01-01'::timestamptz, '2030-12-31'::timestamptz, interval '1 day') ts`,
    );
    expect(r).toEqual([{ off: "05:30" }]);
  });
});
