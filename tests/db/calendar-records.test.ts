/**
 * Calendar, old records and activity functions (migration 24; PRD FR-CAL-1..5, FR-AUD-3; UI spec 3.11, 3.14, 3.15).
 * CAL-01.. All data is fictional and every expected figure is written down by hand below. The functions must give
 * exactly those figures, the same figures as independent plain SQL over the raw tables, use IST calendar dates (not
 * UTC), never count cancelled or no-show bookings as arriving/leaving/staying, never count waiting, rejected or
 * reversed money as collected, work for any year from 2020 to 2035, and refuse everybody who is not an active user.
 *
 * Bookings and money are written with the guard triggers switched off (as dashboard.test.ts does) so exact dates and
 * statuses can be built; the guards themselves are tested elsewhere. March 2026 is a fixed month in the past.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { expectDbError } from "./harness";
import { createBooking, setupWorld, uid, type World } from "./fixtures";

let w: World;
const R = (rupees: number) => rupees * 100;
type Row = Record<string, unknown>;
const q = <T = Row>(sql: string, p?: unknown[]) => w.db.q<T>(sql, p);
const as = <T>(id: string | null, fn: () => Promise<T>) =>
  w.db.as({ role: "authenticated", uid: id }, fn);
const asUser = <T = Row>(sql: string, p: unknown[] = [], who = w.manager) =>
  as(who, () => q<T>(sql, p));
let resortA: string, resortB: string;
let seq = 0;

async function raw<T>(fn: () => Promise<T>): Promise<T> {
  await w.db.exec("set session_replication_role = replica");
  try {
    return await fn();
  } finally {
    await w.db.exec("set session_replication_role = origin");
  }
}

interface BK {
  id: string;
  code: string;
  resort: string;
}
/** a booking at exact IST wall-clock times (ISO local "2026-03-10T14:00") */
async function booking(
  resort: "A" | "B",
  inLocal: string,
  outLocal: string,
  o: {
    status?: string;
    pax?: number;
    tariff?: number;
    bookingDate?: string;
    createdAt?: string;
    name?: string;
    mobile?: string;
    plan?: { label: string; due: string; amount: number }[];
    adjustment?: { date: string; amount: number; reason: string };
  } = {},
): Promise<BK> {
  const id = uid();
  const rid = resort === "A" ? resortA : resortB;
  const n = 500000 + ++seq;
  const code = `CAL-${(o.bookingDate ?? inLocal).slice(0, 4)}-${String(n).padStart(6, "0")}`;
  const pax = o.pax ?? 2;
  const tariff = o.tariff ?? R(2500);
  const base = pax * tariff;
  const inDate = inLocal.slice(0, 10);
  const nights = Math.max(
    1,
    Math.round(
      (Date.UTC(
        +outLocal.slice(0, 4),
        +outLocal.slice(5, 7) - 1,
        +outLocal.slice(8, 10),
      ) -
        Date.UTC(
          +inDate.slice(0, 4),
          +inDate.slice(5, 7) - 1,
          +inDate.slice(8, 10),
        )) /
        86_400_000,
    ),
  );
  await raw(async () => {
    await q(
      `insert into public.bookings
         (id, booking_code, resort_id, booking_year, booking_seq, guest_id, guest_name, guest_mobile, pax,
          co_category_id, co_category_name, co_mode, stay_type_id, stay_type_name, booking_date, check_in_at, check_out_at, nights,
          pricing_method, tariff_per_person_paise, base_amount_paise, idempotency_key, status, created_at)
       values ($1,$2,$3,extract(year from $11::date)::int,$4,$5,$6,$7,$8,$9,'Direct','none',$10,'Resort Stay',$11::date,
               ($12::text || ':00+05:30')::timestamptz, ($13::text || ':00+05:30')::timestamptz, $14,
               'per_person_per_stay', $15, $16, $17, $18::public.booking_status, $19::timestamptz)`,
      [
        id,
        code,
        rid,
        n,
        w.guestId,
        o.name ?? "Test Guest",
        o.mobile ?? "9876543210",
        pax,
        w.cat.direct,
        w.stayTypeId,
        o.bookingDate ?? inDate,
        inLocal.replace("T", " "),
        outLocal.replace("T", " "),
        nights,
        tariff,
        base,
        uid(),
        "confirmed",
        o.createdAt ?? `${o.bookingDate ?? inDate} 10:00:00+05:30`,
      ],
    );
    if (o.status && o.status !== "confirmed")
      await q(
        `update public.bookings set status = $2::public.booking_status, cancellation_reason = 'Guest unwell',
                cancellation_date = booking_date, cancellation_charge_paise = final_amount_paise, cancelled_at = now(), cancelled_by = $3
          where id = $1`,
        [id, o.status, w.owner],
      );
    const rev = uid();
    await q(
      `insert into public.payment_plan_revisions (id, booking_id, revision_no, source, amount_due_before, amount_due_after, locked_total_paise)
       values ($1, $2, 1, 'created', null, $3, 0)`,
      [rev, id, base],
    );
    let line = 1;
    for (const p of o.plan ?? []) {
      await q(
        `insert into public.payment_schedules (booking_id, revision_id, line_no, label, due_date, amount_paise)
         values ($1, $2, $3, $4, $5::date, $6)`,
        [id, rev, line++, p.label, p.due, p.amount],
      );
    }
    if (o.adjustment) {
      await q(
        `insert into public.expected_adjustments (booking_id, resort_id, adjustment_date, amount_paise, reason, revision_id, created_by, source)
         values ($1, $2, $3::date, $4, $5, $6, $7, 'cancellation')`,
        [
          id,
          rid,
          o.adjustment.date,
          o.adjustment.amount,
          o.adjustment.reason,
          rev,
          w.owner,
        ],
      );
    }
  });
  return { id, code, resort: rid };
}

type Status = "waiting" | "approved" | "rejected" | "reversed";
async function money(
  b: BK,
  kind: "payments" | "refunds",
  status: Status,
  amount: number,
  date: string,
  o: { recordedAt?: string; providerId?: number | null } = {},
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
  const vals = [
    `'${id}'`,
    `'${b.code}-${isPay ? "P" : "R"}-${id.slice(0, 6)}'`,
    `'${b.id}'`,
    `'${b.resort}'`,
    String(amount),
    "'cash'",
    `'${date}'::date`,
    `'${status}'`,
    `'${w.manager}'`,
    `'${o.recordedAt ?? `${date} 12:00:00+05:30`}'::timestamptz`,
    `'${uid()}'`,
  ];
  const add = (c: string, v: string) => (cols.push(c), vals.push(v));
  if (!isPay) add("reason", "'Guest left early'");
  if (status === "approved" || status === "reversed") {
    add("approved_by", `'${w.owner}'`);
    add("approved_at", "now()");
  }
  if (status === "rejected") {
    add("rejected_by", `'${w.owner}'`);
    add("rejected_at", "now()");
    add("rejection_reason", "'wrong booking'");
  }
  if (status === "reversed") {
    add("reversed_by", `'${w.owner}'`);
    add("reversed_at", "now()");
    add("reversal_reason", "'entered twice'");
  }
  await raw(() =>
    q(
      `insert into public.${kind} (${cols.join(",")}) values (${vals.join(",")})`,
    ),
  );
  return id;
}

let K1: BK, K2: BK, K3: BK, K3n: BK, K5: BK, K6: BK, K7: BK;
let P1: string;

beforeAll(async () => {
  w = await setupWorld();
  resortA = w.resorts.A.id;
  resortB = w.resorts.B.id;

  // ---- March 2026 (31 days), resort A unless stated ---------------------------------------------------------------
  // K1: check-in 10 Mar 14:00, out 12 Mar 11:00 (2 nights), Rs 5,000. Plan: Advance Rs 2,000 due 5 Mar, Balance Rs 3,000
  //     due 12 Mar; an adjustment of -Rs 500 dated 12 Mar ("Guest request").
  K1 = await booking("A", "2026-03-10T14:00", "2026-03-12T11:00", {
    plan: [
      { label: "Advance", due: "2026-03-05", amount: R(2000) },
      { label: "Balance", due: "2026-03-12", amount: R(3000) },
    ],
    adjustment: {
      date: "2026-03-12",
      amount: -R(500),
      reason: "Guest request",
    },
    name: "Asha Rao",
    mobile: "9811100001",
  });
  // K2: IST boundary: in 31 Mar 23:30 IST (= 18:00 UTC on 31 Mar), out 2 Apr 00:30 IST (= 19:00 UTC on 1 APRIL)
  K2 = await booking("A", "2026-03-31T23:30", "2026-04-02T00:30", {
    plan: [{ label: "Balance", due: "2026-04-02", amount: R(5000) }],
    name: "Night Owl",
  });
  // K3: cancelled, would have arrived 10 Mar (resort B); K3n: no-show 10 Mar. Neither may ever be shown as a guest.
  K3 = await booking("B", "2026-03-10T14:00", "2026-03-11T11:00", {
    status: "cancelled",
    plan: [{ label: "Balance", due: "2026-03-10", amount: R(1000) }],
  });
  K3n = await booking("B", "2026-03-10T15:00", "2026-03-11T11:00", {
    status: "no_show",
  });
  // K4: in 27 Feb, out 3 Mar: staying 1 and 2 March, leaves on the 3rd; arrival is not in March
  await booking("A", "2026-02-27T14:00", "2026-03-03T11:00");
  // K5: resort B, in 10 Mar 18:00, out 11 Mar 11:00, Rs 5,000; plan Rs 2,500 due 10 Mar
  K5 = await booking("B", "2026-03-10T18:00", "2026-03-11T11:00", {
    plan: [{ label: "Advance", due: "2026-03-10", amount: R(2500) }],
  });

  // ---- other years ------------------------------------------------------------------------------------------------
  K6 = await booking("A", "2020-01-15T14:00", "2020-01-16T11:00");
  K7 = await booking("B", "2035-12-31T22:00", "2036-01-02T11:00");

  // ---- money (payments for K1 unless stated) ----------------------------------------------------------------------
  P1 = await money(K1, "payments", "approved", R(2000), "2026-03-10"); // collected 10 Mar
  await money(K1, "payments", "waiting", R(1500), "2026-03-10"); // waiting 10 Mar (never collected)
  await money(K1, "payments", "rejected", R(700), "2026-03-10"); // never counted
  // P4: dated 11 Mar but typed in on 20 Mar: BACKDATED
  await money(K1, "payments", "approved", R(1000), "2026-03-11", {
    recordedAt: "2026-03-20 09:00:00+05:30",
  });
  await money(K5, "payments", "reversed", R(900), "2026-03-10"); // never counted
  await money(K5, "payments", "approved", R(2500), "2026-03-10"); // resort B collected 10 Mar
  await money(K1, "refunds", "approved", R(500), "2026-03-11");
  await money(K1, "refunds", "waiting", R(300), "2026-03-11"); // waiting refund: not counted
  // a payment on a day outside every test month, to prove the month filter
  await money(K6, "payments", "approved", R(100), "2020-01-15");
}, 180_000);

const month = (
  y: number,
  m: number,
  resort: string | null = null,
  who = w?.manager,
) =>
  asUser<{
    day_date: string;
    check_ins: number;
    check_outs: number;
    staying: number;
    due_paise: string;
    collected_paise: string;
    waiting_paise: string;
    refunds_paise: string;
  }>(
    `select day_date::text, check_ins, check_outs, staying, due_paise::text, collected_paise::text, waiting_paise::text, refunds_paise::text from public.calendar_month($1, $2, $3)`,
    [y, m, resort],
    who,
  );
const dayRows = (d: string, resort: string | null = null, who = w?.manager) =>
  asUser<Row>(
    `select kind, booking_code, resort_id, guest_name, booking_status, record_code, amount_paise::text amount, record_status, method, label, record_date::text rdate, entered_on::text edate, backdated, pending_paise::text pending, kind_total::text total from public.calendar_day($1::date, $2)`,
    [d, resort],
    who,
  );
const byDay = (rows: Awaited<ReturnType<typeof month>>, d: string) =>
  rows.find((r) => r.day_date === d)!;

describe("calendar_month: one row per day (CAL-01..)", () => {
  it("CAL-01: every day of the month, in order, with the right length (28, 29, 30, 31 days, leap years)", async () => {
    expect((await month(2026, 3)).map((r) => r.day_date)[0]).toBe("2026-03-01");
    expect((await month(2026, 3)).length).toBe(31);
    expect((await month(2026, 4)).length).toBe(30);
    expect((await month(2026, 2)).length).toBe(28);
    expect((await month(2024, 2)).length).toBe(29); // leap year
    expect((await month(2100, 2)).length).toBe(28); // 2100 is not a leap year
    expect((await month(2028, 2)).at(-1)!.day_date).toBe("2028-02-29");
    const days = (await month(2026, 12)).map((r) => r.day_date);
    expect(days).toEqual([...days].sort());
    expect(days.at(-1)).toBe("2026-12-31");
  });

  it("CAL-02: check-ins, check-outs and staying (all resorts): hand-counted for 10 to 13 March", async () => {
    const m = await month(2026, 3);
    // 10 Mar: K1 and K5 arrive; K3 (cancelled) and K3n (no-show) do not count. Staying overnight on the 10th: K1, K5.
    expect(byDay(m, "2026-03-10")).toMatchObject({
      check_ins: 2,
      check_outs: 0,
      staying: 2,
    });
    // 11 Mar: K5 leaves; K1 still stays
    expect(byDay(m, "2026-03-11")).toMatchObject({
      check_ins: 0,
      check_outs: 1,
      staying: 1,
    });
    // 12 Mar: K1 leaves; nobody stays overnight
    expect(byDay(m, "2026-03-12")).toMatchObject({
      check_ins: 0,
      check_outs: 1,
      staying: 0,
    });
    expect(byDay(m, "2026-03-13")).toMatchObject({
      check_ins: 0,
      check_outs: 0,
      staying: 0,
    });
  });

  it("CAL-03: a stay that began in February is staying on 1 and 2 March and leaves on the 3rd; it is not a March arrival", async () => {
    const m = await month(2026, 3);
    expect(byDay(m, "2026-03-01")).toMatchObject({
      check_ins: 0,
      check_outs: 0,
      staying: 1,
    });
    expect(byDay(m, "2026-03-02")).toMatchObject({
      check_ins: 0,
      check_outs: 0,
      staying: 1,
    });
    expect(byDay(m, "2026-03-03")).toMatchObject({
      check_ins: 0,
      check_outs: 1,
      staying: 0,
    });
  });

  it("CAL-04: IST, not UTC: 23:30 IST on 31 Mar arrives on 31 Mar; 00:30 IST on 2 Apr leaves on 2 Apr (it is still 1 Apr in UTC)", async () => {
    const mar = await month(2026, 3);
    expect(byDay(mar, "2026-03-31")).toMatchObject({
      check_ins: 1,
      staying: 1,
    });
    const apr = await month(2026, 4);
    expect(byDay(apr, "2026-04-01")).toMatchObject({
      check_ins: 0,
      check_outs: 0,
      staying: 1,
    }); // the guest sleeps here
    expect(byDay(apr, "2026-04-02")).toMatchObject({
      check_ins: 0,
      check_outs: 1,
      staying: 0,
    }); // NOT on 1 April
  });

  it("CAL-05: the resort filter: resort A and resort B see only their own guests and money; the two add up to all resorts", async () => {
    const all = await month(2026, 3);
    const a = await month(2026, 3, resortA);
    const b = await month(2026, 3, resortB);
    expect(byDay(a, "2026-03-10")).toMatchObject({ check_ins: 1, staying: 1 });
    expect(byDay(b, "2026-03-10")).toMatchObject({ check_ins: 1, staying: 1 });
    for (let i = 0; i < 31; i++) {
      for (const k of ["check_ins", "check_outs", "staying"] as const)
        expect(all[i][k]).toBe(a[i][k] + b[i][k]);
      for (const k of [
        "due_paise",
        "collected_paise",
        "waiting_paise",
        "refunds_paise",
      ] as const)
        expect(BigInt(all[i][k])).toBe(BigInt(a[i][k]) + BigInt(b[i][k]));
    }
  });

  it("CAL-06: money per day, by hand: collected = approved payments only; waiting separate; rejected/reversed never; refunds approved only", async () => {
    const a = await month(2026, 3, resortA);
    const b = await month(2026, 3, resortB);
    // resort A, 10 Mar: P1 approved 2,000 collected; P2 waiting 1,500 shown apart; P3 rejected 700 ignored
    expect(byDay(a, "2026-03-10")).toMatchObject({
      collected_paise: String(R(2000)),
      waiting_paise: String(R(1500)),
    });
    // 11 Mar: P4 approved 1,000 (by its payment date, although typed in on 20 Mar); refund X1 approved 500; X2 waiting 300 ignored
    expect(byDay(a, "2026-03-11")).toMatchObject({
      collected_paise: String(R(1000)),
      refunds_paise: String(R(500)),
      waiting_paise: "0",
    });
    expect(byDay(a, "2026-03-20")).toMatchObject({ collected_paise: "0" }); // NOT the day it was typed in
    // resort B, 10 Mar: approved 2,500; the reversed 900 is ignored
    expect(byDay(b, "2026-03-10")).toMatchObject({
      collected_paise: String(R(2500)),
      waiting_paise: "0",
    });
  });

  it("CAL-07: 'due' is the expected entries of the day: plan rows plus dated adjustments, also for a cancelled booking (as the dashboard)", async () => {
    const a = await month(2026, 3, resortA);
    const b = await month(2026, 3, resortB);
    expect(byDay(a, "2026-03-05").due_paise).toBe(String(R(2000))); // K1 Advance
    expect(byDay(a, "2026-03-12").due_paise).toBe(String(R(3000) - R(500))); // K1 Balance 3,000 + adjustment -500
    expect(byDay(b, "2026-03-10").due_paise).toBe(String(R(2500) + R(1000))); // K5 Advance + K3 (cancelled) row
    expect(byDay(a, "2026-03-31").due_paise).toBe("0");
  });

  it("CAL-08: the month agrees with independent SQL over the raw tables, for every day and both resort filters (financial consistency)", async () => {
    for (const resort of [null, resortA, resortB]) {
      const rows = await month(2026, 3, resort);
      const oracle = await q<Row>(
        `select d::date::text as day,
           (select count(*) from public.bookings b where b.status not in ('cancelled','no_show') and ($1::uuid is null or b.resort_id = $1)
              and (b.check_in_at at time zone 'Asia/Kolkata')::date = d::date)::int ci,
           (select count(*) from public.bookings b where b.status not in ('cancelled','no_show') and ($1::uuid is null or b.resort_id = $1)
              and (b.check_out_at at time zone 'Asia/Kolkata')::date = d::date)::int co,
           (select count(*) from public.bookings b where b.status not in ('cancelled','no_show') and ($1::uuid is null or b.resort_id = $1)
              and (b.check_in_at at time zone 'Asia/Kolkata')::date <= d::date and (b.check_out_at at time zone 'Asia/Kolkata')::date > d::date)::int st,
           (select coalesce(sum(amount_paise),0) from (
               select s.amount_paise from public.payment_schedules s join public.bookings b on b.id = s.booking_id
                where s.superseded_at is null and s.due_date = d::date and ($1::uuid is null or b.resort_id = $1)
               union all
               select a.amount_paise from public.expected_adjustments a where a.adjustment_date = d::date and ($1::uuid is null or a.resort_id = $1)) z)::text due,
           (select coalesce(sum(p.amount_paise),0) from public.payments p where p.status = 'approved' and p.payment_date = d::date and ($1::uuid is null or p.resort_id = $1))::text col,
           (select coalesce(sum(p.amount_paise),0) from public.payments p where p.status = 'waiting' and p.payment_date = d::date and ($1::uuid is null or p.resort_id = $1))::text wai,
           (select coalesce(sum(r.amount_paise),0) from public.refunds r where r.status = 'approved' and r.refund_date = d::date and ($1::uuid is null or r.resort_id = $1))::text ref
         from generate_series('2026-03-01'::date, '2026-03-31'::date, interval '1 day') d order by 1`,
        [resort],
      );
      expect(
        rows.map((r) => ({
          day: r.day_date,
          ci: r.check_ins,
          co: r.check_outs,
          st: r.staying,
          due: r.due_paise,
          col: r.collected_paise,
          wai: r.waiting_paise,
          ref: r.refunds_paise,
        })),
      ).toEqual(oracle);
    }
  });

  it("CAL-09: the month totals agree with the dashboard's own figures for the same month (the same rules)", async () => {
    const rows = await month(2026, 3);
    const sum = (
      k: "due_paise" | "collected_paise" | "waiting_paise" | "refunds_paise",
    ) => rows.reduce((a, r) => a + BigInt(r[k]), BigInt(0));
    const [d] = await asUser<Row>(
      `select expected_paise::text e, total_collection_paise::text c, waiting_paise::text w, refunds_paise::text r from public.dashboard_summary(null, '2026-03-01', '2026-03-31')`,
    );
    expect(String(sum("due_paise"))).toBe(d.e);
    expect(String(sum("collected_paise"))).toBe(d.c);
    expect(String(sum("waiting_paise"))).toBe(d.w);
    expect(String(sum("refunds_paise"))).toBe(d.r);
  });

  it("CAL-10: any year from 2020 to 2035 works (no limit on looking back or ahead)", async () => {
    expect(byDay(await month(2020, 1), "2020-01-15")).toMatchObject({
      check_ins: 1,
      collected_paise: String(R(100)),
    });
    const dec = await month(2035, 12, resortB);
    expect(byDay(dec, "2035-12-31")).toMatchObject({
      check_ins: 1,
      staying: 1,
    });
    const jan = await month(2036, 1, resortB);
    expect(byDay(jan, "2036-01-01")).toMatchObject({
      staying: 1,
      check_outs: 0,
    });
    expect(byDay(jan, "2036-01-02")).toMatchObject({
      check_outs: 1,
      staying: 0,
    });
    for (let y = 2020; y <= 2035; y++)
      expect((await month(y, 6)).length).toBe(30);
    expect((await month(1990, 1)).length).toBe(31);
    expect((await month(2100, 12)).length).toBe(31);
  });

  it("CAL-11: an empty month is 'all zero', not an error", async () => {
    const m = await month(2031, 7);
    expect(m.length).toBe(31);
    expect(
      m.every(
        (r) =>
          r.check_ins === 0 &&
          r.check_outs === 0 &&
          r.staying === 0 &&
          r.due_paise === "0" &&
          r.collected_paise === "0",
      ),
    ).toBe(true);
  });

  it("CAL-12: bad input is refused with a plain message: month 0 or 13, year before 1990 or after 2100, nulls", async () => {
    for (const [y, mo] of [
      [2026, 0],
      [2026, 13],
      [1989, 12],
      [2101, 1],
      [null, 5],
      [2026, null],
    ] as const)
      await expectDbError(month(y as number, mo as number), "INVALID_INPUT");
  });
});

describe("calendar_day: the lists of one day (CAL-13..)", () => {
  it("CAL-13: 10 March, all resorts: who arrives, in what order; cancelled and no-show never appear in any guest list", async () => {
    const rows = await dayRows("2026-03-10");
    const arrivals = rows.filter((r) => r.kind === "check_in");
    expect(arrivals.map((r) => r.booking_code)).toEqual([K1.code, K5.code]); // 14:00 then 18:00
    expect(arrivals[0]).toMatchObject({
      guest_name: "Asha Rao",
      booking_status: "confirmed",
      total: "2",
    });
    expect(
      rows
        .filter((r) => r.kind === "staying")
        .map((r) => r.booking_code)
        .sort(),
    ).toEqual([K1.code, K5.code].sort());
    const codes = new Set(
      rows
        .filter((r) =>
          ["check_in", "check_out", "staying"].includes(r.kind as string),
        )
        .map((r) => r.booking_code),
    );
    expect(codes.has(K3.code)).toBe(false);
    expect(codes.has(K3n.code)).toBe(false);
  });

  it("CAL-14: departures and the in-house list on 11 and 12 March", async () => {
    const d11 = await dayRows("2026-03-11");
    expect(
      d11.filter((r) => r.kind === "check_out").map((r) => r.booking_code),
    ).toEqual([K5.code]);
    expect(
      d11.filter((r) => r.kind === "staying").map((r) => r.booking_code),
    ).toEqual([K1.code]);
    const d12 = await dayRows("2026-03-12");
    expect(
      d12.filter((r) => r.kind === "check_out").map((r) => r.booking_code),
    ).toEqual([K1.code]);
    expect(d12.filter((r) => r.kind === "staying")).toEqual([]);
  });

  it("CAL-15: the payments of 10 March: every status is listed with its status; the amounts are the stored amounts", async () => {
    const pays = (await dayRows("2026-03-10")).filter(
      (r) => r.kind === "payment",
    );
    expect(
      pays.map((r) => [r.record_status, r.amount].join(":")).sort(),
    ).toEqual(
      [
        `approved:${R(2000)}`,
        `approved:${R(2500)}`,
        `reversed:${R(900)}`,
        `rejected:${R(700)}`,
        `waiting:${R(1500)}`,
      ].sort(),
    );
    expect(pays[0].total).toBe("5");
    expect(pays.every((r) => typeof r.record_code === "string")).toBe(true);
  });

  it("CAL-16: a backdated payment is marked, with both dates: dated 11 Mar, typed in on 20 Mar", async () => {
    const p4 = (await dayRows("2026-03-11")).find((r) => r.kind === "payment")!;
    expect(p4).toMatchObject({
      backdated: true,
      rdate: "2026-03-11",
      edate: "2026-03-20",
      amount: String(R(1000)),
    });
    const p1 = (await dayRows("2026-03-10")).find(
      (r) => r.kind === "payment" && r.amount === String(R(2000)),
    )!;
    expect(p1).toMatchObject({
      backdated: false,
      rdate: "2026-03-10",
      edate: "2026-03-10",
    });
  });

  it("CAL-17: refunds of 11 March with their status; the waiting one is listed, not counted anywhere", async () => {
    const refs = (await dayRows("2026-03-11")).filter(
      (r) => r.kind === "refund",
    );
    expect(refs.map((r) => `${r.record_status}:${r.amount}`).sort()).toEqual(
      [`approved:${R(500)}`, `waiting:${R(300)}`].sort(),
    );
  });

  it("CAL-18: payments due on 12 March: the plan row and the adjustment, each with its label", async () => {
    const due = (await dayRows("2026-03-12")).filter((r) => r.kind === "due");
    expect(
      due.map((r) => [r.method, r.label, r.amount].join("|")).sort(),
    ).toEqual(
      [`plan|Balance|${R(3000)}`, `adjustment|Guest request|${-R(500)}`].sort(),
    );
    const d10 = (await dayRows("2026-03-10")).filter((r) => r.kind === "due");
    expect(d10.map((r) => r.booking_code).sort()).toEqual(
      [K3.code, K5.code].sort(),
    );
  });

  it("CAL-19: the pending amount on a row is the booking's own figure from booking_financials (rule D1), not a new calculation", async () => {
    const rows = await dayRows("2026-03-10");
    for (const r of rows.filter((x) => x.kind === "check_in")) {
      const [f] = await q<{ pending_paise: string }>(
        `select pending_paise::text from public.booking_financials where booking_id = (select id from public.bookings where booking_code = $1)`,
        [r.booking_code],
      );
      expect(r.pending).toBe(f.pending_paise);
    }
    // K1: Rs 5,000 due, approved 2,000 + 1,000, waiting 1,500, refund approved 500 -> pending = 5,000 - (3,000 + 1,500 - 500) = 1,000
    expect(
      rows.find((r) => r.kind === "check_in" && r.booking_code === K1.code)!
        .pending,
    ).toBe(String(R(1000)));
  });

  it("CAL-20: the resort filter on a day", async () => {
    const a = await dayRows("2026-03-10", resortA);
    expect(
      a.filter((r) => r.kind === "check_in").map((r) => r.booking_code),
    ).toEqual([K1.code]);
    expect(a.every((r) => r.resort_id === resortA)).toBe(true);
    const b = await dayRows("2026-03-10", resortB);
    expect(
      b.filter((r) => r.kind === "check_in").map((r) => r.booking_code),
    ).toEqual([K5.code]);
    expect(b.every((r) => r.resort_id === resortB)).toBe(true);
  });

  it("CAL-21: IST: a 23:30 IST arrival is on 31 Mar; the 00:30 IST departure is on 2 Apr (not 1 Apr)", async () => {
    expect(
      (await dayRows("2026-03-31"))
        .filter((r) => r.kind === "check_in")
        .map((r) => r.booking_code),
    ).toEqual([K2.code]);
    expect(
      (await dayRows("2026-04-01")).filter((r) => r.kind === "check_out"),
    ).toEqual([]);
    expect(
      (await dayRows("2026-04-01"))
        .filter((r) => r.kind === "staying")
        .map((r) => r.booking_code),
    ).toEqual([K2.code]);
    expect(
      (await dayRows("2026-04-02"))
        .filter((r) => r.kind === "check_out")
        .map((r) => r.booking_code),
    ).toEqual([K2.code]);
  });

  it("CAL-22: every number in the month view equals the number of rows in the day view", async () => {
    const m = await month(2026, 3);
    for (const d of [
      "2026-03-01",
      "2026-03-03",
      "2026-03-10",
      "2026-03-11",
      "2026-03-12",
      "2026-03-31",
    ]) {
      const rows = await dayRows(d);
      const c = (k: string) => rows.filter((r) => r.kind === k).length;
      expect(c("check_in")).toBe(byDay(m, d).check_ins);
      expect(c("check_out")).toBe(byDay(m, d).check_outs);
      expect(c("staying")).toBe(byDay(m, d).staying);
      const paid = rows
        .filter((r) => r.kind === "payment" && r.record_status === "approved")
        .reduce((s, r) => s + BigInt(r.amount as string), BigInt(0));
      expect(String(paid)).toBe(byDay(m, d).collected_paise);
      const dueSum = rows
        .filter((r) => r.kind === "due")
        .reduce((s, r) => s + BigInt(r.amount as string), BigInt(0));
      expect(String(dueSum)).toBe(byDay(m, d).due_paise);
    }
  });

  it("CAL-23: an empty day returns no rows; far-away dates work; bad dates are refused", async () => {
    expect(await dayRows("2031-07-04")).toEqual([]);
    expect(
      (await dayRows("2020-01-15"))
        .filter((r) => r.kind === "check_in")
        .map((r) => r.booking_code),
    ).toEqual([K6.code]);
    expect(
      (await dayRows("2035-12-31"))
        .filter((r) => r.kind === "check_in")
        .map((r) => r.booking_code),
    ).toEqual([K7.code]);
    await expectDbError(
      asUser(`select * from public.calendar_day(null)`),
      "INVALID_INPUT",
    );
    await expectDbError(
      asUser(`select * from public.calendar_day('1989-12-31')`),
      "INVALID_INPUT",
    );
    await expectDbError(
      asUser(`select * from public.calendar_day('2101-01-01')`),
      "INVALID_INPUT",
    );
  });

  it("CAL-24: a list of one kind is cut at 300 rows and kind_total says how many there really are", async () => {
    for (let i = 0; i < 305; i++)
      await booking("B", "2027-05-05T10:00", "2027-05-06T10:00");
    const rows = await dayRows("2027-05-05", resortB);
    expect(rows.filter((r) => r.kind === "check_in")).toHaveLength(300);
    expect(rows.find((r) => r.kind === "check_in")!.total).toBe("305");
    expect(rows.filter((r) => r.kind === "staying")).toHaveLength(300);
  }, 120_000);
});

describe("who may call them (CAL-25..)", () => {
  const calls: [string, string, unknown[]][] = [
    ["calendar_month", `select * from public.calendar_month(2026, 3)`, []],
    ["calendar_day", `select * from public.calendar_day('2026-03-10')`, []],
    ["old_records_search", `select * from public.old_records_search()`, []],
    ["activity_list", `select * from public.activity_list()`, []],
  ];
  it("CAL-25: anonymous visitors are refused by all four", async () => {
    for (const [, sql] of calls)
      await expectDbError(
        w.db.as({ role: "anon" }, () => q(sql)),
        "permission denied",
      );
  });
  it("CAL-26: signed-out requests, unknown logins and switched-off people are refused, not given an empty list", async () => {
    const off = uid();
    await w.db.exec(
      `insert into auth.users (id, email) values ('${off}', 'off@test.example')`,
    );
    await w.db.as({ role: "postgres", uid: w.owner }, () =>
      q(
        `insert into public.user_profiles (id, full_name, email, role) values ($1, 'Switched Off', 'off@test.example', 'manager')`,
        [off],
      ),
    );
    await raw(() =>
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
  it("CAL-27: Owners and Managers get the same calendar (Q10)", async () => {
    expect(await month(2026, 3, null, w.owner)).toEqual(
      await month(2026, 3, null, w.manager),
    );
    expect(await dayRows("2026-03-10", null, w.owner)).toEqual(
      await dayRows("2026-03-10", null, w.manager2),
    );
  });
  it("CAL-28: the four functions are SECURITY INVOKER with an empty search_path and only signed-in users may run them", async () => {
    const rows = await q<Row>(
      `select p.proname, p.prosecdef, p.proconfig, has_function_privilege('authenticated', p.oid, 'execute') auth,
              has_function_privilege('anon', p.oid, 'execute') anon, has_function_privilege('public', p.oid, 'execute') pub
         from pg_proc p where p.pronamespace = 'public'::regnamespace
          and p.proname in ('calendar_month', 'calendar_day', 'old_records_search', 'activity_list') order by 1`,
    );
    expect(rows.map((r) => r.proname)).toEqual([
      "activity_list",
      "calendar_day",
      "calendar_month",
      "old_records_search",
    ]);
    for (const r of rows) {
      expect(r.prosecdef).toBe(false);
      expect(
        (r.proconfig as string[]).some((c) => /^search_path=("")?$/.test(c)),
      ).toBe(true);
      expect([r.auth, r.anon, r.pub]).toEqual([true, false, false]);
    }
  });
  it("CAL-29: none of them changes anything: row counts of the main tables are the same after calling all four", async () => {
    const count = async () =>
      (
        await q<Row>(
          `select (select count(*) from public.bookings) b, (select count(*) from public.payments) p, (select count(*) from public.refunds) r, (select count(*) from public.audit_logs) a`,
        )
      )[0];
    const before = await count();
    await month(2026, 3);
    await dayRows("2026-03-10");
    await asUser(`select * from public.old_records_search('Asha')`);
    await asUser(`select * from public.activity_list()`);
    expect(await count()).toEqual(before);
  });
});

describe("old_records_search (REC-01..)", () => {
  type Rec = {
    record_type: string;
    record_code: string;
    booking_code: string;
    guest_name: string;
    status: string;
    amount: string;
    rdate: string;
    edate: string;
    backdated: boolean;
    files: string;
    total: string;
    resort_id: string;
  };
  const search = (
    args: {
      q?: string | null;
      resort?: string | null;
      types?: string[] | null;
      basis?: string;
      from?: string | null;
      to?: string | null;
      limit?: number;
      offset?: number;
    } = {},
    who = w.manager,
  ) =>
    asUser<Rec>(
      `select record_type, record_code, booking_code, guest_name, status, amount_paise::text amount, record_date::text rdate, entered_on::text edate, backdated, file_count::text files, total_rows::text total, resort_id
         from public.old_records_search($1, $2, $3::text[], $4, $5::date, $6::date, $7, $8)`,
      [
        args.q ?? null,
        args.resort ?? null,
        args.types ?? null,
        args.basis ?? "record",
        args.from ?? null,
        args.to ?? null,
        args.limit ?? 25,
        args.offset ?? 0,
      ],
      who,
    );

  it("REC-01: a date range lists bookings, payments and refunds together, newest first, with the right dates and amounts", async () => {
    const rows = await search({
      from: "2026-03-10",
      to: "2026-03-12",
      resort: resortA,
    });
    // K1 was booked on 10 Mar (booking date = check-in date in this data); payments P1/P2/P3 dated 10 Mar, P4 11 Mar, refunds 11 Mar
    const dates = rows.map((r) => r.rdate);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(
      rows
        .filter((r) => r.record_type === "booking")
        .map((r) => r.booking_code),
    ).toEqual([K1.code]);
    expect(rows.filter((r) => r.record_type === "payment")).toHaveLength(4);
    expect(rows.filter((r) => r.record_type === "refund")).toHaveLength(2);
    expect(rows[0].total).toBe(String(rows.length));
  });

  it("REC-02: the type filter: only payments; only bookings and refunds; a wrong type is refused", async () => {
    const pays = await search({
      types: ["payment"],
      from: "2026-03-01",
      to: "2026-03-31",
    });
    expect(pays.every((r) => r.record_type === "payment")).toBe(true);
    expect(pays).toHaveLength(6);
    const br = await search({
      types: ["booking", "refund"],
      from: "2026-03-01",
      to: "2026-03-31",
    });
    expect(new Set(br.map((r) => r.record_type))).toEqual(
      new Set(["booking", "refund"]),
    );
    await expectDbError(search({ types: ["guest"] }), "INVALID_INPUT");
    await expectDbError(search({ basis: "other" }), "INVALID_INPUT");
  });

  it("REC-03: amounts: a payment shows its own amount; a booking shows its Amount Due from booking_financials", async () => {
    const rows = await search({
      q: K1.code,
      from: "2026-03-01",
      to: "2026-03-31",
    });
    const bk = rows.find((r) => r.record_type === "booking")!;
    const [f] = await q<{ due_paise: string }>(
      `select due_paise::text from public.booking_financials where booking_id = $1`,
      [K1.id],
    );
    expect(bk.amount).toBe(f.due_paise);
    expect(
      rows.find(
        (r) =>
          r.record_type === "payment" &&
          r.status === "approved" &&
          r.amount === String(R(1000)),
      ),
    ).toBeTruthy();
  });

  it("REC-04: backdated entries are shown: payment date vs the day it was entered", async () => {
    const rows = await search({
      q: K1.code,
      types: ["payment"],
      from: "2026-03-11",
      to: "2026-03-11",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      backdated: true,
      rdate: "2026-03-11",
      edate: "2026-03-20",
    });
  });

  it("REC-05: searching by the day it was entered finds the backdated payment on 20 Mar, not on 11 Mar", async () => {
    const entered = await search({
      basis: "entry",
      types: ["payment"],
      from: "2026-03-20",
      to: "2026-03-20",
    });
    expect(entered).toHaveLength(1);
    expect(entered[0].rdate).toBe("2026-03-11");
    expect(
      await search({
        basis: "entry",
        types: ["payment"],
        from: "2026-03-11",
        to: "2026-03-11",
      }),
    ).toEqual([]);
  });

  it("REC-06: text search: Booking ID, guest name, mobile digits, payment number; capitals and % _ \\ are harmless", async () => {
    expect(
      (await search({ q: K1.code }))
        .filter((r) => r.record_type === "booking")
        .map((r) => r.booking_code),
    ).toEqual([K1.code]);
    expect(
      (await search({ q: "asha rao", types: ["booking"] })).map(
        (r) => r.booking_code,
      ),
    ).toEqual([K1.code]);
    expect(
      (await search({ q: "98111-00001", types: ["booking"] })).map(
        (r) => r.booking_code,
      ),
    ).toEqual([K1.code]);
    const [p] = await q<{ payment_code: string }>(
      `select payment_code from public.payments where id = $1`,
      [P1],
    );
    expect(
      (await search({ q: p.payment_code })).map((r) => r.record_code),
    ).toEqual([p.payment_code]);
    expect(await search({ q: "%" })).toEqual([]);
    expect(await search({ q: "_" })).toEqual([]);
    expect(await search({ q: "\\" })).toEqual([]);
    await expectDbError(search({ q: "x".repeat(101) }), "INVALID_INPUT");
  });

  it("REC-07: records of any year are reachable: 2020 and 2035 together, no time limit", async () => {
    expect(
      (
        await search({
          from: "2020-01-01",
          to: "2020-12-31",
          types: ["booking"],
        })
      ).map((r) => r.booking_code),
    ).toEqual([K6.code]);
    expect(
      (
        await search({
          from: "2035-01-01",
          to: "2036-12-31",
          types: ["booking"],
        })
      ).map((r) => r.booking_code),
    ).toEqual([K7.code]);
    const everything = await search({ types: ["booking"], limit: 100 });
    expect(everything[0].booking_code).toBe(K7.code); // the newest of all years comes first
    expect(Number(everything[0].total)).toBeGreaterThanOrEqual(7);
  });

  it("REC-08: paging: pages follow each other without gaps or repeats; the limit is at most 100", async () => {
    const all = await search({
      from: "2026-03-01",
      to: "2026-03-31",
      limit: 100,
    });
    const p1 = await search({
      from: "2026-03-01",
      to: "2026-03-31",
      limit: 5,
      offset: 0,
    });
    const p2 = await search({
      from: "2026-03-01",
      to: "2026-03-31",
      limit: 5,
      offset: 5,
    });
    const id = (r: Rec) => `${r.record_type}|${r.record_code}`;
    expect([...p1, ...p2].map(id)).toEqual(all.slice(0, 10).map(id));
    expect(p1[0].total).toBe(String(all.length));
    expect((await search({ limit: 100000 })).length).toBeLessThanOrEqual(100);
  });

  it("REC-09: file counts: PDF versions for a booking, files that are not hidden for a payment", async () => {
    await raw(async () => {
      await q(
        `insert into public.booking_pdf_versions (booking_id, version_no, storage_path, content_hash, trigger_reason, summary, size_bytes)
         values ($1, 1, $2, $3, 'booking created', '{}'::jsonb, 1000), ($1, 2, $4, $5, 'payment added', '{}'::jsonb, 1200)`,
        [
          K1.id,
          `${K1.id}/v1.pdf`,
          "a".repeat(64),
          `${K1.id}/v2.pdf`,
          "b".repeat(64),
        ],
      );
      await q(
        `insert into public.proofs (payment_id, storage_path, original_file_name, mime_type, size_bytes, sha256, uploaded_by)
         values ($1, $2, 'a.jpg', 'image/jpeg', 100, $3, $4), ($1, $5, 'b.jpg', 'image/jpeg', 100, $6, $4)`,
        [
          P1,
          `${K1.id}/${uid()}.jpg`,
          "c".repeat(64),
          w.owner,
          `${K1.id}/${uid()}.jpg`,
          "d".repeat(64),
        ],
      );
      await q(
        `update public.proofs set hidden_at = now(), hidden_by = $2, hidden_reason = 'wrong file' where payment_id = $1 and original_file_name = 'b.jpg'`,
        [P1, w.owner],
      );
    });
    const rows = await search({
      q: K1.code,
      from: "2026-03-10",
      to: "2026-03-10",
    });
    expect(rows.find((r) => r.record_type === "booking")!.files).toBe("2");
    expect(
      rows.find(
        (r) => r.record_type === "payment" && r.amount === String(R(2000)),
      )!.files,
    ).toBe("1");
  });

  it("REC-10: the date range must make sense; the same call from an Owner gives the same list", async () => {
    await expectDbError(
      search({ from: "2026-03-12", to: "2026-03-10" }),
      "INVALID_INPUT",
    );
    expect(
      await search({ from: "2026-03-10", to: "2026-03-12" }, w.owner),
    ).toEqual(
      await search({ from: "2026-03-10", to: "2026-03-12" }, w.manager2),
    );
  });
});

describe("Old Records by the other stored dates: check-in, check-out, cancellation (REC-11..)", () => {
  type Row = {
    record_type: string;
    record_code: string;
    booking_code: string;
    status: string;
    rdate: string;
    mdate: string;
    backdated: boolean;
    total: string;
  };
  const find = (
    a: {
      basis: string;
      from?: string | null;
      to?: string | null;
      q?: string | null;
      resort?: string | null;
      types?: string[] | null;
      limit?: number;
      offset?: number;
    },
    who = w.manager,
  ) =>
    asUser<Row>(
      `select record_type, record_code, booking_code, status, record_date::text rdate, matched_date::text mdate, backdated, total_rows::text total
         from public.old_records_search($1, $2, $3::text[], $4, $5::date, $6::date, $7, $8)`,
      [
        a.q ?? null,
        a.resort ?? null,
        a.types ?? null,
        a.basis,
        a.from ?? null,
        a.to ?? null,
        a.limit ?? 100,
        a.offset ?? 0,
      ],
      who,
    );
  const bookingsOf = (rows: Row[]) =>
    rows
      .filter((r) => r.record_type === "booking")
      .map((r) => r.booking_code)
      .sort();
  let M1: BK, M2: BK;
  let P5: string;

  beforeAll(async () => {
    // exact IST midnight edges, resort A: M1 checks in at 23:59 on 31 May and out at 00:00 on 1 June; M2 in at 00:00 on 1 June
    M1 = await booking("A", "2026-05-31T23:59", "2026-06-01T00:00", {
      name: "Edge One",
    });
    M2 = await booking("A", "2026-06-01T00:00", "2026-06-02T11:00", {
      name: "Edge Two",
    });
    // a payment of the cancelled booking K3, dated after the cancellation
    P5 = await money(K3, "payments", "approved", R(1000), "2026-03-12");
  });

  it("REC-11: check-in date, 10 March, all resorts: the four bookings that arrive that day (also the cancelled and the no-show) with their payments and refunds, each matched on the BOOKING's check-in date", async () => {
    const rows = await find({
      basis: "check_in",
      from: "2026-03-10",
      to: "2026-03-10",
    });
    expect(bookingsOf(rows)).toEqual(
      [K1.code, K3.code, K3n.code, K5.code].sort(),
    );
    // K1: 4 payments + 2 refunds, K5: 2 payments, K3: 1 payment (P5)
    expect(rows.filter((r) => r.record_type === "payment")).toHaveLength(7);
    expect(rows.filter((r) => r.record_type === "refund")).toHaveLength(2);
    expect(rows).toHaveLength(13);
    expect(rows.every((r) => r.mdate === "2026-03-10")).toBe(true);
    expect(rows[0].total).toBe("13");
    // the payment dated 12 March is listed because its BOOKING checks in on the 10th
    expect(
      rows.find((r) => r.record_type === "payment" && r.rdate === "2026-03-12"),
    ).toMatchObject({ booking_code: K3.code, mdate: "2026-03-10" });
  });

  it("REC-12: the resort filter, the kind filter and the text search still apply on a booking date", async () => {
    const a = await find({
      basis: "check_in",
      from: "2026-03-10",
      to: "2026-03-10",
      resort: resortA,
    });
    expect(bookingsOf(a)).toEqual([K1.code]);
    expect(a).toHaveLength(7); // K1 + 4 payments + 2 refunds
    const onlyPayments = await find({
      basis: "check_in",
      from: "2026-03-10",
      to: "2026-03-10",
      types: ["payment"],
      resort: resortB,
    });
    expect(onlyPayments.map((r) => r.booking_code).sort()).toEqual(
      [K3.code, K5.code, K5.code].sort(),
    );
    const byText = await find({
      basis: "check_in",
      from: "2026-03-10",
      to: "2026-03-10",
      q: "asha rao",
    });
    expect(byText.every((r) => r.booking_code === K1.code)).toBe(true);
    expect(byText).toHaveLength(7);
  });

  it("REC-13: IST, not UTC: 23:30 IST on 31 March is a 31 March check-in; 00:30 IST on 2 April is a 2 April check-out (it is still 1 April in UTC)", async () => {
    const day = (basis: string, d: string) =>
      find({ basis, from: d, to: d, types: ["booking"] }).then(bookingsOf);
    expect(await day("check_in", "2026-03-31")).toContain(K2.code);
    expect(await day("check_in", "2026-03-30")).not.toContain(K2.code);
    expect(await day("check_in", "2026-04-01")).not.toContain(K2.code);
    expect(await day("check_out", "2026-04-02")).toContain(K2.code);
    expect(await day("check_out", "2026-04-01")).not.toContain(K2.code);
    expect(await day("check_out", "2026-04-03")).not.toContain(K2.code);
  });

  it("REC-14: exact midnight edges: 23:59 belongs to the old day, 00:00 to the new day, for check-in and for check-out", async () => {
    const day = (basis: string, d: string) =>
      find({ basis, from: d, to: d, types: ["booking"], resort: resortA }).then(
        bookingsOf,
      );
    expect(await day("check_in", "2026-05-31")).toEqual([M1.code]);
    expect(await day("check_in", "2026-06-01")).toEqual([M2.code]);
    expect(await day("check_out", "2026-06-01")).toEqual([M1.code]);
    expect(await day("check_out", "2026-06-02")).toEqual([M2.code]);
    // a range over both days has both, at both edges inclusive
    expect(
      bookingsOf(
        await find({
          basis: "check_in",
          from: "2026-05-31",
          to: "2026-06-01",
          types: ["booking"],
          resort: resortA,
        }),
      ),
    ).toEqual([M1.code, M2.code].sort());
  });

  it("REC-15: cancellation date: only cancelled and no-show bookings, with their payments and refunds; nobody else", async () => {
    const rows = await find({
      basis: "cancellation",
      from: "2026-03-10",
      to: "2026-03-10",
    });
    expect(bookingsOf(rows)).toEqual([K3.code, K3n.code].sort());
    expect(
      rows.filter((r) => r.record_type === "payment").map((r) => r.record_code),
    ).toHaveLength(1);
    expect(rows).toHaveLength(3); // K3, K3n and K3's payment
    expect(rows.every((r) => r.mdate === "2026-03-10")).toBe(true);
    expect(
      rows
        .filter((r) => r.record_type === "booking")
        .map((r) => r.status)
        .sort(),
    ).toEqual(["cancelled", "no_show"]);
    // one day later or earlier: nothing
    expect(
      await find({
        basis: "cancellation",
        from: "2026-03-11",
        to: "2026-03-31",
      }),
    ).toEqual([]);
    expect(
      await find({
        basis: "cancellation",
        from: "2026-03-01",
        to: "2026-03-09",
      }),
    ).toEqual([]);
  });

  it("REC-16: with no dates at all, 'cancellation' still lists only the cancelled and no-show bookings (only they have that date); 'check in' lists every booking", async () => {
    const cancelled = await find({ basis: "cancellation", types: ["booking"] });
    expect(bookingsOf(cancelled)).toEqual([K3.code, K3n.code].sort());
    const [{ n }] = await q<{ n: string }>(
      `select count(*)::text n from public.bookings`,
    );
    for (const basis of ["check_in", "check_out"]) {
      const all = await find({ basis, types: ["booking"], limit: 1 });
      expect(all[0].total).toBe(n);
    }
  });

  it("REC-17: matched_date says which stored date was used for each row (record, entry, check-in, check-out, cancellation)", async () => {
    const one = (basis: string, extra: object = {}) =>
      find({
        basis,
        q: K1.code,
        from: "2026-03-01",
        to: "2026-03-31",
        ...extra,
      });
    const rec = await one("record");
    for (const r of rec) expect(r.mdate).toBe(r.rdate);
    const entry = await one("entry");
    const p4 = entry.find((r) => r.backdated)!;
    expect(p4).toMatchObject({ rdate: "2026-03-11", mdate: "2026-03-20" }); // the day it was typed in
    const cin = await one("check_in");
    expect(cin.every((r) => r.mdate === "2026-03-10")).toBe(true); // K1 checks in on the 10th
    const cout = await one("check_out");
    expect(cout.every((r) => r.mdate === "2026-03-12")).toBe(true);
    expect(cin.find((r) => r.backdated)).toBeTruthy(); // backdated flag untouched by the choice of date
  });

  it("REC-18: paging on a booking date: pages follow each other and the total is the same on every page; newest check-in first", async () => {
    const all = await find({
      basis: "check_in",
      from: "2026-03-01",
      to: "2026-03-31",
      limit: 100,
    });
    const p1 = await find({
      basis: "check_in",
      from: "2026-03-01",
      to: "2026-03-31",
      limit: 4,
      offset: 0,
    });
    const p2 = await find({
      basis: "check_in",
      from: "2026-03-01",
      to: "2026-03-31",
      limit: 4,
      offset: 4,
    });
    const id = (r: Row) => `${r.record_type}|${r.record_code}`;
    expect([...p1, ...p2].map(id)).toEqual(all.slice(0, 8).map(id));
    expect(p1[0].total).toBe(String(all.length));
    expect(p2[0].total).toBe(p1[0].total);
    const dates = all.map((r) => r.mdate);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("REC-19: years 2020 and 2035/2036: a check-in in 2020, and a stay that begins in 2035 and ends in 2036", async () => {
    expect(
      bookingsOf(
        await find({
          basis: "check_in",
          from: "2020-01-15",
          to: "2020-01-15",
          types: ["booking"],
        }),
      ),
    ).toEqual([K6.code]);
    const withMoney = await find({
      basis: "check_out",
      from: "2020-01-16",
      to: "2020-01-16",
    });
    expect(withMoney.filter((r) => r.record_type === "payment")).toHaveLength(
      1,
    ); // the Rs 1 payment dated 15 Jan
    expect(
      bookingsOf(
        await find({
          basis: "check_in",
          from: "2035-12-31",
          to: "2035-12-31",
          types: ["booking"],
        }),
      ),
    ).toEqual([K7.code]);
    expect(
      bookingsOf(
        await find({
          basis: "check_out",
          from: "2036-01-02",
          to: "2036-01-02",
          types: ["booking"],
        }),
      ),
    ).toEqual([K7.code]);
    expect(
      await find({
        basis: "check_out",
        from: "2035-12-31",
        to: "2036-01-01",
        types: ["booking"],
      }),
    ).toEqual([]);
  });

  it("REC-20: bad choices are refused in plain words; Owners and Managers get the same list", async () => {
    await expectDbError(find({ basis: "stay" }), "INVALID_INPUT");
    await expectDbError(
      find({ basis: "check_in", from: "2026-03-12", to: "2026-03-10" }),
      "INVALID_INPUT",
    );
    const a = await find(
      { basis: "cancellation", from: "2026-03-10", to: "2026-03-10" },
      w.owner,
    );
    const b = await find(
      { basis: "cancellation", from: "2026-03-10", to: "2026-03-10" },
      w.manager2,
    );
    expect(a).toEqual(b);
    expect(P5).toBeTruthy();
  });
});

describe("activity_list (ACT-01..)", () => {
  type Act = {
    id: string;
    action: string;
    record_type: string;
    table_name: string;
    record_code: string | null;
    booking_code: string | null;
    actor_name: string | null;
    changed_fields: string[] | null;
    old_values: Record<string, unknown> | null;
    new_values: Record<string, unknown> | null;
    reason: string | null;
    total: string;
    target_user_name: string | null;
    occurred_at: string;
    resort_id: string | null;
  };
  const list = (
    a: {
      actor?: string | null;
      action?: string | null;
      type?: string | null;
      resort?: string | null;
      booking?: string | null;
      from?: string | null;
      to?: string | null;
      corrections?: boolean | null;
      limit?: number;
      offset?: number;
    } = {},
    who = w.manager,
  ) =>
    asUser<Act>(
      `select id::text, action, record_type, table_name, record_code, booking_code, actor_name, changed_fields, old_values, new_values, reason, total_rows::text total, target_user_name, occurred_at::text, resort_id
         from public.activity_list($1, $2, $3, $4, $5, $6::date, $7::date, $8, $9, $10)`,
      [
        a.actor ?? null,
        a.action ?? null,
        a.type ?? null,
        a.resort ?? null,
        a.booking ?? null,
        a.from ?? null,
        a.to ?? null,
        a.corrections ?? null,
        a.limit ?? 25,
        a.offset ?? 0,
      ],
      who,
    );
  let B: Awaited<ReturnType<typeof createBooking>>;
  let payId: string;

  beforeAll(async () => {
    B = await createBooking(w, { resort: "A", plan: "auto" }); // audited insert of a booking (as the Owner)
    payId = uid();
    await w.db.tx({ role: "postgres", uid: w.manager }, async () => {
      await q(
        `insert into public.payments (id, booking_id, amount_paise, method, payment_date, reference_number, idempotency_key)
         values ($1, $2, 100000, 'cash', public.today_ist(), 'REF-ACT', $3)`,
        [payId, B.id, uid()],
      );
    });
    await w.db.tx({ role: "postgres", uid: w.owner }, async () => {
      await q(`update public.payments set status = 'approved' where id = $1`, [
        payId,
      ]);
    });
    // an account action and a password-re-entry row (Owners only)
    await w.db.tx({ role: "postgres", uid: w.owner }, async () => {
      await q(
        `insert into public.audit_logs (actor_id, actor_name, action, table_name, record_id, target_user_id, reason)
         values ($1, 'Test Owner', 'password_reset', 'user_profiles', $2::text, $2::uuid, 'Forgot it')`,
        [w.owner, w.manager],
      );
      await q(
        `insert into public.audit_logs (actor_id, actor_name, action, table_name, record_id, target_user_id, changed_fields)
         values ($1, 'Test Owner', 'reauth_verified', 'user_profiles', $2::text, $2::uuid, array['disable_user'])`,
        [w.owner, w.manager],
      );
    });
  });

  it("ACT-01: newest first; one booking's history shows its creation, with the Booking ID and the person who did it", async () => {
    const rows = await list({ booking: B.id });
    const ids = rows.map((r) => Number(r.id));
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
    const created = rows.find(
      (r) => r.record_type === "booking" && r.action === "insert",
    )!;
    expect(created).toMatchObject({
      record_code: B.code,
      booking_code: B.code,
      actor_name: "Test Owner",
    });
    expect(created.new_values).toMatchObject({ booking_code: B.code, pax: 2 });
  });

  it("ACT-02: a change shows only the fields that changed, old and new (readable diffs, AUD-04)", async () => {
    const rows = await list({
      booking: B.id,
      type: "payment",
      action: "update",
    });
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.record_code).toBeTruthy();
    expect(r.changed_fields).toContain("status");
    expect(r.old_values).toMatchObject({ status: "waiting" });
    expect(r.new_values).toMatchObject({ status: "approved" });
    expect(Object.keys(r.new_values!).sort()).toEqual(
      [...r.changed_fields!].sort(),
    );
    expect(r.actor_name).toBe("Test Owner");
  });

  it("ACT-03: technical keys are never returned: storage path, file hash, request key", async () => {
    const rows = await list({ booking: B.id, limit: 100 });
    for (const r of rows)
      for (const v of [r.old_values, r.new_values])
        for (const k of ["storage_path", "sha256", "idempotency_key"])
          expect(Object.keys(v ?? {})).not.toContain(k);
    const ins = rows.find(
      (r) => r.record_type === "payment" && r.action === "insert",
    )!;
    expect(Object.keys(ins.new_values ?? {})).not.toContain("idempotency_key");
  });

  it("ACT-04: the action filter: added, changed, account actions", async () => {
    expect(
      (await list({ booking: B.id, action: "insert" })).every(
        (r) => r.action === "insert",
      ),
    ).toBe(true);
    expect(
      (await list({ booking: B.id, action: "update" })).every(
        (r) => r.action === "update",
      ),
    ).toBe(true);
    const acc = await list({ action: "account", type: "user" });
    expect(acc.map((r) => r.action)).toContain("password_reset");
    expect(
      acc.every((r) => r.action !== "insert" && r.action !== "update"),
    ).toBe(true);
    const pw = acc.find((r) => r.action === "password_reset")!;
    expect(pw).toMatchObject({
      reason: "Forgot it",
      target_user_name: "Test Manager One",
      actor_name: "Test Owner",
    });
  });

  it("ACT-05: the record type filter maps tables to plain kinds; the user filter; the resort filter", async () => {
    for (const [type, table] of [
      ["booking", "bookings"],
      ["payment", "payments"],
      ["user", "user_profiles"],
    ] as const) {
      const rows = await list({ type, limit: 100 });
      expect(rows.length).toBeGreaterThan(0);
      expect(
        rows.every((r) => r.record_type === type && r.table_name === table),
      ).toBe(true);
    }
    expect(
      (await list({ actor: w.manager, limit: 100 })).every(
        (r) => r.actor_name === "Test Manager One",
      ),
    ).toBe(true);
    const a = await list({ resort: resortA, limit: 100 });
    expect(a.length).toBeGreaterThan(0);
    expect(a.every((r) => r.resort_id === resortA)).toBe(true);
  });

  it("ACT-06: the date filter uses IST days: a row made now is found for today in IST and not for yesterday", async () => {
    const [{ t }] = await q<{ t: string }>(`select public.today_ist()::text t`);
    const [{ y }] = await q<{ y: string }>(
      `select (public.today_ist() - 1)::text y`,
    );
    expect((await list({ from: t, to: t })).length).toBeGreaterThan(0);
    expect(await list({ from: "2000-01-01", to: y })).toEqual([]);
    await expectDbError(
      list({ from: "2026-03-12", to: "2026-03-10" }),
      "INVALID_INPUT",
    );
  });

  it("ACT-07: re-entry-of-password rows are visible to Owners only (migration 19), through this function too", async () => {
    const mgr = await list({ action: "account", limit: 100 });
    expect(mgr.some((r) => r.action.startsWith("reauth_"))).toBe(false);
    const own = await list({ action: "account", limit: 100 }, w.owner);
    expect(own.some((r) => r.action === "reauth_verified")).toBe(true);
  });

  it("ACT-08: 'corrections added after approval' lists only files added to an approved item with their reason", async () => {
    await w.db.tx({ role: "postgres", uid: w.manager }, async () => {
      await q(
        `insert into public.proofs (payment_id, storage_path, original_file_name, mime_type, size_bytes, sha256, uploaded_by, is_correction, correction_reason)
         values ($1, $2, 'late.png', 'image/png', 100, $3, $4, true, 'Receipt found later')`,
        [payId, `${B.id}/${uid()}.png`, "e".repeat(64), w.manager],
      );
      const waitingId = uid();
      await q(
        `insert into public.payments (id, booking_id, amount_paise, method, payment_date, reference_number, idempotency_key)
         values ($1, $2, 50000, 'cash', public.today_ist(), 'REF-ACT2', $3)`,
        [waitingId, B.id, uid()],
      );
      await q(
        `insert into public.proofs (payment_id, storage_path, original_file_name, mime_type, size_bytes, sha256, uploaded_by)
         values ($1, $2, 'ordinary.png', 'image/png', 100, $3, $4)`,
        [waitingId, `${B.id}/${uid()}.png`, "f".repeat(64), w.manager],
      );
    });
    const rows = await list({ corrections: true, limit: 100 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      record_type: "file",
      booking_code: B.code,
    });
    expect(rows[0].new_values).toMatchObject({
      is_correction: true,
      correction_reason: "Receipt found later",
    });
    expect(Object.keys(rows[0].new_values!)).not.toContain("storage_path");
    expect(
      (await list({ type: "file", limit: 100 })).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("ACT-09: paging: pages follow each other; the total is the same on every page; at most 100 rows", async () => {
    const all = await list({ limit: 100 });
    const p1 = await list({ limit: 3, offset: 0 });
    const p2 = await list({ limit: 3, offset: 3 });
    expect([...p1, ...p2].map((r) => r.id)).toEqual(
      all.slice(0, 6).map((r) => r.id),
    );
    expect(p1[0].total).toBe(p2[0].total);
    expect(Number(p1[0].total)).toBe(all.length);
    expect((await list({ limit: 1000 })).length).toBeLessThanOrEqual(100);
  });

  it("ACT-10: unknown filter values are refused with a plain message", async () => {
    await expectDbError(list({ action: "delete" }), "INVALID_INPUT");
    await expectDbError(list({ type: "everything" }), "INVALID_INPUT");
  });

  it("ACT-11: the log cannot be changed through any of this: the audit rows are exactly as before after listing", async () => {
    const [{ n, mx }] = await q<{ n: string; mx: string }>(
      `select count(*)::text n, max(id)::text mx from public.audit_logs`,
    );
    await list({ limit: 100 });
    const [after] = await q<{ n: string; mx: string }>(
      `select count(*)::text n, max(id)::text mx from public.audit_logs`,
    );
    expect(after).toEqual({ n, mx });
  });
});
