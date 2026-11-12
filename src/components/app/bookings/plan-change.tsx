"use client";

import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/app/states";
import {
  PlanEditor,
  type LockedRow,
} from "@/components/app/bookings/plan-editor";
import { planPreviewAction } from "@/lib/bookings/actions";
import { rupees, type PlanRowInput } from "@/lib/bookings/form";
import {
  checkEditPlan,
  planNeed,
  type EditPlanCheck,
  type PlanPreview,
} from "@/lib/bookings/plan";
import { formatPaise } from "@/lib/money";

/**
 * The plan part of every screen that CHANGES a booking that already has a plan (edit, change plan, cancel, no-show,
 * change charge). It asks the database for the numbers (`plan_preview`) and then shows, in plain words:
 *   - the summary line (Amount Due · Already due (locked) · Adjustments · Amount still to plan)
 *   - the amber notice when the expected amount will be reduced (no rows needed, a reason is required)
 *   - the option to move an unpaid overdue amount to a new date
 *   - the rows to fill in, with the live "adds up / short / more" line
 * The rules live in src/lib/bookings/plan.ts; the database applies them for real.
 */
export function PlanChangeSection({
  idPrefix,
  bookingId,
  newAmountDuePaise,
  locked,
  rows,
  onRows,
  reason,
  onCheck,
  allowMove = true,
  onMove,
  highlight,
}: {
  idPrefix: string;
  bookingId: string;
  /** the Amount Due after the change; null = unchanged */
  newAmountDuePaise: number | null;
  locked: LockedRow[];
  rows: PlanRowInput[];
  onRows: (rows: PlanRowInput[]) => void;
  /** the reason the person has typed elsewhere on the screen (needed for a reduction or a move) */
  reason: string;
  onCheck: (c: EditPlanCheck | null, movePaise: number) => void;
  allowMove?: boolean;
  onMove?: (paise: number) => void;
  highlight?: string;
}) {
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [moving, setMoving] = useState(false);
  const [moveText, setMoveText] = useState("");

  useEffect(() => {
    let live = true;
    planPreviewAction(bookingId, newAmountDuePaise).then((r) => {
      if (!live) return;
      if (r.ok) setPreview(r.preview);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [bookingId, newAmountDuePaise, attempt]);

  const move = useMemo(() => {
    if (!moving) return 0;
    const m = rupees(moveText);
    return "paise" in m ? m.paise : 0;
  }, [moving, moveText]);

  const check = useMemo(
    () =>
      preview
        ? checkEditPlan(preview, rows, { movePaise: move, reason })
        : null,
    [preview, rows, move, reason],
  );

  useEffect(() => {
    onCheck(check, move);
    onMove?.(move);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [check, move]);

  if (failed)
    return (
      <ErrorState
        title="The plan could not be loaded"
        onRetry={() => {
          setFailed(false);
          setAttempt((n) => n + 1);
        }}
      />
    );
  if (!preview)
    return (
      <Skeleton
        className="h-32 w-full"
        role="status"
        aria-label="Loading the plan"
      />
    );
  const need = planNeed(preview, move);

  return (
    <div className="grid gap-3 rounded-xl border-2 border-waiting/50 p-3">
      {highlight ? (
        <p className="font-medium text-waiting">{highlight}</p>
      ) : null}
      <p className="text-sm" data-testid="plan-summary">
        {need.summary}
      </p>
      {need.notice ? (
        <p
          role="status"
          className="rounded-lg border border-waiting/50 bg-waiting-soft px-3 py-2 text-sm"
        >
          {need.notice}
        </p>
      ) : null}
      {allowMove && preview.unpaid_past_paise > 0 ? (
        <div className="grid gap-2 rounded-lg bg-muted p-3">
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="size-5"
              checked={moving}
              onChange={(e) => setMoving(e.target.checked)}
            />
            Move unpaid amount to a new date (
            {formatPaise(preview.unpaid_past_paise)} is overdue)
          </label>
          {moving ? (
            <div className="grid gap-1">
              <Label htmlFor={`${idPrefix}-move`}>Amount to move (₹)</Label>
              <Input
                id={`${idPrefix}-move`}
                inputMode="decimal"
                value={moveText}
                onChange={(e) => setMoveText(e.target.value)}
                className="min-h-11 max-w-48"
              />
              <p className="text-sm text-muted-foreground">
                Then add the new row(s) below for the new date. A reason is
                needed.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
      {need.kind !== "reduce" ? (
        <PlanEditor
          idPrefix={idPrefix}
          rows={rows}
          onChange={onRows}
          check={check}
          locked={locked}
          minDate={preview.today}
          heading="New payment plan rows"
        />
      ) : null}
      {check &&
      check.problems.length > 0 &&
      rows.some((r) => r.amount !== "") ? (
        <ul className="grid gap-1 text-sm text-destructive" role="alert">
          {check.problems.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
