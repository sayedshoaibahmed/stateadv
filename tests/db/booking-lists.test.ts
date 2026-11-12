/**
 * Booking list and guest list functions (migration 21; UI spec 3.3 and 3.12). BKL-01..
 * Five fictional bookings with every figure calculated BY HAND (in the comments below); the functions must give exactly
 * those numbers and the same numbers as the raw booking_financials view. Today is D; every date is an offset from it.
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
const R = (rupees: number) => rupees * 100;
const day = new Map<number, string>();
let R1: Booking, R2: Booking, R3: Booking, R4: Booking, R5: Booking;
let ashaId: string, raviId: string;

type Row = Record<string, unknown>;
const q = <T = Row>(sql: string, p?: unknown[]) => w.db.q<T>(sql, p);
const as = <T>(id: string | null, fn: () => Promise<T>) =>
  w.db.as({ role: "authenticated", uid: id }, fn);

async function money(
  b: Booking,
  status: "approved" | "waiting",
  amount: number,
  dateOff: number,
) {
  const id = uid();
  await w.db.exec("set session_replication_role = replica");
  try {
    await q(
      `insert into public.payments (id, payment_code, booking_id, resort_id, amount_paise, method, payment_date, status,
         recorded_by, recorded_at, idempotency_key, approved_by, approved_at)
       values ($1, $2, $3, $4, $5, 'cash', public.today_ist() + $6::int, $7::public.approval_status, $8, now(), $9,
         $10, $11)`,
      [
        id,
        `${b.code}-P-${id.slice(0, 6)}`,
        b.id,
        b.resortId,
        amount,
        dateOff,
        status,
        w.manager,
        uid(),
        status === "approved" ? w.owner : null,
        status === "approved" ? new Date().toISOString() : null,
      ],
    );
  } finally {
    await w.db.exec("set session_replication_role = origin");
  }
}

/** Fictional guest details on a booking (the snapshot columns), set without the guard triggers. */
async function setGuest(
  b: Booking,
  guestId: string,
  name: string,
  mobile: string,
) {
  await w.db.exec("set session_replication_role = replica");
  try {
    await q(
      `update public.bookings set guest_id = $2, guest_name = $3, guest_mobile = $4 where id = $1`,
      [b.id, guestId, name, mobile],
    );
  } finally {
    await w.db.exec("set session_replication_role = origin");
  }
}

const list = async (
  args: Record<string, unknown> = {},
  actor: string | null = w.manager,
) => {
  const names = [
    "q",
    "resort",
    "status",
    "date_type",
    "from",
    "to",
    "co_category",
    "method",
    "has_pending",
    "has_waiting",
    "refund_due",
    "adjusted",
    "limit",
    "offset",
  ];
  const casts: Record<string, string> = {
    resort: "::uuid",
    status: "::public.booking_status",
    from: "::date",
    to: "::date",
    co_category: "::smallint",
    method: "::public.pricing_method",
  };
  const params: unknown[] = [];
  const parts = Object.keys(args).map((k) => {
    if (!names.includes(k)) throw new Error(`bad arg ${k}`);
    params.push(args[k]);
    return `p_${k} => $${params.length}${casts[k] ?? ""}`;
  });
  return as(actor, () =>
    q(`select * from public.booking_list(${parts.join(", ")})`, params),
  );
};
const codes = (rows: Row[]) => rows.map((r) => r.booking_code as string);

beforeAll(async () => {
  w = await setupWorld();
  for (let n = -12; n <= 12; n++) day.set(n, await dateOffset(w.db, n));
  const mk = (name: string, mobile: string, email: string | null) =>
    as(w.manager, async () => {
      const [{ g }] = await q<{ g: string }>(
        `select public.upsert_guest(null, $1, $2, $3, null, null)::text g`,
        [name, mobile, email],
      );
      return g;
    });
  ashaId = await mk("Asha Verma", "+91 98765 11111", "asha@test.example");
  raviId = await mk("Ravi Kumar", "91111 22222", null);
  await mk("Meena Nobooking", "90000 00000", null);

  // R1 resort A, Asha. Rs 5,000 (2 x Rs 2,500, per stay). Booked D-3, in D+2. Rs 2,000 approved. -> pending 3,000
  R1 = await createBooking(w, {
    resort: "A",
    bookingDateOffset: -3,
    checkInOffset: 2,
    plan: [{ label: "Balance", dueOffset: 2, amount: R(5000) }],
  });
  await money(R1, "approved", R(2000), -3);
  await setGuest(R1, ashaId, "Asha Verma", "+91 98765 11111");

  // R2 resort A, Ravi. Rs 2,000 (1 x Rs 2,000). Booked D-10, in D-8. Rs 2,000 approved. -> pending 0
  R2 = await createBooking(w, {
    resort: "A",
    pax: 1,
    tariff: R(2000),
    bookingDateOffset: -10,
    checkInOffset: -8,
    plan: [{ label: "Balance", dueOffset: -8, amount: R(2000) }],
  });
  await money(R2, "approved", R(2000), -9);
  await setGuest(R2, raviId, "Ravi Kumar", "91111 22222");

  // R3 resort B, Asha again, Agent "Test Agent". Rs 3,000 (2 x Rs 1,500). Booked D-1, in D+5. Rs 1,000 WAITING.
  //    -> approved 0, waiting 1,000, pending 2,000 (a waiting payment is "recorded", so it is no longer pending)
  R3 = await createBooking(w, {
    resort: "B",
    tariff: R(1500),
    bookingDateOffset: -1,
    checkInOffset: 5,
    co: { category: "agent", partnerId: w.agentId },
    plan: [{ label: "Balance", dueOffset: 5, amount: R(3000) }],
  });
  await money(R3, "waiting", R(1000), -1);
  await setGuest(R3, ashaId, "Asha Verma", "+91 98765 11111");

  // R4 resort B, Ravi. Rs 5,000 (1 x Rs 5,000). Booked D-5, in D-3. Rs 2,000 approved, then CANCELLED with a Rs 500
  //    charge: Amount Due 500, approved 2,000 -> refund due 1,500, pending 0
  R4 = await createBooking(w, {
    resort: "B",
    pax: 1,
    tariff: R(5000),
    bookingDateOffset: -5,
    checkInOffset: -3,
    plan: [{ label: "Balance", dueOffset: -4, amount: R(5000) }],
  });
  await money(R4, "approved", R(2000), -4);
  await cancelBooking(w, R4, {
    charge: R(500),
    lockedPast: R(5000),
    supersedeFuture: false,
    adjustment: R(-4500),
  });
  await setGuest(R4, raviId, "Ravi Kumar", "91111 22222");

  // R5 resort A, Asha. 2 x Rs 2,500 = 5,000, Rs 500 off by hand -> Rs 4,500 (adjusted). Booked D-2, in D+10. No money.
  R5 = await createBooking(w, {
    resort: "A",
    bookingDateOffset: -2,
    checkInOffset: 10,
    adjustment: -R(500),
    adjustmentReason: "Regular guest",
    plan: [{ label: "Balance", dueOffset: 10, amount: R(4500) }],
  });
  await setGuest(R5, ashaId, "Asha Verma", "+91 98765 11111");
});

describe("booking_list: the rows and their money (BKL-01..04)", () => {
  it("BKL-01: every booking, newest booking date first, with the hand-calculated figures", async () => {
    const rows = await list();
    expect(codes(rows)).toEqual([R3.code, R5.code, R1.code, R4.code, R2.code]);
    const by = (b: Booking) => rows.find((r) => r.booking_code === b.code)!;
    const n = (r: Row, k: string) => Number(r[k]);
    expect([
      n(by(R1), "amount_due_paise"),
      n(by(R1), "approved_paise"),
      n(by(R1), "waiting_paise"),
      n(by(R1), "pending_paise"),
    ]).toEqual([R(5000), R(2000), 0, R(3000)]);
    expect([
      n(by(R2), "amount_due_paise"),
      n(by(R2), "approved_paise"),
      n(by(R2), "pending_paise"),
    ]).toEqual([R(2000), R(2000), 0]);
    expect([
      n(by(R3), "approved_paise"),
      n(by(R3), "waiting_paise"),
      n(by(R3), "pending_paise"),
    ]).toEqual([0, R(1000), R(2000)]);
    expect([
      n(by(R4), "amount_due_paise"),
      n(by(R4), "approved_paise"),
      n(by(R4), "refund_due_paise"),
      n(by(R4), "pending_paise"),
    ]).toEqual([R(500), R(2000), R(1500), 0]);
    expect([n(by(R5), "amount_due_paise"), n(by(R5), "pending_paise")]).toEqual(
      [R(4500), R(4500)],
    );
    expect(by(R5).adjusted).toBe(true);
    expect(by(R1).adjusted).toBe(false);
    for (const r of rows) expect(Number(r.total_rows)).toBe(5);
  });

  it("BKL-02: the figures equal the booking_financials view row by row", async () => {
    const rows = await list();
    const view = await as(w.manager, () =>
      q(`select * from public.booking_financials`),
    );
    for (const r of rows) {
      const f = view.find((x) => x.booking_id === r.booking_id)!;
      expect(Number(r.amount_due_paise)).toBe(Number(f.due_paise));
      expect(Number(r.approved_paise)).toBe(Number(f.total_collection_paise));
      expect(Number(r.waiting_paise)).toBe(Number(f.waiting_paise));
      expect(Number(r.pending_paise)).toBe(Number(f.pending_paise));
      expect(Number(r.refund_due_paise)).toBe(Number(f.refund_due_paise));
    }
  });

  it("BKL-03: names, mobile and C/O are the booking's own copy", async () => {
    const r = (await list({ q: R3.code }))[0];
    expect(r.guest_name).toBe("Asha Verma");
    expect(r.guest_mobile).toBe("+91 98765 11111");
    expect(r.co_category_name).toBe("Agent");
    expect(r.co_name).toBe("Test Agent");
    expect(Number(r.pax)).toBe(2);
  });

  it("BKL-04: paging: page size, offset, a stable order and the same total on every page", async () => {
    const p1 = await list({ limit: 2, offset: 0 });
    const p2 = await list({ limit: 2, offset: 2 });
    const p3 = await list({ limit: 2, offset: 4 });
    expect([p1.length, p2.length, p3.length]).toEqual([2, 2, 1]);
    expect([...codes(p1), ...codes(p2), ...codes(p3)]).toEqual([
      R3.code,
      R5.code,
      R1.code,
      R4.code,
      R2.code,
    ]);
    for (const r of [...p1, ...p2, ...p3]) expect(Number(r.total_rows)).toBe(5);
    expect(await list({ limit: 2, offset: 50 })).toEqual([]);
    expect((await list({ limit: 0 })).length).toBe(1); // a page is at least one row
    expect((await list({ limit: -5, offset: -9 })).length).toBe(1); // nonsense paging is made sensible
  });
});

describe("booking_list: search (BKL-05..08)", () => {
  it("BKL-05: by Booking ID, any part, any capitals", async () => {
    expect(codes(await list({ q: R1.code }))).toEqual([R1.code]);
    expect(codes(await list({ q: R1.code.toLowerCase() }))).toEqual([R1.code]);
    expect((await list({ q: "AAA-" })).length).toBe(3); // resort A bookings
  });
  it("BKL-06: by guest name and by C/O name", async () => {
    expect(codes(await list({ q: "asha" }))).toEqual([
      R3.code,
      R5.code,
      R1.code,
    ]);
    expect(codes(await list({ q: "ravi kumar" }))).toEqual([R4.code, R2.code]);
    expect(codes(await list({ q: "test agent" }))).toEqual([R3.code]);
  });
  it("BKL-07: by mobile number, however it was typed", async () => {
    expect(codes(await list({ q: "98765" }))).toEqual([
      R3.code,
      R5.code,
      R1.code,
    ]);
    expect(codes(await list({ q: "+91 98765 11111" }))).toEqual([
      R3.code,
      R5.code,
      R1.code,
    ]);
    expect(codes(await list({ q: "91111-22222" }))).toEqual([R4.code, R2.code]);
    expect(await list({ q: "99" })).toEqual([]); // fewer than 3 digits never matches a number
  });
  it("BKL-08: % _ and \\ are ordinary letters, not wildcards; nothing found gives an empty list", async () => {
    expect(await list({ q: "%" })).toEqual([]);
    expect(await list({ q: "_" })).toEqual([]);
    expect(await list({ q: "\\" })).toEqual([]);
    expect(await list({ q: "' or 1=1 --" })).toEqual([]);
    expect(await list({ q: "nobody here" })).toEqual([]);
    expect((await list({ q: "   " })).length).toBe(5); // blank = no search
    expect((await list({ q: "" })).length).toBe(5);
  });
});

describe("booking_list: filters (BKL-09..16)", () => {
  it("BKL-09: resort and status", async () => {
    expect(codes(await list({ resort: w.resorts.B.id }))).toEqual([
      R3.code,
      R4.code,
    ]);
    expect(codes(await list({ status: "cancelled" }))).toEqual([R4.code]);
    expect((await list({ status: "confirmed" })).length).toBe(4);
    expect(await list({ status: "no_show" })).toEqual([]);
  });
  it("BKL-10: booking-date range is inclusive at both ends", async () => {
    expect(
      codes(
        await list({
          date_type: "booking",
          from: day.get(-3),
          to: day.get(-1),
        }),
      ),
    ).toEqual([R3.code, R5.code, R1.code]);
    expect(
      codes(
        await list({
          date_type: "booking",
          from: day.get(-3),
          to: day.get(-3),
        }),
      ),
    ).toEqual([R1.code]);
    expect(
      codes(await list({ date_type: "booking", from: day.get(-2) })),
    ).toEqual([R3.code, R5.code]);
    expect(
      codes(await list({ date_type: "booking", to: day.get(-10) })),
    ).toEqual([R2.code]);
  });
  it("BKL-11: check-in and check-out ranges use the India calendar date", async () => {
    expect(
      codes(
        await list({ date_type: "check_in", from: day.get(0), to: day.get(6) }),
      ),
    ).toEqual([R3.code, R1.code]);
    expect(
      codes(
        await list({
          date_type: "check_in",
          from: day.get(-8),
          to: day.get(-8),
        }),
      ),
    ).toEqual([R2.code]);
    // every fixture stay is one night: check-out = check-in + 1 day
    expect(
      codes(
        await list({
          date_type: "check_out",
          from: day.get(-7),
          to: day.get(-7),
        }),
      ),
    ).toEqual([R2.code]);
    expect(
      codes(
        await list({
          date_type: "check_out",
          from: day.get(11),
          to: day.get(11),
        }),
      ),
    ).toEqual([R5.code]);
  });
  it("BKL-12: C/O category and pricing method", async () => {
    expect(codes(await list({ co_category: w.cat.agent }))).toEqual([R3.code]);
    expect((await list({ co_category: w.cat.direct })).length).toBe(4);
    expect((await list({ method: "per_person_per_stay" })).length).toBe(5);
    expect(await list({ method: "per_person_per_night" })).toEqual([]);
  });
  it("BKL-13: has pending / has waiting / refund due / adjusted", async () => {
    expect(codes(await list({ has_pending: true }))).toEqual([
      R3.code,
      R5.code,
      R1.code,
    ]);
    expect(codes(await list({ has_waiting: true }))).toEqual([R3.code]);
    expect(codes(await list({ refund_due: true }))).toEqual([R4.code]);
    expect(codes(await list({ adjusted: true }))).toEqual([R5.code]);
    // FALSE and NULL mean "do not filter" (the screen only ever sends TRUE)
    expect((await list({ has_pending: false })).length).toBe(5);
  });
  it("BKL-14: filters combine (AND)", async () => {
    expect(
      codes(
        await list({ q: "asha", has_pending: true, resort: w.resorts.A.id }),
      ),
    ).toEqual([R5.code, R1.code]);
    expect(await list({ q: "asha", status: "cancelled" })).toEqual([]);
  });
  it("BKL-15: a waiting REFUND also counts as 'has waiting'", async () => {
    const id = uid();
    await w.db.exec("set session_replication_role = replica");
    try {
      await q(
        `insert into public.refunds (id, refund_code, booking_id, resort_id, amount_paise, method, refund_date, status,
           recorded_by, recorded_at, idempotency_key, reason)
         values ($1, $2, $3, $4, 100, 'cash', public.today_ist(), 'waiting', $5, now(), $6, 'test')`,
        [id, `${R2.code}-R-1`, R2.id, R2.resortId, w.manager, uid()],
      );
    } finally {
      await w.db.exec("set session_replication_role = origin");
    }
    expect(codes(await list({ has_waiting: true }))).toEqual([
      R3.code,
      R2.code,
    ]);
    // a waiting refund changes no money figure of the list (D1)
    const r2 = (await list({ q: R2.code }))[0];
    expect([
      Number(r2.approved_paise),
      Number(r2.pending_paise),
      Number(r2.refund_due_paise),
    ]).toEqual([R(2000), 0, 0]);
    await w.db.exec("set session_replication_role = replica");
    await q(`delete from public.refunds where id = $1`, [id]);
    await w.db.exec("set session_replication_role = origin");
  });
  it("BKL-16: bad input is refused in plain terms", async () => {
    await expectDbError(list({ date_type: "birthday" }), "INVALID_INPUT");
    await expectDbError(
      list({ from: day.get(2), to: day.get(1) }),
      "INVALID_INPUT",
    );
    await expectDbError(list({ q: "x".repeat(101) }), "INVALID_INPUT");
  });
});

describe("guest_list (BKL-17..20)", () => {
  const glist = async (
    args: { q?: string; limit?: number; offset?: number } = {},
    actor: string | null = w.manager,
  ) =>
    as(actor, () =>
      q(
        `select g.*, g.last_check_in::text as last_in from public.guest_list(p_q => $1, p_limit => $2, p_offset => $3) g`,
        [args.q ?? null, args.limit ?? 25, args.offset ?? 0],
      ),
    );

  it("BKL-17: each guest with booking count, last check-in and money totals (by hand)", async () => {
    const rows = await glist({ q: "a" });
    const g = (name: string) => rows.find((r) => r.full_name === name)!;
    // Asha: R1, R3, R5 -> 3 bookings; last check-in D+10 (R5); net collection 2,000 (R1) + 0 + 0; pending 3,000 + 2,000 + 4,500
    const asha = (await glist({ q: "asha" }))[0];
    expect(Number(asha.bookings)).toBe(3);
    expect(asha.last_in).toBe(day.get(10));
    expect(Number(asha.net_collection_paise)).toBe(R(2000));
    expect(Number(asha.pending_paise)).toBe(R(9500));
    // Ravi: R2, R4 -> 2 bookings; last check-in D-3 (R4); net: R2 2,000 + R4 (2,000 approved - 0 refunds) = 4,000;
    // pending is summed over ALL bookings (rule D1): R2 0 + R4 (cancelled, charge 500 already covered by 2,000 paid) 0
    const ravi = (await glist({ q: "ravi" }))[0];
    expect(Number(ravi.bookings)).toBe(2);
    expect(ravi.last_in).toBe(day.get(-3));
    expect(Number(ravi.net_collection_paise)).toBe(R(4000));
    expect(Number(ravi.pending_paise)).toBe(0);
    expect(g).toBeDefined();
  });
  it("BKL-18: a guest without any booking is listed with zeros; search by name, email or number", async () => {
    const meena = (await glist({ q: "meena" }))[0];
    expect([
      Number(meena.bookings),
      Number(meena.net_collection_paise),
      Number(meena.pending_paise),
    ]).toEqual([0, 0, 0]);
    expect(meena.last_in).toBeNull();
    expect((await glist({ q: "asha@test" })).map((r) => r.full_name)).toEqual([
      "Asha Verma",
    ]);
    expect(
      (await glist({ q: "98765 11111" })).map((r) => r.full_name),
    ).toContain("Asha Verma");
    expect((await glist({ q: "91111" })).map((r) => r.full_name)).toEqual([
      "Ravi Kumar",
    ]);
    expect(await glist({ q: "%" })).toEqual([]);
  });
  it("BKL-19: paging and the total", async () => {
    const all = await glist({ limit: 100 });
    expect(all.length).toBe(4); // Test Guest (fixture), Asha, Ravi, Meena
    const p1 = await glist({ limit: 3, offset: 0 });
    const p2 = await glist({ limit: 3, offset: 3 });
    expect([p1.length, p2.length]).toEqual([3, 1]);
    for (const r of [...p1, ...p2]) expect(Number(r.total_rows)).toBe(4);
    expect(all.map((r) => r.full_name)).toEqual(
      [...all.map((r) => r.full_name)].sort((a, b) =>
        String(a).localeCompare(String(b)),
      ),
    );
  });
  it("BKL-20: the guest page's numbers equal the raw bookings", async () => {
    const [raw] = await q<{ n: string }>(
      `select count(*)::text n from public.bookings where guest_id = $1`,
      [ashaId],
    );
    expect(Number(raw.n)).toBe(3);
  });
  it("BKL-17b: an UNPAID cancellation charge is pending on the guest too (same figure as the booking list and the view)", async () => {
    // Kiran: one booking, Rs 2,000 (1 x Rs 2,000), cancelled with a Rs 800 charge, nothing paid:
    // Amount Due = 800, approved 0, waiting 0 -> Pending = 800 - (0 + 0 - 0) = 800; no refund due.
    const kiran = (
      await as(w.manager, () =>
        q<{ g: string }>(
          `select public.upsert_guest(null, 'Kiran Unpaid', '92222 33333', null, null, null)::text g`,
        ),
      )
    )[0].g;
    const k = await createBooking(w, {
      resort: "A",
      pax: 1,
      tariff: R(2000),
      bookingDateOffset: -4,
      checkInOffset: 4,
      plan: "auto",
    });
    await cancelBooking(w, k, {
      charge: R(800),
      newRows: [{ dueOffset: 1, amount: R(800) }],
    });
    await setGuest(k, kiran, "Kiran Unpaid", "92222 33333");
    const g = (await glist({ q: "kiran" }))[0];
    expect([
      Number(g.bookings),
      Number(g.net_collection_paise),
      Number(g.pending_paise),
    ]).toEqual([1, 0, R(800)]);
    const b = (await list({ q: k.code }))[0];
    expect([
      Number(b.amount_due_paise),
      Number(b.pending_paise),
      Number(b.refund_due_paise),
    ]).toEqual([R(800), R(800), 0]);
    const [f] = await as(w.manager, () =>
      q(
        `select pending_paise from public.booking_financials where booking_id = $1`,
        [k.id],
      ),
    );
    expect(Number(f.pending_paise)).toBe(R(800)); // the booking page reads this same column
    // once the charge is paid (approved), nothing is pending any more
    await money(k, "approved", R(800), 0);
    expect(Number((await glist({ q: "kiran" }))[0].pending_paise)).toBe(0);
    // a waiting payment already lowers Pending (D1) but not Verified Remaining
    const k2 = await createBooking(w, {
      resort: "A",
      pax: 1,
      tariff: R(1000),
      bookingDateOffset: -4,
      checkInOffset: 4,
      plan: "auto",
    });
    await setGuest(k2, kiran, "Kiran Unpaid", "92222 33333");
    await money(k2, "waiting", R(300), 0);
    const [f2] = await as(w.manager, () =>
      q(
        `select pending_paise, verified_remaining_paise from public.booking_financials where booking_id = $1`,
        [k2.id],
      ),
    );
    expect([
      Number(f2.pending_paise),
      Number(f2.verified_remaining_paise),
    ]).toEqual([R(700), R(1000)]);
    expect(Number((await glist({ q: "kiran" }))[0].pending_paise)).toBe(R(700));
  });
});

describe("who may call them (BKL-21..23)", () => {
  const callers: [string, () => Promise<unknown>][] = [
    ["booking_list", () => q(`select * from public.booking_list()`)],
    ["guest_list", () => q(`select * from public.guest_list()`)],
  ];
  it("BKL-21: anonymous visitors are refused", async () => {
    for (const [, run] of callers)
      await expectDbError(w.db.as({ role: "anon" }, run), "permission denied");
  });
  it("BKL-22: signed-out requests, unknown logins and the server key are refused, never given an empty list", async () => {
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
  it("BKL-23: Owners and Managers see the same rows (Q10); a switched-off person is refused", async () => {
    const m = await list({}, w.manager);
    const o = await list({}, w.owner);
    const m2 = await list({}, w.manager2);
    expect(JSON.stringify(m)).toBe(JSON.stringify(o));
    expect(JSON.stringify(m)).toBe(JSON.stringify(m2));
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
});
