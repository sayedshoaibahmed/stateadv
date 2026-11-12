"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PlanChangeSection } from "@/components/app/bookings/plan-change";
import type { LockedRow } from "@/components/app/bookings/plan-editor";
import {
  cancelBookingAction,
  changeChargeAction,
  changePlanAction,
  setStatusAction,
} from "@/lib/bookings/actions";
import {
  buttonText,
  helpText,
  parseCharge,
  refundLine,
  startingCharge,
  type CancelKind,
} from "@/lib/bookings/cancel";
import type { PlanRowInput } from "@/lib/bookings/form";
import type { EditPlanCheck } from "@/lib/bookings/plan";
import { formatPaise } from "@/lib/money";
import { cn } from "@/lib/utils";

type Which = null | "cancelled" | "no_show" | "undo" | "plan" | "charge";

export interface ActionsBooking {
  id: string;
  code: string;
  version: number;
  status: "confirmed" | "checked_in" | "checked_out" | "cancelled" | "no_show";
  finalPaise: number;
  chargePaise: number | null;
  approvedPaise: number;
  refundsApprovedPaise: number;
}

const field = "min-h-11";

/** The buttons on the booking page and the dialogs behind them. Every save goes through a server action. */
export function BookingActions({
  booking,
  locked,
  today,
}: {
  booking: ActionsBooking;
  locked: LockedRow[];
  today: string;
}) {
  const router = useRouter();
  const [which, setWhich] = useState<Which>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const done = (text: string) => {
    setWhich(null);
    setMessage(text);
    router.refresh();
  };
  const b = booking;
  const final = b.status === "cancelled" || b.status === "no_show";

  function changeStatus(
    status: "confirmed" | "checked_in" | "checked_out",
    reason?: string,
    onError?: (m: string) => void,
  ) {
    startTransition(async () => {
      const r = await setStatusAction({
        bookingId: b.id,
        expectedVersion: b.version,
        status,
        reason,
      });
      if (r.ok) done(r.message ?? "Saved.");
      else if (onError) onError(r.message);
      else setMessage(r.message);
    });
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {!final ? (
          <Link
            href={`/bookings/${b.id}/edit`}
            className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}
          >
            Edit
          </Link>
        ) : null}
        {b.status === "confirmed" ? (
          <Button
            className={field}
            disabled={pending}
            onClick={() => changeStatus("checked_in")}
          >
            Mark Checked-in
          </Button>
        ) : null}
        {b.status === "checked_in" ? (
          <Button
            className={field}
            disabled={pending}
            onClick={() => changeStatus("checked_out")}
          >
            Mark Checked-out
          </Button>
        ) : null}
        {b.status === "checked_in" || b.status === "checked_out" ? (
          <Button
            variant="outline"
            className={field}
            onClick={() => setWhich("undo")}
          >
            {b.status === "checked_in" ? "Undo check-in" : "Undo check-out"}
          </Button>
        ) : null}
        {!final ? (
          <>
            <Button
              variant="outline"
              className={field}
              onClick={() => setWhich("plan")}
            >
              Change payment plan
            </Button>
            <Button
              variant="outline"
              className={field}
              onClick={() => setWhich("cancelled")}
            >
              Cancel Booking
            </Button>
            <Button
              variant="outline"
              className={field}
              onClick={() => setWhich("no_show")}
            >
              Mark No-show
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="outline"
              className={field}
              onClick={() => setWhich("charge")}
            >
              Change cancellation charge
            </Button>
            <Button
              variant="outline"
              className={field}
              onClick={() => setWhich("plan")}
            >
              Change payment plan
            </Button>
          </>
        )}
      </div>
      {message ? (
        <p role="status" className="text-sm font-medium">
          {message}
        </p>
      ) : null}

      <Dialog open={which !== null} onOpenChange={(o) => !o && setWhich(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {which === "undo" ? (
            <UndoDialog b={b} pending={pending} onSubmit={changeStatus} />
          ) : null}
          {which === "cancelled" || which === "no_show" ? (
            <CancelDialog
              key={which}
              kind={which}
              b={b}
              locked={locked}
              today={today}
              onDone={done}
            />
          ) : null}
          {which === "charge" ? (
            <ChargeDialog b={b} locked={locked} onDone={done} />
          ) : null}
          {which === "plan" ? (
            <PlanDialog b={b} locked={locked} onDone={done} />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UndoDialog({
  b,
  pending,
  onSubmit,
}: {
  b: ActionsBooking;
  pending: boolean;
  onSubmit: (
    s: "confirmed" | "checked_in" | "checked_out",
    reason: string,
    onError: (m: string) => void,
  ) => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const target = b.status === "checked_in" ? "confirmed" : "checked_in";
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {b.status === "checked_in" ? "Undo check-in" : "Undo check-out"}
        </DialogTitle>
        <DialogDescription>
          Use this only if it was marked by mistake. The reason is kept in the
          booking history.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1">
        <Label htmlFor="undo-reason">Reason</Label>
        <Input
          id="undo-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className={field}
        />
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <Button
        className={field}
        disabled={pending}
        onClick={() => {
          if (reason.trim().length < 5)
            return setError("Please write the reason (at least 5 letters).");
          setError(null);
          onSubmit(target, reason.trim(), setError);
        }}
      >
        Undo
      </Button>
    </>
  );
}

const blankRows = (): PlanRowInput[] => [];

function CancelDialog({
  kind,
  b,
  locked,
  today,
  onDone,
}: {
  kind: CancelKind;
  b: ActionsBooking;
  locked: LockedRow[];
  today: string;
  onDone: (m: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(today);
  const [charge, setCharge] = useState(startingCharge(kind, b.finalPaise));
  const [chargeWhy, setChargeWhy] = useState("");
  const [rows, setRows] = useState<PlanRowInput[]>(blankRows());
  const [check, setCheck] = useState<EditPlanCheck | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const parsed = useMemo(
    () => parseCharge({ charge }, b.finalPaise),
    [charge, b.finalPaise],
  );
  const needsWhy =
    kind === "no_show" && parsed.ok && parsed.paise !== b.finalPaise;
  const line = parsed.ok
    ? refundLine(b.approvedPaise, b.refundsApprovedPaise, parsed.paise)
    : null;

  function submit() {
    setMessage(null);
    const e: Record<string, string> = {};
    if (!parsed.ok) e.charge = parsed.problem;
    if (reason.trim().length < 5)
      e.reason = "Please write the reason (at least 5 letters).";
    if (needsWhy && chargeWhy.trim().length < 5)
      e.chargeChangeReason =
        "Please say why the charge is not the full amount (at least 5 letters).";
    if (check && check.problems.length > 0) e.plan = check.problems[0];
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    startTransition(async () => {
      const r = await cancelBookingAction({
        bookingId: b.id,
        expectedVersion: b.version,
        kind,
        date,
        charge,
        reason,
        chargeChangeReason: chargeWhy,
        plan: rows,
      });
      if (r.ok) onDone(r.message ?? "Saved.");
      else {
        setMessage(r.message);
        if (r.errors) setErrors(r.errors);
      }
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {kind === "cancelled" ? "Cancel Booking" : "Mark No-show"}
        </DialogTitle>
        <DialogDescription>
          {b.code}. The original booking amount stays on record; the charge
          below becomes the Amount Due.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <div className="grid gap-1">
          <Label htmlFor="cancel-reason">Reason</Label>
          <Input
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={field}
            aria-invalid={errors.reason ? true : undefined}
          />
          {errors.reason ? (
            <p role="alert" className="text-sm text-destructive">
              {errors.reason}
            </p>
          ) : null}
        </div>
        <div className="grid gap-1 sm:max-w-56">
          <Label htmlFor="cancel-date">Date</Label>
          <Input
            id="cancel-date"
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value)}
            className={field}
          />
          {errors.date ? (
            <p role="alert" className="text-sm text-destructive">
              {errors.date}
            </p>
          ) : null}
        </div>
        <div className="grid gap-1 sm:max-w-56">
          <Label htmlFor="cancel-charge">Cancellation charge (₹)</Label>
          <Input
            id="cancel-charge"
            inputMode="decimal"
            value={charge}
            onChange={(e) => setCharge(e.target.value)}
            className={field}
            aria-invalid={errors.charge ? true : undefined}
          />
          <p className="text-sm text-muted-foreground">
            {helpText(kind)} Booking amount: {formatPaise(b.finalPaise)}.
          </p>
          {errors.charge ? (
            <p role="alert" className="text-sm text-destructive">
              {errors.charge}
            </p>
          ) : null}
        </div>
        {needsWhy ? (
          <div className="grid gap-1">
            <Label htmlFor="cancel-charge-why">
              Reason for changing the charge
            </Label>
            <Input
              id="cancel-charge-why"
              value={chargeWhy}
              onChange={(e) => setChargeWhy(e.target.value)}
              className={field}
            />
            {errors.chargeChangeReason ? (
              <p role="alert" className="text-sm text-destructive">
                {errors.chargeChangeReason}
              </p>
            ) : null}
          </div>
        ) : null}
        {parsed.ok ? (
          <PlanChangeSection
            idPrefix="cancelplan"
            bookingId={b.id}
            newAmountDuePaise={parsed.paise}
            locked={locked}
            rows={rows}
            onRows={setRows}
            reason={reason}
            allowMove={false}
            onCheck={(c) => setCheck(c)}
          />
        ) : null}
        {line ? (
          <p className="font-medium" data-testid="refund-line">
            {line}
          </p>
        ) : null}
        {errors.plan && !rows.some((r) => r.amount !== "") ? (
          <p role="alert" className="text-sm text-destructive">
            {errors.plan}
          </p>
        ) : null}
        {message ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {message}
          </p>
        ) : null}
        <Button className="min-h-12" disabled={pending} onClick={submit}>
          {pending ? "Saving…" : buttonText(kind)}
        </Button>
      </div>
    </>
  );
}

function ChargeDialog({
  b,
  locked,
  onDone,
}: {
  b: ActionsBooking;
  locked: LockedRow[];
  onDone: (m: string) => void;
}) {
  const [charge, setCharge] = useState(
    b.chargePaise === null ? "" : String(b.chargePaise / 100),
  );
  const [reason, setReason] = useState("");
  const [rows, setRows] = useState<PlanRowInput[]>([]);
  const [check, setCheck] = useState<EditPlanCheck | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const parsed = useMemo(
    () => parseCharge({ charge }, b.finalPaise),
    [charge, b.finalPaise],
  );

  function submit() {
    const e: Record<string, string> = {};
    if (!parsed.ok) e.charge = parsed.problem;
    if (reason.trim().length < 5)
      e.reason = "Please write the reason (at least 5 letters).";
    if (check && check.problems.length > 0) e.plan = check.problems[0];
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    startTransition(async () => {
      const r = await changeChargeAction({
        bookingId: b.id,
        expectedVersion: b.version,
        charge,
        reason,
        plan: rows,
      });
      if (r.ok) onDone(r.message ?? "Saved.");
      else {
        setMessage(r.message);
        if (r.errors) setErrors(r.errors);
      }
    });
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>Change cancellation charge</DialogTitle>
        <DialogDescription>
          {b.code}. This is a correction, so a reason is needed.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <div className="grid gap-1 sm:max-w-56">
          <Label htmlFor="charge-new">New charge (₹)</Label>
          <Input
            id="charge-new"
            inputMode="decimal"
            value={charge}
            onChange={(e) => setCharge(e.target.value)}
            className={field}
          />
          {errors.charge ? (
            <p role="alert" className="text-sm text-destructive">
              {errors.charge}
            </p>
          ) : null}
        </div>
        <div className="grid gap-1">
          <Label htmlFor="charge-reason">Reason</Label>
          <Input
            id="charge-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={field}
          />
          {errors.reason ? (
            <p role="alert" className="text-sm text-destructive">
              {errors.reason}
            </p>
          ) : null}
        </div>
        {parsed.ok ? (
          <PlanChangeSection
            idPrefix="chargeplan"
            bookingId={b.id}
            newAmountDuePaise={parsed.paise}
            locked={locked}
            rows={rows}
            onRows={setRows}
            reason={reason}
            allowMove={false}
            onCheck={(c) => setCheck(c)}
          />
        ) : null}
        {message ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {message}
          </p>
        ) : null}
        <Button className="min-h-12" disabled={pending} onClick={submit}>
          {pending ? "Saving…" : "Save the new charge"}
        </Button>
      </div>
    </>
  );
}

function PlanDialog({
  b,
  locked,
  onDone,
}: {
  b: ActionsBooking;
  locked: LockedRow[];
  onDone: (m: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [rows, setRows] = useState<PlanRowInput[]>([]);
  const [check, setCheck] = useState<EditPlanCheck | null>(null);
  const [move, setMove] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const ready = !!check && check.problems.length === 0;

  function submit() {
    startTransition(async () => {
      const r = await changePlanAction({
        bookingId: b.id,
        expectedVersion: b.version,
        reason,
        movePaise: move,
        plan: rows,
      });
      if (r.ok) onDone(r.message ?? "Saved.");
      else setMessage(r.message);
    });
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>Change payment plan</DialogTitle>
        <DialogDescription>
          {b.code}. Rows that are already due stay as they are. A reason is
          needed.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <div className="grid gap-1">
          <Label htmlFor="plan-reason">Reason</Label>
          <Input
            id="plan-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={field}
          />
        </div>
        <PlanChangeSection
          idPrefix="planchange"
          bookingId={b.id}
          newAmountDuePaise={null}
          locked={locked}
          rows={rows}
          onRows={setRows}
          reason={reason}
          onCheck={(c, m) => {
            setCheck(c);
            setMove(m);
          }}
        />
        {message ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {message}
          </p>
        ) : null}
        <Button
          className="min-h-12"
          disabled={pending || !ready || reason.trim().length < 5}
          onClick={submit}
        >
          {pending ? "Saving…" : "Save the plan"}
        </Button>
      </div>
    </>
  );
}
