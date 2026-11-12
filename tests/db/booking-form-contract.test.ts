/**
 * The booking screens and the database agree (M4). The payload the booking form builds (src/lib/bookings/form.ts) is
 * sent to the REAL database functions; what the screen previewed must be exactly what the database stored.
 * Expected values are calculated by hand in the comments. BFC-01..
 */
import { beforeAll, describe, expect, it } from "vitest";
import { expectDbError } from "./harness";
import { dateOffset, setupWorld, uid, type World } from "./fixtures";
import {
  buildPayload,
  emptyForm,
  previewAmounts,
  valuesFromBooking,
  type BookingFormValues,
} from "@/lib/bookings/form";
import { checkEditPlan, isPlanPreview } from "@/lib/bookings/plan";

let w: World;
const R = (rupees: number) => rupees * 100;
const day = new Map<number, string>();
type Row = Record<string, unknown>;
const q = <T = Row>(sql: string, p?: unknown[]) => w.db.q<T>(sql, p);
const as = <T>(fn: () => Promise<T>) =>
  w.db.as({ role: "authenticated", uid: w.manager }, fn);

function form(over: Partial<BookingFormValues> = {}): BookingFormValues {
  return {
    ...emptyForm(day.get(0)),
    resortId: w.resorts.A.id,
    guestName: "Asha Verma",
    guestMobile: "+91 98765 43210",
    stayTypeId: String(w.stayTypeId),
    bookingDate: day.get(0)!,
    checkInDate: day.get(3)!,
    checkOutDate: day.get(5)!,
    coCategoryId: String(w.cat.direct),
    pax: "2",
    pricingMethod: "per_person_per_night",
    tariff: "2500",
    ...over,
  };
}
const create = async (v: BookingFormValues, key = uid()) => {
  const { payload, plan } = buildPayload(v, "create");
  const [{ r }] = await as(() =>
    q<{ r: Row }>(
      `select public.create_booking($1::jsonb, $2::jsonb, $3::uuid) as r`,
      [JSON.stringify(payload), JSON.stringify(plan), key],
    ),
  );
  return r as { id: string; booking_code: string; duplicate: boolean };
};
/** The booking as the app reads it (JSON, like PostgREST gives it: dates and times as text). */
const booking = async (id: string) =>
  (
    await q<{ j: Row }>(
      `select to_jsonb(b) as j from public.bookings b where b.id = $1`,
      [id],
    )
  )[0].j;
const preview = async (id: string, newDue: number | null = null) => {
  const [{ r }] = await as(() =>
    q<{ r: unknown }>(`select public.plan_preview($1, $2) as r`, [id, newDue]),
  );
  if (!isPlanPreview(r)) throw new Error("bad preview");
  return r;
};

beforeAll(async () => {
  w = await setupWorld();
  for (let n = -3; n <= 12; n++) day.set(n, await dateOffset(w.db, n));
});

describe("the form's preview equals what the database stores (BFC-01..)", () => {
  it("BFC-01: per night: 2 people x Rs 2,500 x 2 nights (3rd -> 5th) = Rs 10,000; IST times; Booking ID format", async () => {
    const v = form({
      plan: [
        { label: "Advance", dueDate: day.get(0)!, amount: "4000" },
        { label: "Balance", dueDate: day.get(3)!, amount: "6000" },
      ],
    });
    const a = previewAmounts(v);
    expect(a).toMatchObject({ ok: true, nights: 2, finalPaise: R(10000) });
    const r = await create(v);
    expect(r.duplicate).toBe(false);
    expect(r.booking_code).toMatch(
      new RegExp(`^AAA-${day.get(0)!.slice(0, 4)}-000001$`),
    );
    const b = await booking(r.id);
    expect(b).toMatchObject({
      nights: 2,
      pax: 2,
      base_amount_paise: R(10000),
      final_amount_paise: R(10000),
      amount_due_paise: R(10000),
      status: "confirmed",
      guest_name: "Asha Verma",
    });
    const [{ t_in, t_out }] = await q<{ t_in: string; t_out: string }>(
      `select to_char(check_in_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') t_in, to_char(check_out_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') t_out from public.bookings where id = $1`,
      [r.id],
    );
    expect([t_in, t_out]).toEqual([
      `${day.get(3)} 14:00`,
      `${day.get(5)} 11:00`,
    ]);
    const rows = await q(
      `select label, amount_paise, due_date::text d from public.payment_schedules where booking_id = $1 order by line_no`,
      [r.id],
    );
    expect(rows.map((x) => [x.label, Number(x.amount_paise), x.d])).toEqual([
      ["Advance", R(4000), day.get(0)],
      ["Balance", R(6000), day.get(3)],
    ]);
  });

  it("BFC-02: extras, discount and a changed final amount: 5,000 + 500 - 300 = 5,200, changed to 4,900 (-300 adjustment)", async () => {
    const v = form({
      pricingMethod: "per_person_per_stay",
      extra: "500",
      extraNote: "Bonfire",
      discount: "300",
      changeFinal: true,
      finalOverride: "4900",
      adjustmentReason: "Regular guest",
      plan: [{ label: "Balance", dueDate: day.get(3)!, amount: "4900" }],
    });
    const a = previewAmounts(v);
    expect(a).toMatchObject({
      ok: true,
      calculatedFinalPaise: R(5200),
      finalPaise: R(4900),
      manualAdjustmentPaise: R(-300),
    });
    const r = await create(v);
    expect(await booking(r.id)).toMatchObject({
      base_amount_paise: R(5000),
      total_amount_paise: R(5500),
      final_amount_paise: R(4900),
      manual_adjustment_paise: R(-300),
      manual_adjustment_reason: "Regular guest",
      extra_charges_note: "Bonfire",
    });
  });

  it("BFC-03: the same form for every nights case: same IST date = 0 nights per stay; late check-out next morning = 1 night", async () => {
    const stay0 = form({
      pricingMethod: "per_person_per_stay",
      checkOutDate: day.get(3)!,
      checkOutTime: "18:00",
      plan: [{ label: "Balance", dueDate: day.get(3)!, amount: "5000" }],
    });
    expect(await booking((await create(stay0)).id)).toMatchObject({
      nights: 0,
      final_amount_paise: R(5000),
    });
    const late = form({
      checkInTime: "23:30",
      checkOutDate: day.get(4)!,
      checkOutTime: "00:15",
      plan: [{ label: "Balance", dueDate: day.get(3)!, amount: "5000" }],
    });
    expect(previewAmounts(late)).toMatchObject({
      ok: true,
      nights: 1,
      finalPaise: R(5000),
    });
    expect(await booking((await create(late)).id)).toMatchObject({
      nights: 1,
      final_amount_paise: R(5000),
    });
  });

  it("BFC-04: pressing Save twice with the same key gives the same booking and no second one", async () => {
    const v = form({
      plan: [{ label: "Balance", dueDate: day.get(3)!, amount: "5000" }],
      pricingMethod: "per_person_per_stay",
    });
    const key = uid();
    const first = await create(v, key);
    const second = await create(v, key);
    expect(second).toMatchObject({
      id: first.id,
      booking_code: first.booking_code,
      duplicate: true,
    });
    const [{ n }] = await q<{ n: string }>(
      `select count(*)::text n from public.bookings where idempotency_key = $1`,
      [key],
    );
    expect(n).toBe("1");
  });

  it("BFC-05: a plan that does not add up is refused by the database too (the screen stops it first)", async () => {
    const v = form({
      pricingMethod: "per_person_per_stay",
      plan: [{ label: "Balance", dueDate: day.get(3)!, amount: "4999" }],
    });
    const { payload, plan } = buildPayload(v, "create");
    await expectDbError(
      as(() =>
        q(`select public.create_booking($1::jsonb, $2::jsonb, $3::uuid)`, [
          JSON.stringify(payload),
          JSON.stringify(plan),
          uid(),
        ]),
      ),
      "PLAN_TOTAL_MISMATCH",
    );
  });

  it("BFC-06: an existing guest is used by id; a new mobile number makes one guest, a repeat finds the same person", async () => {
    const before = Number(
      (await q<{ n: string }>(`select count(*)::text n from public.guests`))[0]
        .n,
    );
    const v = form({
      guestMobile: "70000 11111",
      guestName: "New Person",
      pricingMethod: "per_person_per_stay",
      plan: [{ label: "Balance", dueDate: day.get(3)!, amount: "5000" }],
    });
    const r1 = await create(v);
    const g = (await booking(r1.id)).guest_id as string;
    expect(
      Number(
        (
          await q<{ n: string }>(`select count(*)::text n from public.guests`)
        )[0].n,
      ),
    ).toBe(before + 1);
    const r2 = await create({ ...v, guestId: g });
    expect((await booking(r2.id)).guest_id).toBe(g);
    expect(
      Number(
        (
          await q<{ n: string }>(`select count(*)::text n from public.guests`)
        )[0].n,
      ),
    ).toBe(before + 1);
  });
});

describe("editing through the form's payload (BFC-07..)", () => {
  async function fresh() {
    const v = form({
      pricingMethod: "per_person_per_stay",
      plan: [
        { label: "Advance", dueDate: day.get(0)!, amount: "2000" },
        { label: "Balance", dueDate: day.get(3)!, amount: "3000" },
      ],
    });
    const r = await create(v);
    return { id: r.id, b: await booking(r.id) };
  }
  const update = (
    id: string,
    version: number,
    v: BookingFormValues,
    opts: { plan?: unknown; reason?: string | null } = {},
  ) => {
    const { payload } = buildPayload(v, "edit");
    return as(() =>
      q(
        `select public.update_booking($1, $2, $3::jsonb, $4::jsonb, 0, $5) as r`,
        [
          id,
          version,
          JSON.stringify(payload),
          opts.plan === undefined ? null : JSON.stringify(opts.plan),
          opts.reason ?? null,
        ],
      ),
    );
  };
  const toForm = (b: Row) => valuesFromBooking(b as never, null);

  it("BFC-07: opening a booking and saving it unchanged changes nothing and adds no plan version", async () => {
    const { id, b } = await fresh();
    const v = toForm(b);
    expect(previewAmounts(v)).toMatchObject({ ok: true, finalPaise: R(5000) });
    await update(id, Number(b.version), v);
    const [{ n }] = await q<{ n: string }>(
      `select count(*)::text n from public.payment_plan_revisions where booking_id = $1`,
      [id],
    );
    expect(n).toBe("1");
    expect(await booking(id)).toMatchObject({
      final_amount_paise: R(5000),
      pax: 2,
      nights: 2,
    });
  });

  it("BFC-08: remarks only: no reason needed; the version moves on", async () => {
    const { id, b } = await fresh();
    await update(id, Number(b.version), {
      ...toForm(b),
      remarks: "Late arrival",
    });
    const after = await booking(id);
    expect(after.remarks).toBe("Late arrival");
    expect(Number(after.version)).toBe(Number(b.version) + 1);
  });

  it("BFC-09: a discount of 500 needs a reason AND a plan: the screen's check agrees with the database", async () => {
    const { id, b } = await fresh();
    const v = { ...toForm(b), discount: "500", changeReason: "Guest asked" };
    expect(previewAmounts(v)).toMatchObject({ ok: true, finalPaise: R(4500) });
    const pv = await preview(id, R(4500));
    // today D: the Advance (due D) is not past due, so nothing is locked: all 4,500 must be planned
    expect(pv).toMatchObject({
      amount_due_paise: R(4500),
      locked_paise: 0,
      adjustments_paise: 0,
      to_plan_paise: R(4500),
    });
    const rows = [{ label: "Balance", dueDate: day.get(3)!, amount: "4500" }];
    expect(
      checkEditPlan(pv, rows, { reason: v.changeReason }).problems,
    ).toEqual([]);
    expect(
      checkEditPlan(
        pv,
        [{ label: "Balance", dueDate: day.get(3)!, amount: "4000" }],
        { reason: v.changeReason },
      ).problems.length,
    ).toBeGreaterThan(0);
    // without a plan the database refuses
    await expectDbError(
      update(id, Number(b.version), v, { reason: "Guest asked" }),
      "PLAN_TOTAL_MISMATCH",
    );
    // with a reason missing it refuses too
    await expectDbError(
      update(id, Number(b.version), v, {
        plan: [
          { label: "Balance", due_date: day.get(3), amount_paise: R(4500) },
        ],
      }),
      "REASON_REQUIRED",
    );
    await update(id, Number(b.version), v, {
      plan: [{ label: "Balance", due_date: day.get(3), amount_paise: R(4500) }],
      reason: "Guest asked",
    });
    expect(await booking(id)).toMatchObject({
      final_amount_paise: R(4500),
      discount_paise: R(500),
    });
    const active = await q(
      `select label, amount_paise from public.payment_schedules where booking_id = $1 and superseded_at is null`,
      [id],
    );
    expect(active.map((x) => [x.label, Number(x.amount_paise)])).toEqual([
      ["Balance", R(4500)],
    ]);
  });

  it("BFC-10: someone else saved first: the stale version is refused with the plain 'reload' message", async () => {
    const { id, b } = await fresh();
    await update(id, Number(b.version), { ...toForm(b), remarks: "first" });
    await expectDbError(
      update(id, Number(b.version), { ...toForm(b), remarks: "second" }),
      "STALE_RECORD",
    );
  });

  it("BFC-11: the resort cannot be changed, and the booking date must stay in the same year", async () => {
    const { id, b } = await fresh();
    const other = { ...toForm(b), resortId: w.resorts.B.id };
    const { payload } = buildPayload(other, "create"); // a payload that (wrongly) includes the resort
    await expectDbError(
      as(() =>
        q(`select public.update_booking($1, $2, $3::jsonb)`, [
          id,
          Number(b.version),
          JSON.stringify(payload),
        ]),
      ),
      "ID_FIELDS_LOCKED",
    );
    const nextYear = `${Number(String(b.booking_date).slice(0, 4)) + 1}-01-05`;
    await expectDbError(
      update(id, Number(b.version), { ...toForm(b), bookingDate: nextYear }),
      "ID_FIELDS_LOCKED",
    );
  });
});

describe("status and cancel through the dialog's inputs (BFC-12..)", () => {
  async function fresh(plan = "5000") {
    const v = form({
      pricingMethod: "per_person_per_stay",
      plan: [{ label: "Balance", dueDate: day.get(3)!, amount: plan }],
    });
    const r = await create(v);
    return { id: r.id, b: await booking(r.id) };
  }
  const status = (
    id: string,
    version: number,
    s: string,
    reason: string | null = null,
  ) =>
    as(() =>
      q(
        `select public.set_booking_status($1, $2, $3::public.booking_status, $4)`,
        [id, version, s, reason],
      ),
    );

  it("BFC-12: check-in, check-out; undoing a step needs a written reason, going forward does not", async () => {
    const { id, b } = await fresh();
    await status(id, Number(b.version), "checked_in");
    const v1 = Number((await booking(id)).version);
    await expectDbError(status(id, v1, "confirmed"), "REASON_REQUIRED");
    await status(id, v1, "confirmed", "Marked by mistake");
    expect((await booking(id)).status).toBe("confirmed");
    await expectDbError(
      status(id, Number((await booking(id)).version), "checked_out"),
      "STATUS_NOT_ALLOWED",
    );
  });

  it("BFC-13: cancel: the charge is typed; 1,000 with the plan 1,000 due today; original amounts stay; Amount Due is the charge", async () => {
    const { id, b } = await fresh();
    const pv = await preview(id, R(1000));
    expect(pv).toMatchObject({
      amount_due_paise: R(1000),
      locked_paise: 0,
      to_plan_paise: R(1000),
    });
    await as(() =>
      q(
        `select public.cancel_booking($1, $2, 'cancelled', $3::date, $4, 'Guest cancelled', null, $5::jsonb)`,
        [
          id,
          Number(b.version),
          day.get(0),
          R(1000),
          JSON.stringify([
            {
              label: "Cancellation charge",
              due_date: day.get(0),
              amount_paise: R(1000),
            },
          ]),
        ],
      ),
    );
    expect(await booking(id)).toMatchObject({
      status: "cancelled",
      cancellation_charge_paise: R(1000),
      final_amount_paise: R(5000),
      amount_due_paise: R(1000),
    });
    const [f] = await as(() =>
      q(
        `select due_paise, pending_paise from public.booking_financials where booking_id = $1`,
        [id],
      ),
    );
    expect([Number(f.due_paise), Number(f.pending_paise)]).toEqual([
      R(1000),
      R(1000),
    ]);
  });

  it("BFC-14: cancel with no charge typed is refused; a charge above the booking amount is refused; a future date is refused", async () => {
    const { id, b } = await fresh();
    const call = (charge: number | null, date: string) =>
      as(() =>
        q(
          `select public.cancel_booking($1, $2, 'cancelled', $3::date, $4, 'Guest cancelled', null, '[]'::jsonb)`,
          [id, Number(b.version), date, charge],
        ),
      );
    await expectDbError(call(null, day.get(0)!), "CHARGE_REQUIRED");
    await expectDbError(call(R(5001), day.get(0)!), "CHARGE_OUT_OF_RANGE");
    await expectDbError(call(0, day.get(2)!), "CANCELLATION_DATE_FUTURE");
  });

  it("BFC-15: no-show: no charge given means the full amount; a different amount needs its own reason", async () => {
    const a = await fresh();
    await as(() =>
      q(
        `select public.cancel_booking($1, $2, 'no_show', $3::date, null, 'Did not arrive', null, $4::jsonb)`,
        [
          a.id,
          Number(a.b.version),
          day.get(0),
          JSON.stringify([
            {
              label: "No-show charge",
              due_date: day.get(0),
              amount_paise: R(5000),
            },
          ]),
        ],
      ),
    );
    expect(await booking(a.id)).toMatchObject({
      status: "no_show",
      cancellation_charge_paise: R(5000),
    });
    const b2 = await fresh();
    await expectDbError(
      as(() =>
        q(
          `select public.cancel_booking($1, $2, 'no_show', $3::date, $4, 'Did not arrive', null, $5::jsonb)`,
          [
            b2.id,
            Number(b2.b.version),
            day.get(0),
            R(3000),
            JSON.stringify([
              {
                label: "No-show charge",
                due_date: day.get(0),
                amount_paise: R(3000),
              },
            ]),
          ],
        ),
      ),
      "REASON_REQUIRED",
    );
  });

  it("BFC-16: a cancelled booking is final: no check-in, no edit of its amounts", async () => {
    const { id, b } = await fresh();
    await as(() =>
      q(
        `select public.cancel_booking($1, $2, 'cancelled', $3::date, 0, 'Guest cancelled', null, '[]'::jsonb)`,
        [id, Number(b.version), day.get(0)],
      ),
    );
    const after = await booking(id);
    await expectDbError(
      status(id, Number(after.version), "checked_in"),
      "STATUS_NOT_ALLOWED",
    );
    await expectDbError(
      update(id, Number(after.version), {
        ...valuesFromBooking(after as never, null),
        discount: "100",
      }),
      "CANCELLED_AMOUNTS_LOCKED",
    );
  });

  const update = (id: string, version: number, v: BookingFormValues) => {
    const { payload } = buildPayload(v, "edit");
    return as(() =>
      q(
        `select public.update_booking($1, $2, $3::jsonb, null, 0, 'test reason')`,
        [id, version, JSON.stringify(payload)],
      ),
    );
  };
});
