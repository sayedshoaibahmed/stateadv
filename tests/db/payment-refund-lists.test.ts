/**
 * Payment and refund list functions (migration 22; UI spec 3.9, 3.10). PGL-01..
 * A small fictional dataset with every value written down below; the functions must show exactly the stored amounts,
 * statuses and flags and nothing else, and refuse everybody who is not an active user.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { expectDbError } from "./harness";
import {
  addPayment,
  addProof,
  addRefund,
  createBooking,
  dateOffset,
  setStatus,
  setupWorld,
  uid,
  type Booking,
  type World,
} from "./fixtures";

let w: World;
const R = (rupees: number) => rupees * 100;
type Row = Record<string, unknown>;
const q = <T = Row>(sql: string, p?: unknown[]) => w.db.q<T>(sql, p);
const as = <T>(id: string | null, fn: () => Promise<T>) =>
  w.db.as({ role: "authenticated", uid: id }, fn);
const day = new Map<number, string>();
let X: Booking, Y: Booking;
let upi: number, card: number;
const pay: Record<string, string> = {};
const ref: Record<string, string> = {};

/** write recorded_at (and nothing else) without the guard triggers, so the queue order is known */
async function stamp(
  table: "payments" | "refunds",
  id: string,
  daysAgo: number,
  hour: number,
) {
  await w.db.exec("set session_replication_role = replica");
  try {
    await q(
      `update public.${table} set recorded_at = ((public.today_ist() - $2::int)::text || ' ' || $3 || ':00:00+05:30')::timestamptz where id = $1`,
      [id, daysAgo, String(hour).padStart(2, "0")],
    );
  } finally {
    await w.db.exec("set session_replication_role = origin");
  }
}

const plist = (
  args: Record<string, unknown> = {},
  actor: string | null = w.manager,
) => callList("payment_list", args, actor);
const rlist = (
  args: Record<string, unknown> = {},
  actor: string | null = w.manager,
) => callList("refund_list", args, actor);
async function callList(
  fn: string,
  args: Record<string, unknown>,
  actor: string | null,
) {
  const casts: Record<string, string> = {
    status: "::public.approval_status",
    method: "::public.payment_method",
    provider: "::smallint",
    resort: "::uuid",
    booking: "::uuid",
    from: "::date",
    to: "::date",
    recorded_by: "::uuid",
  };
  const params: unknown[] = [];
  const parts = Object.keys(args).map((k) => {
    params.push(args[k]);
    return `p_${k} => $${params.length}${casts[k] ?? ""}`;
  });
  return as(actor, () =>
    q(`select * from public.${fn}(${parts.join(", ")})`, params),
  );
}
const codes = (rows: Row[], key: string) => rows.map((r) => r[key] as string);
const num = (r: Row, k: string) => Number(r[k]);

beforeAll(async () => {
  w = await setupWorld();
  for (let n = -10; n <= 2; n++) day.set(n, await dateOffset(w.db, n));
  upi = (
    await q<{ id: number }>(
      `select id from public.payment_providers where method = 'upi' order by id limit 1`,
    )
  )[0].id;
  card = (
    await q<{ id: number }>(
      `select id from public.payment_providers where method = 'card' order by id limit 1`,
    )
  )[0].id;

  // booking X (resort A): Rs 1,000 (so the Rs 1,300 approved is Rs 300 more than due: a refund of up to Rs 300 is allowed).
  // booking Y (resort B): Rs 5,000
  X = await createBooking(w, {
    resort: "A",
    pax: 1,
    tariff: R(1000),
    bookingDateOffset: -8,
    checkInOffset: 3,
    plan: "auto",
  });
  Y = await createBooking(w, {
    resort: "B",
    pax: 1,
    tariff: R(5000),
    bookingDateOffset: -7,
    checkInOffset: 4,
    plan: "auto",
  });

  // P1 cash 1,000 by Manager 1, approved by the Owner               -> approved, not self-approved
  pay.p1 = await addPayment(w, X, {
    actor: w.manager,
    amount: R(1000),
    method: "cash",
    dateOffset: -6,
  });
  await setStatus(w, "payments", pay.p1, "approved", w.owner);
  // P2 UPI 2,000 by Manager 1, waiting, one proof file               -> waiting
  pay.p2 = await addPayment(w, X, {
    actor: w.manager,
    amount: R(2000),
    method: "upi",
    providerId: upi,
    dateOffset: -5,
  });
  // P3 cash 500 by Manager 1, rejected by the Owner                  -> rejected (never counts)
  pay.p3 = await addPayment(w, X, {
    actor: w.manager,
    amount: R(500),
    method: "cash",
    dateOffset: -4,
  });
  await setStatus(w, "payments", pay.p3, "rejected", w.owner, "Wrong booking");
  // P4 cash 300 by Manager 1, approved by Manager 1 himself          -> approved, SELF-approved
  pay.p4 = await addPayment(w, X, {
    actor: w.manager,
    amount: R(300),
    method: "cash",
    dateOffset: -3,
  });
  await setStatus(w, "payments", pay.p4, "approved", w.manager);
  // P5 cash 400 by Manager 2, approved then reversed                 -> reversed (never counts)
  pay.p5 = await addPayment(w, X, {
    actor: w.manager2,
    amount: R(400),
    method: "cash",
    dateOffset: -2,
  });
  await setStatus(w, "payments", pay.p5, "approved", w.owner);
  await setStatus(w, "payments", pay.p5, "reversed", w.owner, "Entered twice");
  // P6 card 1,500 on booking Y by Manager 2, waiting, one proof file -> waiting
  pay.p6 = await addPayment(w, Y, {
    actor: w.manager2,
    amount: R(1500),
    method: "card",
    providerId: card,
    dateOffset: -1,
  });

  // entry order (recorded_at): P1 10 days ago ... P6 5 days ago
  const ago = { p1: 10, p2: 9, p3: 8, p4: 7, p5: 6, p6: 5 } as const;
  for (const [k, d] of Object.entries(ago))
    await stamp("payments", pay[k], d, 10);

  // refunds on booking X (approved 1,000 + 300 = 1,300; due 1,000; so at most 300 can go back): F1 cash 150 approved by the Owner, F2 cash 100 waiting
  ref.f1 = await addRefund(w, X, {
    actor: w.manager,
    amount: R(150),
    method: "cash",
  });
  await setStatus(w, "refunds", ref.f1, "approved", w.owner);
  ref.f2 = await addRefund(w, X, {
    actor: w.manager2,
    amount: R(100),
    method: "cash",
  });
  // F3 cash 50 approved by the Manager who recorded it (self-approved): 150 + 100 + 50 = 300, exactly the room there is
  ref.f3 = await addRefund(w, X, {
    actor: w.manager,
    amount: R(50),
    method: "cash",
  });
  await setStatus(w, "refunds", ref.f3, "approved", w.manager);
  await stamp("refunds", ref.f1, 4, 9);
  await stamp("refunds", ref.f2, 3, 9);
  await stamp("refunds", ref.f3, 2, 9);
  void uid;
});

describe("payment_list: rows exactly as stored (PGL-01..)", () => {
  it("PGL-01: six payments, newest payment date first, each with booking, guest, status, flags and file count", async () => {
    const rows = await plist();
    expect(rows.length).toBe(6);
    expect(codes(rows, "payment_id")).toEqual([
      pay.p6,
      pay.p5,
      pay.p4,
      pay.p3,
      pay.p2,
      pay.p1,
    ]);
    for (const r of rows) expect(num(r, "total_rows")).toBe(6);
    const by = (id: string) => rows.find((r) => r.payment_id === id)!;
    expect([
      num(by(pay.p1), "amount_paise"),
      by(pay.p1).status,
      by(pay.p1).is_self_approved,
    ]).toEqual([R(1000), "approved", false]);
    expect([
      num(by(pay.p2), "amount_paise"),
      by(pay.p2).status,
      by(pay.p2).method,
      num(by(pay.p2), "proof_count"),
    ]).toEqual([R(2000), "waiting", "upi", 1]);
    expect([
      by(pay.p3).status,
      by(pay.p3).rejection_reason,
      by(pay.p3).decided_by_name,
    ]).toEqual(["rejected", "Wrong booking", "Test Owner"]);
    expect([
      by(pay.p4).status,
      by(pay.p4).is_self_approved,
      by(pay.p4).decided_by_name,
    ]).toEqual(["approved", true, "Test Manager One"]);
    expect([by(pay.p5).status, by(pay.p5).reversal_reason]).toEqual([
      "reversed",
      "Entered twice",
    ]);
    expect([
      by(pay.p6).booking_code,
      by(pay.p6).provider_name !== null,
      num(by(pay.p6), "proof_count"),
      by(pay.p6).recorded_by_name,
    ]).toEqual([Y.code, true, 1, "Test Manager Two"]);
    expect(by(pay.p1).booking_code).toBe(X.code);
    expect(by(pay.p1).guest_name).toBe("Test Guest");
    expect(by(pay.p1).recorded_by_name).toBe("Test Manager One");
    expect(by(pay.p2).decided_by_name).toBeNull(); // nobody has decided a waiting payment
  });

  it("PGL-02: the amounts listed are the raw table amounts; rejected and reversed rows are listed with their status", async () => {
    const raw = await q(
      `select id, amount_paise, status::text s from public.payments`,
    );
    const rows = await plist();
    for (const r of rows) {
      const x = raw.find((z) => z.id === r.payment_id)!;
      expect([num(r, "amount_paise"), r.status]).toEqual([
        Number(x.amount_paise),
        x.s,
      ]);
    }
    expect(codes(await plist({ status: "rejected" }), "payment_id")).toEqual([
      pay.p3,
    ]);
    expect(codes(await plist({ status: "reversed" }), "payment_id")).toEqual([
      pay.p5,
    ]);
    expect(codes(await plist({ status: "waiting" }), "payment_id")).toEqual([
      pay.p6,
      pay.p2,
    ]);
    expect((await plist({ status: "approved" })).length).toBe(2);
  });

  it("PGL-03: method and provider filters", async () => {
    expect(codes(await plist({ method: "upi" }), "payment_id")).toEqual([
      pay.p2,
    ]);
    expect(codes(await plist({ method: "card" }), "payment_id")).toEqual([
      pay.p6,
    ]);
    expect((await plist({ method: "cash" })).length).toBe(4);
    expect(codes(await plist({ provider: upi }), "payment_id")).toEqual([
      pay.p2,
    ]);
    expect(codes(await plist({ provider: card }), "payment_id")).toEqual([
      pay.p6,
    ]);
    expect(await plist({ method: "cheque" })).toEqual([]);
  });

  it("PGL-04: payment date and entry date are different filters; both ends are inclusive", async () => {
    expect(
      codes(await plist({ from: day.get(-3), to: day.get(-2) }), "payment_id"),
    ).toEqual([pay.p5, pay.p4]);
    expect(
      codes(await plist({ from: day.get(-6), to: day.get(-6) }), "payment_id"),
    ).toEqual([pay.p1]);
    // entry dates: P1 10 days ago, P2 9, P3 8, P4 7, P5 6, P6 5
    expect(
      codes(
        await plist({
          date_type: "entry",
          from: day.get(-10),
          to: day.get(-9),
        }),
        "payment_id",
      ),
    ).toEqual([pay.p2, pay.p1]);
    expect(
      codes(
        await plist({ date_type: "entry", from: day.get(-5) }),
        "payment_id",
      ),
    ).toEqual([pay.p6]);
    expect(
      codes(
        await plist({ date_type: "entry", to: day.get(-10) }),
        "payment_id",
      ),
    ).toEqual([pay.p1]);
  });

  it("PGL-05: recorded-by and self-approved filters", async () => {
    expect((await plist({ recorded_by: w.manager })).length).toBe(4);
    expect((await plist({ recorded_by: w.manager2 })).length).toBe(2);
    expect(codes(await plist({ self_approved: true }), "payment_id")).toEqual([
      pay.p4,
    ]);
    expect((await plist({ self_approved: false })).length).toBe(6); // FALSE means "do not filter"
  });

  it("PGL-06: booking and resort filters (the booking page's Payments tab uses the booking filter)", async () => {
    expect((await plist({ booking: X.id })).length).toBe(5);
    expect(codes(await plist({ booking: Y.id }), "payment_id")).toEqual([
      pay.p6,
    ]);
    expect(
      codes(await plist({ resort: w.resorts.B.id }), "payment_id"),
    ).toEqual([pay.p6]);
    expect((await plist({ resort: w.resorts.A.id })).length).toBe(5);
  });

  it("PGL-07: search by payment number, Booking ID, guest name and reference; wildcards are plain letters", async () => {
    const code = (
      await q<{ c: string }>(
        `select payment_code c from public.payments where id = $1`,
        [pay.p2],
      )
    )[0].c;
    expect(codes(await plist({ q: code }), "payment_id")).toEqual([pay.p2]);
    expect((await plist({ q: Y.code })).length).toBe(1);
    expect((await plist({ q: "test guest" })).length).toBe(6);
    const refNo = (
      await q<{ r: string }>(
        `select reference_number r from public.payments where id = $1`,
        [pay.p3],
      )
    )[0].r;
    expect(codes(await plist({ q: refNo }), "payment_id")).toEqual([pay.p3]);
    for (const bad of ["%", "_", "\\", "' or 1=1 --"])
      expect(await plist({ q: bad })).toEqual([]);
    expect((await plist({ q: "   " })).length).toBe(6);
  });

  it("PGL-08: paging, the total on every page, and the approval-queue order (oldest entered first)", async () => {
    const p1 = await plist({ limit: 4, offset: 0 });
    const p2 = await plist({ limit: 4, offset: 4 });
    expect([p1.length, p2.length]).toEqual([4, 2]);
    expect([...p1, ...p2].every((r) => num(r, "total_rows") === 6)).toBe(true);
    expect((await plist({ limit: 0 })).length).toBe(1);
    expect((await plist({ limit: -3, offset: -9 })).length).toBe(1);
    expect(await plist({ offset: 99 })).toEqual([]);
    const queue = await plist({ status: "waiting", oldest_first: true });
    expect(codes(queue, "payment_id")).toEqual([pay.p2, pay.p6]); // P2 entered 9 days ago, P6 5 days ago
    expect(codes(await plist({ oldest_first: true }), "payment_id")).toEqual([
      pay.p1,
      pay.p2,
      pay.p3,
      pay.p4,
      pay.p5,
      pay.p6,
    ]);
  });

  it("PGL-09: a hidden file is not counted (the last file of a UPI/card payment cannot be hidden, a second one can)", async () => {
    const own = async () =>
      num((await plist({ booking: Y.id }))[0], "proof_count");
    expect(await own()).toBe(1);
    await w.db.tx({ role: "postgres", uid: w.owner }, async () => {
      await addProof(w, { paymentId: pay.p6, bookingId: Y.id });
    });
    expect(await own()).toBe(2);
    const [extra] = await q<{ id: string }>(
      `select id from public.proofs where payment_id = $1 order by uploaded_at desc limit 1`,
      [pay.p6],
    );
    await as(w.manager, () =>
      q(`select public.hide_proof($1, 'Wrong picture chosen')`, [extra.id]),
    );
    expect(await own()).toBe(1);
  });
  it("PGL-10: bad input is refused in plain terms", async () => {
    await expectDbError(plist({ date_type: "birthday" }), "INVALID_INPUT");
    await expectDbError(
      plist({ from: day.get(2), to: day.get(1) }),
      "INVALID_INPUT",
    );
    await expectDbError(plist({ q: "x".repeat(101) }), "INVALID_INPUT");
  });
});

describe("refund_list (PGL-11..)", () => {
  it("PGL-11: three refunds with reason, status, flags; newest refund date first", async () => {
    const rows = await rlist();
    expect(rows.length).toBe(3);
    const by = (id: string) => rows.find((r) => r.refund_id === id)!;
    expect([
      num(by(ref.f1), "amount_paise"),
      by(ref.f1).status,
      by(ref.f1).reason,
      by(ref.f1).is_self_approved,
    ]).toEqual([R(150), "approved", "Test refund", false]);
    expect([
      num(by(ref.f2), "amount_paise"),
      by(ref.f2).status,
      by(ref.f2).decided_by_name,
    ]).toEqual([R(100), "waiting", null]);
    expect([by(ref.f3).status, by(ref.f3).is_self_approved]).toEqual([
      "approved",
      true,
    ]);
    expect(by(ref.f1).booking_code).toBe(X.code);
    expect(rows.every((r) => num(r, "total_rows") === 3)).toBe(true);
  });
  it("PGL-12: filters: status, self-approved, entry date, booking, resort; search; queue order", async () => {
    expect(codes(await rlist({ status: "waiting" }), "refund_id")).toEqual([
      ref.f2,
    ]);
    expect(codes(await rlist({ self_approved: true }), "refund_id")).toEqual([
      ref.f3,
    ]);
    expect(
      codes(
        await rlist({ date_type: "entry", from: day.get(-4), to: day.get(-3) }),
        "refund_id",
      ),
    ).toEqual([ref.f2, ref.f1]);
    expect((await rlist({ booking: X.id })).length).toBe(3);
    expect(await rlist({ booking: Y.id })).toEqual([]);
    expect(await rlist({ resort: w.resorts.B.id })).toEqual([]);
    expect((await rlist({ q: "test guest" })).length).toBe(3);
    expect(await rlist({ q: "%" })).toEqual([]);
    expect(codes(await rlist({ oldest_first: true }), "refund_id")).toEqual([
      ref.f1,
      ref.f2,
      ref.f3,
    ]);
    expect(
      codes(await rlist({ recorded_by: w.manager2 }), "refund_id"),
    ).toEqual([ref.f2]);
    await expectDbError(rlist({ date_type: "payment" }), "INVALID_INPUT"); // a refund list has refund dates, not payment dates
  });
});

describe("who may call them (PGL-13..)", () => {
  const callers: [string, () => Promise<unknown>][] = [
    ["payment_list", () => q(`select * from public.payment_list()`)],
    ["refund_list", () => q(`select * from public.refund_list()`)],
  ];
  it("PGL-13: anonymous visitors are refused", async () => {
    for (const [, run] of callers)
      await expectDbError(w.db.as({ role: "anon" }, run), "permission denied");
  });
  it("PGL-14: signed-out requests, unknown logins and the server key are refused, never given an empty list", async () => {
    for (const [, run] of callers) {
      await expectDbError(
        w.db.as({ role: "authenticated", uid: null }, run),
        "NOT_ALLOWED",
      );
      await expectDbError(
        w.db.as({ role: "authenticated", uid: uid() }, run),
        "NOT_ALLOWED",
      );
      await expectDbError(
        w.db.as({ role: "service_role" }, run),
        "NOT_ALLOWED",
      );
    }
  });
  it("PGL-15: Owners and Managers see the same rows (Q10); a switched-off person is refused", async () => {
    const m = await plist({}, w.manager);
    const o = await plist({}, w.owner);
    expect(JSON.stringify(m)).toBe(JSON.stringify(o));
    expect(JSON.stringify(await rlist({}, w.manager2))).toBe(
      JSON.stringify(await rlist({}, w.owner)),
    );
    await w.db.tx({ role: "postgres", uid: w.owner }, async () => {
      await q(
        `update public.user_profiles set is_active = false where id = $1`,
        [w.manager2],
      );
    });
    for (const [, run] of callers)
      await expectDbError(
        w.db.as({ role: "authenticated", uid: w.manager2 }, run),
        "NOT_ALLOWED",
      );
  });
  it("PGL-16: reading a list changes nothing: statuses, amounts, versions and the audit log are the same afterwards", async () => {
    const snap = async () =>
      JSON.stringify([
        await q(
          `select id, status::text, amount_paise, version from public.payments order by id`,
        ),
        await q(
          `select id, status::text, amount_paise, version from public.refunds order by id`,
        ),
        await q(`select count(*)::text n from public.audit_logs`),
      ]);
    const before = await snap();
    await plist({ status: "waiting", oldest_first: true });
    await rlist({ q: "test" });
    expect(await snap()).toBe(before);
  });
});
