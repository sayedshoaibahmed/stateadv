import { describe, expect, it } from "vitest";
import { allocateCoverage } from "@/lib/bookings/coverage";
import {
  buttonText,
  checkCancel,
  helpText,
  parseCharge,
  refundLine,
  startingCharge,
  type CancelValues,
} from "@/lib/bookings/cancel";
import {
  checkEditPlan,
  isPlanPreview,
  planNeed,
  type PlanPreview,
} from "@/lib/bookings/plan";

const R = (rupees: number) => rupees * 100;
const TODAY = "2026-11-12";
const row = (amount: string, dueDate = TODAY, label = "Balance") => ({
  label,
  dueDate,
  amount,
});

/** Amount Due 4,500; Rs 2,000 already due (locked); no adjustments -> Rs 2,500 still to plan (the spec's own example). */
const preview = (over: Partial<PlanPreview> = {}): PlanPreview => ({
  amount_due_paise: R(4500),
  locked_paise: R(2000),
  adjustments_paise: 0,
  to_plan_paise: R(2500),
  unpaid_past_paise: 0,
  today: TODAY,
  ...over,
});

describe("plan rules for changing a plan (PLN-U1..)", () => {
  it("PLN-U1: the summary reads like the spec: Amount Due 4,500 · locked 2,000 · adjustments 0 · still to plan 2,500", () => {
    expect(planNeed(preview())).toMatchObject({
      kind: "rows",
      rowsMustTotalPaise: R(2500),
      summary:
        "Amount Due ₹4,500 · Already due (locked) ₹2,000 · Adjustments ₹0 · Amount still to plan ₹2,500",
      notice: null,
    });
  });
  it("PLN-U2: a negative amount to plan needs no rows: an adjustment records the reduction", () => {
    const n = planNeed(
      preview({ amount_due_paise: R(1000), to_plan_paise: R(-1000) }),
    );
    expect(n).toMatchObject({
      kind: "reduce",
      reductionPaise: R(1000),
      rowsMustTotalPaise: 0,
    });
    expect(n.notice).toBe(
      "Expected will be reduced by ₹1,000 today (adjustment). Please give a reason.",
    );
    expect(n.summary).toContain("Amount still to plan ₹0");
  });
  it("PLN-U3: exactly zero to plan: nothing to do", () => {
    expect(planNeed(preview({ to_plan_paise: 0 }))).toMatchObject({
      kind: "none",
      rowsMustTotalPaise: 0,
    });
  });
  it("PLN-U4: moving an overdue amount adds it to what must be planned", () => {
    const n = planNeed(preview({ unpaid_past_paise: R(700) }), R(700));
    expect(n.rowsMustTotalPaise).toBe(R(3200));
    expect(n.summary).toContain("Moved ₹700");
  });
  it("PLN-U5: rows must add up to the amount still to plan", () => {
    const ok = checkEditPlan(preview(), [row("2500")]);
    expect(ok.problems).toEqual([]);
    expect(ok.state).toBe("ok");
    const short = checkEditPlan(preview(), [row("2000")]);
    expect(short.problems[0]).toContain("₹500 short");
    const over = checkEditPlan(preview(), [
      row("2500", TODAY),
      row("1", "2026-11-13"),
    ]);
    expect(over.problems[0]).toContain("more");
  });
  it("PLN-U6: new rows cannot be due before today (past rows stay locked)", () => {
    const c = checkEditPlan(preview(), [row("2500", "2026-11-11")]);
    expect(c.problems.join(" ")).toContain("Row 1 is due before today");
    expect(checkEditPlan(preview(), [row("2500", TODAY)]).problems).toEqual([]);
  });
  it("PLN-U7: a reduction needs a reason and no rows", () => {
    const p = preview({ amount_due_paise: R(1000), to_plan_paise: R(-1000) });
    expect(checkEditPlan(p, []).problems.join(" ")).toContain("reason");
    expect(
      checkEditPlan(p, [], { reason: "Discount agreed" }).problems,
    ).toEqual([]);
    expect(
      checkEditPlan(p, [row("100")], {
        reason: "Discount agreed",
      }).problems.join(" "),
    ).toContain("remove the rows");
  });
  it("PLN-U8: moving an overdue amount: not more than overdue and unpaid, needs a reason", () => {
    const p = preview({ unpaid_past_paise: R(700) });
    expect(
      checkEditPlan(p, [row("3200")], {
        movePaise: R(800),
        reason: "Guest asked",
      }).problems.join(" "),
    ).toContain("Only ₹700 is overdue");
    expect(
      checkEditPlan(p, [row("3200")], { movePaise: R(700) }).problems.join(" "),
    ).toContain("reason");
    expect(
      checkEditPlan(p, [row("3200")], {
        movePaise: R(700),
        reason: "Guest asked",
      }).problems,
    ).toEqual([]);
    expect(
      checkEditPlan(preview(), [row("2500")], {
        movePaise: R(1),
        reason: "x y z w",
      }).problems.join(" "),
    ).toContain("Nothing is overdue");
    expect(
      checkEditPlan(p, [row("2500")], {
        movePaise: -1,
        reason: "Guest asked",
      }).problems.join(" "),
    ).toContain("cannot be negative");
  });
  it("PLN-U9: the preview from the database is checked before it is trusted", () => {
    expect(isPlanPreview(preview())).toBe(true);
    expect(isPlanPreview(null)).toBe(false);
    expect(isPlanPreview({ ...preview(), today: "nope" })).toBe(false);
    expect(isPlanPreview({ ...preview(), locked_paise: 1.5 })).toBe(false);
    expect(isPlanPreview({ amount_due_paise: 1 })).toBe(false);
  });
});

describe("cancel and no-show (CAN-U1..)", () => {
  const base = (over: Partial<CancelValues> = {}): CancelValues => ({
    kind: "cancelled",
    reason: "Guest cancelled",
    date: TODAY,
    charge: "1000",
    chargeChangeReason: "",
    plan: [],
    ...over,
  });
  const opts = (
    p: PlanPreview | null = preview({
      amount_due_paise: R(1000),
      locked_paise: 0,
      to_plan_paise: R(1000),
    }),
  ) => ({ finalPaise: R(5000), today: TODAY, preview: p });

  it("CAN-U1: a cancel charge starts EMPTY and must be typed; no-show starts as the full amount", () => {
    expect(startingCharge("cancelled", R(5000))).toBe("");
    expect(startingCharge("no_show", R(5000))).toBe("5000");
    expect(startingCharge("no_show", 250050)).toBe("2500.5");
  });
  it("CAN-U2: charge: empty is refused, zero is allowed, more than the booking is refused", () => {
    expect(parseCharge({ charge: "" }, R(5000))).toMatchObject({
      ok: false,
      problem: expect.stringContaining("it can be zero"),
    });
    expect(parseCharge({ charge: "0" }, R(5000))).toEqual({
      ok: true,
      paise: 0,
    });
    expect(parseCharge({ charge: "5,000" }, R(5000))).toEqual({
      ok: true,
      paise: R(5000),
    });
    expect(parseCharge({ charge: "5001" }, R(5000))).toMatchObject({
      ok: false,
      problem: expect.stringContaining("more than the booking amount (₹5,000)"),
    });
    expect(parseCharge({ charge: "abc" }, R(5000))).toMatchObject({
      ok: false,
    });
    expect(parseCharge({ charge: "-1" }, R(5000))).toMatchObject({ ok: false });
  });
  it("CAN-U3: a plain cancel needs a reason and a plan that adds up (1,000 to plan, 0 locked)", () => {
    expect(
      checkCancel(base({ reason: "no" }), opts()).errors.reason,
    ).toBeTruthy();
    expect(checkCancel(base({ plan: [] }), opts()).errors.plan).toContain(
      "short",
    );
    expect(checkCancel(base({ plan: [row("1000")] }), opts()).errors).toEqual(
      {},
    );
  });
  it("CAN-U4: a zero-charge cancel with nothing locked needs no rows", () => {
    const p = preview({
      amount_due_paise: 0,
      locked_paise: 0,
      to_plan_paise: 0,
    });
    expect(checkCancel(base({ charge: "0" }), opts(p)).errors).toEqual({});
  });
  it("CAN-U5: a charge below what is already locked reduces expected (reason is the cancel reason), no rows", () => {
    const p = preview({
      amount_due_paise: R(500),
      locked_paise: R(2000),
      to_plan_paise: R(-1500),
    });
    expect(
      checkCancel(base({ charge: "500", plan: [] }), opts(p)).errors,
    ).toEqual({});
    expect(
      checkCancel(base({ charge: "500", plan: [row("100")] }), opts(p)).errors
        .plan,
    ).toContain("remove the rows");
  });
  it("CAN-U6: no-show: the full amount needs no extra reason; a different amount does", () => {
    const p = preview({
      amount_due_paise: R(5000),
      locked_paise: 0,
      to_plan_paise: R(5000),
    });
    const full = checkCancel(
      base({ kind: "no_show", charge: "5000", plan: [row("5000")] }),
      opts(p),
    );
    expect(full.needsChargeReason).toBe(false);
    expect(full.errors).toEqual({});
    const less = checkCancel(
      base({ kind: "no_show", charge: "3000", plan: [row("3000")] }),
      opts(
        preview({
          amount_due_paise: R(3000),
          locked_paise: 0,
          to_plan_paise: R(3000),
        }),
      ),
    );
    expect(less.needsChargeReason).toBe(true);
    expect(less.errors.chargeChangeReason).toBeTruthy();
    const ok = checkCancel(
      base({
        kind: "no_show",
        charge: "3000",
        chargeChangeReason: "Guest was ill",
        plan: [row("3000")],
      }),
      opts(
        preview({
          amount_due_paise: R(3000),
          locked_paise: 0,
          to_plan_paise: R(3000),
        }),
      ),
    );
    expect(ok.errors).toEqual({});
  });
  it("CAN-U7: the date: today is fine, the future is not, nonsense is not", () => {
    expect(
      checkCancel(base({ date: "2026-11-13", plan: [row("1000")] }), opts())
        .errors.date,
    ).toContain("future");
    expect(
      checkCancel(base({ date: "2026-11-01", plan: [row("1000")] }), opts())
        .errors.date,
    ).toBeUndefined();
    expect(checkCancel(base({ date: "" }), opts()).errors.date).toBeTruthy();
    expect(
      checkCancel(base({ date: "2026-11-13", plan: [row("1000")] }), {
        ...opts(),
        forChange: true,
      }).errors.date,
    ).toBeUndefined();
  });
  it("CAN-U8: button words, help text and the refund line (already approved 3,000, charge 1,000 -> refund due 2,000)", () => {
    expect(buttonText("cancelled")).toBe("Cancel this booking");
    expect(buttonText("no_show")).toBe("Mark as No-show");
    expect(helpText("cancelled")).toContain("Amount the resort keeps");
    expect(refundLine(R(3000), 0, R(1000))).toBe(
      "Already approved ₹3,000 → Refund due ₹2,000",
    );
    expect(refundLine(R(3000), R(500), R(1000))).toBe(
      "Already approved ₹2,500 → Refund due ₹1,500",
    ); // refunds already approved count
    expect(refundLine(R(500), 0, R(1000))).toBe(
      "Already approved ₹500 → No refund due",
    );
    expect(refundLine(0, 0, R(1000))).toBeNull();
  });
});

describe("plan tab: covered and outstanding (PLN-U10..)", () => {
  const lines = [
    { id: "b", label: "Balance", dueDate: "2026-11-20", amountPaise: R(3000) },
    { id: "a", label: "Advance", dueDate: "2026-11-05", amountPaise: R(2000) },
  ];
  it("PLN-U10: money covers the oldest row first; a row is overdue only when due before today and not covered", () => {
    const out = allocateCoverage(lines, R(2500), TODAY);
    expect(out.map((l) => l.id)).toEqual(["a", "b"]);
    expect(out[0]).toMatchObject({
      coveredPaise: R(2000),
      outstandingPaise: 0,
      overdue: false,
      locked: true,
    });
    expect(out[1]).toMatchObject({
      coveredPaise: R(500),
      outstandingPaise: R(2500),
      overdue: false,
      locked: false,
    });
    const unpaid = allocateCoverage(lines, 0, TODAY);
    expect(unpaid[0]).toMatchObject({
      outstandingPaise: R(2000),
      overdue: true,
    });
    expect(unpaid[1].overdue).toBe(false);
  });
  it("PLN-U11: never negative; surplus beyond the plan is simply not allocated", () => {
    expect(
      allocateCoverage(lines, -500, TODAY).every((l) => l.coveredPaise === 0),
    ).toBe(true);
    const all = allocateCoverage(lines, R(9999), TODAY);
    expect(all.every((l) => l.outstandingPaise === 0)).toBe(true);
  });
  it("PLN-U12: due today is not overdue and not locked", () => {
    const [l] = allocateCoverage(
      [{ id: "x", label: "Balance", dueDate: TODAY, amountPaise: 100 }],
      0,
      TODAY,
    );
    expect(l).toMatchObject({ overdue: false, locked: false });
  });
});
