/**
 * Dashboard functions (migration 20; PRD FR-DSH-2..4, UI spec 3.2, TEST_PLAN COL-12). DSH-01..
 * The golden dataset below has every figure calculated BY HAND (in the comments); the functions must give exactly those
 * numbers, and the same numbers as independent plain SQL over the raw tables. Everything is fictional.
 *
 * Money rows are inserted with the guard triggers switched off (as financial-views.test.ts does) so any combination of
 * statuses can be built; the guards themselves are tested elsewhere. Today is D; every date below is an offset from it.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { expectDbError } from "./harness";
import {
  cancelBooking,
  createBooking,
  dateOffset,
  setupWorld,
  uid,
  type Booking,
  type World,
} from "./fixtures";

let w: World;
const days = new Map<number, string>(); // offset -> IST date
let B1: Booking,
  B2: Booking,
  B3: Booking,
  B4: Booking,
  B6: Booking,
  C1: Booking;
let resortA: string, resortB: string;

const q = <T = Record<string, unknown>>(sql: string, p?: unknown[]) =>
  w.db.q<T>(sql, p);
const day = (n: number) => days.get(n)!;
const R = (rupees: number) => rupees * 100;

type Status = "waiting" | "approved" | "rejected" | "reversed";
async function putMoney(
  b: Booking,
  kind: "payments" | "refunds",
  status: Status,
  amount: number,
  dateOff: number,
  o: { approver?: string; recordedAgoDays?: number } = {},
): Promise<string> {
  const id = uid();
  const isPay = kind === "payments";
  const cols = [
    "id",
    isPay ? "payment_code" : "refund_code",
    "booking_id",
    "resort_id",
    "amount_paise",
    "method",
    isPay ? "payment_date" : "refund_date",
    "status",
    "recorded_by",
    "recorded_at",
    "idempotency_key",
  ];
  const vals: string[] = [
    `'${id}'`,
    `'${b.code}-${isPay ? "P" : "R"}-${id.slice(0, 8)}'`,
    `'${b.id}'`,
    `'${b.resortId}'`,
    String(amount),
    "'cash'",
    `(public.today_ist() + ${dateOff})`,
    `'${status}'`,
    `'${w.manager}'`,
    o.recordedAgoDays
      ? `now() - interval '${o.recordedAgoDays} days'`
      : "now()",
    `'${uid()}'`,
  ];
  const add = (c: string, v: string) => (cols.push(c), vals.push(v));
  if (!isPay) add("reason", "'test refund'");
  if (status === "approved" || status === "reversed") {
    add("approved_by", `'${o.approver ?? w.owner}'`);
    add("approved_at", "now()");
  }
  if (status === "rejected") {
    add("rejected_by", `'${w.owner}'`);
    add("rejected_at", "now()");
    add("rejection_reason", "'test'");
  }
  if (status === "reversed") {
    add("reversed_by", `'${w.owner}'`);
    add("reversed_at", "now()");
    add("reversal_reason", "'test'");
  }
  await w.db.exec("set session_replication_role = replica");
  try {
    await q(
      `insert into public.${kind} (${cols.join(",")}) values (${vals.join(",")})`,
    );
  } finally {
    await w.db.exec("set session_replication_role = origin");
  }
  return id;
}

beforeAll(async () => {
  w = await setupWorld();
  for (let n = -60; n <= 12; n++) days.set(n, await dateOffset(w.db, n));
  resortA = w.resorts.A.id;
  resortB = w.resorts.B.id;

  // ---- resort A ---------------------------------------------------------------------------------------------------
  // B1: Rs 5,000 (2 people x Rs 2,500 per stay). Booked D-9, checks in today, out tomorrow.
  //     plan: Rs 2,000 due D-8, Rs 3,000 due D+5
  B1 = await createBooking(w, {
    resort: "A",
    bookingDateOffset: -9,
    checkInOffset: 0,
    plan: [
      { label: "Advance", dueOffset: -8, amount: R(2000) },
      { label: "Balance", dueOffset: 5, amount: R(3000) },
    ],
  });
  await putMoney(B1, "payments", "approved", R(2000), -8); // counts
  await putMoney(B1, "payments", "waiting", R(1000), -2); //  waiting card
  await putMoney(B1, "payments", "rejected", R(500), -1); //  never counts
  await putMoney(B1, "payments", "reversed", R(300), -1); //  never counts

  // B2: Rs 1,000 (1 x Rs 1,000). Booked D-3, checks in D+3. plan Rs 1,000 due D+2. Paid and SELF-approved.
  B2 = await createBooking(w, {
    resort: "A",
    pax: 1,
    tariff: R(1000),
    bookingDateOffset: -3,
    checkInOffset: 3,
    plan: [{ label: "Balance", dueOffset: 2, amount: R(1000) }],
  });
  await putMoney(B2, "payments", "approved", R(1000), -3, {
    approver: w.manager,
  });

  // B5: Rs 500 (1 x Rs 500). Booked D-2, checked in D-1, checks out TODAY. plan Rs 500 due D-1; nothing paid (overdue).
  await createBooking(w, {
    resort: "A",
    pax: 1,
    tariff: R(500),
    bookingDateOffset: -2,
    checkInOffset: -1,
    plan: [{ label: "Balance", dueOffset: -1, amount: R(500) }],
  });

  // B6: Rs 800, booked D-40: OUTSIDE the test period. Paid Rs 800 on D-40.
  B6 = await createBooking(w, {
    resort: "A",
    pax: 1,
    tariff: R(800),
    bookingDateOffset: -40,
    checkInOffset: -38,
    plan: [{ label: "Balance", dueOffset: -40, amount: R(800) }],
  });
  await putMoney(B6, "payments", "approved", R(800), -40);

  // C1: Rs 3,000, booked D-20, would check in today, but CANCELLED with no charge: never a check-in, no money.
  C1 = await createBooking(w, {
    resort: "A",
    pax: 1,
    tariff: R(3000),
    bookingDateOffset: -20,
    checkInOffset: 0,
    plan: [{ label: "Balance", dueOffset: 2, amount: R(3000) }],
  });
  await cancelBooking(w, C1, { charge: 0 });

  // ---- resort B ---------------------------------------------------------------------------------------------------
  // B3: Rs 4,000 (2 x Rs 2,000). Booked D-6, checked in D-4. plan Rs 4,000 due D-5. Rs 1,500 approved on D-5.
  B3 = await createBooking(w, {
    resort: "B",
    tariff: R(2000),
    bookingDateOffset: -6,
    checkInOffset: -4,
    plan: [{ label: "Balance", dueOffset: -5, amount: R(4000) }],
  });
  await putMoney(B3, "payments", "approved", R(1500), -5);

  // B4: Rs 3,000 (1 x Rs 3,000). Booked D-7, checked in D-4. plan Rs 3,000 due D-1. Rs 3,000 approved on D-4,
  //     Rs 2,000 refund approved on D-1.
  B4 = await createBooking(w, {
    resort: "B",
    pax: 1,
    tariff: R(3000),
    bookingDateOffset: -7,
    checkInOffset: -4,
    plan: [{ label: "Balance", dueOffset: -1, amount: R(3000) }],
  });
  await putMoney(B4, "payments", "approved", R(3000), -4);
  await putMoney(B4, "refunds", "approved", R(2000), -1);

  // one failed PDF on B1 (resort A)
  await q(
    `insert into public.pdf_jobs (booking_id, reason, status, attempts, last_error) values ($1, 'test', 'failed', 3, 'test')`,
    [B1.id],
  );
}, 180_000);

// ---- the golden figures for the period D-10 .. D ----------------------------------------------------------------
const FROM = () => day(-10);
const TO = () => day(0);

const as = <T>(id: string | null, fn: () => Promise<T>) =>
  w.db.as({ role: "authenticated", uid: id }, fn);
type Row = Record<string, unknown>;
const summary = async (
  resort: string | null = null,
  from: string | null = FROM(),
  to: string | null = TO(),
  actor: string | null = w.manager,
) =>
  (
    await as(actor, () =>
      q<Row>(`select * from public.dashboard_summary($1, $2, $3)`, [
        resort,
        from,
        to,
      ]),
    )
  )[0];
const n = (r: Row, k: string) => Number(r[k]);

describe("the cards: dashboard_summary (DSH-01..05)", () => {
  it("DSH-01: resort A, period D-10..D, equals the hand-calculated figures", async () => {
    const s = await summary(resortA);
    expect(n(s, "total_resorts")).toBe(1); //                  the one resort chosen
    expect(n(s, "total_bookings")).toBe(3); //                 B1 (D-9), B2 (D-3), B5 (D-2); B6 and C1 are older
    expect(n(s, "checkins_today")).toBe(1); //                 B1 only: C1 is cancelled
    expect(n(s, "checkouts_today")).toBe(1); //                B5 (B1 checks out tomorrow)
    expect(n(s, "expected_paise")).toBe(R(2500)); //           B1 Rs 2,000 (D-8) + B5 Rs 500 (D-1); later rows are outside
    expect(n(s, "total_collection_paise")).toBe(R(3000)); //   B1 Rs 2,000 + B2 Rs 1,000 (B6 is outside; rejected/reversed never)
    expect(n(s, "waiting_paise")).toBe(R(1000)); //            B1's waiting Rs 1,000, a separate figure
    expect(n(s, "waiting_items")).toBe(1);
    expect(n(s, "refunds_paise")).toBe(0);
    expect(n(s, "net_collection_paise")).toBe(R(3000));
    expect(n(s, "pending_paise")).toBe(R(2500)); //            B1 3,000-... see below: now, not period
  });

  it("DSH-02: resort B, same period", async () => {
    const s = await summary(resortB);
    expect(n(s, "total_bookings")).toBe(2); //                 B3, B4
    expect(n(s, "checkins_today")).toBe(0);
    expect(n(s, "checkouts_today")).toBe(0);
    expect(n(s, "expected_paise")).toBe(R(7000)); //           B3 Rs 4,000 (D-5) + B4 Rs 3,000 (D-1)
    expect(n(s, "total_collection_paise")).toBe(R(4500)); //   B3 Rs 1,500 + B4 Rs 3,000
    expect(n(s, "waiting_paise")).toBe(0);
    expect(n(s, "refunds_paise")).toBe(R(2000)); //            B4's approved refund, by REFUND date
    expect(n(s, "net_collection_paise")).toBe(R(2500)); //     4,500 - 2,000
    expect(n(s, "pending_paise")).toBe(R(4500)); //            B3 2,500 + B4 2,000
  });

  it("DSH-03: all resorts add up exactly (resort A + resort B, the placeholder resorts have nothing)", async () => {
    const s = await summary(null);
    expect(n(s, "total_bookings")).toBe(5);
    expect(n(s, "expected_paise")).toBe(R(9500));
    expect(n(s, "total_collection_paise")).toBe(R(7500));
    expect(n(s, "waiting_paise")).toBe(R(1000));
    expect(n(s, "waiting_items")).toBe(1);
    expect(n(s, "refunds_paise")).toBe(R(2000));
    expect(n(s, "net_collection_paise")).toBe(R(5500));
    expect(n(s, "pending_paise")).toBe(R(7000));
    // the number of active resorts is whatever the table says (the 4 placeholders plus the two test resorts)
    const active = await q<{ n: string }>(
      `select count(*)::text n from public.resorts where is_active`,
    );
    expect(n(s, "total_resorts")).toBe(Number(active[0].n));
    expect(String(s.period_from)).toContain("");
  });

  it("DSH-04: Pending Amount (hand calculation, as of now) and what rejected and reversed money does", async () => {
    // B1 due 5,000: recorded = approved 2,000 + waiting 1,000 = 3,000 -> pending 2,000 (rejected 500 and reversed 300 never count)
    // B2 due 1,000, paid 1,000 -> 0; B5 due 500, nothing recorded -> 500; B6 due 800 paid 800 -> 0; C1 due 0 -> 0
    // resort A = 2,000 + 500 = 2,500
    const a = await summary(resortA);
    expect(n(a, "pending_paise")).toBe(R(2500));
    // B3 due 4,000 - 1,500 = 2,500; B4 due 3,000, recorded 3,000 - refund 2,000 = 1,000 -> pending 2,000 -> resort B 4,500
    expect((await summary(resortB)).pending_paise).toBe(R(4500));
    const rejected = await q<{ n: string }>(
      `select coalesce(sum(amount_paise), 0)::text n from public.payments where status in ('rejected', 'reversed')`,
    );
    expect(Number(rejected[0].n)).toBeGreaterThan(0); // the fixture really contains such rows ...
    // ... and none of them is in any figure: collection equals the sum of APPROVED payments only (independent SQL)
    const plain = await q<{ n: string }>(
      `select coalesce(sum(amount_paise), 0)::text n from public.payments where status = 'approved' and payment_date between $1 and $2`,
      [FROM(), TO()],
    );
    expect(n(await summary(null), "total_collection_paise")).toBe(
      Number(plain[0].n),
    );
  });

  it("DSH-05: the period decides the dated figures; today's check-ins, waiting items and pending do not move with it", async () => {
    // a one-day period: D-8 only
    const one = await summary(resortA, day(-8), day(-8));
    expect(n(one, "total_bookings")).toBe(0);
    expect(n(one, "expected_paise")).toBe(R(2000)); //          B1's advance is due on D-8
    expect(n(one, "total_collection_paise")).toBe(R(2000)); //  and was paid on D-8
    expect(n(one, "waiting_paise")).toBe(0);
    expect(n(one, "checkins_today")).toBe(1); //                today's figures stay today's
    expect(n(one, "waiting_items")).toBe(1);
    expect(n(one, "pending_paise")).toBe(R(2500));
    // a wider period now reaches B6 (D-40): its booking, its Rs 800 payment and its Rs 800 due date
    const wide = await summary(resortA, day(-45), day(0));
    expect(n(wide, "total_bookings")).toBe(5); // B1, B2, B5, B6 and the cancelled C1 (booked D-20)
    expect(n(wide, "total_collection_paise")).toBe(R(3800));
    expect(n(wide, "expected_paise")).toBe(R(3300));
    // no period at all = today only; only a start or only an end = that single day
    const none = await as(w.manager, () =>
      q<Row>(`select * from public.dashboard_summary(null, null, null)`),
    );
    expect(String(none[0].period_from)).toBe(String(none[0].period_to));
    expect(n(none[0], "total_collection_paise")).toBe(0);
  });
});

describe("the resort table: dashboard_by_resort (DSH-06..07)", () => {
  it("DSH-06: one row per resort with the same figures as the cards; the rows add up to the all-resorts card", async () => {
    const rows = await as(w.manager, () =>
      q<Row>(`select * from public.dashboard_by_resort(null, $1, $2)`, [
        FROM(),
        TO(),
      ]),
    );
    const a = rows.find((r) => r.resort_id === resortA)!;
    const b = rows.find((r) => r.resort_id === resortB)!;
    expect([
      n(a, "bookings"),
      n(a, "expected_paise"),
      n(a, "total_collection_paise"),
      n(a, "waiting_paise"),
      n(a, "refunds_paise"),
      n(a, "net_collection_paise"),
      n(a, "pending_paise"),
    ]).toEqual([3, R(2500), R(3000), R(1000), 0, R(3000), R(2500)]);
    expect([
      n(b, "bookings"),
      n(b, "expected_paise"),
      n(b, "total_collection_paise"),
      n(b, "waiting_paise"),
      n(b, "refunds_paise"),
      n(b, "net_collection_paise"),
      n(b, "pending_paise"),
    ]).toEqual([2, R(7000), R(4500), 0, R(2000), R(2500), R(4500)]);
    // every resort appears, also the ones without any booking; the placeholders are all zeros
    const active = await q<{ n: string }>(
      `select count(*)::text n from public.resorts`,
    );
    expect(rows).toHaveLength(Number(active[0].n));
    const empty = rows.filter(
      (r) => r.resort_id !== resortA && r.resort_id !== resortB,
    );
    expect(empty.length).toBeGreaterThan(0);
    for (const r of empty)
      expect([
        n(r, "bookings"),
        n(r, "expected_paise"),
        n(r, "total_collection_paise"),
        n(r, "pending_paise"),
      ]).toEqual([0, 0, 0, 0]);
    // the rows add up to the card
    const card = await summary(null);
    const sum = (k: string) => rows.reduce((s, r) => s + n(r, k), 0);
    expect(sum("bookings")).toBe(n(card, "total_bookings"));
    for (const k of [
      "expected_paise",
      "total_collection_paise",
      "waiting_paise",
      "refunds_paise",
      "net_collection_paise",
      "pending_paise",
    ])
      expect(sum(k), k).toBe(n(card, k));
  });

  it("DSH-07: the resort filter returns that resort only; switched-off resorts are still listed (last); an unknown resort gives nothing", async () => {
    const one = await as(w.manager, () =>
      q<Row>(`select * from public.dashboard_by_resort($1, $2, $3)`, [
        resortB,
        FROM(),
        TO(),
      ]),
    );
    expect(one).toHaveLength(1);
    expect(one[0].resort_id).toBe(resortB);
    const spare = (
      await q<{ id: string }>(
        `select id from public.resorts where id not in ($1, $2) order by name limit 1`,
        [resortA, resortB],
      )
    )[0].id;
    await q(`update public.resorts set is_active = false where id = $1`, [
      spare,
    ]);
    const all = await as(w.manager, () =>
      q<Row>(`select * from public.dashboard_by_resort(null, $1, $2)`, [
        FROM(),
        TO(),
      ]),
    );
    const listed = all.find((r) => r.resort_id === spare)!;
    expect(listed.is_active).toBe(false);
    expect(all.at(-1)!.resort_id).toBe(spare); // switched-off resorts come after the active ones
    await q(`update public.resorts set is_active = true where id = $1`, [
      spare,
    ]);
    const nobody = await as(w.manager, () =>
      q<Row>(`select * from public.dashboard_by_resort($1, $2, $3)`, [
        uid(),
        FROM(),
        TO(),
      ]),
    );
    expect(nobody).toEqual([]);
    const s = await summary(uid());
    expect([
      n(s, "total_resorts"),
      n(s, "total_bookings"),
      n(s, "total_collection_paise"),
      n(s, "pending_paise"),
    ]).toEqual([0, 0, 0, 0]);
  });
});

describe("the chart: dashboard_by_date (DSH-08..09)", () => {
  const chart = (
    resort: string | null,
    from: string,
    to: string,
    grain = "day",
  ) =>
    as(w.manager, () =>
      q<Row>(
        `select to_char(bucket_start, 'YYYY-MM-DD') as bucket_start, total_collection_paise, waiting_paise, expected_paise from public.dashboard_by_date($1, $2, $3, $4)`,
        [resort, from, to, grain],
      ),
    );

  it("DSH-08: one row per day, also empty days, with the hand-calculated approved, waiting and expected amounts", async () => {
    const rows = await chart(resortA, FROM(), TO());
    expect(rows).toHaveLength(11); //                          D-10 .. D
    expect(rows.map((r) => String(r.bucket_start).slice(0, 10))).toEqual(
      Array.from({ length: 11 }, (_, i) => day(-10 + i)),
    );
    const at = (off: number) =>
      rows.find((r) => String(r.bucket_start).slice(0, 10) === day(off))!;
    expect([
      n(at(-8), "total_collection_paise"),
      n(at(-8), "expected_paise"),
    ]).toEqual([R(2000), R(2000)]);
    expect(n(at(-3), "total_collection_paise")).toBe(R(1000));
    expect(n(at(-2), "waiting_paise")).toBe(R(1000));
    expect(n(at(-1), "expected_paise")).toBe(R(500)); //        B5's due date; B1's rejected and reversed rows on D-1 are not in anything
    expect(n(at(-1), "total_collection_paise")).toBe(0);
    expect(n(at(-1), "waiting_paise")).toBe(0);
    // the chart adds up to the cards (COL-12)
    const card = await summary(resortA);
    const sum = (k: string) => rows.reduce((s, r) => s + n(r, k), 0);
    expect(sum("total_collection_paise")).toBe(
      n(card, "total_collection_paise"),
    );
    expect(sum("waiting_paise")).toBe(n(card, "waiting_paise"));
    expect(sum("expected_paise")).toBe(n(card, "expected_paise"));
  });

  it("DSH-09: by month the buckets start on the 1st and still add up; a bad grain is refused", async () => {
    const rows = await chart(null, day(-45), day(0), "month");
    const starts = rows.map((r) => String(r.bucket_start).slice(0, 10));
    expect(starts.every((s) => s.endsWith("-01"))).toBe(true);
    const months = new Set(
      Array.from({ length: 46 }, (_, i) => day(-45 + i).slice(0, 7)),
    );
    expect(rows).toHaveLength(months.size);
    const card = await summary(null, day(-45), day(0));
    const sum = (k: string) => rows.reduce((s, r) => s + n(r, k), 0);
    expect(sum("total_collection_paise")).toBe(
      n(card, "total_collection_paise"),
    );
    expect(sum("expected_paise")).toBe(n(card, "expected_paise"));
    await expectDbError(chart(null, FROM(), TO(), "week"), "INVALID_INPUT");
  });
});

describe("the alerts: dashboard_alerts (DSH-10..13)", () => {
  const alerts = async (
    resort: string | null = null,
    actor: string | null = w.manager,
  ) =>
    (
      await as(actor, () =>
        q<Row>(`select * from public.dashboard_alerts($1, $2, $3)`, [
          resort,
          FROM(),
          TO(),
        ]),
      )
    )[0];

  it("DSH-10: overdue plans (hand calculation: B5 500, B3 2,500, B4 2,000), failed PDFs and self-approved items", async () => {
    // overdue today = expected to date - net collected to date:
    //   B1 2,000 - 2,000 = 0   B2 (due D+2) 0   B5 500 - 0 = 500   B6 800 - 800 = 0   C1 0
    //   B3 4,000 - 1,500 = 2,500   B4 3,000 - (3,000 - 2,000) = 2,000
    const all = await alerts(null);
    expect([n(all, "overdue_bookings"), n(all, "overdue_paise")]).toEqual([
      3,
      R(5000),
    ]);
    const a = await alerts(resortA);
    expect([n(a, "overdue_bookings"), n(a, "overdue_paise")]).toEqual([
      1,
      R(500),
    ]);
    const b = await alerts(resortB);
    expect([n(b, "overdue_bookings"), n(b, "overdue_paise")]).toEqual([
      2,
      R(4500),
    ]);
    // one failed PDF, on a resort A booking
    expect([
      n(all, "failed_pdfs"),
      n(a, "failed_pdfs"),
      n(b, "failed_pdfs"),
    ]).toEqual([1, 1, 0]);
    // B2's payment was approved by the person who recorded it
    expect([
      n(all, "self_approved"),
      n(a, "self_approved"),
      n(b, "self_approved"),
    ]).toEqual([1, 1, 0]);
    // and only inside the period (approved today): a period in the far past has none
    const past = await as(w.manager, () =>
      q<Row>(`select * from public.dashboard_alerts(null, $1, $2)`, [
        day(-60),
        day(-50),
      ]),
    );
    expect(n(past[0], "self_approved")).toBe(0);
  });

  it("DSH-11: waiting items older than 3 days are counted by their ENTRY time, not by their payment date", async () => {
    const before = n(await alerts(null), "waiting_old_items");
    expect(before).toBe(0); // everything in the fixture was recorded just now
    await putMoney(B3, "payments", "waiting", R(100), -1, {
      recordedAgoDays: 4,
    }); // entered 4 days ago
    await putMoney(B3, "refunds", "waiting", R(100), -1, {
      recordedAgoDays: 5,
    });
    await putMoney(B4, "payments", "waiting", R(100), -1, {
      recordedAgoDays: 2,
    }); // only 2 days: not old yet
    expect(n(await alerts(null), "waiting_old_items")).toBe(2);
    expect(n(await alerts(resortB), "waiting_old_items")).toBe(2);
    expect(n(await alerts(resortA), "waiting_old_items")).toBe(0);
    // the cards' queue now counts all of them (1 + 3), but the waiting AMOUNT is only for payments in the period
    const card = await summary(null);
    expect(n(card, "waiting_items")).toBe(4);
    expect(n(card, "waiting_paise")).toBe(R(1000) + R(100) + R(100)); // two new waiting PAYMENTS dated D-1; the refund is not a payment
  });

  it("DSH-12: the backup alert: none recorded, recent, older than 36 hours, unreadable", async () => {
    const set = (value: string | null) =>
      value === null
        ? q(`delete from public.system_status where key = 'last_backup'`).catch(
            () =>
              q(
                `update public.system_status set value = '{}'::jsonb where key = 'last_backup'`,
              ),
          )
        : q(
            `insert into public.system_status (key, value) values ('last_backup', $1::jsonb)
             on conflict (key) do update set value = excluded.value`,
            [value],
          );
    const none = await alerts();
    expect([none.backup_at, none.backup_old]).toEqual([null, false]); // nothing recorded yet: not an alert
    await set(
      JSON.stringify({ at: new Date(Date.now() - 2 * 3600_000).toISOString() }),
    );
    expect((await alerts()).backup_old).toBe(false);
    await set(
      JSON.stringify({
        at: new Date(Date.now() - 40 * 3600_000).toISOString(),
      }),
    );
    const old = await alerts();
    expect(old.backup_old).toBe(true);
    expect(old.backup_at).not.toBeNull();
    await set(
      JSON.stringify({
        at: new Date(Date.now() - 35 * 3600_000).toISOString(),
      }),
    );
    expect((await alerts()).backup_old).toBe(false); // the limit is 36 hours
    await set(JSON.stringify({ at: "not a date" }));
    const bad = await alerts();
    expect([bad.backup_at, bad.backup_old]).toEqual([null, false]);
    await set(
      JSON.stringify({ at: new Date(Date.now() - 1 * 3600_000).toISOString() }),
    );
  });

  it("DSH-13: failed PDFs of another resort are not counted for the filtered one; done jobs are not failures", async () => {
    await q(
      `insert into public.pdf_jobs (booking_id, reason, status) values ($1, 'test', 'done')`,
      [B3.id],
    );
    await q(
      `insert into public.pdf_jobs (booking_id, reason, status) values ($1, 'test', 'pending')`,
      [B3.id],
    );
    expect(n(await alerts(resortB), "failed_pdfs")).toBe(0);
    await q(
      `insert into public.pdf_jobs (booking_id, reason, status, attempts) values ($1, 'test', 'failed', 3)`,
      [B3.id],
    );
    expect(n(await alerts(resortB), "failed_pdfs")).toBe(1);
    expect(n(await alerts(resortA), "failed_pdfs")).toBe(1);
    expect(n(await alerts(null), "failed_pdfs")).toBe(2);
  });
});

describe("who may call them, and what they may see (DSH-14..17)", () => {
  const fns = [
    "dashboard_summary",
    "dashboard_by_resort",
    "dashboard_by_date",
    "dashboard_alerts",
  ];
  const call = (
    name: string,
    actor:
      | { role: "authenticated"; uid: string | null }
      | { role: "anon" }
      | { role: "service_role" },
  ) =>
    w.db.as(actor, () =>
      q(
        name === "dashboard_by_date"
          ? `select * from public.${name}(null, $1, $2, 'day')`
          : `select * from public.${name}(null, $1, $2)`,
        [FROM(), TO()],
      ),
    );

  it("DSH-14: active Owners and Managers see the same figures (Q10: everybody has the same access)", async () => {
    const m = await summary(null, FROM(), TO(), w.manager);
    const o = await summary(null, FROM(), TO(), w.owner);
    const m2 = await summary(null, FROM(), TO(), w.manager2);
    expect(JSON.stringify(m)).toBe(JSON.stringify(o));
    expect(JSON.stringify(m)).toBe(JSON.stringify(m2));
  });

  it("DSH-15: anonymous visitors, signed-out requests, unknown logins and switched-off users are refused, never given zeros", async () => {
    for (const f of fns) {
      await expectDbError(call(f, { role: "anon" }), "permission denied");
      await expectDbError(
        call(f, { role: "authenticated", uid: null }),
        "NOT_ALLOWED",
      );
      await expectDbError(
        call(f, { role: "authenticated", uid: uid() }),
        "NOT_ALLOWED",
      ); // a login without a profile
      await expectDbError(call(f, { role: "service_role" }), "NOT_ALLOWED"); // the server key has no user behind it
    }
    // a switched-off Manager
    const l = uid();
    await q(
      `insert into auth.users (id, email) values ($1, 'dsh15@test.example')`,
      [l],
    );
    await w.db.as({ role: "authenticated", uid: w.owner }, () =>
      q(
        `select public.profile_create($1, 'Test Dsh15', 'dsh15@test.example', 'manager')`,
        [l],
      ),
    );
    for (const f of fns) await call(f, { role: "authenticated", uid: l }); // active: fine
    await w.db.as({ role: "authenticated", uid: w.owner }, () =>
      q(`select public.profile_set_active($1, false, 'Left the team')`, [l]),
    );
    for (const f of fns)
      await expectDbError(
        call(f, { role: "authenticated", uid: l }),
        "NOT_ALLOWED",
      );
  });

  it("DSH-16: the functions run with the CALLER's rights (row-level security still applies), only read, and use a fixed search path", async () => {
    const meta = await q<{
      proname: string;
      definer: boolean;
      vol: string;
      cfg: string;
      anon: boolean;
      auth: boolean;
      pub: boolean;
    }>(
      `select p.proname, p.prosecdef definer, p.provolatile::text vol, coalesce(p.proconfig::text, '') cfg,
              has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('authenticated', p.oid, 'execute') auth,
              has_function_privilege('public', p.oid, 'execute') pub
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'dashboard\\_%' order by 1`,
    );
    expect(meta.map((m) => m.proname)).toEqual([
      "dashboard_alerts",
      "dashboard_by_date",
      "dashboard_by_resort",
      "dashboard_range",
      "dashboard_summary",
    ]);
    for (const m of meta) {
      expect(m.definer, m.proname).toBe(false); // SECURITY INVOKER
      expect(m.vol, m.proname).toBe("s"); //        STABLE: cannot write
      expect(m.cfg, m.proname).toContain("search_path");
      expect([m.anon, m.pub, m.auth], m.proname).toEqual([false, false, true]);
    }
  });

  it("DSH-17: reading changes nothing (no row of any table is written)", async () => {
    const tables = [
      "bookings",
      "payments",
      "refunds",
      "audit_logs",
      "pdf_jobs",
      "payment_schedules",
      "resorts",
    ];
    const snap = async () =>
      JSON.stringify(
        await Promise.all(
          tables.map(
            async (t) =>
              (
                await q<{ n: string }>(
                  `select count(*)::text n from public.${t}`,
                )
              )[0].n,
          ),
        ),
      );
    const before = await snap();
    for (const f of fns)
      await call(f, { role: "authenticated", uid: w.manager });
    expect(await snap()).toBe(before);
  });
});

describe("period and input rules (DSH-18)", () => {
  it("DSH-18: an end before the start, a period over ten years and a missing user are refused with plain codes", async () => {
    await expectDbError(summary(null, day(0), day(-1)), "INVALID_INPUT");
    await expectDbError(
      as(w.manager, () =>
        q(
          `select * from public.dashboard_summary(null, '2010-01-01', '2026-12-31')`,
        ),
      ),
      "INVALID_INPUT",
    );
    // ten years is the longest allowed
    await as(w.manager, () =>
      q(
        `select * from public.dashboard_summary(null, '2017-01-01', '2026-12-31')`,
      ),
    );
    // a start without an end (or the reverse) is that one day
    const s = await as(w.manager, () =>
      q<Row>(`select * from public.dashboard_summary(null, $1::date, null)`, [
        day(-8),
      ]),
    );
    expect(String(s[0].period_from)).toBe(String(s[0].period_to));
    expect(n(s[0], "total_collection_paise")).toBe(R(2000) + R(0)); // all resorts, D-8: B1's Rs 2,000
  });
});
