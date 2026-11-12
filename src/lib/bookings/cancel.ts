/**
 * The Cancel Booking / Mark No-show dialog (Q7, Q7a, Q7c; UI spec 3.6). Pure and unit-tested; the database re-checks all of it.
 *
 *   Cancel   : the charge starts EMPTY and must be typed (₹0 is allowed). Help text: "Amount the resort keeps."
 *   No-show  : the charge starts as the full Final Booking Amount; a different amount needs a reason.
 *   Both     : a reason (at least 5 letters), a date (today or earlier, default today) and a plan that follows the plan rules.
 *   The original amounts of the booking are never touched: the charge becomes the Amount Due.
 */
import { isIsoDate } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import { rupees, MIN_REASON, type PlanRowInput } from "@/lib/bookings/form";
import {
  checkEditPlan,
  type EditPlanCheck,
  type PlanPreview,
} from "@/lib/bookings/plan";

export type CancelKind = "cancelled" | "no_show";

export interface CancelValues {
  kind: CancelKind;
  reason: string;
  date: string;
  /** rupees as typed */
  charge: string;
  chargeChangeReason: string;
  plan: PlanRowInput[];
}

export const startingCharge = (kind: CancelKind, finalPaise: number): string =>
  kind === "no_show" ? String(finalPaise / 100) : "";

export const buttonText = (kind: CancelKind) =>
  kind === "cancelled" ? "Cancel this booking" : "Mark as No-show";
export const helpText = (kind: CancelKind) =>
  kind === "cancelled"
    ? "Amount the resort keeps. Type 0 if the guest pays nothing."
    : "The resort keeps the full amount unless you change it.";

export type ChargeResult =
  { ok: true; paise: number } | { ok: false; problem: string };

/** The charge as paise, or a plain sentence. */
export function parseCharge(
  v: Pick<CancelValues, "charge">,
  finalPaise: number,
): ChargeResult {
  const c = rupees(v.charge, null);
  if ("error" in c) {
    return {
      ok: false,
      problem:
        v.charge.trim() === ""
          ? "Please enter the cancellation charge (it can be zero)."
          : c.error,
    };
  }
  if (c.paise > finalPaise)
    return {
      ok: false,
      problem: `The charge cannot be more than the booking amount (${formatPaise(finalPaise)}).`,
    };
  return { ok: true, paise: c.paise };
}

/** "Already approved ₹3,000 → Refund due ₹2,000" (nothing when no refund is due). */
export function refundLine(
  approvedPaise: number,
  refundsApprovedPaise: number,
  chargePaise: number,
): string | null {
  const net = approvedPaise - refundsApprovedPaise;
  const due = Math.max(net - chargePaise, 0);
  if (net <= 0) return null;
  return due > 0
    ? `Already approved ${formatPaise(net)} → Refund due ${formatPaise(due)}`
    : `Already approved ${formatPaise(net)} → No refund due`;
}

export interface CancelCheck {
  charge: ChargeResult;
  plan: EditPlanCheck | null;
  errors: Record<string, string>;
  /** true when the person must say why the charge differs from the full amount (no-show only) */
  needsChargeReason: boolean;
}

export function checkCancel(
  v: CancelValues,
  o: {
    finalPaise: number;
    today: string;
    preview: PlanPreview | null;
    forChange?: boolean;
  },
): CancelCheck {
  const errors: Record<string, string> = {};
  const charge = parseCharge(v, o.finalPaise);
  if (!charge.ok) errors.charge = charge.problem;
  if (v.reason.trim().length < MIN_REASON)
    errors.reason = "Please write the reason (at least 5 letters).";
  if (!o.forChange) {
    if (!isIsoDate(v.date)) errors.date = "Please choose the date.";
    else if (v.date > o.today)
      errors.date = "The date cannot be in the future.";
  }
  const needsChargeReason =
    v.kind === "no_show" && charge.ok && charge.paise !== o.finalPaise;
  if (needsChargeReason && v.chargeChangeReason.trim().length < MIN_REASON) {
    errors.chargeChangeReason =
      "Please say why the charge is not the full amount (at least 5 letters).";
  }
  let plan: EditPlanCheck | null = null;
  if (charge.ok && o.preview) {
    // the preview must have been made for THIS charge as the new Amount Due
    plan = checkEditPlan(o.preview, v.plan, { reason: v.reason });
    if (plan.problems.length > 0) errors.plan = plan.problems[0];
  }
  return { charge, plan, errors, needsChargeReason };
}
