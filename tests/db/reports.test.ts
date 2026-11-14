/**
 * Report functions (migration 25; PRD 5.12 and 5.16, DATABASE_SCHEMA 3.4, TEST_PLAN COL-01..12). RPT-01..
 * A small fictional dataset in which EVERY figure is written down by hand in the comments below; each report must give
 * exactly those figures, the same figures as independent plain SQL over the raw tables, and the same figures as the
 * dashboard and the booking page (rule D1). Money in paise is written as R(rupees).
 *
 * Rules checked: Total Collection (Approved) = approved payments by PAYMENT date; Waiting apart and never added;
 * Refunds = approved refunds by REFUND date; rejected and reversed never counted; the approval date never matters;
 * past months never change (D2); all dates are IST; only active people may ask; nothing is changed by asking.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { expectDbError } from "./harness";
import { setupWorld, uid, type World } from "./fixtures";
import { makeBuilders, type RawBooking } from "./raw-data";

let w: World;
const R = (rupees: number) => rupees * 100;
type Row = Record<string, unknown>;
const q = <T = Row>(sql: string, p?: unknown[]) => w.db.q<T>(sql, p);
const as = <T>(id: string | null, fn: () => Promise<T>) =>
  w.db.as({ role: "authenticated", uid: id }, fn);
const asUser = <T = Row>(sql: string, p: unknown[] = [], who = w.manager) =>
  as(who, () => q<T>(sql, p));
let A: string, B: string;
let a0: RawBooking,
  a1: RawBooking,
  a2: RawBooking,
  a3: RawBooking,
  a4: RawBooking,
  a5: RawBooking;
let b1: RawBooking, b2: RawBooking, b3: RawBooking, b9: RawBooking;
let put: ReturnType<typeof makeBuilders>;

beforeAll(async () => {
  w = await setupWorld();
  A = w.resorts.A.id;
  B = w.resorts.B.id;
  put = makeBuilders(w, (sql, p) => q(sql, p));
  const { booking, money } = put;

  // ---- resort A ----------------------------------------------------------------------------------------------------
  // A0: booked 30 Dec 2025, Rs 1,700, plan Rs 1,700 due 31 Dec 2025. Payments over a year end and a Sunday/Monday:
  //     Rs 1,000 on 31 Dec 2025, Rs 700 on 1 Jan 2026, Rs 50 on Sunday 4 Jan, Rs 70 on Monday 5 Jan.
  a0 = await booking({
    resort: "A",
    bookingDate: "2025-12-30",
    checkIn: "2026-01-02T14:00",
    checkOut: "2026-01-03T11:00",
    pax: 1,
    tariff: R(1700),
    plan: [{ label: "Balance", due: "2025-12-31", amount: R(1700) }],
  });
  await money(a0, "payments", "approved", R(1000), "2025-12-31");
  await money(a0, "payments", "approved", R(700), "2026-01-01");
  await money(a0, "payments", "approved", R(50), "2026-01-04");
  await money(a0, "payments", "approved", R(70), "2026-01-05");
  // A1: booked 2 Mar, in 10 Mar 14:00, out 12 Mar, Rs 5,000 (2 x Rs 2,500). Plan: Rs 2,000 due 2 Mar, Rs 3,000 due 10 Mar.
  //     Approved Rs 2,000 cash 2 Mar and Rs 1,500 PhonePe 9 Mar; waiting Rs 1,000 PhonePe 10 Mar; rejected Rs 300 and
  //     reversed Rs 200 on 9 Mar (never counted). Refund approved Rs 500 on 11 Mar; refund waiting Rs 300 on 12 Mar.
  //     Pending = 5,000 - (3,500 + 1,000 - 500) = 1,000; Verified Remaining = 5,000 - (3,500 - 500) = 2,000.
  //     Overdue on 31 Mar = (2,000 + 3,000) - (3,500 - 500) = 2,000.
  a1 = await booking({
    resort: "A",
    bookingDate: "2026-03-02",
    checkIn: "2026-03-10T14:00",
    checkOut: "2026-03-12T11:00",
    name: "Asha Rao",
    plan: [
      { label: "Advance", due: "2026-03-02", amount: R(2000) },
      { label: "Balance", due: "2026-03-10", amount: R(3000) },
    ],
  });
  await money(a1, "payments", "approved", R(2000), "2026-03-02");
  await money(a1, "payments", "approved", R(1500), "2026-03-09", {
    method: "upi",
    provider: "PhonePe",
  });
  await money(a1, "payments", "waiting", R(1000), "2026-03-10", {
    method: "upi",
    provider: "PhonePe",
  });
  await money(a1, "payments", "rejected", R(300), "2026-03-09");
  await money(a1, "payments", "reversed", R(200), "2026-03-09");
  await money(a1, "refunds", "approved", R(500), "2026-03-11", {
    recordedAt: "2026-04-12 10:00:00+05:30",
  }); // dated 11 Mar, typed in on 12 APRIL: it is still a MARCH refund
  await money(a1, "refunds", "waiting", R(300), "2026-03-12");
  // A2: booked 27 Feb, in 1 Mar, Rs 4,000 (1 x Rs 4,000), plan Rs 4,000 due 1 Mar, paid Rs 4,000 approved on 28 FEB.
  a2 = await booking({
    resort: "A",
    bookingDate: "2026-02-27",
    checkIn: "2026-03-01T14:00",
    checkOut: "2026-03-03T11:00",
    pax: 1,
    tariff: R(4000),
    plan: [{ label: "Balance", due: "2026-03-01", amount: R(4000) }],
  });
  await money(a2, "payments", "approved", R(4000), "2026-02-28");
  // A3: CANCELLED on 15 Mar with charge Rs 1,000. Rs 6,000 (2 x Rs 3,000). The Advance Rs 2,000 due 5 Mar stays (past rows
  //     never change, D2); the Balance row is gone; an adjustment of -Rs 1,000 is dated 15 Mar. Sum = 1,000 = the charge.
  //     Paid Rs 2,000 (UPI Paytm, 5 Mar); refund approved Rs 1,000 on 2 APRIL.
  a3 = await booking({
    resort: "A",
    bookingDate: "2026-03-05",
    checkIn: "2026-03-20T14:00",
    checkOut: "2026-03-21T11:00",
    pax: 2,
    tariff: R(3000),
    plan: [{ label: "Advance", due: "2026-03-05", amount: R(2000) }],
    adjustments: [
      {
        date: "2026-03-15",
        amount: -R(1000),
        reason: "Booking cancelled: guest unwell",
        source: "cancellation",
      },
    ],
    cancel: { status: "cancelled", date: "2026-03-15", charge: R(1000) },
  });
  await money(a3, "payments", "approved", R(2000), "2026-03-05", {
    method: "upi",
    provider: "Paytm",
  });
  await money(a3, "refunds", "approved", R(1000), "2026-04-02");
  // A4: NO-SHOW on 13 Mar, Rs 4,000 (2 x Rs 2,000), charge Rs 4,000, plan Rs 4,000 due 12 Mar, paid Rs 4,500 on 12 Mar
  //     -> Refund due = 4,500 - 4,000 = 500.
  a4 = await booking({
    resort: "A",
    bookingDate: "2026-03-08",
    checkIn: "2026-03-12T14:00",
    checkOut: "2026-03-13T11:00",
    pax: 2,
    tariff: R(2000),
    plan: [{ label: "Balance", due: "2026-03-12", amount: R(4000) }],
    cancel: {
      status: "no_show",
      date: "2026-03-13",
      charge: R(4000),
      reason: "Did not arrive",
    },
  });
  await money(a4, "payments", "approved", R(4500), "2026-03-12");
  // A5: booked 20 Mar, in 5 Apr, 2 x Rs 2,500 = 5,000 - discount 300 - manual adjustment 200 ("Regular guest") = 4,500,
  //     plan Rs 4,500 due 5 Apr, nothing paid.
  a5 = await booking({
    resort: "A",
    bookingDate: "2026-03-20",
    checkIn: "2026-04-05T14:00",
    checkOut: "2026-04-06T11:00",
    discount: R(300),
    adjustment: -R(200),
    adjustmentReason: "Regular guest",
    plan: [{ label: "Balance", due: "2026-04-05", amount: R(4500) }],
  });

  // ---- resort B ----------------------------------------------------------------------------------------------------
  // B1: IST edge: in 31 Mar 23:30, out 2 Apr 00:30. Rs 4,000 (4 x Rs 1,000), plan Rs 4,000 due 31 Mar. Paid Rs 4,000 UPI
  //     Paytm on 31 Mar; Rs 500 cash DATED 1 APRIL but typed in at 23:50 on 31 March (counts in APRIL, COL-08);
  //     waiting Rs 200 cash dated 1 April typed in at 23:50 on 31 March.
  b1 = await booking({
    resort: "B",
    bookingDate: "2026-03-03",
    checkIn: "2026-03-31T23:30",
    checkOut: "2026-04-02T00:30",
    pax: 4,
    tariff: R(1000),
    plan: [{ label: "Balance", due: "2026-03-31", amount: R(4000) }],
  });
  await money(b1, "payments", "approved", R(4000), "2026-03-31", {
    method: "upi",
    provider: "Paytm",
    recordedAt: "2026-03-31 23:45:00+05:30",
  });
  await money(b1, "payments", "approved", R(500), "2026-04-01", {
    recordedAt: "2026-03-31 23:50:00+05:30",
  });
  await money(b1, "payments", "waiting", R(200), "2026-04-01", {
    recordedAt: "2026-03-31 23:50:00+05:30",
  });
  // B2: Rs 3,000 (2 x Rs 1,500). Plan: Rs 1,500 due 15 Mar (never paid, moved), Rs 1,500 due 28 Mar. On 20 Mar the unpaid
  //     15 Mar amount was moved to 10 Apr: adjustment -Rs 1,500 on 20 Mar (move_overdue) and a new row Rs 1,500 due 10 Apr.
  //     Only a WAITING card payment of Rs 3,000 (Visa) on 15 Mar, typed in on 16 Mar.
  //     Pending = 3,000 - (0 + 3,000) = 0; Verified Remaining = 3,000; Overdue on 31 Mar = (1,500 + 1,500 - 1,500) - 0 = 1,500.
  b2 = await booking({
    resort: "B",
    bookingDate: "2026-03-10",
    checkIn: "2026-03-15T14:00",
    checkOut: "2026-03-16T11:00",
    pax: 2,
    tariff: R(1500),
    plan: [
      { label: "Advance", due: "2026-03-15", amount: R(1500) },
      { label: "Balance", due: "2026-03-28", amount: R(1500) },
      { label: "Advance (moved)", due: "2026-04-10", amount: R(1500) },
    ],
    adjustments: [
      {
        date: "2026-03-20",
        amount: -R(1500),
        reason: "Guest will pay at check-in",
        source: "move_overdue",
      },
    ],
  });
  await money(b2, "payments", "waiting", R(3000), "2026-03-15", {
    method: "card",
    provider: "Visa",
    recordedAt: "2026-03-16 10:00:00+05:30",
  });
  // B3: CANCELLED on 20 Mar, charge Rs 2,000 (changed by hand: "Part of the charge was waived"). Rs 5,000 (2 x Rs 2,500).
  //     Plan Rs 1,000 due 12 Mar + cancellation row Rs 1,000 due 20 Mar. Paid Rs 1,000 cash on 12 Mar.
  //     Refunds that never count: rejected Rs 200 (20 Mar), reversed Rs 100 (21 Mar).
  b3 = await booking({
    resort: "B",
    bookingDate: "2026-03-12",
    checkIn: "2026-03-25T14:00",
    checkOut: "2026-03-26T11:00",
    plan: [
      { label: "Advance", due: "2026-03-12", amount: R(1000) },
      { label: "Cancellation charge", due: "2026-03-20", amount: R(1000) },
    ],
    cancel: {
      status: "cancelled",
      date: "2026-03-20",
      charge: R(2000),
      chargeChangeReason: "Part of the charge was waived",
    },
  });
  await money(b3, "payments", "approved", R(1000), "2026-03-12");
  await money(b3, "refunds", "rejected", R(200), "2026-03-20");
  await money(b3, "refunds", "reversed", R(100), "2026-03-21");
  // B9: a leap day: booked 29 Feb 2028, Rs 250, paid Rs 250 on 29 Feb 2028.
  b9 = await booking({
    resort: "B",
    bookingDate: "2028-02-29",
    checkIn: "2028-03-05T14:00",
    checkOut: "2028-03-06T11:00",
    pax: 1,
    tariff: R(250),
    plan: [{ label: "Balance", due: "2028-02-29", amount: R(250) }],
  });
  await money(b9, "payments", "approved", R(250), "2028-02-29");
  // B9 also has a WAITING payment of Rs 100 dated 2 May 2026 and typed in at 02:00 on 3 May (IST) = 20:30 on 2 May in UTC: the IST day is the 3rd
  await money(b9, "payments", "waiting", R(100), "2026-05-02", {
    recordedAt: "2026-05-03 02:00:00+05:30",
  });
}, 180_000);

const rows = async (sql: string, p: unknown[] = [], who = w?.manager) =>
  asUser<Row>(sql, p, who);

// ---------------------------------------------------------------------------------------------------------------------
describe("the hand-built data is consistent (RPT-01)", () => {
  it("RPT-01 (COL-11f): for every test booking the plan rows plus the adjustments add up to the amount due", async () => {
    const bad = await q<Row>(
      `select b.booking_code, coalesce(sum(e.amount_paise), 0)::text s, f.due_paise::text d
         from public.bookings b join public.booking_financials f on f.booking_id = b.id
         left join public.expected_entries e on e.booking_id = b.id
        where b.booking_code like 'RPT%' group by b.booking_code, f.due_paise
       having coalesce(sum(e.amount_paise), 0) <> f.due_paise`,
    );
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("Collection: daily, weekly, monthly, yearly (RPT-02..)", () => {
  const col = (
    from: string,
    to: string,
    group: string,
    split = "none",
    resort: string | null = null,
  ) =>
    rows(
      `select period_start::text ps, period_end::text pe, resort_id, resort_name, method, approved_paise::text ap, approved_count ac, waiting_paise::text wa, waiting_count wc,
              refunds_paise::text rf, refunds_count rc, net_paise::text net, total_approved_paise::text tap, total_waiting_paise::text twa,
              total_refunds_paise::text trf, total_net_paise::text tnet, total_rows::text n
         from public.report_collection($1::date, $2::date, $3, $4, $5)`,
      [from, to, resort, group, split],
    );
  const line = (r: Row) => [r.ps, r.pe, r.ap, r.wa, r.rf, r.net].join("|");

  it("RPT-02 (COL-02, COL-03, COL-09): days of March, hand-counted: approved only is collection, waiting apart, rejected and reversed never, refunds on the refund date", async () => {
    const r = await col("2026-03-01", "2026-03-31", "day");
    expect(r.map(line)).toEqual([
      `2026-03-02|2026-03-02|${R(2000)}|0|0|${R(2000)}`, // A1 advance
      `2026-03-05|2026-03-05|${R(2000)}|0|0|${R(2000)}`, // A3 advance (UPI)
      `2026-03-09|2026-03-09|${R(1500)}|0|0|${R(1500)}`, // A1 PhonePe; the rejected 300 and reversed 200 are NOT here
      `2026-03-10|2026-03-10|0|${R(1000)}|0|0`, //          A1 waiting only
      `2026-03-11|2026-03-11|0|0|${R(500)}|${-R(500)}`, //  A1 refund approved: net is negative
      `2026-03-12|2026-03-12|${R(5500)}|0|0|${R(5500)}`, // A4 4,500 + B3 1,000
      `2026-03-15|2026-03-15|0|${R(3000)}|0|0`, //          B2 waiting card
      `2026-03-31|2026-03-31|${R(4000)}|0|0|${R(4000)}`, // B1 (the Rs 500 dated 1 April is NOT here)
    ]);
    expect(r[0]).toMatchObject({
      tap: String(R(15000)),
      twa: String(R(4000)),
      trf: String(R(500)),
      tnet: String(R(14500)),
      n: "8",
    });
  });

  it("RPT-03: the counts: how many approved payments, waiting payments and refunds make each figure", async () => {
    const r = await col("2026-03-01", "2026-03-31", "day");
    const d = (day: string) => r.find((x) => x.ps === day)!;
    expect(d("2026-03-12")).toMatchObject({ ac: 2, wc: 0, rc: 0 });
    expect(d("2026-03-09")).toMatchObject({ ac: 1, wc: 0 }); // rejected and reversed are not counted either
    expect(d("2026-03-10")).toMatchObject({ ac: 0, wc: 1 });
    expect(d("2026-03-11")).toMatchObject({ rc: 1 });
  });

  it("RPT-04: weeks run Monday to Sunday and are cut to the chosen dates", async () => {
    const r = await col("2026-03-01", "2026-03-31", "week");
    expect(r.map(line)).toEqual([
      `2026-03-02|2026-03-08|${R(4000)}|0|0|${R(4000)}`, //                        2 Mar + 5 Mar
      `2026-03-09|2026-03-15|${R(7000)}|${R(4000)}|${R(500)}|${R(6500)}`, //       9 to 15 Mar (15 Mar is a Sunday)
      `2026-03-30|2026-03-31|${R(4000)}|0|0|${R(4000)}`, //                        30 Mar to 5 Apr, cut at 31 Mar
    ]);
    const cut = await col("2026-02-25", "2026-03-31", "week");
    expect(cut[0]).toMatchObject({
      ps: "2026-02-25",
      pe: "2026-03-01",
      ap: String(R(4000)),
    }); // 23 Feb week cut at the start; 28 Feb (Saturday)
  });

  it("RPT-05: a week that spans the new year, Sunday 4 January in the old week and Monday 5 January in the new one", async () => {
    const r = await col("2025-12-29", "2026-01-11", "week");
    expect(r.map(line)).toEqual([
      `2025-12-29|2026-01-04|${R(1750)}|0|0|${R(1750)}`, // 31 Dec 1,000 + 1 Jan 700 + Sunday 4 Jan 50
      `2026-01-05|2026-01-11|${R(70)}|0|0|${R(70)}`, //     Monday 5 Jan 70
    ]);
  });

  it("RPT-06: months, with an April whose refunds are more than its payments (a negative net)", async () => {
    const r = await col("2026-02-01", "2026-04-30", "month");
    expect(r.map(line)).toEqual([
      `2026-02-01|2026-02-28|${R(4000)}|0|0|${R(4000)}`,
      `2026-03-01|2026-03-31|${R(15000)}|${R(4000)}|${R(500)}|${R(14500)}`,
      `2026-04-01|2026-04-30|${R(500)}|${R(200)}|${R(1000)}|${-R(500)}`, // Rs 500 dated 1 Apr although typed in on 31 Mar
    ]);
    expect(r[0]).toMatchObject({
      tap: String(R(19500)),
      twa: String(R(4200)),
      trf: String(R(1500)),
      tnet: String(R(18000)),
    });
  });

  it("RPT-07: years, across a year end (2025 and 2026)", async () => {
    const r = await col("2025-01-01", "2026-12-31", "year");
    expect(r.map(line)).toEqual([
      `2025-01-01|2025-12-31|${R(1000)}|0|0|${R(1000)}`,
      `2026-01-01|2026-12-31|${R(20320)}|${R(4300)}|${R(1500)}|${R(18820)}`, // 820 (Jan: 700 + 50 + 70) + 4,000 (Feb) + 15,000 (Mar) + 500 (Apr)
    ]);
  });

  it("RPT-08: a leap day: 29 February 2028 is a day, and February 2028 ends on the 29th", async () => {
    expect((await col("2028-02-28", "2028-03-01", "day")).map(line)).toEqual([
      `2028-02-29|2028-02-29|${R(250)}|0|0|${R(250)}`,
    ]);
    expect((await col("2028-02-01", "2028-03-31", "month")).map(line)).toEqual([
      `2028-02-01|2028-02-29|${R(250)}|0|0|${R(250)}`,
    ]);
    expect((await col("2028-01-01", "2028-12-31", "year")).map(line)).toEqual([
      `2028-01-01|2028-12-31|${R(250)}|0|0|${R(250)}`,
    ]);
  });

  it("RPT-09 (COL-07): split by resort: the resorts add up to all resorts, and the figures are the hand-counted ones", async () => {
    const r = await col("2026-03-01", "2026-03-31", "month", "resort");
    const byResort = new Map(r.map((x) => [x.resort_id, x]));
    expect(byResort.get(A)).toMatchObject({
      ap: String(R(10000)),
      wa: String(R(1000)),
      rf: String(R(500)),
      net: String(R(9500)),
    });
    expect(byResort.get(B)).toMatchObject({
      ap: String(R(5000)),
      wa: String(R(3000)),
      rf: "0",
      net: String(R(5000)),
    });
    expect(r).toHaveLength(2);
    const all = (await col("2026-03-01", "2026-03-31", "month"))[0];
    expect(
      BigInt(byResort.get(A)!.ap as string) +
        BigInt(byResort.get(B)!.ap as string),
    ).toBe(BigInt(all.ap as string));
    expect(r[0].resort_name).toBe("Test Resort Alpha");
  });

  it("RPT-10: split by method: cash, UPI, card", async () => {
    const r = await col("2026-03-01", "2026-03-31", "month", "method");
    const m = new Map(r.map((x) => [x.method, x]));
    expect(m.get("cash")).toMatchObject({
      ap: String(R(7500)),
      ac: 3,
      rf: String(R(500)),
    });
    expect(m.get("upi")).toMatchObject({
      ap: String(R(7500)),
      wa: String(R(1000)),
    });
    expect(m.get("card")).toMatchObject({ ap: "0", wa: String(R(3000)) });
    expect(r.map((x) => x.method)).toEqual(["cash", "upi", "card"]);
  });

  it("RPT-11: the resort filter: only that resort's figures", async () => {
    const a = await col("2026-03-01", "2026-03-31", "month", "none", A);
    expect(a[0]).toMatchObject({
      ap: String(R(10000)),
      wa: String(R(1000)),
      rf: String(R(500)),
    });
    const b = await col("2026-03-01", "2026-03-31", "month", "none", B);
    expect(b[0]).toMatchObject({
      ap: String(R(5000)),
      wa: String(R(3000)),
      rf: "0",
    });
  });

  it("RPT-12: the weeks, months and days all add up to the same total as the whole period (independent SQL)", async () => {
    const [o] = await q<Row>(
      `select (select coalesce(sum(amount_paise),0) from public.payments where status='approved' and payment_date between '2025-01-01' and '2026-12-31')::text ap,
              (select coalesce(sum(amount_paise),0) from public.payments where status='waiting' and payment_date between '2025-01-01' and '2026-12-31')::text wa,
              (select coalesce(sum(amount_paise),0) from public.refunds where status='approved' and refund_date between '2025-01-01' and '2026-12-31')::text rf`,
    );
    for (const g of ["day", "week", "month", "year"]) {
      const r = await col("2025-01-01", "2026-12-31", g);
      const sum = (k: string) =>
        r.reduce((s, x) => s + BigInt(x[k] as string), BigInt(0));
      expect(String(sum("ap")), g).toBe(o.ap);
      expect(String(sum("wa")), g).toBe(o.wa);
      expect(String(sum("rf")), g).toBe(o.rf);
      expect(r[0].tap, g).toBe(o.ap);
    }
  });

  it("RPT-13: nothing in the period is an empty report, not an error", async () => {
    expect(await col("2031-01-01", "2031-12-31", "month")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("Resort-wise Collection: expected against actual (RPT-14..)", () => {
  const ev = (from: string, to: string, resort: string | null = null) =>
    rows(
      `select resort_id, resort_name, originally_expected_paise::text op, expected_adjustments_paise::text adj, expected_paise::text ex,
              approved_paise::text ap, waiting_paise::text wa, refunds_paise::text rf, net_paise::text net, difference_paise::text diff,
              total_originally_expected_paise::text top, total_expected_adjustments_paise::text tadj, total_expected_paise::text tex,
              total_approved_paise::text tap, total_waiting_paise::text twa, total_refunds_paise::text trf, total_net_paise::text tnet,
              total_difference_paise::text tdiff, total_rows::text n
         from public.report_expected_vs_actual($1::date, $2::date, $3)`,
      [from, to, resort],
    );

  it("RPT-14 (COL-01, COL-11): March by resort, hand-calculated: Originally Expected + Adjustments = Expected; Difference = Expected - Total Collection (Approved)", async () => {
    const r = await ev("2026-03-01", "2026-03-31");
    const m = new Map(r.map((x) => [x.resort_id, x]));
    // A: plans 5,000 (A1) + 4,000 (A2) + 2,000 (A3) + 4,000 (A4) = 15,000; adjustment -1,000; expected 14,000; approved 10,000; waiting 1,000; refunds 500
    expect(m.get(A)).toMatchObject({
      op: String(R(15000)),
      adj: String(-R(1000)),
      ex: String(R(14000)),
      ap: String(R(10000)),
      wa: String(R(1000)),
      rf: String(R(500)),
      net: String(R(9500)),
      diff: String(R(4000)),
    });
    // B: plans 4,000 (B1) + 1,500 + 1,500 (B2) + 1,000 + 1,000 (B3) = 9,000; adjustment -1,500; expected 7,500; approved 5,000; waiting 3,000
    expect(m.get(B)).toMatchObject({
      op: String(R(9000)),
      adj: String(-R(1500)),
      ex: String(R(7500)),
      ap: String(R(5000)),
      wa: String(R(3000)),
      rf: "0",
      net: String(R(5000)),
      diff: String(R(2500)),
    });
    expect(r[0]).toMatchObject({
      top: String(R(24000)),
      tadj: String(-R(2500)),
      tex: String(R(21500)),
      tap: String(R(15000)),
      twa: String(R(4000)),
      trf: String(R(500)),
      tnet: String(R(14500)),
      tdiff: String(R(6500)),
    });
  });

  it("RPT-15: every resort is listed, also the ones with nothing, with zeros; the total number of rows is the number of resorts", async () => {
    const r = await ev("2031-01-01", "2031-01-31");
    const [{ n }] = await q<{ n: string }>(
      `select count(*)::text n from public.resorts`,
    );
    expect(r).toHaveLength(Number(n));
    expect(r.every((x) => x.ex === "0" && x.ap === "0" && x.diff === "0")).toBe(
      true,
    );
    expect(r[0].n).toBe(n);
    expect(
      (await ev("2026-03-01", "2026-03-31", A)).map((x) => x.resort_id),
    ).toEqual([A]);
  });

  it("RPT-16 (COL-12): the totals equal the dashboard's cards for the same dates, and each resort equals the dashboard's resort table", async () => {
    const [d] = await rows(
      `select expected_paise::text e, total_collection_paise::text c, waiting_paise::text w, refunds_paise::text r, net_collection_paise::text n from public.dashboard_summary(null, '2026-03-01', '2026-03-31')`,
    );
    const r = await ev("2026-03-01", "2026-03-31");
    expect(d).toEqual({
      e: r[0].tex,
      c: r[0].tap,
      w: r[0].twa,
      r: r[0].trf,
      n: r[0].tnet,
    });
    const dash = await rows(
      `select resort_id, expected_paise::text e, total_collection_paise::text c, waiting_paise::text w, refunds_paise::text r from public.dashboard_by_resort(null, '2026-03-01', '2026-03-31')`,
    );
    const byId = new Map(r.map((x) => [x.resort_id, x]));
    for (const x of dash)
      expect({
        e: byId.get(x.resort_id)!.ex,
        c: byId.get(x.resort_id)!.ap,
        w: byId.get(x.resort_id)!.wa,
        r: byId.get(x.resort_id)!.rf,
      }).toEqual({ e: x.e, c: x.c, w: x.w, r: x.r });
  });

  it("RPT-18: April by hand: B2's moved Rs 1,500 and A5's Rs 4,500 are expected; Rs 500 collected; Rs 1,000 refunded: net minus Rs 500", async () => {
    const r = await ev("2026-04-01", "2026-04-30");
    const m = new Map(r.map((x) => [x.resort_id, x]));
    expect(m.get(A)).toMatchObject({
      ap: "0",
      rf: String(R(1000)),
      net: String(-R(1000)),
    });
    expect(m.get(B)).toMatchObject({
      op: String(R(1500)),
      ap: String(R(500)),
      wa: String(R(200)),
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("Payment Method Report (RPT-19..)", () => {
  const pm = (from: string, to: string, resort: string | null = null) =>
    rows(
      `select method, provider_name, approved_paise::text ap, approved_count ac, waiting_paise::text wa, waiting_count wc, refunds_paise::text rf, refunds_count rc,
              net_paise::text net, total_approved_paise::text tap, total_waiting_paise::text twa, total_refunds_paise::text trf, total_net_paise::text tnet, total_rows::text n
         from public.report_payment_methods($1::date, $2::date, $3)`,
      [from, to, resort],
    );
  it("RPT-19: March by method and app, hand-counted", async () => {
    const r = await pm("2026-03-01", "2026-03-31");
    expect(
      r.map((x) =>
        [
          x.method,
          x.provider_name,
          x.ap,
          x.ac,
          x.wa,
          x.wc,
          x.rf,
          x.rc,
          x.net,
        ].join("|"),
      ),
    ).toEqual([
      `cash||${R(7500)}|3|0|0|${R(500)}|1|${R(7000)}`, //     A1 2,000 + A4 4,500 + B3 1,000; refund 500
      `upi|Paytm|${R(6000)}|2|0|0|0|0|${R(6000)}`, //          A3 2,000 + B1 4,000
      `upi|PhonePe|${R(1500)}|1|${R(1000)}|1|0|0|${R(1500)}`, //  A1 1,500; waiting 1,000
      `card|Visa|0|0|${R(3000)}|1|0|0|0`, //                   B2 waiting 3,000
    ]);
    expect(r[0]).toMatchObject({
      tap: String(R(15000)),
      twa: String(R(4000)),
      trf: String(R(500)),
      tnet: String(R(14500)),
      n: "4",
    });
  });
  it("RPT-20 (COL-12): the totals equal the collection report's totals for the same dates; the resort filter splits them", async () => {
    const [c] = await rows(
      `select total_approved_paise::text a, total_waiting_paise::text w, total_refunds_paise::text r from public.report_collection('2026-03-01', '2026-03-31', null, 'month', 'none')`,
    );
    const r = await pm("2026-03-01", "2026-03-31");
    expect({ a: r[0].tap, w: r[0].twa, r: r[0].trf }).toEqual(c);
    const a = await pm("2026-03-01", "2026-03-31", A);
    const b = await pm("2026-03-01", "2026-03-31", B);
    expect(BigInt(a[0].tap as string) + BigInt(b[0].tap as string)).toBe(
      BigInt(r[0].tap as string),
    );
  });
  it("RPT-21: an empty period has no rows", async () => {
    expect(await pm("2031-01-01", "2031-01-31")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("Booking Report (RPT-22..)", () => {
  type B = {
    code: string;
    status: string;
    final: string;
    due: string;
    pax: number;
    tp: string;
    tf: string;
    td: string;
    n: string;
    co: string;
    pm: string;
  };
  const bk = (
    field: string,
    from: string | null,
    to: string | null,
    o: {
      resort?: string | null;
      status?: string | null;
      limit?: number;
      offset?: number;
    } = {},
  ) =>
    asUser<B>(
      `select booking_code code, status::text status, final_paise::text final, due_paise::text due, pax, total_pax::text tp, total_final_paise::text tf, total_due_paise::text td,
              total_rows::text n, co_category_name co, pricing_method pm
         from public.report_bookings($1, $2::date, $3::date, $4, $5::public.booking_status, $6, $7)`,
      [
        field,
        from,
        to,
        o.resort ?? null,
        o.status ?? null,
        o.limit ?? 100,
        o.offset ?? 0,
      ],
    );
  it("RPT-22: by booking date, March: seven bookings, newest first; count, PAX, Final Amount and Amount Due hand-added", async () => {
    const r = await bk("booking", "2026-03-01", "2026-03-31");
    expect(r.map((x) => x.code)).toEqual(
      [a5, b3, b2, a4, a3, b1, a1].map((x) => x.code),
    );
    expect(r[0]).toMatchObject({
      n: "7",
      tp: "16",
      tf: String(R(31500)),
      td: String(R(23500)),
      co: "Direct",
      pm: "per_person_per_stay",
    });
    const due = new Map(r.map((x) => [x.code, x]));
    expect(due.get(a3.code)).toMatchObject({
      final: String(R(6000)),
      due: String(R(1000)),
    }); // cancelled: Amount Due = the charge
    expect(due.get(b3.code)).toMatchObject({
      final: String(R(5000)),
      due: String(R(2000)),
    });
    expect(due.get(a4.code)).toMatchObject({
      final: String(R(4000)),
      due: String(R(4000)),
    });
  });
  it("RPT-23: by check-in date, March: A2 (booked in February) is in, A5 (checks in in April) is out; IST: B1 checks in at 23:30 on the 31st", async () => {
    const r = await bk("check_in", "2026-03-01", "2026-03-31");
    expect(r.map((x) => x.code).sort()).toEqual(
      [a1, a2, a3, a4, b1, b2, b3].map((x) => x.code).sort(),
    );
    expect(r[0]).toMatchObject({ n: "7", tp: "15", tf: String(R(31000)) });
    expect(
      (await bk("check_in", "2026-03-31", "2026-03-31")).map((x) => x.code),
    ).toEqual([b1.code]);
    expect(await bk("check_in", "2026-04-01", "2026-04-01")).toEqual([]);
    expect(
      (await bk("check_in", "2026-04-01", "2026-04-30")).map((x) => x.code),
    ).toEqual([a5.code]);
  });
  it("RPT-24: the status and resort filters, and the totals follow the filter", async () => {
    expect(
      (await bk("booking", "2026-03-01", "2026-03-31", { status: "cancelled" }))
        .map((x) => x.code)
        .sort(),
    ).toEqual([a3.code, b3.code].sort());
    const ns = await bk("booking", "2026-03-01", "2026-03-31", {
      status: "no_show",
    });
    expect(ns.map((x) => x.code)).toEqual([a4.code]);
    expect(ns[0]).toMatchObject({
      tf: String(R(4000)),
      td: String(R(4000)),
      n: "1",
    });
    const ra = await bk("booking", "2026-03-01", "2026-03-31", { resort: A });
    expect(ra).toHaveLength(4);
    expect(ra[0]).toMatchObject({ tf: String(R(19500)) });
  });
  it("RPT-25: paging: the pages follow each other and the totals are those of ALL rows, not of the page", async () => {
    const all = await bk("booking", "2026-03-01", "2026-03-31");
    const p1 = await bk("booking", "2026-03-01", "2026-03-31", {
      limit: 3,
      offset: 0,
    });
    const p2 = await bk("booking", "2026-03-01", "2026-03-31", {
      limit: 3,
      offset: 3,
    });
    const p3 = await bk("booking", "2026-03-01", "2026-03-31", {
      limit: 3,
      offset: 6,
    });
    expect([...p1, ...p2, ...p3].map((x) => x.code)).toEqual(
      all.map((x) => x.code),
    );
    for (const p of [p1, p2, p3])
      expect(p[0]).toMatchObject({
        n: "7",
        tf: String(R(31500)),
        td: String(R(23500)),
        tp: "16",
      });
    expect(
      await bk("booking", "2026-03-01", "2026-03-31", { offset: 50 }),
    ).toEqual([]);
  });
  it("RPT-26: no dates at all means every booking; a status that does not exist is refused", async () => {
    const [{ n }] = await q<{ n: string }>(
      `select count(*)::text n from public.bookings`,
    );
    expect((await bk("booking", null, null, { limit: 1 }))[0].n).toBe(n);
    await expectDbError(bk("stay", null, null), "INVALID_INPUT");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("Pending Amount Report (RPT-27..)", () => {
  type P = {
    code: string;
    due: string;
    ap: string;
    wa: string;
    pen: string;
    ver: string;
    od: string;
    asof: string;
    tpen: string;
    tver: string;
    tod: string;
    n: string;
    st: string;
  };
  const pend = (
    asOf: string | null,
    resort: string | null = null,
    limit = 100,
    offset = 0,
  ) =>
    asUser<P>(
      `select booking_code code, status::text st, due_paise::text due, approved_paise::text ap, waiting_paise::text wa, pending_paise::text pen, verified_remaining_paise::text ver,
              overdue_paise::text od, as_of::text asof, total_pending_paise::text tpen, total_verified_remaining_paise::text tver, total_overdue_paise::text tod, total_rows::text n
         from public.report_pending($1::date, $2, $3, $4)`,
      [asOf, resort, limit, offset],
    );
  it("RPT-27 (COL-05, COL-06): as of 31 March: A1, B2, B3 and A5, ordered by Overdue, with the hand-calculated figures", async () => {
    const r = await pend("2026-03-31");
    expect(r.map((x) => x.code)).toEqual([a1, b2, b3, a5].map((x) => x.code));
    expect(r.map((x) => [x.pen, x.ver, x.od].join("|"))).toEqual([
      `${R(1000)}|${R(2000)}|${R(2000)}`, // A1
      `0|${R(3000)}|${R(1500)}`, //          B2: waiting covers Pending, not Verified Remaining; overdue 1,500 after the moved row
      `${R(1000)}|${R(1000)}|${R(1000)}`, // B3: a cancelled booking with an unpaid charge
      `${R(4500)}|${R(4500)}|0`, //          A5: nothing is due before 5 April
    ]);
    expect(r[0]).toMatchObject({
      tpen: String(R(6500)),
      tver: String(R(10500)),
      tod: String(R(4500)),
      n: "4",
      asof: "2026-03-31",
    });
  });
  it("RPT-28: a booking that is paid, over-paid, cancelled and settled or refunded is NOT listed", async () => {
    const codes = (await pend("2026-03-31")).map((x) => x.code);
    for (const b of [a0, a2, a3, a4, b1, b9])
      expect(codes).not.toContain(b.code);
  });
  it("RPT-29: as of 30 April the overdue amounts grow (A5 and B2's moved row fall due) while Pending and Verified Remaining stay what they are today", async () => {
    const r = await pend("2026-04-30");
    expect(r.map((x) => [x.code, x.od].join("|"))).toEqual([
      `${a5.code}|${R(4500)}`,
      `${b2.code}|${R(3000)}`,
      `${a1.code}|${R(2000)}`,
      `${b3.code}|${R(1000)}`,
    ]);
    expect(r[0]).toMatchObject({
      tod: String(R(10500)),
      tpen: String(R(6500)),
      tver: String(R(10500)),
    });
  });
  it("RPT-30: it agrees with the booking page's own figures (booking_financials) and with booking_overdue, booking by booking", async () => {
    const r = await pend("2026-03-31");
    for (const x of r) {
      const [f] = await q<Row>(
        `select f.pending_paise::text p, f.verified_remaining_paise::text v, (select o.overdue_paise::text from public.booking_overdue('2026-03-31') o where o.booking_id = f.booking_id) od
                                  from public.booking_financials f join public.bookings b on b.id = f.booking_id where b.booking_code = $1`,
        [x.code],
      );
      expect({ p: x.pen, v: x.ver, od: x.od }).toEqual({
        p: f.p,
        v: f.v,
        od: f.od,
      });
    }
  });
  it("RPT-31: the resort filter and paging; today is the default date", async () => {
    expect((await pend("2026-03-31", A)).map((x) => x.code)).toEqual([
      a1.code,
      a5.code,
    ]);
    expect((await pend("2026-03-31", B)).map((x) => x.code)).toEqual([
      b2.code,
      b3.code,
    ]);
    expect((await pend("2026-03-31", null, 2, 2)).map((x) => x.code)).toEqual([
      b3.code,
      a5.code,
    ]);
    const [{ t }] = await q<{ t: string }>(`select public.today_ist()::text t`);
    expect((await pend(null))[0].asof).toBe(t);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("Waiting for Approval Report (RPT-32..)", () => {
  type W = {
    kind: string;
    code: string;
    booking: string;
    amount: string;
    rdate: string;
    edate: string;
    age: number;
    tp: string;
    tr: string;
    tpc: number;
    trc: number;
    n: string;
    rby: string;
  };
  const wait = (
    type: string,
    from: string | null,
    to: string | null,
    o: { resort?: string | null; kind?: string | null } = {},
  ) =>
    asUser<W>(
      `select kind, record_code code, booking_code booking, amount_paise::text amount, record_date::text rdate, entered_on::text edate, age_days age, total_payments_paise::text tp,
              total_refunds_paise::text tr, total_payments_count tpc, total_refunds_count trc, total_rows::text n, recorded_by_name rby
         from public.report_waiting($1, $2::date, $3::date, $4, $5)`,
      [type, from, to, o.resort ?? null, o.kind ?? null],
    );
  it("RPT-32: all five waiting items, oldest first, with the totals of payments and of refunds apart", async () => {
    const r = await wait("entry", null, null);
    expect(r.map((x) => `${x.kind}|${x.amount}|${x.rdate}|${x.edate}`)).toEqual(
      [
        `payment|${R(1000)}|2026-03-10|2026-03-10`, // A1
        `refund|${R(300)}|2026-03-12|2026-03-12`, //  A1
        `payment|${R(3000)}|2026-03-15|2026-03-16`, // B2 (typed in the next day)
        `payment|${R(200)}|2026-04-01|2026-03-31`, // B1 (dated April, typed in on 31 March at 23:50)
        `payment|${R(100)}|2026-05-02|2026-05-03`, // B9 (typed in at 02:00 on the 3rd, India time)
      ],
    );
    expect(r[0]).toMatchObject({
      tp: String(R(4300)),
      tr: String(R(300)),
      tpc: 4,
      trc: 1,
      n: "5",
      rby: "Test Manager One",
    });
  });
  it("RPT-33: the age in days is today (IST) minus the day it was typed in", async () => {
    const r = await wait("entry", null, null);
    for (const x of r) {
      const [{ d }] = await q<{ d: number }>(
        `select (public.today_ist() - $1::date)::int d`,
        [x.edate],
      );
      expect(x.age).toBe(d);
    }
  });
  it("RPT-34 (COL-08): 'typed in' and 'payment date' are different days: the Rs 200 is 31 March by entry and 1 April by payment date", async () => {
    expect(
      (await wait("entry", "2026-03-31", "2026-03-31")).map((x) => x.amount),
    ).toEqual([String(R(200))]);
    expect(await wait("entry", "2026-04-01", "2026-04-01")).toEqual([]);
    expect(
      (await wait("record", "2026-04-01", "2026-04-01")).map((x) => x.amount),
    ).toEqual([String(R(200))]);
    expect(await wait("record", "2026-03-31", "2026-03-31")).toEqual([]);
    expect(
      (await wait("record", "2026-03-15", "2026-03-15")).map((x) =>
        x.code.slice(-3),
      ),
    ).toHaveLength(1);
    expect(await wait("entry", "2026-03-15", "2026-03-15")).toEqual([]);
    // typed in at 02:00 on 3 May India time = 2 May in UTC: it belongs to the 3rd
    expect(
      (await wait("entry", "2026-05-03", "2026-05-03")).map((x) => x.amount),
    ).toEqual([String(R(100))]);
    expect(await wait("entry", "2026-05-02", "2026-05-02")).toEqual([]);
  });
  it("RPT-35: the resort and kind filters; the totals follow the filter", async () => {
    expect(
      (await wait("entry", null, null, { kind: "refund" })).map(
        (x) => x.amount,
      ),
    ).toEqual([String(R(300))]);
    const b = await wait("entry", null, null, { resort: B });
    expect(b).toHaveLength(3);
    expect(b[0]).toMatchObject({ tp: String(R(3300)), trc: 0, tr: null });
    await expectDbError(
      wait("entry", null, null, { kind: "booking" }),
      "INVALID_INPUT",
    );
    await expectDbError(wait("other", null, null), "INVALID_INPUT");
  });
  it("RPT-36: approved, rejected and reversed items are never in the waiting report", async () => {
    const codes = (await wait("entry", null, null)).map((x) => x.code);
    const [{ n }] = await q<{ n: string }>(
      `select count(*)::text n from (select payment_code from public.payments where status = 'waiting' union all select refund_code from public.refunds where status = 'waiting') z`,
    );
    expect(codes).toHaveLength(Number(n));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("Refund Report (RPT-37..)", () => {
  type F = {
    code: string;
    booking: string;
    amount: string;
    method: string;
    status: string;
    reason: string;
    rdate: string;
    ta: string;
    tw: string;
    tr: string;
    tv: string;
    n: string;
  };
  const rf = (
    from: string | null,
    to: string | null,
    o: {
      resort?: string | null;
      status?: string | null;
      method?: string | null;
    } = {},
  ) =>
    asUser<F>(
      `select refund_code code, booking_code booking, amount_paise::text amount, method, status::text status, reason, refund_date::text rdate, total_approved_paise::text ta,
              total_waiting_paise::text tw, total_rejected_paise::text tr, total_reversed_paise::text tv, total_rows::text n
         from public.report_refunds($1::date, $2::date, $3, $4::public.approval_status, $5::public.payment_method, 100, 0)`,
      [from, to, o.resort ?? null, o.status ?? null, o.method ?? null],
    );
  it("RPT-37: all five refunds, newest first, with the total of each status apart", async () => {
    const r = await rf(null, null);
    expect(r.map((x) => [x.status, x.amount, x.rdate].join("|"))).toEqual([
      `approved|${R(1000)}|2026-04-02`,
      `reversed|${R(100)}|2026-03-21`,
      `rejected|${R(200)}|2026-03-20`,
      `waiting|${R(300)}|2026-03-12`,
      `approved|${R(500)}|2026-03-11`,
    ]);
    expect(r[0]).toMatchObject({
      ta: String(R(1500)),
      tw: String(R(300)),
      tr: String(R(200)),
      tv: String(R(100)),
      n: "5",
      reason: "Guest left early",
    });
  });
  it("RPT-38 (COL-10): by REFUND date: the April refund of a March booking is in April; March's approved refunds are unchanged", async () => {
    const march = await rf("2026-03-01", "2026-03-31");
    expect(march).toHaveLength(4);
    expect(march[0]).toMatchObject({ ta: String(R(500)) });
    expect(
      (await rf("2026-04-01", "2026-04-30")).map((x) => x.booking),
    ).toEqual([a3.code]);
  });
  it("RPT-39: the status, method and resort filters", async () => {
    expect(
      (await rf(null, null, { status: "waiting" })).map((x) => x.amount),
    ).toEqual([String(R(300))]);
    expect(await rf(null, null, { status: "waiting", resort: B })).toEqual([]);
    expect(await rf(null, null, { method: "upi" })).toEqual([]);
    expect((await rf(null, null, { resort: B })).map((x) => x.status)).toEqual([
      "reversed",
      "rejected",
    ]);
  });
  it("RPT-40: the approved total equals the collection report's refunds for the same dates", async () => {
    const [c] = await rows(
      `select total_refunds_paise::text r from public.report_collection('2026-03-01', '2026-04-30', null, 'month', 'none') limit 1`,
    );
    const r = await rf("2026-03-01", "2026-04-30");
    expect(r[0].ta).toBe(c.r);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("Cancellation Report (RPT-41..)", () => {
  type C = {
    code: string;
    status: string;
    cdate: string;
    orig: string;
    charge: string;
    ap: string;
    rdue: string;
    reason: string;
    ccr: string | null;
    to: string;
    tc: string;
    tr: string;
    n: string;
  };
  const cx = (
    from: string | null,
    to: string | null,
    o: { resort?: string | null; status?: string | null } = {},
  ) =>
    asUser<C>(
      `select booking_code code, status::text status, cancellation_date::text cdate, original_paise::text orig, charge_paise::text charge, approved_paise::text ap,
              refund_due_paise::text rdue, reason, charge_change_reason ccr, total_original_paise::text "to", total_charge_paise::text tc, total_refund_due_paise::text tr, total_rows::text n
         from public.report_cancellations($1::date, $2::date, $3, $4::public.booking_status, 100, 0)`,
      [from, to, o.resort ?? null, o.status ?? null],
    );
  it("RPT-41: March: the cancelled and the no-show bookings, newest cancellation first, with original amount, charge and refund due", async () => {
    const r = await cx("2026-03-01", "2026-03-31");
    expect(
      r.map((x) =>
        [x.code, x.status, x.cdate, x.orig, x.charge, x.ap, x.rdue].join("|"),
      ),
    ).toEqual([
      [b3.code, "cancelled", "2026-03-20", R(5000), R(2000), R(1000), 0].join(
        "|",
      ),
      [a3.code, "cancelled", "2026-03-15", R(6000), R(1000), R(2000), 0].join(
        "|",
      ), // paid 2,000 - refunded 1,000 (in April) = 1,000 = the charge
      [
        a4.code,
        "no_show",
        "2026-03-13",
        R(4000),
        R(4000),
        R(4500),
        R(500),
      ].join("|"),
    ]);
    expect(r[0]).toMatchObject({
      to: String(R(15000)),
      tc: String(R(7000)),
      tr: String(R(500)),
      n: "3",
      ccr: "Part of the charge was waived",
    });
    expect(r[1].reason).toBe("Guest unwell");
  });
  it("RPT-42: the status and resort filters; an active booking is never in this report", async () => {
    expect(
      (await cx(null, null, { status: "no_show" })).map((x) => x.code),
    ).toEqual([a4.code]);
    expect((await cx(null, null, { resort: B })).map((x) => x.code)).toEqual([
      b3.code,
    ]);
    const all = (await cx(null, null)).map((x) => x.code);
    for (const b of [a1, a2, a5, b1, b2]) expect(all).not.toContain(b.code);
    await expectDbError(
      cx(null, null, { status: "confirmed" }),
      "INVALID_INPUT",
    );
  });
  it("RPT-43: the dates are the cancellation dates: 15 to 16 March finds only A3", async () => {
    expect((await cx("2026-03-15", "2026-03-16")).map((x) => x.code)).toEqual([
      a3.code,
    ]);
    expect(await cx("2026-04-01", "2026-04-30")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("Expected Adjustments and Manual Adjustment reports (RPT-44..)", () => {
  type E = {
    date: string;
    code: string;
    amount: string;
    source: string;
    reason: string;
    by: string;
    total: string;
    n: string;
  };
  const ea = (
    from: string | null,
    to: string | null,
    o: { resort?: string | null; source?: string | null } = {},
  ) =>
    asUser<E>(
      `select adjustment_date::text date, booking_code code, amount_paise::text amount, source::text source, reason, created_by_name "by", total_paise::text total, total_rows::text n
         from public.report_expected_adjustments($1::date, $2::date, $3, $4::public.adjustment_source, 100, 0)`,
      [from, to, o.resort ?? null, o.source ?? null],
    );
  it("RPT-44: every adjustment on its own date with booking, amount, source, reason and user; the total is the sum", async () => {
    const r = await ea("2026-03-01", "2026-03-31");
    expect(
      r.map((x) => [x.date, x.code, x.amount, x.source, x.reason].join("|")),
    ).toEqual([
      `2026-03-20|${b2.code}|${-R(1500)}|move_overdue|Guest will pay at check-in`,
      `2026-03-15|${a3.code}|${-R(1000)}|cancellation|Booking cancelled: guest unwell`,
    ]);
    expect(r[0]).toMatchObject({
      total: String(-R(2500)),
      n: "2",
      by: "Test Manager One",
    });
  });
  it("RPT-45: it agrees with the Expected Adjustments column of the resort-wise report for the same dates", async () => {
    const r = await ea("2026-03-01", "2026-03-31");
    const [x] = await rows(
      `select total_expected_adjustments_paise::text a from public.report_expected_vs_actual('2026-03-01', '2026-03-31', null) limit 1`,
    );
    expect(r[0].total).toBe(x.a);
  });
  it("RPT-46: the source, resort and date filters", async () => {
    expect(
      (await ea(null, null, { source: "cancellation" })).map((x) => x.code),
    ).toEqual([a3.code]);
    expect((await ea(null, null, { resort: B })).map((x) => x.code)).toContain(
      b2.code,
    );
    expect(await ea("2026-03-16", "2026-03-19")).toEqual([]);
  });

  type M = {
    code: string;
    bdate: string;
    total: string;
    disc: string;
    adj: string;
    why: string | null;
    final: string;
    charge: string | null;
    ccr: string | null;
    tadj: string;
    n: string;
  };
  const ma = (
    from: string | null,
    to: string | null,
    resort: string | null = null,
  ) =>
    asUser<M>(
      `select booking_code code, booking_date::text bdate, total_paise::text total, discount_paise::text disc, adjustment_paise::text adj, adjustment_reason why, final_paise::text final,
              charge_paise::text charge, charge_change_reason ccr, total_adjustment_paise::text tadj, total_rows::text n
         from public.report_manual_adjustments($1::date, $2::date, $3, 100, 0)`,
      [from, to, resort],
    );
  it("RPT-47: bookings whose amount or cancellation charge was changed by hand, with the stored figures and the reasons", async () => {
    const r = await ma(null, null);
    expect(r.map((x) => x.code)).toEqual([a5.code, b3.code]);
    expect(r[0]).toMatchObject({
      bdate: "2026-03-20",
      total: String(R(5000)),
      disc: String(R(300)),
      adj: String(-R(200)),
      why: "Regular guest",
      final: String(R(4500)),
      charge: null,
      tadj: String(-R(200)),
      n: "2",
    });
    expect(r[1]).toMatchObject({
      adj: "0",
      charge: String(R(2000)),
      ccr: "Part of the charge was waived",
    });
    expect((await ma("2026-03-15", "2026-03-31")).map((x) => x.code)).toEqual([
      a5.code,
    ]);
    expect((await ma(null, null, B)).map((x) => x.code)).toEqual([b3.code]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("who may ask, and what a bad question gets (RPT-48..)", () => {
  const calls: [string, string][] = [
    [
      "report_check",
      `select public.report_check('2026-03-01', '2026-03-31', 3660)`,
    ],
    [
      "report_collection",
      `select * from public.report_collection('2026-03-01', '2026-03-31')`,
    ],
    [
      "report_expected_vs_actual",
      `select * from public.report_expected_vs_actual('2026-03-01', '2026-03-31')`,
    ],
    [
      "report_payment_methods",
      `select * from public.report_payment_methods('2026-03-01', '2026-03-31')`,
    ],
    ["report_bookings", `select * from public.report_bookings()`],
    ["report_pending", `select * from public.report_pending()`],
    ["report_waiting", `select * from public.report_waiting()`],
    ["report_refunds", `select * from public.report_refunds()`],
    ["report_cancellations", `select * from public.report_cancellations()`],
    [
      "report_expected_adjustments",
      `select * from public.report_expected_adjustments()`,
    ],
    [
      "report_manual_adjustments",
      `select * from public.report_manual_adjustments()`,
    ],
  ];
  it("RPT-48: anonymous visitors are refused by every report function", async () => {
    for (const [, sql] of calls)
      await expectDbError(
        w.db.as({ role: "anon" }, () => q(sql)),
        "permission denied",
      );
  });
  it("RPT-49: signed-out requests, unknown logins and switched-off people are refused, not given an empty report", async () => {
    const off = uid();
    await w.db.exec(
      `insert into auth.users (id, email) values ('${off}', 'off-rpt@test.example')`,
    );
    await w.db.as({ role: "postgres", uid: w.owner }, () =>
      q(
        `insert into public.user_profiles (id, full_name, email, role) values ($1, 'Switched Off', 'off-rpt@test.example', 'manager')`,
        [off],
      ),
    );
    await put.raw(() =>
      q(
        `update public.user_profiles set is_active = false, disabled_at = now() where id = $1`,
        [off],
      ),
    );
    for (const [, sql] of calls) {
      await expectDbError(
        as(null, () => q(sql)),
        "NOT_ALLOWED",
      );
      await expectDbError(
        as(uid(), () => q(sql)),
        "NOT_ALLOWED",
      );
      await expectDbError(
        as(off, () => q(sql)),
        "NOT_ALLOWED",
      );
    }
  });
  it("RPT-50: Owners and Managers get the same reports (Q10)", async () => {
    const sql = `select * from public.report_collection('2026-03-01', '2026-03-31', null, 'day', 'resort')`;
    expect(await asUser(sql, [], w.owner)).toEqual(
      await asUser(sql, [], w.manager2),
    );
  });
  it("RPT-51: all eleven are SECURITY INVOKER with an empty search_path; only signed-in users may run them", async () => {
    const rows2 = await q<Row>(
      `select p.proname, p.prosecdef, p.proconfig, has_function_privilege('authenticated', p.oid, 'execute') auth,
              has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('public', p.oid, 'execute') pub
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'report\\_%' order by 1`,
    );
    expect(rows2.map((x) => x.proname as string).sort()).toEqual(
      calls.map(([n]) => n).sort(),
    );
    for (const x of rows2) {
      expect(x.prosecdef).toBe(false);
      expect(
        (x.proconfig as string[]).some((c) => /^search_path=("")?$/.test(c)),
      ).toBe(true);
      expect([x.auth, x.anon, x.pub]).toEqual([true, false, false]);
    }
  });
  it("RPT-52: bad questions get plain messages: reversed dates, more than ten years, missing dates, unknown choices", async () => {
    const bad = async (sql: string) =>
      expectDbError(asUser(sql), "INVALID_INPUT");
    await bad(
      `select * from public.report_collection('2026-03-31', '2026-03-01')`,
    );
    await bad(
      `select * from public.report_collection('2010-01-01', '2026-01-01')`,
    );
    await bad(`select * from public.report_collection(null, '2026-01-01')`);
    await bad(
      `select * from public.report_collection('2026-01-01', '2026-01-31', null, 'hour')`,
    );
    await bad(
      `select * from public.report_collection('2026-01-01', '2026-01-31', null, 'day', 'guest')`,
    );
    await bad(
      `select * from public.report_expected_vs_actual('2026-03-31', '2026-03-01')`,
    );
    await bad(`select * from public.report_payment_methods(null, null)`);
    await bad(
      `select * from public.report_bookings('booking', '2026-03-31', '2026-03-01')`,
    );
    await bad(
      `select * from public.report_refunds('2026-03-31', '2026-03-01')`,
    );
    await bad(
      `select * from public.report_waiting('entry', '2026-03-31', '2026-03-01')`,
    );
    await bad(
      `select * from public.report_cancellations('2026-03-31', '2026-03-01')`,
    );
    await bad(
      `select * from public.report_expected_adjustments('2026-03-31', '2026-03-01')`,
    );
    await bad(
      `select * from public.report_manual_adjustments('2026-03-31', '2026-03-01')`,
    );
  });
  it("RPT-53: the period reports take at most 3,660 days (ten years): 3,660 days later is allowed, one day more is not", async () => {
    const ok = await rows(
      `select period_start::text ps, approved_paise::text ap from public.report_collection('2016-01-01', '2016-01-01'::date + 3660, null, 'year')`,
    );
    // 3,660 days after 1 Jan 2016 is 8 Jan 2026: the data of 2025 and the first days of 2026
    expect(ok.map((x) => x.ps)).toEqual(["2025-01-01", "2026-01-01"]);
    expect(ok.map((x) => x.ap)).toEqual([String(R(1000)), String(R(820))]);
    await expectDbError(
      asUser(
        `select * from public.report_collection('2016-01-01', '2016-01-01'::date + 3661)`,
      ),
      "INVALID_INPUT",
    );
    await expectDbError(
      asUser(
        `select * from public.report_expected_vs_actual('2016-01-01', '2016-01-01'::date + 3661)`,
      ),
      "INVALID_INPUT",
    );
    await expectDbError(
      asUser(
        `select * from public.report_payment_methods('2016-01-01', '2016-01-01'::date + 3661)`,
      ),
      "INVALID_INPUT",
    );
  });
  it("RPT-54: the page size is clamped to 1 to 1,000 and a negative offset to 0", async () => {
    expect(
      (
        await rows(
          `select * from public.report_bookings('booking', null, null, null, null, 100000, 0)`,
        )
      ).length,
    ).toBeLessThanOrEqual(1000);
    expect(
      (
        await rows(
          `select * from public.report_bookings('booking', null, null, null, null, 0, -5)`,
        )
      ).length,
    ).toBe(1);
  });
  it("RPT-55: asking changes nothing: the row counts of the main tables are the same after every report", async () => {
    const count = async () =>
      (
        await q<Row>(
          `select (select count(*) from public.bookings) b, (select count(*) from public.payments) p, (select count(*) from public.refunds) r, (select count(*) from public.expected_adjustments) a, (select count(*) from public.audit_logs) l`,
        )
      )[0];
    const before = await count();
    for (const [, sql] of calls) await asUser(sql);
    expect(await count()).toEqual(before);
  });
  it("RPT-56 (regression): the financial view and the dashboard are untouched: a booking's figures are still those of rule D1", async () => {
    const [f] = await q<Row>(
      `select pending_paise::text p, verified_remaining_paise::text v, refund_due_paise::text rd, total_collection_paise::text c, net_collection_paise::text n from public.booking_financials where booking_id = $1`,
      [a1.id],
    );
    // A1: approved 3,500, waiting 1,000, refunds approved 500, due 5,000
    expect(f).toEqual({
      p: String(R(1000)),
      v: String(R(2000)),
      rd: "0",
      c: String(R(3500)),
      n: String(R(3000)),
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// LAST, because it adds an adjustment to the data (everything above counts the data as built)
describe("past months never change (RPT-57)", () => {
  const ev = (from: string, to: string) =>
    rows(
      `select resort_id, originally_expected_paise::text op, expected_adjustments_paise::text adj, expected_paise::text ex, approved_paise::text ap
         from public.report_expected_vs_actual($1::date, $2::date, null)`,
      [from, to],
    );
  it("RPT-57 (COL-11e, D2): a cancellation AFTER March changes April, not March: the March figures are identical before and after", async () => {
    const marchBefore = await ev("2026-03-01", "2026-03-31");
    const aprilBefore = await ev("2026-04-01", "2026-04-30");
    expect(aprilBefore.find((x) => x.resort_id === A)).toMatchObject({
      op: String(R(4500)),
      adj: "0",
      ex: String(R(4500)),
    }); // A5
    await put.adjustment(
      a5,
      "2026-04-20",
      -R(200),
      "Amount reduced by the manager",
      "amount_change",
    );
    expect(await ev("2026-03-01", "2026-03-31")).toEqual(marchBefore);
    const aprilAfter = await ev("2026-04-01", "2026-04-30");
    expect(aprilAfter.find((x) => x.resort_id === A)).toMatchObject({
      op: String(R(4500)),
      adj: String(-R(200)),
      ex: String(R(4300)),
    });
  });
});
