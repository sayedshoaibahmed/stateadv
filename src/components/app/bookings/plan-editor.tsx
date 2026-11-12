"use client";

import { Lock, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPaise } from "@/lib/money";
import {
  MAX_PLAN_ROWS,
  type PlanCheck,
  type PlanRowInput,
} from "@/lib/bookings/form";
import { formatDisplayDate } from "@/lib/dates";
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
}) {
  const set = (i: number, patch: Partial<PlanRowInput>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
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
          return (
            <li
              key={i}
              className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_11rem_9rem_auto] sm:items-end"
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
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
                aria-label={`Remove row ${i + 1}`}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                <span className="sm:sr-only">Remove</span>
              </Button>
              {problem && r.amount !== "" ? (
                <p
                  role="alert"
                  className="text-sm text-destructive sm:col-span-4"
                >
                  {problem}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
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
