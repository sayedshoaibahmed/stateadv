"use client";

import { useState } from "react";
import { Lock, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPaise } from "@/lib/money";
import {
  MAX_PLAN_ROWS,
  rupees,
  type PlanCheck,
  type PlanRowInput,
} from "@/lib/bookings/form";
import { verifyPlanAction } from "@/lib/bookings/actions";
import { allocateCoverage, type CoveredLine } from "@/lib/bookings/coverage";
import { formatDisplayDate, todayIst } from "@/lib/dates";
import { cn } from "@/lib/utils";

export interface LockedRow {
  label: string;
  dueDate: string;
  amountPaise: number;
}

/**
 * The payment-plan rows: a label, a due date and an amount. Both starting amounts are EMPTY (nothing is suggested).
 * Rows that are already due are shown greyed with a lock and cannot be changed (D2). The line under the rows says in
 * plain words whether the plan adds up.
 *
 * Each row also has a Verify button: it checks the money actually approved for this booking against the rows (oldest
 * due date first) and shows whether that row is paid, partly paid or not paid yet. It needs a saved booking
 * (`bookingId`); on a brand-new booking that has not been saved yet, it just explains that.
 */
export function PlanEditor({
  idPrefix,
  rows,
  onChange,
  check,
  locked = [],
  minDate,
  disabled,
  heading = "Payment plan",
  bookingId,
}: {
  idPrefix: string;
  rows: PlanRowInput[];
  onChange: (rows: PlanRowInput[]) => void;
  check: PlanCheck | null;
  locked?: LockedRow[];
  /** new rows must be due on or after this date (YYYY-MM-DD) */
  minDate?: string;
  disabled?: boolean;
  heading?: string;
  /** the saved booking's id, so Verify can look up real payments; omit for a booking not yet saved */
  bookingId?: string;
}) {
  const set = (i: number, patch: Partial<PlanRowInput>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const [verifying, setVerifying] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<CoveredLine[] | null>(null);

  function verify() {
    setVerifyMessage(null);
    if (!bookingId) {
      setVerifyMessage("Save the booking first to verify payments.");
      return;
    }
    setVerifying(true);
    verifyPlanAction(bookingId).then((r) => {
      setVerifying(false);
      if (!r.ok) {
        setVerifyMessage(r.message);
        return;
      }
      setCoverage(
        allocateCoverage(
          rows.map((row, i) => {
            const a = rupees(row.amount, null);
            return {
              id: String(i),
              label: row.label,
              dueDate: row.dueDate,
              amountPaise: "paise" in a ? a.paise : 0,
            };
          }),
          r.netCollectedPaise,
          todayIst(),
        ),
      );
    });
  }

  const statusFor = (i: number) =>
    coverage?.find((c) => c.id === String(i)) ?? null;

  return (
    <fieldset className="grid gap-3" disabled={disabled}>
      <legend className="text-lg font-semibold">{heading}</legend>
      {locked.length > 0 ? (
        <ul className="grid gap-1" aria-label="Rows that are already due">
          {locked.map((l, i) => (
            <li
              key={i}
              className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground"
            >
              <Lock className="size-4 shrink-0" aria-hidden="true" />
              <span>
                {l.label} {formatPaise(l.amountPaise)} – due{" "}
                {formatDisplayDate(l.dueDate)} – locked (already due)
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="grid gap-3">
        {rows.map((r, i) => {
          const problem = check?.rowProblems[i] ?? null;
          const status = statusFor(i);
          return (
            <li
              key={i}
              className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_11rem_9rem_auto_auto] sm:items-end"
            >
              <div className="grid gap-1">
                <Label htmlFor={`${idPrefix}-label-${i}`}>Name</Label>
                <Input
                  id={`${idPrefix}-label-${i}`}
                  value={r.label}
                  maxLength={60}
                  onChange={(e) => set(i, { label: e.target.value })}
                  className="min-h-11"
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`${idPrefix}-date-${i}`}>Due date</Label>
                <Input
                  id={`${idPrefix}-date-${i}`}
                  type="date"
                  value={r.dueDate}
                  min={minDate}
                  onChange={(e) => set(i, { dueDate: e.target.value })}
                  className="min-h-11"
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`${idPrefix}-amount-${i}`}>Amount (₹)</Label>
                <Input
                  id={`${idPrefix}-amount-${i}`}
                  inputMode="decimal"
                  value={r.amount}
                  placeholder="0"
                  onChange={(e) => set(i, { amount: e.target.value })}
                  aria-invalid={problem ? true : undefined}
                  className="min-h-11"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={verifying}
                onClick={verify}
              >
                <ShieldCheck className="size-4" aria-hidden="true" />
                {verifying ? "Checking…" : "Verify"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
                aria-label={`Remove row ${i + 1}`}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                <span className="sm:sr-only">Remove</span>
              </Button>
              {status ? (
                <p
                  role="status"
                  className={cn(
                    "text-sm font-medium sm:col-span-5",
                    status.outstandingPaise === 0
                      ? "text-approved"
                      : status.coveredPaise > 0
                        ? "text-waiting"
                        : "text-muted-foreground",
                  )}
                >
                  {status.outstandingPaise === 0
                    ? `Verified: paid in full (${formatPaise(status.amountPaise)})`
                    : status.coveredPaise > 0
                      ? `Verified: partly paid, ${formatPaise(status.coveredPaise)} of ${formatPaise(status.amountPaise)}`
                      : "Verified: not paid yet"}
                </p>
              ) : null}
              {problem && r.amount !== "" ? (
                <p
                  role="alert"
                  className="text-sm text-destructive sm:col-span-5"
                >
                  {problem}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {verifyMessage ? (
        <p role="alert" className="text-sm text-destructive">
          {verifyMessage}
        </p>
      ) : null}
      <div>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          disabled={rows.length >= MAX_PLAN_ROWS}
          onClick={() =>
            onChange([
              ...rows,
              { label: "Payment", dueDate: minDate ?? "", amount: "" },
            ])
          }
        >
          <Plus className="size-4" aria-hidden="true" /> Add a row
        </Button>
      </div>
      {check?.text ? (
        <p
          role="status"
          className={cn(
            "rounded-lg px-3 py-2 text-sm font-medium",
            check.state === "ok"
              ? "bg-approved-soft text-approved"
              : "bg-rejected-soft text-rejected",
          )}
        >
          {check.text}
        </p>
      ) : null}
    </fieldset>
  );
}
