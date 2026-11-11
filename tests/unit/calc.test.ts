import { describe, expect, it } from "vitest";
import { FIN_CASES } from "../shared/fin-cases";
import {
  CalcError,
  computeBookingAmounts,
  computeFinancials,
  type FinancialInput,
} from "@/lib/calc";

const R = (rupees: number) => rupees * 100; // test helper: whole rupees → paise

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof CalcError) return e.code;
    throw e;
  }
  return undefined;
}

describe("computeBookingAmounts (TEST_PLAN 2.2)", () => {
  it("AMT-01: per stay 2 × ₹2,500 = ₹5,000", () => {
    const r = computeBookingAmounts({
      pricingMethod: "per_person_per_stay",
      pax: 2,
      tariffPerPersonPaise: R(2500),
      nights: 1,
    });
    expect(r).toEqual({
      basePaise: R(5000),
      totalPaise: R(5000),
      calculatedFinalPaise: R(5000),
      manualAdjustmentPaise: 0,
      finalPaise: R(5000),
    });
  });

  it("AMT-02: per night 2 × ₹2,500 × 2 + ₹500 − ₹1,000 = ₹9,500", () => {
    const r = computeBookingAmounts({
      pricingMethod: "per_person_per_night",
      pax: 2,
      tariffPerPersonPaise: R(2500),
      nights: 2,
      extraChargesPaise: R(500),
      discountPaise: R(1000),
    });
    expect(r.basePaise).toBe(R(10000));
    expect(r.totalPaise).toBe(R(10500));
    expect(r.finalPaise).toBe(R(9500));
  });

  it("AMT-04: per night with 0 nights is rejected", () => {
    expect(
      code(() =>
        computeBookingAmounts({
          pricingMethod: "per_person_per_night",
          pax: 2,
          tariffPerPersonPaise: R(2500),
          nights: 0,
        }),
      ),
    ).toBe("NIGHTS_REQUIRED");
  });

  it("AMT-05: per stay with 0 nights (day outing) is allowed", () => {
    const r = computeBookingAmounts({
      pricingMethod: "per_person_per_stay",
      pax: 10,
      tariffPerPersonPaise: R(800),
      nights: 0,
    });
    expect(r.finalPaise).toBe(R(8000));
  });

  it("AMT-06: discount > total is rejected", () => {
    expect(
      code(() =>
        computeBookingAmounts({
          pricingMethod: "per_person_per_stay",
          pax: 1,
          tariffPerPersonPaise: R(1000),
          nights: 1,
          discountPaise: R(1001),
        }),
      ),
    ).toBe("DISCOUNT_TOO_LARGE");
  });

  it("AMT-08: manual final without reason is rejected", () => {
    expect(
      code(() =>
        computeBookingAmounts({
          pricingMethod: "per_person_per_night",
          pax: 2,
          tariffPerPersonPaise: R(2500),
          nights: 2,
          extraChargesPaise: R(500),
          discountPaise: R(1000),
          finalOverridePaise: R(9000),
        }),
      ),
    ).toBe("ADJUSTMENT_REASON_REQUIRED");
  });

  it("AMT-09: manual final ₹9,000 with reason → adjustment −₹500", () => {
    const r = computeBookingAmounts({
      pricingMethod: "per_person_per_night",
      pax: 2,
      tariffPerPersonPaise: R(2500),
      nights: 2,
      extraChargesPaise: R(500),
      discountPaise: R(1000),
      finalOverridePaise: R(9000),
      adjustmentReason: "Rounded for regular guest",
    });
    expect(r.calculatedFinalPaise).toBe(R(9500));
    expect(r.manualAdjustmentPaise).toBe(-50000);
    expect(r.finalPaise).toBe(R(9000));
  });

  it("AMT-10: manual final below ₹0 is rejected", () => {
    expect(
      code(() =>
        computeBookingAmounts({
          pricingMethod: "per_person_per_stay",
          pax: 1,
          tariffPerPersonPaise: R(100),
          nights: 1,
          finalOverridePaise: -1,
          adjustmentReason: "x",
        }),
      ),
    ).toBe("FINAL_BELOW_ZERO");
  });

  it("override equal to the calculated value needs no reason", () => {
    const r = computeBookingAmounts({
      pricingMethod: "per_person_per_stay",
      pax: 1,
      tariffPerPersonPaise: R(100),
      nights: 1,
      finalOverridePaise: R(100),
    });
    expect(r.manualAdjustmentPaise).toBe(0);
  });

  it("rejects invalid PAX", () => {
    for (const pax of [0, -1, 1.5, 1001]) {
      expect(
        code(() =>
          computeBookingAmounts({
            pricingMethod: "per_person_per_stay",
            pax,
            tariffPerPersonPaise: R(100),
            nights: 1,
          }),
        ),
      ).toBe("INVALID_PAX");
    }
  });
});

describe("computeFinancials (TEST_PLAN 2.9, decided D1)", () => {
  it.each(FIN_CASES)("%s", (_id, [D, A, W, RA, RW], e) => {
    const input: FinancialInput = {
      amountDuePaise: R(D),
      approvedPaise: R(A),
      waitingPaise: R(W),
      refundsApprovedPaise: R(RA),
      refundsWaitingPaise: R(RW),
    };
    const f = computeFinancials(input);
    expect(f.pendingPaise).toBe(R(e.pending));
    expect(f.verifiedRemainingPaise).toBe(R(e.verified));
    expect(f.extraPaise).toBe(R(e.extra));
    expect(f.refundDuePaise).toBe(R(e.refundDue));
    expect(f.totalCollectionPaise).toBe(R(e.total));
    expect(f.netCollectionPaise).toBe(R(e.net));
    if (e.stillToRecord !== undefined) {
      expect(f.refundStillToRecordPaise).toBe(R(e.stillToRecord));
    }
  });

  it("D1: a waiting refund never changes Pending / Net Collection", () => {
    const base = {
      amountDuePaise: R(5000),
      approvedPaise: R(6000),
      waitingPaise: 0,
      refundsApprovedPaise: 0,
    };
    const before = computeFinancials({ ...base, refundsWaitingPaise: 0 });
    const during = computeFinancials({ ...base, refundsWaitingPaise: R(1500) });
    expect(during.pendingPaise).toBe(before.pendingPaise);
    expect(during.netCollectionPaise).toBe(before.netCollectionPaise);
    expect(during.extraPaise).toBe(before.extraPaise);
    expect(during.refundLimitPaise).toBe(R(4500)); // A − RA − RW
  });

  it("Q5: waiting payments are never Total Collection", () => {
    const f = computeFinancials({
      amountDuePaise: R(5000),
      approvedPaise: 0,
      waitingPaise: R(1000),
      refundsApprovedPaise: 0,
      refundsWaitingPaise: 0,
    });
    expect(f.totalCollectionPaise).toBe(0);
    expect(f.pendingPaise).toBe(R(4000));
    expect(f.verifiedRemainingPaise).toBe(R(5000));
  });
});
