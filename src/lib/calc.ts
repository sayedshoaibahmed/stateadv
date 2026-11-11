/**
 * Booking and financial calculations — REFERENCE implementation.
 *
 * The database is the source of truth (DATABASE_SCHEMA §3–4). This module
 * mirrors the same formulas so the booking form can show a live preview,
 * and so M2 database tests can be cross-checked against it.
 * Integer paise only.
 */
import { assertPaise, multiplyPaise, type Paise } from "./money";

export type PricingMethod = "per_person_per_night" | "per_person_per_stay";

export class CalcError extends Error {
  constructor(
    public readonly code:
      | "INVALID_PAX"
      | "INVALID_NIGHTS"
      | "NIGHTS_REQUIRED"
      | "DISCOUNT_TOO_LARGE"
      | "NEGATIVE_AMOUNT"
      | "FINAL_BELOW_ZERO"
      | "ADJUSTMENT_REASON_REQUIRED",
    message: string,
  ) {
    super(message);
    this.name = "CalcError";
  }
}

export interface BookingAmountInput {
  pricingMethod: PricingMethod;
  pax: number;
  tariffPerPersonPaise: Paise;
  nights: number;
  extraChargesPaise?: Paise;
  discountPaise?: Paise;
  /** Final amount typed by the user (manual adjustment). Omit to use the calculated final. */
  finalOverridePaise?: Paise;
  adjustmentReason?: string;
}

export interface BookingAmounts {
  basePaise: Paise;
  totalPaise: Paise;
  calculatedFinalPaise: Paise;
  manualAdjustmentPaise: Paise;
  finalPaise: Paise;
}

/** PRD FR-BK-4 (decided Q1, Q14, D4). */
export function computeBookingAmounts(i: BookingAmountInput): BookingAmounts {
  if (!Number.isSafeInteger(i.pax) || i.pax < 1 || i.pax > 1000) {
    throw new CalcError("INVALID_PAX", "PAX must be between 1 and 1000.");
  }
  if (!Number.isSafeInteger(i.nights) || i.nights < 0) {
    throw new CalcError("INVALID_NIGHTS", "Nights must be 0 or more.");
  }
  if (i.pricingMethod === "per_person_per_night" && i.nights < 1) {
    throw new CalcError(
      "NIGHTS_REQUIRED",
      "Per night pricing needs at least 1 night. Check the check-out date.",
    );
  }
  const tariff = assertPaise(i.tariffPerPersonPaise, "Tariff");
  const extra = assertPaise(i.extraChargesPaise ?? 0, "Extra charges");
  const discount = assertPaise(i.discountPaise ?? 0, "Discount");
  if (tariff < 0 || extra < 0 || discount < 0) {
    throw new CalcError("NEGATIVE_AMOUNT", "Amounts cannot be negative.");
  }

  const basePaise =
    i.pricingMethod === "per_person_per_night"
      ? multiplyPaise(tariff, i.pax, i.nights)
      : multiplyPaise(tariff, i.pax);
  const totalPaise = assertPaise(basePaise + extra);
  if (discount > totalPaise) {
    throw new CalcError(
      "DISCOUNT_TOO_LARGE",
      "Discount cannot be more than the Total Amount.",
    );
  }
  const calculatedFinalPaise = totalPaise - discount;

  let finalPaise = calculatedFinalPaise;
  if (i.finalOverridePaise !== undefined) {
    finalPaise = assertPaise(i.finalOverridePaise, "Final amount");
    if (finalPaise < 0) {
      throw new CalcError(
        "FINAL_BELOW_ZERO",
        "Final Booking Amount cannot be below ₹0.",
      );
    }
    if (finalPaise !== calculatedFinalPaise && !i.adjustmentReason?.trim()) {
      throw new CalcError(
        "ADJUSTMENT_REASON_REQUIRED",
        "Please give a reason for changing the final amount.",
      );
    }
  }

  return {
    basePaise,
    totalPaise,
    calculatedFinalPaise,
    manualAdjustmentPaise: finalPaise - calculatedFinalPaise,
    finalPaise,
  };
}

export interface FinancialInput {
  /** Amount Due: final amount, or cancellation charge when cancelled/no-show. */
  amountDuePaise: Paise;
  approvedPaise: Paise; // A
  waitingPaise: Paise; // W
  refundsApprovedPaise: Paise; // RA
  refundsWaitingPaise: Paise; // RW
}

export interface Financials {
  totalRecordedPaise: Paise;
  totalCollectionPaise: Paise;
  netCollectionPaise: Paise;
  pendingPaise: Paise;
  verifiedRemainingPaise: Paise;
  extraPaise: Paise;
  refundDuePaise: Paise;
  refundWaitingPaise: Paise;
  refundStillToRecordPaise: Paise;
  refundLimitPaise: Paise;
}

/** PRD §5.11 / DATABASE_SCHEMA §3.1 (decided Q5, Q7d, D1). */
export function computeFinancials(f: FinancialInput): Financials {
  const D = assertPaise(f.amountDuePaise);
  const A = assertPaise(f.approvedPaise);
  const W = assertPaise(f.waitingPaise);
  const RA = assertPaise(f.refundsApprovedPaise);
  const RW = assertPaise(f.refundsWaitingPaise);

  const netCollection = A - RA;
  const netRecorded = A + W - RA; // D1: waiting refunds are NOT subtracted
  const refundDue = Math.max(netCollection - D, 0);

  return {
    totalRecordedPaise: A + W,
    totalCollectionPaise: A,
    netCollectionPaise: netCollection,
    pendingPaise: Math.max(D - netRecorded, 0),
    verifiedRemainingPaise: Math.max(D - netCollection, 0),
    extraPaise: Math.max(netRecorded - D, 0),
    refundDuePaise: refundDue,
    refundWaitingPaise: RW,
    refundStillToRecordPaise: Math.max(refundDue - RW, 0),
    refundLimitPaise: A - RA - RW,
  };
}
