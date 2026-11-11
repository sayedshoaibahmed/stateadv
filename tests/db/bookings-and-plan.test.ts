/**
 * Bookings, cancellation, payment plan, expected adjustments
 * (TEST_PLAN AMT-*, CO-*, BID-*, PLN-*, CAN-*, COL-11*). Fictional data only.
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
beforeAll(async () => {
  w = await setupWorld();
}, 120_000);

const q = <T = Record<string, unknown>>(sql: string, p?: unknown[]) =>
  w.db.q<T>(sql, p);
const asOwner = <T>(fn: () => Promise<T>) =>
  w.db.as({ role: "postgres", uid: w.owner }, fn);
const txOwner = <T>(fn: () => Promise<T>) =>
  w.db.tx({ role: "postgres", uid: w.owner }, fn);

const booking = async (id: string) =>
  (
    await q<Record<string, never>>(
      `select * from public.bookings where id = $1`,
      [id],
    )
  )[0] as Record<string, never>;

describe("amounts (AMT-*, Q1, Q14)", () => {
  it("AMT-01: per stay 2 x Rs2,500 = Rs5,000 - total, final and amount due are computed by the database", async () => {
    const b = await createBooking(w, {
      pax: 2,
      tariff: 250000,
      method: "per_person_per_stay",
    });
    const r = await booking(b.id);
    expect(Number(r.base_amount_paise)).toBe(500000);
    expect(Number(r.total_amount_paise)).toBe(500000);
    expect(Number(r.final_amount_paise)).toBe(500000);
    expect(Number(r.amount_due_paise)).toBe(500000);
  });

  it("AMT-02: per night 2 x Rs2,500 x 2 nights + Rs500 extra - Rs1,000 discount = Rs9,500", async () => {
    const b = await createBooking(w, {
      method: "per_person_per_night",
      nights: 2,
      extra: 50000,
      discount: 100000,
    });
    const r = await booking(b.id);
    expect(Number(r.base_amount_paise)).toBe(1000000);
    expect(Number(r.total_amount_paise)).toBe(1050000);
    expect(Number(r.final_amount_paise)).toBe(950000);
    expect(r.nights).toBe(2);
  });

  it("AMT-05: a day outing (0 nights) is fine for per-stay pricing", async () => {
    const b = await createBooking(w, { nights: 0, pax: 10, tariff: 80000 });
    expect(Number((await booking(b.id)).final_amount_paise)).toBe(800000);
  });

  it("AMT-09: a manual final amount needs a reason; the calculated parts stay stored", async () => {
    await expectDbError(
      createBooking(w, { adjustment: -50000 }),
      "bookings_adjustment_reason",
    );
    const b = await createBooking(w, {
      adjustment: -50000,
      adjustmentReason: "Rounded for a regular guest",
    });
    const r = await booking(b.id);
    expect(Number(r.final_amount_paise)).toBe(450000);
    expect(Number(r.manual_adjustment_paise)).toBe(-50000);
    expect(Number(r.base_amount_paise)).toBe(500000); // original calculation is kept
  });

  it("AMT-10: the final amount can never go below zero", async () => {
    await expectDbError(
      createBooking(w, { adjustment: -600000, adjustmentReason: "x" }),
      "bookings_final_nonneg",
    );
  });

  it("AMT-06: a discount larger than the total is refused", async () => {
    await expectDbError(
      createBooking(w, { discount: 500001 }),
      "bookings_discount_range",
    );
  });

  it("AMT-11: a wrong base amount cannot be stored (the formula is enforced by the database)", async () => {
    await expectDbError(
      txOwner(() =>
        q(
          `insert into public.bookings (booking_code, resort_id, booking_year, booking_seq, guest_id, guest_name, guest_mobile, pax,
             co_category, stay_type_id, booking_date, check_in_at, check_out_at, nights, pricing_method,
             tariff_per_person_paise, base_amount_paise, idempotency_key)
           values ('AAA-2026-009999', $1, 2026, 9999, $2, 'T', '9876543210', 2, 'direct', $3, '2026-05-05',
                   '2026-05-06 14:00+05:30', '2026-05-07 11:00+05:30', 1, 'per_person_per_stay', 250000, 400000, $4)`,
          [w.resorts.A.id, w.guestId, w.stayTypeId, uid()],
        ),
      ),
      "bookings_base_formula",
    );
  });

  it("nights must match the IST dates (AMT-03, AMT-12)", async () => {
    // Only the row-level rules are under test here, so each attempt is rolled back (no plan needed).
    const attempt = (nights: number, inT: string, outT: string) =>
      w.db.as({ role: "postgres", uid: w.owner }, async () => {
        await w.db.exec("begin");
        try {
          await q(
            `insert into public.bookings (booking_code, resort_id, booking_year, booking_seq, guest_id, guest_name, guest_mobile, pax,
               co_category, stay_type_id, booking_date, check_in_at, check_out_at, nights, pricing_method,
               tariff_per_person_paise, base_amount_paise, idempotency_key)
             values ('AAA-2026-009998', $1, 2026, 9998, $2, 'T', '9876543210', 1, 'direct', $3, '2026-05-05',
                     $4::timestamptz, $5::timestamptz, $6, 'per_person_per_stay', 100, 100, $7)`,
            [w.resorts.A.id, w.guestId, w.stayTypeId, inT, outT, nights, uid()],
          );
        } finally {
          await w.db.exec("rollback");
        }
      });
    // 12 May 23:30 IST -> 13 May 00:30 IST is ONE night, even though it is only 1 hour long
    await attempt(1, "2026-05-12 23:30+05:30", "2026-05-13 00:30+05:30");
    await expectDbError(
      attempt(0, "2026-05-12 23:30+05:30", "2026-05-13 00:30+05:30"),
      "bookings_nights_match",
    );
    // 12 May 10:00 -> 20:00 the same day is a day outing: 0 nights, not 1
    await attempt(0, "2026-05-12 10:00+05:30", "2026-05-12 20:00+05:30");
    await expectDbError(
      attempt(1, "2026-05-12 10:00+05:30", "2026-05-12 20:00+05:30"),
      "bookings_nights_match",
    );
    // check-in 12 May 14:00, check-out 14 May 11:00 = 2 nights
    await attempt(2, "2026-05-12 14:00+05:30", "2026-05-14 11:00+05:30");
  });

  it("AMT-04: per-night pricing needs at least one night", async () => {
    await expectDbError(
      createBooking(w, { method: "per_person_per_night", nights: 0 }),
      "bookings_per_night_needs_night",
    );
  });
});

describe("C/O rules (CO-*, Q3)", () => {
  it("Agent needs an agent, Partner needs a partner, and the type must match", async () => {
    await createBooking(w, {
      co: { category: "agent", partnerId: w.agentId, name: "Test Agent" },
    });
    await createBooking(w, {
      co: { category: "partner", partnerId: w.partnerId, name: "Test Partner" },
    });
    await expectDbError(
      createBooking(w, {
        co: { category: "agent", partnerId: null, name: "x" },
      }),
      "CO_TYPE_MISMATCH",
    );
    await expectDbError(
      createBooking(w, {
        co: { category: "agent", partnerId: w.partnerId, name: "x" },
      }),
      "CO_TYPE_MISMATCH",
    ); // CO-02
    await expectDbError(
      createBooking(w, {
        co: { category: "partner", partnerId: w.agentId, name: "x" },
      }),
      "CO_TYPE_MISMATCH",
    );
  });
  it("Own needs a name; Direct has none", async () => {
    await createBooking(w, { co: { category: "own", name: "Test Source" } });
    await createBooking(w, { co: { category: "direct" } });
    await expectDbError(
      createBooking(w, { co: { category: "own", name: null } }),
      "bookings_co_rules",
    ); // CO-04
    await expectDbError(
      createBooking(w, { co: { category: "direct", name: "someone" } }),
      "bookings_co_rules",
    ); // CO-06
    await expectDbError(
      createBooking(w, {
        co: { category: "own", partnerId: w.agentId, name: "x" },
      }),
      "bookings_co_rules",
    );
  });
});

describe("Booking ID and frozen fields (BID-*, Q4, Q16)", () => {
  it("BID: the code must match its resort-year-sequence; duplicates are refused", async () => {
    const b = await createBooking(w, { resort: "B" });
    expect(b.code).toMatch(/^BBB-\d{4}-\d{6}$/);
    await expectDbError(
      q(
        `update public.bookings set booking_code = 'BBB-2026-123456' where id = $1`,
        [b.id],
      ),
      "ID_FIELDS_LOCKED",
    );
    // same resort + year + sequence again
    const [{ year, seq }] = await q<{ year: number; seq: number }>(
      `select booking_year as year, booking_seq as seq from public.bookings where id = $1`,
      [b.id],
    );
    await expectDbError(
      txOwner(() =>
        q(
          `insert into public.bookings (booking_code, resort_id, booking_year, booking_seq, guest_id, guest_name, guest_mobile, pax,
             co_category, stay_type_id, booking_date, check_in_at, check_out_at, nights, pricing_method,
             tariff_per_person_paise, base_amount_paise, idempotency_key)
           values ($1, $2, $3, $4, $5, 'T', '9876543210', 1, 'direct', $6, public.today_ist(),
                   now(), now() + interval '1 day', 1, 'per_person_per_stay', 100, 100, $7)`,
          [
            `BBB-${year}-${String(seq).padStart(6, "0")}`,
            w.resorts.B.id,
            year,
            seq,
            w.guestId,
            w.stayTypeId,
            uid(),
          ],
        ),
      ),
      "bookings_code_key",
    );
  });

  it("BID: a code that disagrees with its own year or sequence is refused", async () => {
    await expectDbError(
      txOwner(() =>
        q(
          `insert into public.bookings (booking_code, resort_id, booking_year, booking_seq, guest_id, guest_name, guest_mobile, pax,
             co_category, stay_type_id, booking_date, check_in_at, check_out_at, nights, pricing_method,
             tariff_per_person_paise, base_amount_paise, idempotency_key)
           values ('AAA-2025-000001', $1, 2026, 1, $2, 'T', '9876543210', 1, 'direct', $3, '2026-03-03',
                   '2026-03-04 10:00+05:30', '2026-03-05 10:00+05:30', 1, 'per_person_per_stay', 100, 100, $4)`,
          [w.resorts.A.id, w.guestId, w.stayTypeId, uid()],
        ),
      ),
      "bookings_code_matches",
    );
  });

  it("BID-05: the year comes from the BOOKING DATE, not from when it is entered", async () => {
    const b = await createBooking(w, { bookingDateOffset: -400 }); // a booking dated last year or earlier
    const r = await booking(b.id);
    const [{ y }] = await q<{ y: number }>(
      `select extract(year from booking_date)::int y from public.bookings where id = $1`,
      [b.id],
    );
    const dateYear = y;
    expect(r.booking_year).toBe(dateYear);
    expect(b.code).toContain(`-${dateYear}-`);
  });

  it("BID-09/10: resort and booking year are frozen after creation; a same-year date change is allowed", async () => {
    const b = await createBooking(w, {
      bookingDateOffset: 0,
      checkInOffset: 5,
    });
    await expectDbError(
      asOwner(() =>
        q(`update public.bookings set resort_id = $2 where id = $1`, [
          b.id,
          w.resorts.B.id,
        ]),
      ),
      "ID_FIELDS_LOCKED",
    );
    await expectDbError(
      asOwner(() =>
        q(
          `update public.bookings set booking_year = booking_year + 1 where id = $1`,
          [b.id],
        ),
      ),
      "ID_FIELDS_LOCKED",
    );
    await expectDbError(
      asOwner(() =>
        q(
          `update public.bookings set booking_date = booking_date + interval '400 days' where id = $1`,
          [b.id],
        ),
      ),
      "bookings_year_is_date",
    );
    await asOwner(() =>
      q(
        `update public.bookings set booking_date = make_date(booking_year, 1, 2) where id = $1`,
        [b.id],
      ),
    ); // same year: fine
  });

  it("BID-12: the resort code freezes after its first booking", async () => {
    const fresh = uid();
    await asOwner(() =>
      q(
        `insert into public.resorts (id, code, name) values ($1, 'NEW', 'Test Resort New')`,
        [fresh],
      ),
    );
    await asOwner(() =>
      q(`update public.resorts set code = 'NW2' where id = $1`, [fresh]),
    ); // no bookings yet: allowed
    await expectDbError(
      asOwner(() =>
        q(`update public.resorts set code = 'XXX' where id = $1`, [
          w.resorts.A.id,
        ]),
      ),
      "RESORT_CODE_LOCKED",
    );
    await asOwner(() =>
      q(
        `update public.resorts set name = 'Test Resort Alpha Renamed' where id = $1`,
        [w.resorts.A.id],
      ),
    ); // name is free
  });

  it("an inactive resort cannot receive new bookings, but old ones stay readable", async () => {
    const old = await createBooking(w, { resort: "A" });
    await asOwner(() =>
      q(`update public.resorts set is_active = false where id = $1`, [
        w.resorts.A.id,
      ]),
    );
    await expectDbError(createBooking(w, { resort: "A" }), "RESORT_INACTIVE");
    const seen = await w.db.as({ role: "authenticated", uid: w.manager }, () =>
      q<{ n: number }>(
        `select count(*)::int n from public.bookings where id = $1`,
        [old.id],
      ),
    );
    expect(seen[0].n).toBe(1);
    await asOwner(() =>
      q(`update public.resorts set is_active = true where id = $1`, [
        w.resorts.A.id,
      ]),
    );
  });

  it("the idempotency key makes a double submit impossible", async () => {
    const key = uid();
    const ins = (seq: number) =>
      txOwner(() =>
        q(
          `insert into public.bookings (booking_code, resort_id, booking_year, booking_seq, guest_id, guest_name, guest_mobile, pax,
             co_category, stay_type_id, booking_date, check_in_at, check_out_at, nights, pricing_method,
             tariff_per_person_paise, base_amount_paise, idempotency_key)
           values ($1, $2, 2026, $3, $4, 'T', '9876543210', 1, 'direct', $5, '2026-06-06',
                   '2026-06-07 10:00+05:30', '2026-06-08 10:00+05:30', 1, 'per_person_per_stay', 0, 0, $6)`,
          [
            `BBB-2026-${String(seq).padStart(6, "0")}`,
            w.resorts.B.id,
            seq,
            w.guestId,
            w.stayTypeId,
            key,
          ],
        ),
      );
    await ins(880001);
    await expectDbError(ins(880002), "bookings_idem_key");
  });
});

const cancel = (b: Booking, o: Parameters<typeof cancelBooking>[2]) =>
  cancelBooking(w, b, o);

describe("cancellation and no-show (CAN-*, Q7, Q7a, Q7c)", () => {
  it("CAN-03: cancelling keeps the original amounts; amount due becomes the charge; who/when come from the session", async () => {
    const b = await createBooking(w, {
      plan: [{ label: "Balance", dueOffset: 3, amount: 500000 }],
    });
    await cancel(b, {
      charge: 100000,
      newRows: [{ dueOffset: 0, amount: 100000 }],
    });
    const r = await booking(b.id);
    expect(r.status).toBe("cancelled");
    expect(Number(r.final_amount_paise)).toBe(500000); // original, untouched
    expect(Number(r.total_amount_paise)).toBe(500000);
    expect(Number(r.amount_due_paise)).toBe(100000); // what is now expected (Q7a)
    expect(r.cancelled_by).toBe(w.owner);
    expect(r.cancelled_at).toBeTruthy();
  });

  it("the plan must be rebuilt in the same transaction: otherwise the commit fails (PLAN_TOTAL_MISMATCH)", async () => {
    const b = await createBooking(w, {
      plan: [{ label: "Balance", dueOffset: 3, amount: 500000 }],
    });
    await expectDbError(
      txOwner(() =>
        q(
          `update public.bookings set status = 'cancelled', cancellation_charge_paise = 100000, cancellation_reason = 'x', cancellation_date = public.today_ist() where id = $1`,
          [b.id],
        ),
      ),
      "PLAN_TOTAL_MISMATCH",
    );
    expect((await booking(b.id)).status).toBe("confirmed"); // nothing was saved
  });

  it("CAN-01/02: reason, date and a charge between 0 and the final amount are required (no default charge)", async () => {
    const b = await createBooking(w);
    await expectDbError(
      cancel(b, {
        charge: 100000,
        reason: null,
        newRows: [{ dueOffset: 0, amount: 100000 }],
      }),
      "bookings_cancellation_fields",
    );
    await expectDbError(
      cancel(b, {
        charge: 500001,
        newRows: [{ dueOffset: 0, amount: 500001 }],
      }),
      "bookings_charge_range",
    );
    await expectDbError(
      cancel(b, { charge: -1, newRows: [] }),
      "bookings_charge_range",
    );
    await expectDbError(
      cancel(b, { charge: 0, date: await dateOffset(w.db, 3), newRows: [] }),
      "CANCELLATION_DATE_FUTURE",
    );
  });

  it("CAN-04: a Rs0 charge is allowed and leaves nothing expected", async () => {
    const b = await createBooking(w);
    await cancel(b, { charge: 0, newRows: [] });
    const r = await booking(b.id);
    expect(Number(r.amount_due_paise)).toBe(0);
    const [{ n }] = await q<{ n: number }>(
      `select count(*)::int n from public.payment_schedules where booking_id = $1 and superseded_at is null`,
      [b.id],
    );
    expect(n).toBe(0);
  });

  it("CAN-05..07: a no-show uses the full amount unless a reason for a different charge is given", async () => {
    const full = await createBooking(w);
    await cancel(full, {
      status: "no_show",
      charge: 500000,
      newRows: [{ dueOffset: 0, amount: 500000 }],
    });
    expect((await booking(full.id)).status).toBe("no_show");

    const partial = await createBooking(w);
    await expectDbError(
      cancel(partial, {
        status: "no_show",
        charge: 200000,
        newRows: [{ dueOffset: 0, amount: 200000 }],
      }),
      "bookings_noshow_charge",
    );
    await cancel(partial, {
      status: "no_show",
      charge: 200000,
      chargeReason: "Owner allowed a partial charge",
      newRows: [{ dueOffset: 0, amount: 200000 }],
    });
    expect(Number((await booking(partial.id)).amount_due_paise)).toBe(200000);
  });

  it("CAN-08: a cancelled booking can never be reopened or have its original amounts rewritten", async () => {
    const b = await createBooking(w);
    await cancel(b, {
      charge: 100000,
      newRows: [{ dueOffset: 0, amount: 100000 }],
    });
    await expectDbError(
      asOwner(() =>
        q(`update public.bookings set status = 'confirmed' where id = $1`, [
          b.id,
        ]),
      ),
      "STATUS_FINAL",
    );
    await expectDbError(
      asOwner(() =>
        q(`update public.bookings set status = 'checked_in' where id = $1`, [
          b.id,
        ]),
      ),
      "STATUS_FINAL",
    );
    await expectDbError(
      asOwner(() =>
        q(`update public.bookings set discount_paise = 1 where id = $1`, [
          b.id,
        ]),
      ),
      "CANCELLED_AMOUNTS_LOCKED",
    );
    await expectDbError(
      asOwner(() =>
        q(
          `update public.bookings set cancellation_reason = 'edited' where id = $1`,
          [b.id],
        ),
      ),
      "CANCELLATION_RECORD_LOCKED",
    );
  });

  it("CAN-09: correcting the charge later needs a new written reason", async () => {
    const b = await createBooking(w);
    await cancel(b, {
      charge: 100000,
      newRows: [{ dueOffset: 0, amount: 100000 }],
    });
    await expectDbError(
      txOwner(() =>
        q(
          `update public.bookings set cancellation_charge_paise = 150000 where id = $1`,
          [b.id],
        ),
      ),
      "CHARGE_CHANGE_REASON_REQUIRED",
    );
  });

  it("CAN-03b / COL-11: past-due rows stay locked; the difference becomes a negative adjustment dated today (PRD example C)", async () => {
    // Advance Rs2,000 due 40 days ago (past, locked) + Balance Rs3,000 due in 30 days. Cancel with a Rs1,000 charge.
    const b = await createBooking(w, {
      plan: [
        { label: "Advance", dueOffset: -40, amount: 200000 },
        { label: "Balance", dueOffset: 30, amount: 300000 },
      ],
    });
    await cancel(b, {
      charge: 100000,
      lockedPast: 200000,
      adjustment: -100000,
      newRows: [],
    });

    // History is preserved: the October-style row is still ACTIVE and unchanged, the future row is replaced.
    const rows = await q<{
      label: string;
      active: boolean;
      due_offset: number;
      amount_paise: string;
    }>(
      `select label, superseded_at is null as active, (due_date - public.today_ist()) as due_offset, amount_paise
       from public.payment_schedules where booking_id = $1 order by line_no`,
      [b.id],
    );
    expect(
      rows.map((r) => [r.label, r.active, Number(r.amount_paise)]),
    ).toEqual([
      ["Advance", true, 200000],
      ["Balance", false, 300000],
    ]);

    // Expected figures per date: the advance stays on its original date; the correction lands today.
    const e = await q<{ offset: number; kind: string; amount: string }>(
      `select (entry_date - public.today_ist()) as "offset", kind, amount_paise as amount from public.expected_entries where booking_id = $1 order by entry_date`,
      [b.id],
    );
    expect(e.map((x) => [Number(x.offset), x.kind, Number(x.amount)])).toEqual([
      [-40, "plan", 200000], //  history never changes
      [0, "adjustment", -100000], // correction dated today
    ]);
    // Over all time the booking expects exactly the cancellation charge (the rule: rows + adjustments = amount due).
    expect(e.reduce((s, x) => s + Number(x.amount), 0)).toBe(100000);
  });

  it("COL-11b: when the charge is higher than the locked rows, a new cancellation row is added and no adjustment is needed", async () => {
    const b = await createBooking(w, {
      plan: [
        { label: "Advance", dueOffset: -40, amount: 200000 },
        { label: "Balance", dueOffset: 30, amount: 300000 },
      ],
    });
    await cancel(b, {
      charge: 300000,
      lockedPast: 200000,
      newRows: [{ dueOffset: 0, amount: 100000 }],
    });
    const [{ total }] = await q<{ total: string }>(
      `select sum(amount_paise) total from public.expected_entries where booking_id = $1`,
      [b.id],
    );
    expect(Number(total)).toBe(300000);
    const [{ n }] = await q<{ n: number }>(
      `select count(*)::int n from public.expected_adjustments where booking_id = $1`,
      [b.id],
    );
    expect(n).toBe(0);
  });
});

describe("payment plan rules (PLN-*, Q6, D2)", () => {
  it("PLN-02: the plan must add up to the amount due - checked at commit", async () => {
    await expectDbError(
      createBooking(w, {
        plan: [{ label: "Balance", dueOffset: 2, amount: 499999 }],
      }),
      "PLAN_TOTAL_MISMATCH",
    );
    await expectDbError(
      createBooking(w, {
        plan: [
          { label: "Advance", dueOffset: 0, amount: 100000 },
          { label: "Balance", dueOffset: 2, amount: 400001 },
        ],
      }),
      "PLAN_TOTAL_MISMATCH",
    );
    await expectDbError(
      createBooking(w, { plan: "none" }),
      "PLAN_TOTAL_MISMATCH",
    ); // money due but nothing planned
  });

  it("PLN-03: any number of rows with any due dates is fine as long as they add up", async () => {
    const b = await createBooking(w, {
      plan: [
        { label: "Advance", dueOffset: 0, amount: 150000 },
        { label: "Second", dueOffset: 1, amount: 150000 },
        { label: "Balance", dueOffset: 2, amount: 200000 },
      ],
    });
    expect(b.final).toBe(500000);
  });

  it("a free (Rs0) booking needs no plan rows", async () => {
    await createBooking(w, { tariff: 0, plan: "none" });
  });

  it("PLN-07: the first plan (at creation) may include rows that are already past due", async () => {
    await createBooking(w, {
      plan: [
        { label: "Advance", dueOffset: -10, amount: 100000 },
        { label: "Balance", dueOffset: 2, amount: 400000 },
      ],
    });
  });

  /** Replace future rows with a new revision (the way the change-plan RPC will do it). */
  async function revise(
    b: Booking,
    rows: Array<{ dueOffset: number; amount: number }>,
    over?: (revId: string) => Promise<void>,
  ) {
    await txOwner(async () => {
      const revId = uid();
      const [{ maxno }] = await q<{ maxno: number }>(
        `select max(revision_no) maxno from public.payment_plan_revisions where booking_id = $1`,
        [b.id],
      );
      const [{ locked }] = await q<{ locked: string }>(
        `select coalesce(sum(amount_paise), 0) locked from public.payment_schedules where booking_id = $1 and superseded_at is null and due_date < public.today_ist()`,
        [b.id],
      );
      await q(
        `insert into public.payment_plan_revisions (id, booking_id, revision_no, source, reason, amount_due_before, amount_due_after, locked_total_paise)
         values ($1, $2, $3, 'plan_change', 'Guest asked for new dates', $4, $4, $5)`,
        [revId, b.id, maxno + 1, b.final, Number(locked)],
      );
      await q(
        `update public.payment_schedules set superseded_revision_id = $2 where booking_id = $1 and superseded_at is null and due_date >= public.today_ist()`,
        [b.id, revId],
      );
      let line = 20 + maxno * 10;
      for (const r of rows) {
        await q(
          `insert into public.payment_schedules (booking_id, revision_id, line_no, label, due_date, amount_paise)
           values ($1, $2, $3, 'Rescheduled', public.today_ist() + $4::int, $5)`,
          [b.id, revId, line++, r.dueOffset, r.amount],
        );
      }
      if (over) await over(revId);
    });
  }

  it("changing the plan replaces future rows and keeps the old ones as history", async () => {
    const b = await createBooking(w, {
      plan: [
        { label: "Advance", dueOffset: 1, amount: 200000 },
        { label: "Balance", dueOffset: 5, amount: 300000 },
      ],
    });
    await revise(b, [{ dueOffset: 7, amount: 500000 }]);
    const rows = await q<{ active: boolean; amount_paise: string }>(
      `select superseded_at is null active, amount_paise from public.payment_schedules where booking_id = $1 order by created_at, line_no`,
      [b.id],
    );
    expect(
      rows.filter((r) => r.active).map((r) => Number(r.amount_paise)),
    ).toEqual([500000]);
    expect(rows.filter((r) => !r.active)).toHaveLength(2); // old rows kept
  });

  it("PLN-05: a past-due row can never be replaced, changed or removed", async () => {
    const b = await createBooking(w, {
      plan: [
        { label: "Advance", dueOffset: -5, amount: 100000 },
        { label: "Balance", dueOffset: 5, amount: 400000 },
      ],
    });
    // trying to move the whole amount (including the locked row) fails
    await expectDbError(
      txOwner(async () => {
        const revId = uid();
        await q(
          `insert into public.payment_plan_revisions (id, booking_id, revision_no, source, reason, amount_due_before, amount_due_after, locked_total_paise)
           values ($1, $2, 2, 'plan_change', 'x', $3, $3, 100000)`,
          [revId, b.id, b.final],
        );
        await q(
          `update public.payment_schedules set superseded_revision_id = $2 where booking_id = $1 and label = 'Advance'`,
          [b.id, revId],
        );
      }),
      "PAST_DUE_ROW_LOCKED",
    );
    // editing a row in place is never allowed
    await expectDbError(
      asOwner(() =>
        q(
          `update public.payment_schedules set amount_paise = 1 where booking_id = $1`,
          [b.id],
        ),
      ),
      "PLAN_ROW_IMMUTABLE",
    );
    await expectDbError(
      asOwner(() =>
        q(
          `update public.payment_schedules set due_date = due_date + 1 where booking_id = $1 and label = 'Balance'`,
          [b.id],
        ),
      ),
      "PLAN_ROW_IMMUTABLE",
    );
    await expectDbError(
      q(`delete from public.payment_schedules where booking_id = $1`, [b.id]),
      "DELETE_NOT_ALLOWED",
    );
  });

  it("PLN-06: a later revision cannot add a row with a past date", async () => {
    const b = await createBooking(w, {
      plan: [{ label: "Advance", dueOffset: 1, amount: 500000 }],
    });
    await expectDbError(
      revise(b, [{ dueOffset: -3, amount: 500000 }]),
      "PLAN_DATE_IN_PAST",
    );
  });

  it("PLN-10: a row due TODAY is not yet past and can still be replaced", async () => {
    const b = await createBooking(w, {
      plan: [{ label: "Advance", dueOffset: 0, amount: 500000 }],
    });
    await revise(b, [{ dueOffset: 3, amount: 500000 }]);
  });

  it("plan rows cannot be added to an old revision or without a revision", async () => {
    const b = await createBooking(w, {
      plan: [{ label: "Balance", dueOffset: 2, amount: 500000 }],
    });
    await expectDbError(
      txOwner(() =>
        q(
          `insert into public.payment_schedules (booking_id, revision_id, line_no, label, due_date, amount_paise) values ($1, $2, 99, 'Sneaky', public.today_ist() + 9, 1)`,
          [b.id, b.revisionId],
        ),
      ),
      "PLAN_REVISION_CLOSED",
    );
  });

  it("revisions are numbered without gaps and must tell the truth about the amounts", async () => {
    const b = await createBooking(w);
    const rev = (n: number, before: number, after: number, locked = 0) =>
      txOwner(() =>
        q(
          `insert into public.payment_plan_revisions (booking_id, revision_no, source, reason, amount_due_before, amount_due_after, locked_total_paise)
           values ($1, $2, 'plan_change', 'x', $3, $4, $5)`,
          [b.id, n, before, after, locked],
        ).then(() =>
          q(
            `update public.payment_schedules set superseded_revision_id = (select id from public.payment_plan_revisions where booking_id = $1 and revision_no = $2) where booking_id = $1 and superseded_at is null`,
            [b.id, n],
          ).then(() =>
            q(
              `insert into public.payment_schedules (booking_id, revision_id, line_no, label, due_date, amount_paise) values ($1, (select id from public.payment_plan_revisions where booking_id = $1 and revision_no = $2), 50, 'R', public.today_ist() + 4, $3)`,
              [b.id, n, after],
            ),
          ),
        ),
      );
    await expectDbError(rev(3, b.final, b.final), "PLAN_REVISION_ORDER");
    await expectDbError(
      rev(2, b.final, b.final + 1),
      "PLAN_REVISION_AMOUNT_MISMATCH",
    ); // not the booking's real amount due
    await expectDbError(
      rev(2, 12345, b.final),
      "PLAN_REVISION_AMOUNT_MISMATCH",
    ); //        "before" is not the last "after"
    await expectDbError(
      rev(2, b.final, b.final, 777),
      "PLAN_REVISION_AMOUNT_MISMATCH",
    ); //  locked total is wrong
    await rev(2, b.final, b.final);
  });

  it("PLN-09: revisions and adjustments are permanent; adjustments are always dated today", async () => {
    const b = await createBooking(w, {
      plan: [
        { label: "Advance", dueOffset: -9, amount: 100000 },
        { label: "Balance", dueOffset: 4, amount: 400000 },
      ],
    });
    await expectDbError(
      txOwner(async () => {
        const revId = uid();
        await q(
          `insert into public.payment_plan_revisions (id, booking_id, revision_no, source, reason, amount_due_before, amount_due_after, locked_total_paise) values ($1, $2, 2, 'plan_change', 'x', $3, $3, 100000)`,
          [revId, b.id, b.final],
        );
        await q(
          `insert into public.expected_adjustments (booking_id, revision_id, adjustment_date, amount_paise, source, reason)
           values ($1, $2, public.today_ist() - 3, -1000, 'plan_change', 'backdated')`,
          [b.id, revId],
        );
      }),
      "ADJUSTMENT_DATE_INVALID",
    );
    const own = await createBooking(w, {
      plan: [
        { label: "Advance", dueOffset: -9, amount: 200000 },
        { label: "Balance", dueOffset: 4, amount: 300000 },
      ],
    });
    await cancel(own, {
      charge: 100000,
      lockedPast: 200000,
      adjustment: -100000,
      newRows: [],
    }); // a real adjustment now exists
    await expectDbError(
      q(`update public.expected_adjustments set reason = 'x'`),
      "RECORD_IS_APPEND_ONLY",
    );
    await expectDbError(
      q(`delete from public.expected_adjustments`),
      "DELETE_NOT_ALLOWED",
    );
  });
});

describe("normal status changes and optimistic locking", () => {
  it("a booking moves confirmed -> checked_in -> checked_out; each change bumps the version", async () => {
    const b = await createBooking(w);
    const v1 = (await booking(b.id)).version;
    await asOwner(() =>
      q(`update public.bookings set status = 'checked_in' where id = $1`, [
        b.id,
      ]),
    );
    await asOwner(() =>
      q(`update public.bookings set status = 'checked_out' where id = $1`, [
        b.id,
      ]),
    );
    const r = await booking(b.id);
    expect(r.status).toBe("checked_out");
    expect(r.version).toBe(v1 + 2);
    expect(r.updated_by).toBe(w.owner);
  });

  it("EDT-07: the guest snapshot on a booking does not change when the guest record changes", async () => {
    const b = await createBooking(w);
    await asOwner(() =>
      q(
        `update public.guests set full_name = 'Renamed Guest', mobile = '9000000000' where id = $1`,
        [w.guestId],
      ),
    );
    const r = await booking(b.id);
    expect(r.guest_name).toBe("Test Guest");
    expect(r.guest_mobile).toBe("9876543210");
    const [g] = await q<{ mobile_normalized: string }>(
      `select mobile_normalized from public.guests where id = $1`,
      [w.guestId],
    );
    expect(g.mobile_normalized).toBe("9000000000");
  });

  it("mobile numbers are normalised for search: +91 and leading 0 are removed", async () => {
    const rows = await q<{ n: string }>(
      `select public.normalize_mobile(x) n from unnest(array['+91 98765 43210','098765 43210','98765-43210','919876543210']) x`,
    );
    expect(rows.map((r) => r.n)).toEqual([
      "9876543210",
      "9876543210",
      "9876543210",
      "9876543210",
    ]);
  });
});
