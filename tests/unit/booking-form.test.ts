import { describe, expect, it } from "vitest";
import {
  buildPayload,
  buildPlanRows,
  checkPlan,
  emptyForm,
  nightsOf,
  nightsText,
  paiseText,
  previewAmounts,
  splitIst,
  suggestDueDates,
  validateBooking,
  valuesFromBooking,
  type BookingFormValues,
} from "@/lib/bookings/form";

const R = (rupees: number) => rupees * 100;

/** A complete, valid form: 2 people, Rs 2,500 each, per stay, 12 -> 14 Nov 2026 (2 nights), one plan row. */
function filled(over: Partial<BookingFormValues> = {}): BookingFormValues {
  return {
    ...emptyForm("2026-11-10"),
    resortId: "11111111-1111-4111-8111-111111111111",
    guestName: "Asha Verma",
    guestMobile: "+91 98765 43210",
    stayTypeId: "1",
    bookingDate: "2026-11-10",
    checkInDate: "2026-11-12",
    checkOutDate: "2026-11-14",
    pax: "2",
    coCategoryId: "4",
    pricingMethod: "per_person_per_stay",
    tariff: "2,500",
    plan: [{ label: "Balance", dueDate: "2026-11-12", amount: "5000" }],
    ...over,
  };
}

describe("nights are worked out, never typed (BF-01..)", () => {
  it("BF-01: IST date of check-out minus IST date of check-in, times ignored", () => {
    expect(nightsOf("2026-11-12", "2026-11-14")).toBe(2);
    expect(nightsOf("2026-11-12", "2026-11-13")).toBe(1);
    expect(nightsOf("2026-11-12", "2026-11-12")).toBe(0);
    expect(nightsOf("2026-12-30", "2027-01-02")).toBe(3); // across a year
    expect(nightsOf("2028-02-28", "2028-03-01")).toBe(2); // leap year
    expect(nightsOf("", "2026-11-12")).toBeNull();
    expect(nightsOf("2026-02-30", "2026-03-01")).toBeNull();
  });
  it("BF-02: wording", () => {
    expect(nightsText(1)).toBe("1 night");
    expect(nightsText(2)).toBe("2 nights");
    expect(nightsText(null)).toBe("");
  });
  it("BF-03: the late check-out next morning is still one night (times never change nights)", () => {
    const a = previewAmounts(
      filled({
        checkInDate: "2026-11-12",
        checkInTime: "23:30",
        checkOutDate: "2026-11-13",
        checkOutTime: "00:15",
        pricingMethod: "per_person_per_night",
      }),
    );
    expect(a.ok && a.nights).toBe(1);
  });
  it("BF-04: the form has no field for nights and the payload never sends nights, base or final amounts", () => {
    expect(Object.keys(emptyForm())).not.toContain("nights");
    const { payload } = buildPayload(filled(), "create");
    for (const k of [
      "nights",
      "base_amount_paise",
      "total_amount_paise",
      "final_amount_paise",
      "amount_due_paise",
    ])
      expect(payload).not.toHaveProperty(k);
  });
});

describe("live amounts, independently calculated (BF-05..)", () => {
  it("BF-05: per night: 2 people x Rs 2,500 x 2 nights = Rs 10,000", () => {
    const a = previewAmounts(filled({ pricingMethod: "per_person_per_night" }));
    expect(a).toMatchObject({
      ok: true,
      nights: 2,
      basePaise: R(10000),
      totalPaise: R(10000),
      finalPaise: R(10000),
      manualAdjustmentPaise: 0,
    });
    expect(a.ok && a.line).toBe("2 people × ₹2,500 × 2 nights = ₹10,000");
  });
  it("BF-06: per stay: nights do not multiply; extras and discount", () => {
    const a = previewAmounts(filled({ extra: "500", discount: "300" }));
    // 2 x 2,500 = 5,000; + 500 extra = 5,500 total; - 300 = 5,200 final
    expect(a).toMatchObject({
      ok: true,
      basePaise: R(5000),
      totalPaise: R(5500),
      calculatedFinalPaise: R(5200),
      finalPaise: R(5200),
    });
    expect(a.ok && a.line).toBe("2 people × ₹2,500 = ₹5,000");
  });
  it("BF-07: a changed final amount is an adjustment: calculated 5,200 -> final 4,900 = -300", () => {
    const a = previewAmounts(
      filled({
        extra: "500",
        discount: "300",
        changeFinal: true,
        finalOverride: "4900",
      }),
    );
    expect(a).toMatchObject({
      ok: true,
      calculatedFinalPaise: R(5200),
      finalPaise: R(4900),
      manualAdjustmentPaise: R(-300),
    });
  });
  it("BF-08: not filled in yet = no preview and no complaint; the final amount box open but empty changes nothing", () => {
    expect(previewAmounts(emptyForm())).toEqual({ ok: false, problem: null });
    const a = previewAmounts(filled({ changeFinal: true, finalOverride: "" }));
    expect(a.ok && a.manualAdjustmentPaise).toBe(0);
  });
  it("BF-09: per-night needs a later check-out day; per-stay may check out the same day", () => {
    const night = previewAmounts(
      filled({
        pricingMethod: "per_person_per_night",
        checkOutDate: "2026-11-12",
      }),
    );
    expect(night.ok).toBe(false);
    expect(!night.ok && night.problem).toContain("later day");
    const stay = previewAmounts(filled({ checkOutDate: "2026-11-12" }));
    expect(stay.ok && stay.nights).toBe(0);
    const back = previewAmounts(filled({ checkOutDate: "2026-11-11" }));
    expect(!back.ok && back.problem).toContain("before");
  });
  it("BF-10: bad numbers are explained, not thrown", () => {
    expect(previewAmounts(filled({ pax: "0" }))).toMatchObject({
      ok: false,
      problem: expect.stringContaining("between 1 and 1000"),
    });
    expect(previewAmounts(filled({ pax: "1001" }))).toMatchObject({
      ok: false,
    });
    expect(previewAmounts(filled({ pax: "2.5" }))).toMatchObject({ ok: false });
    expect(previewAmounts(filled({ tariff: "abc" }))).toMatchObject({
      ok: false,
    });
    expect(previewAmounts(filled({ tariff: "-5" }))).toMatchObject({
      ok: false,
    });
    expect(previewAmounts(filled({ discount: "99999" }))).toMatchObject({
      ok: false,
      problem: expect.stringContaining("Discount"),
    });
    expect(
      previewAmounts(filled({ changeFinal: true, finalOverride: "x" })),
    ).toMatchObject({ ok: false });
  });
  it("BF-11: paise are exact; Indian grouping; no float drift", () => {
    const a = previewAmounts(filled({ tariff: "0.10", pax: "3" }));
    expect(a.ok && a.basePaise).toBe(30); // 3 x 10 paise
    const big = previewAmounts(filled({ tariff: "1,50,000", pax: "10" }));
    expect(big.ok && big.finalPaise).toBe(R(1500000));
  });
});

describe("payment plan check (BF-12..)", () => {
  const row = (amount: string, dueDate = "2026-11-12", label = "Balance") => ({
    label,
    dueDate,
    amount,
  });
  it("BF-12: adds up / short / more", () => {
    expect(checkPlan([row("5000")], R(5000))).toMatchObject({
      state: "ok",
      text: "Plan total ₹5,000 of ₹5,000 ✓",
    });
    expect(checkPlan([row("4500")], R(5000))).toMatchObject({
      state: "short",
      diffPaise: R(500),
      text: expect.stringContaining("₹500 short"),
    });
    expect(checkPlan([row("5500")], R(5000))).toMatchObject({
      state: "over",
      diffPaise: R(-500),
      text: expect.stringContaining("₹500 more"),
    });
  });
  it("BF-13: rows that are empty count as nothing; nothing is suggested", () => {
    const c = checkPlan([row("", "2026-11-10", "Advance"), row("")], R(5000));
    expect(c.sumPaise).toBe(0);
    expect(c.state).toBe("short");
    expect(emptyForm("2026-11-10").plan.map((p) => p.amount)).toEqual(["", ""]);
  });
  it("BF-14: row problems", () => {
    const c = checkPlan(
      [row("abc"), row("0"), row("100", ""), row("100", "2026-11-12", " ")],
      R(100),
    );
    expect(c.rowProblems.every(Boolean)).toBe(true);
  });
  it("BF-15: a zero-amount booking needs no rows", () => {
    expect(checkPlan([], 0)).toMatchObject({ state: "ok" });
  });
  it("BF-16: the Balance row follows the check-in date only while it has no date of its own", () => {
    const p = emptyForm("2026-11-10").plan;
    expect(suggestDueDates(p, "2026-11-12").map((r) => r.dueDate)).toEqual([
      "2026-11-10",
      "2026-11-12",
    ]);
    const edited = [{ label: "Balance", dueDate: "2026-11-20", amount: "" }];
    expect(suggestDueDates(edited, "2026-11-12")[0].dueDate).toBe("2026-11-20");
    expect(suggestDueDates(p, "")).toEqual(p);
  });
});

describe("validation, in plain English (BF-17..)", () => {
  it("BF-17: a valid new booking has no errors", () => {
    expect(validateBooking(filled(), { mode: "create" })).toEqual({});
  });
  it("BF-18: an empty form lists what is missing", () => {
    const e = validateBooking(emptyForm("2026-11-10"), { mode: "create" });
    expect(e.resortId).toBeTruthy();
    expect(e.guestName).toBeTruthy();
    expect(e.guestMobile).toBeTruthy();
    expect(e.stayTypeId).toBeTruthy();
    expect(e.checkInDate).toBeTruthy();
    expect(e.coCategoryId).toBeTruthy();
    expect(e.pricingMethod).toBeTruthy();
    for (const m of Object.values(e))
      expect(m).not.toMatch(/undefined|null|\[object/);
  });
  it("BF-19: an existing guest needs no name or mobile", () => {
    const e = validateBooking(
      filled({
        guestId: "22222222-2222-4222-8222-222222222222",
        guestName: "",
        guestMobile: "",
      }),
      { mode: "create" },
    );
    expect(e.guestName).toBeUndefined();
    expect(e.guestMobile).toBeUndefined();
  });
  it("BF-20: mobile, email, times, check-out after check-in", () => {
    expect(
      validateBooking(filled({ guestMobile: "123" }), { mode: "create" })
        .guestMobile,
    ).toBeTruthy();
    expect(
      validateBooking(filled({ guestEmail: "nope" }), { mode: "create" })
        .guestEmail,
    ).toBeTruthy();
    expect(
      validateBooking(filled({ checkInTime: "25:00" }), { mode: "create" })
        .checkInTime,
    ).toBeTruthy();
    expect(
      validateBooking(
        filled({
          pricingMethod: "per_person_per_stay",
          checkInDate: "2026-11-12",
          checkInTime: "14:00",
          checkOutDate: "2026-11-12",
          checkOutTime: "10:00",
        }),
        { mode: "create" },
      ).checkOutDate,
    ).toBeTruthy();
    expect(
      validateBooking(
        filled({
          pricingMethod: "per_person_per_stay",
          checkInDate: "2026-11-12",
          checkInTime: "10:00",
          checkOutDate: "2026-11-12",
          checkOutTime: "18:00",
        }),
        { mode: "create" },
      ).checkOutDate,
    ).toBeUndefined();
  });
  it("BF-21: changing the final amount needs a reason of 5 letters; edit needs a reason when an amount changed", () => {
    const base = filled({ changeFinal: true, finalOverride: "4000" });
    expect(
      validateBooking({ ...base, adjustmentReason: "abcd" }, { mode: "create" })
        .adjustmentReason,
    ).toBeTruthy();
    expect(
      validateBooking(
        {
          ...base,
          adjustmentReason: "abcde",
          plan: [{ label: "Balance", dueDate: "2026-11-12", amount: "4000" }],
        },
        { mode: "create" },
      ).adjustmentReason,
    ).toBeUndefined();
    expect(
      validateBooking(filled({ changeFinal: true, finalOverride: "" }), {
        mode: "create",
      }).finalOverride,
    ).toBeTruthy();
    expect(
      validateBooking(filled(), { mode: "edit", amountChanged: true })
        .changeReason,
    ).toBeTruthy();
    expect(
      validateBooking(filled({ changeReason: "Guest asked" }), {
        mode: "edit",
        amountChanged: true,
      }).changeReason,
    ).toBeUndefined();
    expect(
      validateBooking(filled(), { mode: "edit", amountChanged: false })
        .changeReason,
    ).toBeUndefined();
  });
  it("BF-22: the plan must match the final amount when creating; edit does not ask for the resort", () => {
    expect(
      validateBooking(
        filled({
          plan: [{ label: "Balance", dueDate: "2026-11-12", amount: "4000" }],
        }),
        { mode: "create" },
      ).plan,
    ).toContain("short");
    expect(
      validateBooking(filled({ resortId: "" }), { mode: "edit" }).resortId,
    ).toBeUndefined();
    expect(
      validateBooking(filled({ resortId: "" }), { mode: "create" }).resortId,
    ).toBeTruthy();
    expect(
      validateBooking(
        filled({
          plan: Array.from({ length: 25 }, () => ({
            label: "x",
            dueDate: "2026-11-12",
            amount: "1",
          })),
        }),
        { mode: "create" },
      ).plan,
    ).toBeTruthy();
  });
});

describe("what is sent to the database (BF-23..)", () => {
  it("BF-23: inputs only, in paise, with IST times", () => {
    const { payload, plan } = buildPayload(
      filled({
        extra: "500",
        extraNote: "Bonfire",
        discount: "300",
        remarks: " Late arrival ",
      }),
      "create",
    );
    expect(payload).toMatchObject({
      resort_id: "11111111-1111-4111-8111-111111111111",
      stay_type_id: 1,
      booking_date: "2026-11-10",
      check_in_at: "2026-11-12T14:00:00+05:30",
      check_out_at: "2026-11-14T11:00:00+05:30",
      pax: 2,
      co_category_id: 4,
      co_entry_id: null,
      pricing_method: "per_person_per_stay",
      tariff_paise: R(2500),
      extra_charges_paise: R(500),
      extra_charges_note: "Bonfire",
      discount_paise: R(300),
      manual_adjustment_paise: 0,
      manual_adjustment_reason: null,
      remarks: "Late arrival",
      guest_name: "Asha Verma",
      guest_mobile: "+91 98765 43210",
    });
    expect(plan).toEqual([
      { label: "Balance", due_date: "2026-11-12", amount_paise: R(5000) },
    ]);
  });
  it("BF-24: an existing guest sends the id only; edit never sends the resort", () => {
    const { payload } = buildPayload(
      filled({ guestId: "22222222-2222-4222-8222-222222222222" }),
      "edit",
    );
    expect(payload).toMatchObject({
      guest_id: "22222222-2222-4222-8222-222222222222",
    });
    expect(payload).not.toHaveProperty("guest_name");
    expect(payload).not.toHaveProperty("resort_id");
  });
  it("BF-25: the adjustment is final - calculated, with its reason; a zero adjustment sends no reason", () => {
    const up = buildPayload(
      filled({
        changeFinal: true,
        finalOverride: "5600",
        adjustmentReason: "Added a room",
      }),
      "create",
    ).payload;
    expect(up).toMatchObject({
      manual_adjustment_paise: R(600),
      manual_adjustment_reason: "Added a room",
    });
    const none = buildPayload(
      filled({
        changeFinal: true,
        finalOverride: "5000",
        adjustmentReason: "ignored",
      }),
      "create",
    ).payload;
    expect(none).toMatchObject({
      manual_adjustment_paise: 0,
      manual_adjustment_reason: null,
    });
  });
  it("BF-26: a typed C/O name is sent trimmed; blank is null", () => {
    expect(
      buildPayload(filled({ coName: "  Ravi  " }), "create").payload,
    ).toMatchObject({ co_name: "Ravi" });
    expect(
      buildPayload(filled({ coName: "   " }), "create").payload,
    ).toMatchObject({ co_name: null });
  });
  it("BF-27: building from an incomplete form refuses instead of sending nonsense", () => {
    expect(() => buildPayload(emptyForm(), "create")).toThrow();
  });
  it("BF-28: plan rows without a usable amount are left out (callers check first)", () => {
    expect(
      buildPlanRows([
        { label: "A", dueDate: "2026-11-12", amount: "" },
        { label: "B", dueDate: "2026-11-13", amount: "10" },
      ]),
    ).toEqual([{ label: "B", due_date: "2026-11-13", amount_paise: R(10) }]);
  });
});

describe("editing: the form is filled from the booking (BF-29..)", () => {
  const booking = {
    resort_id: "11111111-1111-4111-8111-111111111111",
    guest_id: "22222222-2222-4222-8222-222222222222",
    guest_name: "Asha Verma",
    guest_mobile: "+91 98765 43210",
    stay_type_id: 1,
    booking_date: "2026-11-10",
    check_in_at: "2026-11-12T08:30:00.000Z", // 14:00 IST
    check_out_at: "2026-11-14T05:30:00.000Z", // 11:00 IST
    pax: 2,
    co_category_id: 4,
    co_entry_id: null,
    co_name: null,
    co_mode: "none",
    pricing_method: "per_person_per_stay" as const,
    tariff_per_person_paise: R(2500),
    extra_charges_paise: R(500),
    extra_charges_note: "Bonfire",
    discount_paise: R(300),
    manual_adjustment_paise: R(-300),
    manual_adjustment_reason: "Regular guest",
    final_amount_paise: R(4900),
    remarks: null,
  };
  it("BF-29: IST date and time come back exactly, whatever the computer's time zone", () => {
    expect(splitIst("2026-11-12T08:30:00.000Z")).toEqual({
      date: "2026-11-12",
      time: "14:00",
    });
    expect(splitIst("2026-11-11T20:00:00.000Z")).toEqual({
      date: "2026-11-12",
      time: "01:30",
    }); // crosses midnight IST
    expect(splitIst("garbage")).toEqual({ date: "", time: "" });
  });
  it("BF-30: paise text", () => {
    expect(paiseText(R(2500))).toBe("2500");
    expect(paiseText(250050)).toBe("2500.50");
    expect(paiseText(5)).toBe("0.05");
    expect(paiseText(0)).toBe("0");
  });
  it("BF-31: round trip: the saved booking's form gives the same inputs back", () => {
    const v = valuesFromBooking(booking, "asha@test.example");
    expect(v).toMatchObject({
      checkInDate: "2026-11-12",
      checkInTime: "14:00",
      checkOutDate: "2026-11-14",
      checkOutTime: "11:00",
      tariff: "2500",
      extra: "500",
      discount: "300",
      changeFinal: true,
      finalOverride: "4900",
      plan: [],
      guestEmail: "asha@test.example",
    });
    const a = previewAmounts(v);
    expect(a).toMatchObject({
      ok: true,
      nights: 2,
      finalPaise: R(4900),
      manualAdjustmentPaise: R(-300),
    });
    const { payload } = buildPayload(v, "edit");
    expect(payload).toMatchObject({
      check_in_at: "2026-11-12T14:00:00+05:30",
      check_out_at: "2026-11-14T11:00:00+05:30",
      manual_adjustment_paise: R(-300),
      tariff_paise: R(2500),
    });
  });
  it("BF-32: a listed C/O name is not sent as a typed name", () => {
    const v = valuesFromBooking(
      {
        ...booking,
        co_mode: "listed",
        co_entry_id: "33333333-3333-4333-8333-333333333333",
        co_name: "Test Agent",
      },
      null,
    );
    expect(v.coName).toBe("");
    expect(v.coEntryId).toBe("33333333-3333-4333-8333-333333333333");
    const typed = valuesFromBooking(
      { ...booking, co_mode: "typed", co_name: "Ravi" },
      null,
    );
    expect(typed.coName).toBe("Ravi");
  });
});
