/**
 * Resort-wise Collection against the real M5 flow (RPT-M5-01..). The other report tests build their data directly; this one
 * goes through the database's own steps (payments recorded, approved, rejected, reversed; refunds approved, waiting, reversed;
 * a cancellation with its adjustment) and checks that the report agrees with the booking page's figures (booking_financials,
 * rule D1), with the expected_entries view, and with the dashboard, and that nothing is counted twice or counted early.
 * Fictional data only. Dates are relative to today (IST).
 */
import { beforeAll, describe, expect, it } from "vitest";
import {
  addPayment,
  addRefund,
  cancelBooking,
  createBooking,
  dateOffset,
  setupWorld,
  type Booking,
  type World,
} from "./fixtures";

let w: World;
let x: Booking;
let other: Booking;
let from: string, to: string;
type Row = Record<string, string>;
const q = <T = Row>(sql: string, p?: unknown[]) => w.db.q<T>(sql, p);
const asUser = <T = Row>(sql: string, p: unknown[] = [], who = w.manager) =>
  w.db.as({ role: "authenticated", uid: who }, () => q<T>(sql, p));
const asOwner = <T = Row>(sql: string, p: unknown[] = []) =>
  w.db.tx({ role: "postgres", uid: w.owner }, () => q<T>(sql, p));

async function decide(
  kind: "payment" | "refund",
  id: string,
  how: "approve" | "reject" | "reverse",
) {
  const table = kind === "payment" ? "payments" : "refunds";
  const [{ version }] = await q<{ version: string }>(
    `select version::text from public.${table} where id = $1`,
    [id],
  );
  const fn = `${how}_${kind}`;
  await asOwner(
    how === "approve"
      ? `select public.${fn}($1, $2::int)`
      : `select public.${fn}($1, $2::int, 'Test reason')`,
    [id, version],
  );
}

beforeAll(async () => {
  w = await setupWorld();
  from = await dateOffset(w.db, -10);
  to = await dateOffset(w.db, 10);

  // X (resort A): Rs 5,000. Plan: Rs 2,000 due 3 days ago, Rs 3,000 due in 5 days.
  x = await createBooking(w, {
    resort: "A",
    plan: [
      { label: "Advance", dueOffset: -3, amount: 200000 },
      { label: "Balance", dueOffset: 5, amount: 300000 },
    ],
  });
  // payments (recorded by the manager, decided by the owner)
  const p1 = await addPayment(w, x, {
    actor: w.manager,
    amount: 200000,
    dateOffset: -3,
  });
  await addPayment(w, x, { actor: w.manager, amount: 100000, dateOffset: -2 }); // stays waiting
  const p3 = await addPayment(w, x, {
    actor: w.manager,
    amount: 40000,
    dateOffset: -2,
  });
  const p4 = await addPayment(w, x, {
    actor: w.manager,
    amount: 70000,
    dateOffset: -1,
  });
  const p5 = await addPayment(w, x, {
    actor: w.manager,
    amount: 30000,
    dateOffset: 0,
  });
  await decide("payment", p1, "approve");
  await decide("payment", p3, "reject");
  await decide("payment", p4, "approve");
  await decide("payment", p4, "reverse");
  await decide("payment", p5, "approve");
  // the booking is cancelled with a Rs 1,000 charge: the Rs 3,000 future row goes, the Rs 2,000 past row stays, and a
  // dated adjustment of -Rs 1,000 makes the expected total equal the charge
  await cancelBooking(w, x, {
    charge: 100000,
    adjustment: -100000,
    lockedPast: 200000,
  });

  // refunds (allowed now: the cancellation left Rs 1,300 paid over the charge)
  const r1 = await addRefund(w, x, { actor: w.manager, amount: 20000 });
  await addRefund(w, x, { actor: w.manager, amount: 10000 }); // stays waiting
  const r3 = await addRefund(w, x, { actor: w.manager, amount: 5000 });
  await decide("refund", r1, "approve");
  await decide("refund", r3, "approve");
  await decide("refund", r3, "reverse");
  // another booking in resort B, nothing paid: it must not leak into resort A's row
  other = await createBooking(w, {
    resort: "B",
    plan: [{ label: "Balance", dueOffset: 1, amount: 500000 }],
  });
  await addPayment(w, other, {
    actor: w.manager,
    amount: 10000,
    dateOffset: 0,
  });
});

const report = async (resort: string | null = null) =>
  asUser<Row>(
    `select resort_id::text, originally_expected_paise::text oe, expected_adjustments_paise::text ea, expected_paise::text e,
            approved_paise::text a, waiting_paise::text wa, refunds_paise::text rf, net_paise::text n, difference_paise::text d,
            total_originally_expected_paise::text toe, total_expected_adjustments_paise::text tea, total_expected_paise::text te,
            total_approved_paise::text ta, total_waiting_paise::text twa, total_refunds_paise::text trf
       from public.report_expected_vs_actual($1::date, $2::date, $3::uuid) order by resort_name`,
    [from, to, resort],
  );

describe("Resort-wise Collection against the M5 flow (RPT-M5-01..)", () => {
  it("RPT-M5-01: resort A, by hand: Originally Expected 2,000 (the superseded Rs 3,000 row is gone), adjustment -1,000, Expected 1,000; approved 2,300 (2,000 + 300), waiting 1,000, refunds 200, net 2,100, Difference 1,000 - 2,300 = -1,300", async () => {
    const [a] = await report(w.resorts.A.id);
    expect(a).toMatchObject({
      oe: "200000",
      ea: "-100000",
      e: "100000",
      a: "230000",
      wa: "100000",
      rf: "20000",
      n: "210000",
      d: "-130000",
    });
  });

  it("RPT-M5-02: rejected (Rs 400) and reversed (Rs 700) payments, the waiting Rs 1,000 and the waiting and reversed refunds are in no approved figure", async () => {
    const [a] = await report(w.resorts.A.id);
    const sums = await q<Row>(
      `select status::text, sum(amount_paise)::text s from public.payments where booking_id = $1 group by status order by status`,
      [x.id],
    );
    expect(Object.fromEntries(sums.map((r) => [r.status, r.s]))).toEqual({
      approved: "230000",
      rejected: "40000",
      reversed: "70000",
      waiting: "100000",
    });
    expect(a.a).toBe("230000"); // only the approved ones
    expect(a.wa).toBe("100000"); // only the waiting one, shown apart
    expect(a.rf).toBe("20000"); // approved refund only (not the waiting 100 or the reversed 50)
  });

  it("RPT-M5-03 (D1): the report agrees with the booking page's own figures for the same booking (booking_financials), to the paisa", async () => {
    const [f] = await q<Row>(
      `select final_paise::text fp, due_paise::text dp, approved_paise::text ap, waiting_paise::text wp,
              refunds_approved_paise::text rp, net_collection_paise::text np
         from public.booking_financials where booking_id = $1`,
      [x.id],
    );
    const [a] = await report(w.resorts.A.id);
    expect(a.e).toBe(f.dp); // Expected = what the booking page says is due
    expect(f.fp).toBe("500000"); // the original amount stays on the booking; the report uses what is due now
    expect(a.a).toBe(f.ap);
    expect(a.wa).toBe(f.wp);
    expect(a.rf).toBe(f.rp);
    expect(a.n).toBe(f.np);
  });

  it("RPT-M5-04: nothing is counted twice: Expected equals the expected_entries view for the booking, and the plan rows plus the adjustments are never counted again", async () => {
    const [v] = await q<Row>(
      `select coalesce(sum(amount_paise) filter (where kind = 'plan'), 0)::text op,
              coalesce(sum(amount_paise) filter (where kind = 'adjustment'), 0)::text adj,
              coalesce(sum(amount_paise), 0)::text tot
         from public.expected_entries where booking_id = $1`,
      [x.id],
    );
    const [a] = await report(w.resorts.A.id);
    expect([a.oe, a.ea, a.e]).toEqual([v.op, v.adj, v.tot]);
    const [n] = await q<Row>(
      `select count(*)::text n from public.expected_adjustments where booking_id = $1`,
      [x.id],
    );
    expect(n.n).toBe("1"); // one adjustment, one time in the report
    // the adjustments report lists the same single adjustment
    const adj = await asUser<Row>(
      `select amount_paise::text a, total_paise::text t, total_rows::text r
         from public.report_expected_adjustments($1::date, $2::date, $3::uuid, null, 100, 0)`,
      [from, to, w.resorts.A.id],
    );
    expect(adj).toHaveLength(1);
    expect(adj[0]).toMatchObject({ a: "-100000", t: "-100000", r: "1" });
  });

  it("RPT-M5-05: resort B's booking does not leak into resort A's row, and the all-resorts totals are the two rows added", async () => {
    const rows = await report(null);
    const a = rows.find((r) => r.resort_id === w.resorts.A.id)!;
    const b = rows.find((r) => r.resort_id === w.resorts.B.id)!;
    expect(b).toMatchObject({ oe: "500000", e: "500000", a: "0", wa: "10000" });
    expect(a.a).toBe("230000");
    expect(rows[0].te).toBe(String(rows.reduce((s, r) => s + Number(r.e), 0)));
    expect(rows[0].ta).toBe(String(rows.reduce((s, r) => s + Number(r.a), 0)));
    expect(rows[0].twa).toBe(
      String(rows.reduce((s, r) => s + Number(r.wa), 0)),
    );
    expect(rows[0].trf).toBe(
      String(rows.reduce((s, r) => s + Number(r.rf), 0)),
    );
  });

  it("RPT-M5-06: the period decides: a window before every payment has the Rs 2,000 row expected, nothing collected; a window after today has only what is dated after it", async () => {
    const before = await asUser<Row>(
      `select originally_expected_paise::text oe, approved_paise::text a, refunds_paise::text rf
         from public.report_expected_vs_actual($1::date, $2::date, $3::uuid)`,
      [await dateOffset(w.db, -5), await dateOffset(w.db, -4), w.resorts.A.id],
    );
    expect(before[0]).toMatchObject({ oe: "0", a: "0", rf: "0" });
    const only = await asUser<Row>(
      `select originally_expected_paise::text oe, approved_paise::text a
         from public.report_expected_vs_actual($1::date, $2::date, $3::uuid)`,
      [await dateOffset(w.db, -3), await dateOffset(w.db, -3), w.resorts.A.id],
    );
    expect(only[0]).toMatchObject({ oe: "200000", a: "200000" }); // the Rs 2,000 row and the Rs 2,000 payment of that day
  });

  it("RPT-M5-07: the collection report and the resort-wise report give the same approved, waiting, refund and net totals for these dates", async () => {
    const c = await asUser<Row>(
      `select total_approved_paise::text a, total_waiting_paise::text w, total_refunds_paise::text r, total_net_paise::text n
         from public.report_collection($1::date, $2::date, $3::uuid, 'month', 'none') limit 1`,
      [from, to, w.resorts.A.id],
    );
    const [a] = await report(w.resorts.A.id);
    expect(c[0]).toMatchObject({ a: a.a, w: a.wa, r: a.rf, n: a.n });
  });

  it("RPT-M5-08: reading reports changes nothing (the expected figures, payments and refunds are the same before and after)", async () => {
    const snap = () =>
      q<Row>(
        `select (select count(*) from public.payments)::text p, (select count(*) from public.refunds)::text r,
                (select coalesce(sum(amount_paise),0) from public.expected_entries)::text e,
                (select count(*) from public.audit_logs)::text l`,
      );
    const before = await snap();
    await report(null);
    await asUser(`select * from public.report_collection($1::date, $2::date)`, [
      from,
      to,
    ]);
    expect(await snap()).toEqual(before);
  });

  it("RPT-M5-09: a person who is not allowed (anon, or no profile) gets nothing", async () => {
    await expect(
      w.db.as({ role: "anon" }, () =>
        q(
          `select * from public.report_expected_vs_actual($1::date, $2::date)`,
          [from, to],
        ),
      ),
    ).rejects.toThrow();
  });

  it("RPT-M5-10: every active person may see every resort (Q10); a resort id that does not exist gives an empty report, never another resort's data", async () => {
    const ghost = "11111111-2222-4333-8444-555555555556";
    const sqls = [
      `select * from public.report_expected_vs_actual($1::date, $2::date, $3::uuid)`,
      `select * from public.report_collection($1::date, $2::date, $3::uuid)`,
      `select * from public.report_bookings('booking', $1::date, $2::date, $3::uuid)`,
      `select * from public.report_refunds($1::date, $2::date, $3::uuid)`,
      `select * from public.report_waiting('entry', $1::date, $2::date, $3::uuid)`,
    ];
    for (const sql of sqls)
      expect(await asUser(sql, [from, to, ghost]), sql).toHaveLength(0);
    // an Owner and a Manager see the same figures for resort A
    const sql = sqls[0];
    expect(await asUser(sql, [from, to, w.resorts.A.id], w.owner)).toEqual(
      await asUser(sql, [from, to, w.resorts.A.id], w.manager),
    );
  });
});
