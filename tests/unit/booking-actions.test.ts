import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createBooking: vi.fn(),
  updateBooking: vi.fn(),
  setBookingStatus: vi.fn(),
  cancelBooking: vi.fn(),
  changeCancellationCharge: vi.fn(),
  setPaymentSchedule: vi.fn(),
  planPreview: vi.fn(),
  upsertCoEntry: vi.fn(),
  upsertGuest: vi.fn(),
  upsertProvider: vi.fn(),
  booking: { current: null as Record<string, unknown> | null },
  rpc: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireUser: m.requireUser }));
vi.mock("@/lib/db/actions", () => ({
  createBooking: m.createBooking,
  updateBooking: m.updateBooking,
  setBookingStatus: m.setBookingStatus,
  cancelBooking: m.cancelBooking,
  changeCancellationCharge: m.changeCancellationCharge,
  setPaymentSchedule: m.setPaymentSchedule,
  planPreview: m.planPreview,
  upsertCoEntry: m.upsertCoEntry,
  upsertGuest: m.upsertGuest,
  upsertProvider: m.upsertProvider,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: m.booking.current }) }),
      }),
    }),
    rpc: m.rpc,
  }),
}));

import {
  cancelBookingAction,
  changeChargeAction,
  changePlanAction,
  createBookingAction,
  findGuestsAction,
  planPreviewAction,
  quickAddCoEntryAction,
  saveGuestAction,
  saveProviderAction,
  setStatusAction,
  updateBookingAction,
} from "@/lib/bookings/actions";
import { emptyForm, type BookingFormValues } from "@/lib/bookings/form";

const ID = "44444444-4444-4444-8444-444444444444";
const KEY = "55555555-5555-4555-8555-555555555555";
const R = (rupees: number) => rupees * 100;
const TODAY = new Date().toISOString().slice(0, 10);

function valid(over: Partial<BookingFormValues> = {}): BookingFormValues {
  return {
    ...emptyForm("2026-11-10"),
    resortId: "11111111-1111-4111-8111-111111111111",
    guestName: "Asha Verma",
    guestMobile: "98765 43210",
    stayTypeId: "1",
    checkInDate: "2026-11-12",
    checkOutDate: "2026-11-14",
    pax: "2",
    coCategoryId: "4",
    pricingMethod: "per_person_per_stay",
    tariff: "2500",
    plan: [{ label: "Balance", dueDate: "2026-11-12", amount: "5000" }],
    ...over,
  };
}
const preview = {
  amount_due_paise: R(4500),
  locked_paise: 0,
  adjustments_paise: 0,
  to_plan_paise: R(4500),
  unpaid_past_paise: 0,
  today: TODAY,
};

beforeEach(() => {
  vi.clearAllMocks();
  m.requireUser.mockResolvedValue({ id: "u1" });
  m.createBooking.mockResolvedValue({
    ok: true,
    data: { id: ID, booking_code: "AAA-2026-000001", duplicate: false },
  });
  m.updateBooking.mockResolvedValue({ ok: true, data: { version: 3 } });
  m.setBookingStatus.mockResolvedValue({ ok: true, data: {} });
  m.cancelBooking.mockResolvedValue({ ok: true, data: {} });
  m.changeCancellationCharge.mockResolvedValue({ ok: true, data: {} });
  m.setPaymentSchedule.mockResolvedValue({ ok: true, data: {} });
  m.planPreview.mockResolvedValue({ ok: true, data: preview });
  m.upsertCoEntry.mockResolvedValue({
    ok: true,
    data: "66666666-6666-4666-8666-666666666666",
  });
  m.upsertGuest.mockResolvedValue({ ok: true, data: ID });
  m.upsertProvider.mockResolvedValue({ ok: true, data: 1 });
  m.booking.current = {
    id: ID,
    version: 2,
    status: "confirmed",
    final_amount_paise: R(5000),
    amount_due_paise: R(5000),
    cancellation_charge_paise: null,
  };
  m.rpc.mockResolvedValue({ data: [], error: null });
});

const dbCalls = () =>
  [
    m.createBooking,
    m.updateBooking,
    m.setBookingStatus,
    m.cancelBooking,
    m.changeCancellationCharge,
    m.setPaymentSchedule,
    m.upsertCoEntry,
    m.upsertGuest,
    m.upsertProvider,
  ].reduce((n, f) => n + f.mock.calls.length, 0);

describe("every action checks the signed-in user first (ACT-U1)", () => {
  it("ACT-U1: when nobody is signed in nothing reaches the database", async () => {
    m.requireUser.mockRejectedValue(new Error("NEXT_REDIRECT"));
    const fd = new FormData();
    const calls: (() => Promise<unknown>)[] = [
      () => createBookingAction({ values: valid(), idempotencyKey: KEY }),
      () =>
        updateBookingAction({
          bookingId: ID,
          expectedVersion: 2,
          values: valid(),
          sendPlan: false,
          movePaise: 0,
        }),
      () =>
        setStatusAction({
          bookingId: ID,
          expectedVersion: 2,
          status: "checked_in",
        }),
      () =>
        cancelBookingAction({
          bookingId: ID,
          expectedVersion: 2,
          kind: "cancelled",
          date: TODAY,
          charge: "0",
          reason: "Guest cancelled",
          chargeChangeReason: "",
          plan: [],
        }),
      () =>
        changeChargeAction({
          bookingId: ID,
          expectedVersion: 2,
          charge: "0",
          reason: "Correction",
          plan: [],
        }),
      () =>
        changePlanAction({
          bookingId: ID,
          expectedVersion: 2,
          reason: "Change",
          movePaise: 0,
          plan: [],
        }),
      () => planPreviewAction(ID, null),
      () => findGuestsAction("98765"),
      () => quickAddCoEntryAction(1, "New agent", ""),
      () => saveGuestAction(undefined, fd),
      () => saveProviderAction(undefined, fd),
    ];
    for (const c of calls) await expect(c()).rejects.toThrow("NEXT_REDIRECT");
    expect(dbCalls()).toBe(0);
    expect(m.planPreview).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe("create (ACT-U2..)", () => {
  it("ACT-U2: a valid booking is saved with INPUTS only and the form's save key", async () => {
    const r = await createBookingAction({
      values: valid(),
      idempotencyKey: KEY,
    });
    expect(r).toMatchObject({
      ok: true,
      id: ID,
      code: "AAA-2026-000001",
      duplicate: false,
      message: "Booking AAA-2026-000001 saved.",
    });
    const [payload, plan, key] = m.createBooking.mock.calls[0];
    expect(key).toBe(KEY);
    expect(plan).toEqual([
      { label: "Balance", due_date: "2026-11-12", amount_paise: R(5000) },
    ]);
    expect(payload).toMatchObject({
      pax: 2,
      tariff_paise: R(2500),
      manual_adjustment_paise: 0,
      check_in_at: "2026-11-12T14:00:00+05:30",
    });
    for (const k of [
      "nights",
      "base_amount_paise",
      "final_amount_paise",
      "total_amount_paise",
    ])
      expect(payload).not.toHaveProperty(k);
  });
  it("ACT-U3: pressing Save twice: the database's 'duplicate' answer is passed on (no second booking)", async () => {
    m.createBooking.mockResolvedValue({
      ok: true,
      data: { id: ID, booking_code: "AAA-2026-000001", duplicate: true },
    });
    const r = await createBookingAction({
      values: valid(),
      idempotencyKey: KEY,
    });
    expect(r).toMatchObject({ ok: true, duplicate: true });
  });
  it("ACT-U4: rules are checked on the server again: a plan that does not add up never reaches the database", async () => {
    const r = await createBookingAction({
      values: valid({
        plan: [{ label: "Balance", dueDate: "2026-11-12", amount: "4000" }],
      }),
      idempotencyKey: KEY,
    });
    expect(r).toMatchObject({
      ok: false,
      errors: { plan: expect.stringContaining("short") },
    });
    expect(m.createBooking).not.toHaveBeenCalled();
  });
  it("ACT-U5: nonsense from the browser is refused: missing key, wrong types, over-long text, a made-up pricing method", async () => {
    for (const bad of [
      { values: valid() },
      { values: valid(), idempotencyKey: "not-a-uuid" },
      { values: { ...valid(), pax: 5 }, idempotencyKey: KEY },
      { values: valid({ remarks: "x".repeat(1001) }), idempotencyKey: KEY },
      { values: { ...valid(), pricingMethod: "free" }, idempotencyKey: KEY },
      { values: valid({ resortId: "nope" as never }), idempotencyKey: KEY },
      null,
      "text",
    ]) {
      const r = await createBookingAction(bad);
      expect(r.ok).toBe(false);
    }
    expect(m.createBooking).not.toHaveBeenCalled();
  });
  it("ACT-U6: a database refusal comes back as the plain message and nothing technical", async () => {
    m.createBooking.mockResolvedValue({
      ok: false,
      message: "New bookings cannot be added to a resort that is switched off.",
    });
    const r = await createBookingAction({
      values: valid(),
      idempotencyKey: KEY,
    });
    expect(r).toEqual({
      ok: false,
      message: "New bookings cannot be added to a resort that is switched off.",
      errors: undefined,
    });
  });
});

describe("edit (ACT-U7..)", () => {
  const edit = (
    values: BookingFormValues,
    extra: Record<string, unknown> = {},
  ) =>
    updateBookingAction({
      bookingId: ID,
      expectedVersion: 2,
      values,
      sendPlan: false,
      movePaise: 0,
      ...extra,
    });
  it("ACT-U7: a change that keeps the amount (5,000) needs no reason and no plan; the version is sent for the conflict check", async () => {
    const r = await edit(valid({ remarks: "Late arrival" }));
    expect(r).toMatchObject({ ok: true, version: 3 });
    const [id, version, , opts] = m.updateBooking.mock.calls[0];
    expect([id, version]).toEqual([ID, 2]);
    expect(opts.plan).toBeUndefined();
    expect(m.planPreview).not.toHaveBeenCalled();
  });
  it("ACT-U8: a changed amount needs a reason", async () => {
    const r = await edit(valid({ discount: "500" }));
    expect(r).toMatchObject({
      ok: false,
      errors: { changeReason: expect.any(String) },
    });
    expect(m.updateBooking).not.toHaveBeenCalled();
  });
  it("ACT-U9: a changed amount also needs a plan that adds up to the amount still to plan (4,500)", async () => {
    const short = await edit(
      valid({
        discount: "500",
        changeReason: "Guest asked",
        plan: [{ label: "Balance", dueDate: TODAY, amount: "4000" }],
      }),
    );
    expect(short.ok).toBe(false);
    expect(m.updateBooking).not.toHaveBeenCalled();
    expect(m.planPreview).toHaveBeenCalledWith(ID, R(4500));
    const ok = await edit(
      valid({
        discount: "500",
        changeReason: "Guest asked",
        plan: [{ label: "Balance", dueDate: TODAY, amount: "4500" }],
      }),
    );
    expect(ok.ok).toBe(true);
    const [, , payload, opts] = m.updateBooking.mock.calls[0];
    expect(payload).toMatchObject({ discount_paise: R(500) });
    expect(opts).toMatchObject({
      plan: [{ label: "Balance", due_date: TODAY, amount_paise: R(4500) }],
      reason: "Guest asked",
      moveOverduePaise: 0,
    });
  });
  it("ACT-U10: a cancelled or no-show booking cannot be edited here", async () => {
    m.booking.current = { ...m.booking.current, status: "cancelled" };
    const r = await edit(valid());
    expect(r).toMatchObject({
      ok: false,
      message: expect.stringContaining("cannot be edited"),
    });
    expect(m.updateBooking).not.toHaveBeenCalled();
  });
  it("ACT-U11: a booking that does not exist, and a conflict reported by the database", async () => {
    m.booking.current = null;
    expect(await edit(valid())).toMatchObject({
      ok: false,
      message: expect.stringContaining("could not find"),
    });
    m.booking.current = {
      id: ID,
      version: 2,
      status: "confirmed",
      final_amount_paise: R(5000),
      amount_due_paise: R(5000),
      cancellation_charge_paise: null,
    };
    m.updateBooking.mockResolvedValue({
      ok: false,
      message: "Someone else changed this just now. Please reload the page.",
    });
    expect(await edit(valid())).toMatchObject({
      ok: false,
      message: "Someone else changed this just now. Please reload the page.",
    });
  });
});

describe("status, cancel, charge, plan (ACT-U12..)", () => {
  it("ACT-U12: status change passes the version and the reason; only the three allowed targets are accepted", async () => {
    expect(
      await setStatusAction({
        bookingId: ID,
        expectedVersion: 2,
        status: "confirmed",
        reason: " Mistake ",
      }),
    ).toMatchObject({ ok: true });
    expect(m.setBookingStatus).toHaveBeenCalledWith(
      ID,
      2,
      "confirmed",
      "Mistake",
    );
    expect(
      (
        await setStatusAction({
          bookingId: ID,
          expectedVersion: 2,
          status: "cancelled",
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await setStatusAction({
          bookingId: ID,
          expectedVersion: 0,
          status: "checked_in",
        })
      ).ok,
    ).toBe(false);
    expect(m.setBookingStatus).toHaveBeenCalledTimes(1);
  });
  const cancel = (over: Record<string, unknown> = {}) =>
    cancelBookingAction({
      bookingId: ID,
      expectedVersion: 2,
      kind: "cancelled",
      date: TODAY,
      charge: "1000",
      reason: "Guest cancelled",
      chargeChangeReason: "",
      plan: [{ label: "Cancellation charge", dueDate: TODAY, amount: "1000" }],
      ...over,
    });
  it("ACT-U13: cancel: the charge is typed (empty refused, zero allowed), the plan follows the charge", async () => {
    m.planPreview.mockResolvedValue({
      ok: true,
      data: { ...preview, amount_due_paise: R(1000), to_plan_paise: R(1000) },
    });
    expect(await cancel({ charge: "" })).toMatchObject({
      ok: false,
      errors: { charge: expect.stringContaining("it can be zero") },
    });
    expect(m.cancelBooking).not.toHaveBeenCalled();
    const ok = await cancel();
    expect(ok).toMatchObject({
      ok: true,
      message: "The booking was cancelled.",
    });
    expect(m.planPreview).toHaveBeenCalledWith(ID, R(1000));
    expect(m.cancelBooking).toHaveBeenCalledWith(
      ID,
      2,
      expect.objectContaining({
        kind: "cancelled",
        chargePaise: R(1000),
        reason: "Guest cancelled",
        plan: [
          {
            label: "Cancellation charge",
            due_date: TODAY,
            amount_paise: R(1000),
          },
        ],
      }),
    );
    m.planPreview.mockResolvedValue({
      ok: true,
      data: { ...preview, amount_due_paise: 0, to_plan_paise: 0 },
    });
    expect((await cancel({ charge: "0", plan: [] })).ok).toBe(true);
  });
  it("ACT-U14: cancel: a charge above the booking amount, no reason and a future date are refused", async () => {
    expect(await cancel({ charge: "5001" })).toMatchObject({
      ok: false,
      errors: {
        charge: expect.stringContaining("more than the booking amount"),
      },
    });
    m.planPreview.mockResolvedValue({
      ok: true,
      data: { ...preview, amount_due_paise: R(1000), to_plan_paise: R(1000) },
    });
    expect(await cancel({ reason: "no" })).toMatchObject({
      ok: false,
      errors: { reason: expect.any(String) },
    });
    expect(await cancel({ date: "2999-01-01" })).toMatchObject({
      ok: false,
      errors: { date: expect.any(String) },
    });
    expect(m.cancelBooking).not.toHaveBeenCalled();
  });
  it("ACT-U15: no-show with a changed charge needs its own reason", async () => {
    m.planPreview.mockResolvedValue({
      ok: true,
      data: { ...preview, amount_due_paise: R(3000), to_plan_paise: R(3000) },
    });
    const plan = [{ label: "No-show charge", dueDate: TODAY, amount: "3000" }];
    expect(
      await cancel({ kind: "no_show", charge: "3000", plan }),
    ).toMatchObject({
      ok: false,
      errors: { chargeChangeReason: expect.any(String) },
    });
    expect(
      (
        await cancel({
          kind: "no_show",
          charge: "3000",
          plan,
          chargeChangeReason: "Guest was ill",
        })
      ).ok,
    ).toBe(true);
    expect(m.cancelBooking.mock.calls[0][2]).toMatchObject({
      kind: "no_show",
      chargeChangeReason: "Guest was ill",
    });
  });
  it("ACT-U16: change the cancellation charge: only for a cancelled booking, with a reason", async () => {
    const body = {
      bookingId: ID,
      expectedVersion: 2,
      charge: "500",
      reason: "Goodwill",
      plan: [] as unknown[],
    };
    expect(await changeChargeAction(body)).toMatchObject({
      ok: false,
      message: expect.stringContaining("Only a cancelled"),
    });
    m.booking.current = {
      ...m.booking.current,
      status: "cancelled",
      cancellation_charge_paise: R(1000),
    };
    m.planPreview.mockResolvedValue({
      ok: true,
      data: {
        ...preview,
        amount_due_paise: R(500),
        locked_paise: R(2000),
        to_plan_paise: R(-1500),
      },
    });
    expect((await changeChargeAction({ ...body, reason: "no" })).ok).toBe(
      false,
    );
    expect(await changeChargeAction(body)).toMatchObject({ ok: true });
    expect(m.changeCancellationCharge).toHaveBeenCalledWith(
      ID,
      2,
      R(500),
      "Goodwill",
      [],
    );
  });
  it("ACT-U17: change the plan: rows must add up, a reason is needed to move an overdue amount", async () => {
    const row = (amount: string) => ({
      label: "Balance",
      dueDate: TODAY,
      amount,
    });
    expect(
      (
        await changePlanAction({
          bookingId: ID,
          expectedVersion: 2,
          reason: "Guest asked",
          movePaise: 0,
          plan: [row("4000")],
        })
      ).ok,
    ).toBe(false);
    expect(
      await changePlanAction({
        bookingId: ID,
        expectedVersion: 2,
        reason: "Guest asked",
        movePaise: 0,
        plan: [row("4500")],
      }),
    ).toMatchObject({ ok: true });
    expect(m.setPaymentSchedule).toHaveBeenCalledWith(
      ID,
      2,
      [{ label: "Balance", due_date: TODAY, amount_paise: R(4500) }],
      "Guest asked",
      0,
    );
    m.planPreview.mockResolvedValue({
      ok: true,
      data: { ...preview, unpaid_past_paise: R(700) },
    });
    expect(
      (
        await changePlanAction({
          bookingId: ID,
          expectedVersion: 2,
          reason: "Guest asked",
          movePaise: R(800),
          plan: [row("5300")],
        })
      ).ok,
    ).toBe(false);
  });
  it("ACT-U18: a preview the database could not give, or a broken one, is explained", async () => {
    m.planPreview.mockResolvedValue({
      ok: false,
      message: "We could not find that record.",
    });
    expect(await planPreviewAction(ID, null)).toMatchObject({
      ok: false,
      message: "We could not find that record.",
    });
    m.planPreview.mockResolvedValue({ ok: true, data: { nonsense: true } });
    expect(await planPreviewAction(ID, null)).toMatchObject({ ok: false });
    expect(await planPreviewAction("not-an-id", null)).toMatchObject({
      ok: false,
    });
    expect(await planPreviewAction(ID, -5)).toMatchObject({ ok: false });
  });
});

describe("guests, quick add, payment apps (ACT-U19..)", () => {
  it("ACT-U19: guest suggestions: short or empty text never asks the database; matches are trimmed to what the screen needs", async () => {
    for (const t of ["", "ab", "12", "  1 2  "])
      expect(await findGuestsAction(t)).toEqual([]);
    expect(m.rpc).not.toHaveBeenCalled();
    m.rpc.mockResolvedValue({
      data: [
        {
          guest_id: ID,
          full_name: "Asha Verma",
          mobile: "98765 43210",
          bookings: 2,
          email: "private@x.example",
          pending_paise: 5,
        },
      ],
      error: null,
    });
    const g = await findGuestsAction("98765 43210");
    expect(g).toEqual([
      { id: ID, fullName: "Asha Verma", mobile: "98765 43210", bookings: 2 },
    ]);
    expect(m.rpc).toHaveBeenCalledWith("guest_list", {
      p_q: "98765 43210",
      p_limit: 5,
      p_offset: 0,
    });
    m.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await findGuestsAction("98765")).toEqual([]);
  });
  it("ACT-U20: save a guest: a name is required; blank optional fields are not sent", async () => {
    const fd = (o: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(o)) f.set(k, v);
      return f;
    };
    expect(
      await saveGuestAction(
        undefined,
        fd({ fullName: "  ", mobile: "98765 43210" }),
      ),
    ).toMatchObject({ errors: { fullName: expect.any(String) } });
    expect(m.upsertGuest).not.toHaveBeenCalled();
    expect(
      await saveGuestAction(
        undefined,
        fd({
          fullName: "Asha",
          mobile: "98765 43210",
          email: "",
          address: "",
          notes: "",
        }),
      ),
    ).toMatchObject({ ok: true, message: "The guest was added." });
    expect(m.upsertGuest).toHaveBeenCalledWith({
      id: undefined,
      fullName: "Asha",
      mobile: "98765 43210",
      email: undefined,
      address: undefined,
      notes: undefined,
    });
    expect(
      await saveGuestAction(
        undefined,
        fd({ id: ID, fullName: "Asha", mobile: "98765 43210" }),
      ),
    ).toMatchObject({ ok: true, message: "Saved." });
    expect(
      (
        await saveGuestAction(
          undefined,
          fd({ id: "bad", fullName: "Asha", mobile: "1" }),
        )
      ).ok,
    ).toBeUndefined();
  });
  it("ACT-U21: quick add of an Agent/Partner name", async () => {
    expect(await quickAddCoEntryAction(1, "  ", "")).toMatchObject({
      ok: false,
    });
    expect(await quickAddCoEntryAction(0, "Ravi", "")).toMatchObject({
      ok: false,
    });
    expect(await quickAddCoEntryAction(1, "x".repeat(121), "")).toMatchObject({
      ok: false,
    });
    expect(m.upsertCoEntry).not.toHaveBeenCalled();
    expect(
      await quickAddCoEntryAction(1, " Ravi Travels ", "98765"),
    ).toMatchObject({
      ok: true,
      id: "66666666-6666-4666-8666-666666666666",
      name: "Ravi Travels",
    });
    expect(m.upsertCoEntry).toHaveBeenCalledWith({
      categoryId: 1,
      name: "Ravi Travels",
      mobile: "98765",
    });
    m.upsertCoEntry.mockResolvedValue({
      ok: false,
      message: "That name already exists.",
    });
    expect(await quickAddCoEntryAction(1, "Ravi Travels", "")).toMatchObject({
      ok: false,
      message: "That name already exists.",
    });
  });
  it("ACT-U22: payment apps: name, UPI or Card, new apps start switched on", async () => {
    const fd = (o: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(o)) f.set(k, v);
      return f;
    };
    expect(
      await saveProviderAction(undefined, fd({ name: "", method: "upi" })),
    ).toMatchObject({ errors: { name: expect.any(String) } });
    expect(
      await saveProviderAction(
        undefined,
        fd({ name: "PhonePe", method: "cash" }),
      ),
    ).toMatchObject({ errors: { method: expect.any(String) } });
    expect(m.upsertProvider).not.toHaveBeenCalled();
    expect(
      await saveProviderAction(
        undefined,
        fd({ name: "PhonePe", method: "upi" }),
      ),
    ).toMatchObject({ ok: true, message: "The app was added." });
    expect(m.upsertProvider).toHaveBeenLastCalledWith({
      id: undefined,
      method: "upi",
      name: "PhonePe",
      active: true,
    });
    expect(
      await saveProviderAction(
        undefined,
        fd({ id: "3", name: "PhonePe", method: "upi" }),
      ),
    ).toMatchObject({ ok: true, message: "Saved." });
    expect(m.upsertProvider).toHaveBeenLastCalledWith({
      id: 3,
      method: "upi",
      name: "PhonePe",
      active: false,
    }); // unchecked box = switched off
  });
});
