/**
 * The payment-plan rules for CHANGING a booking that already has a plan (TRD 5.2a, D2; UI spec 3.4). Pure and unit-tested.
 *
 *   Amount Due (new)  =  Already due (locked)  +  earlier Adjustments  +  Amount still to plan
 *
 *   - rows that are already due (before today) are LOCKED and never touched
 *   - "Amount still to plan" is what the new rows (due today or later) must add up to
 *   - if it is NEGATIVE, no new rows are needed: an Expected Adjustment (dated today) records the reduction and a reason is required
 *   - an overdue, unpaid amount can be MOVED to a new date: it is added to the amount to plan and a dated adjustment
 *     removes it from "expected before today"; this needs a reason and cannot be more than what is overdue and unpaid
 * The database does the real work (`plan_preview`, `apply_plan_change`); this only previews and checks first.
 */
import { isIsoDate } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import {
  checkPlan,
  type PlanCheck,
  type PlanRowInput,
} from "@/lib/bookings/form";

/** What `plan_preview` returns (all paise, `today` an IST date). */
export interface PlanPreview {
  amount_due_paise: number;
  locked_paise: number;
  adjustments_paise: number;
  to_plan_paise: number;
  unpaid_past_paise: number;
  today: string;
}

export function isPlanPreview(x: unknown): x is PlanPreview {
  if (typeof x !== "object" || x === null) return false;
  const p = x as Record<string, unknown>;
  return (
    [
      "amount_due_paise",
      "locked_paise",
      "adjustments_paise",
      "to_plan_paise",
      "unpaid_past_paise",
    ].every((k) => Number.isSafeInteger(p[k])) &&
    typeof p.today === "string" &&
    isIsoDate(p.today)
  );
}

export interface PlanNeed {
  kind: "rows" | "none" | "reduce";
  /** what the new rows must add up to (0 unless kind = "rows") */
  rowsMustTotalPaise: number;
  /** the Expected Adjustment that will be recorded when kind = "reduce" */
  reductionPaise: number;
  summary: string;
  notice: string | null;
}

/** Shows the numbers the way the screen words them. `move` = overdue amount being moved to a new date. */
export function planNeed(p: PlanPreview, movePaise = 0): PlanNeed {
  const toPlan = p.to_plan_paise + movePaise;
  const summary =
    `Amount Due ${formatPaise(p.amount_due_paise)} · Already due (locked) ${formatPaise(p.locked_paise)} · ` +
    `Adjustments ${formatPaise(p.adjustments_paise)}${movePaise > 0 ? ` · Moved ${formatPaise(movePaise)}` : ""} · ` +
    `Amount still to plan ${formatPaise(Math.max(toPlan, 0))}`;
  if (toPlan < 0) {
    return {
      kind: "reduce",
      rowsMustTotalPaise: 0,
      reductionPaise: -toPlan,
      summary,
      notice: `Expected will be reduced by ${formatPaise(-toPlan)} today (adjustment). Please give a reason.`,
    };
  }
  if (toPlan === 0)
    return {
      kind: "none",
      rowsMustTotalPaise: 0,
      reductionPaise: 0,
      summary,
      notice: null,
    };
  return {
    kind: "rows",
    rowsMustTotalPaise: toPlan,
    reductionPaise: 0,
    summary,
    notice: null,
  };
}

export interface EditPlanCheck extends PlanCheck {
  need: PlanNeed;
  /** blocking sentences in plain English; empty = ready to save */
  problems: string[];
}

/**
 * The checks before saving a changed plan: rows must add up, none may be due before today, a reduction or a move needs
 * a reason, and a move cannot be more than the overdue unpaid amount.
 */
export function checkEditPlan(
  p: PlanPreview,
  rows: readonly PlanRowInput[],
  o: { movePaise?: number; reason?: string } = {},
): EditPlanCheck {
  const move = o.movePaise ?? 0;
  const need = planNeed(p, move);
  const base = checkPlan(rows, need.rowsMustTotalPaise, "amount still to plan");
  const problems: string[] = [];
  if (move < 0) problems.push("The amount to move cannot be negative.");
  if (move > p.unpaid_past_paise) {
    problems.push(
      p.unpaid_past_paise === 0
        ? "Nothing is overdue and unpaid, so nothing can be moved."
        : `Only ${formatPaise(p.unpaid_past_paise)} is overdue and unpaid.`,
    );
  }
  if (need.kind === "reduce" && rows.length > 0)
    problems.push(
      "No new rows are needed: the amount is being reduced. Please remove the rows.",
    );
  if (need.kind !== "reduce" && base.state !== "ok")
    problems.push(base.text ?? "The plan rows do not add up.");
  if (
    need.kind !== "reduce" &&
    base.state === "ok" &&
    base.rowProblems.some(Boolean)
  )
    problems.push("Please complete every row of the payment plan.");
  rows.forEach((r, i) => {
    if (isIsoDate(r.dueDate) && r.dueDate < p.today)
      problems.push(
        `Row ${i + 1} is due before today. New rows must be due today or later.`,
      );
  });
  if (
    (need.kind === "reduce" || move > 0) &&
    (o.reason ?? "").trim().length < 5
  ) {
    problems.push("Please give a reason (at least 5 letters).");
  }
  return { ...base, need, problems };
}
