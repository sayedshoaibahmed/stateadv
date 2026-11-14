import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { BookingStatusBadge } from "@/components/app/booking-status";
import { DateText } from "@/components/app/date-text";
import { Money } from "@/components/app/money";
import { EmptyState, ErrorState } from "@/components/app/states";
import { BackdatedTag, StatusBadge } from "@/components/app/status-badge";
import {
  TABS,
  addBookingHref,
  addDays,
  dayHref,
  dayTitle,
  monthHref,
  monthOf,
  type Kind,
  type TabKey,
} from "@/lib/calendar/model";
import type { DayData, DayItem, Loaded } from "@/lib/calendar/data";
import { METHOD_LABELS } from "@/lib/payments/form";
import { cn } from "@/lib/utils";

const link = cn(buttonVariants({ variant: "outline" }), "min-h-11");

function EnteredNote({ i }: { i: DayItem }) {
  if (!i.backdated || !i.recordDate || !i.enteredOn) return null;
  return (
    <p className="text-sm text-muted-foreground">
      <BackdatedTag entered={i.enteredOn} /> Dated{" "}
      <DateText value={i.recordDate} />, entered on{" "}
      <DateText value={i.enteredOn} />
    </p>
  );
}

function Who({
  i,
  resortNames,
}: {
  i: DayItem;
  resortNames: Map<string, string>;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href={`/bookings/${i.bookingId}`}
          className="font-semibold underline underline-offset-4"
        >
          {i.bookingCode}
        </Link>
        <BookingStatusBadge status={i.bookingStatus} />
      </div>
      <p className="mt-1 text-sm">
        {i.guestName} · {i.guestMobile}
      </p>
      <p className="text-sm text-muted-foreground">
        {resortNames.get(i.resortId) ?? "—"} · {i.pax}{" "}
        {i.pax === 1 ? "person" : "people"} · Check-in{" "}
        <DateText value={i.checkInAt} withTime /> · Check-out{" "}
        <DateText value={i.checkOutAt} withTime />
      </p>
    </>
  );
}

function Row({
  i,
  resortNames,
}: {
  i: DayItem;
  resortNames: Map<string, string>;
}) {
  const addPayment = (
    <Link href={`/payments/new?booking=${i.bookingId}`} className={link}>
      Add Payment
    </Link>
  );
  const open = (
    <Link href={`/bookings/${i.bookingId}`} className={link}>
      Open booking
    </Link>
  );
  return (
    <li className="rounded-xl border p-3" data-kind={i.kind}>
      <Who i={i} resortNames={resortNames} />
      {i.kind === "payment" || i.kind === "refund" ? (
        <div className="mt-2 grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            {i.recordStatus ? <StatusBadge status={i.recordStatus} /> : null}
            <Money
              paise={i.amountPaise ?? 0}
              tone={
                i.kind === "refund"
                  ? "refund"
                  : i.recordStatus === "approved"
                    ? "approved"
                    : i.recordStatus === "waiting"
                      ? "waiting"
                      : i.recordStatus === "reversed"
                        ? "reversed"
                        : "neutral"
              }
              className="font-semibold"
            />
            <span className="text-sm text-muted-foreground">
              {i.recordCode} ·{" "}
              {(METHOD_LABELS as Record<string, string>)[i.method ?? ""] ??
                i.method}
              {i.label ? ` · ${i.label}` : ""}
            </span>
          </div>
          <EnteredNote i={i} />
        </div>
      ) : null}
      {i.kind === "due" ? (
        <p className="mt-2 text-sm">
          {i.method === "adjustment" ? "Adjustment" : "Planned payment"}:{" "}
          <span className="font-medium">{i.label ?? "—"}</span> ·{" "}
          <Money paise={i.amountPaise ?? 0} tone="pending" />
        </p>
      ) : null}
      <p className="mt-1 text-sm text-muted-foreground">
        Pending on this booking: <Money paise={i.pendingPaise} tone="pending" />
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {i.kind === "payment" && i.recordId ? (
          <Link href={`/payments/${i.recordId}`} className={link}>
            Open payment
          </Link>
        ) : null}
        {i.kind === "refund" && i.recordId ? (
          <Link href={`/refunds/${i.recordId}`} className={link}>
            Open refund
          </Link>
        ) : null}
        {open}
        {i.kind === "check_in" || i.kind === "check_out" || i.kind === "due"
          ? i.pendingPaise > 0
            ? addPayment
            : null
          : null}
      </div>
    </li>
  );
}

const EMPTY: Record<Kind, string> = {
  check_in: "Nobody is arriving on this day.",
  check_out: "Nobody is leaving on this day.",
  staying: "Nobody is staying overnight on this day.",
  payment: "No payments are dated this day.",
  refund: "No refunds are dated this day.",
  due: "No payments are due on this day.",
};

export function CalendarDayView({
  date,
  resort,
  resortName,
  today,
  tab,
  day,
  resortNames,
}: {
  date: string;
  resort: string | null;
  resortName: string | null;
  today: string;
  tab: TabKey;
  day: Loaded<DayData>;
  resortNames: Map<string, string>;
}) {
  const kind = TABS.find((t) => t.key === tab)!.kind;
  const items = day.ok ? day.data.items.filter((i) => i.kind === kind) : [];
  const total = day.ok ? day.data.totals[kind] : 0;
  return (
    <main className="flex flex-1 flex-col gap-4 p-3 sm:p-4">
      <div>
        <Link
          href={monthHref(monthOf(date), resort)}
          className="text-sm underline underline-offset-4"
        >
          Back to the month
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{dayTitle(date)}</h1>
            <p className="text-sm text-muted-foreground">
              {resortName ?? "All resorts"} · India time (IST)
              {date === today ? " · Today" : ""}
            </p>
          </div>
          <Link
            href={addBookingHref(date, resort)}
            className={cn(buttonVariants(), "min-h-11")}
          >
            Add Booking for this date
          </Link>
        </div>
      </div>
      <nav aria-label="Other days" className="flex flex-wrap items-end gap-2">
        <Link
          href={dayHref(addDays(date, -1), resort, tab)}
          className={link}
          aria-label={`Previous day, ${dayTitle(addDays(date, -1))}`}
        >
          Previous day
        </Link>
        <Link href={dayHref(today, resort, tab)} className={link}>
          Today
        </Link>
        <Link
          href={dayHref(addDays(date, 1), resort, tab)}
          className={link}
          aria-label={`Next day, ${dayTitle(addDays(date, 1))}`}
        >
          Next day
        </Link>
      </nav>
      {!day.ok ? (
        <ErrorState
          title="This day could not be loaded"
          retryHref={dayHref(date, resort, tab)}
        />
      ) : (
        <>
          <nav aria-label="Lists for this day">
            <ul className="flex flex-wrap gap-2">
              {TABS.map((t) => {
                const n = day.data.totals[t.kind];
                const on = t.key === tab;
                return (
                  <li key={t.key}>
                    <Link
                      href={dayHref(date, resort, t.key)}
                      aria-current={on ? "page" : undefined}
                      className={cn(
                        "inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium",
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "hover:bg-muted",
                      )}
                    >
                      {t.label}
                      <span
                        className={cn(
                          "rounded-full px-2 text-xs tabular-nums",
                          on ? "bg-primary-foreground/20" : "bg-muted",
                        )}
                      >
                        {n}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          {items.length === 0 ? (
            <EmptyState title={EMPTY[kind]} />
          ) : (
            <>
              {total > items.length ? (
                <p
                  role="status"
                  className="rounded-lg border border-waiting/40 bg-waiting-soft p-3 text-sm"
                >
                  Showing the first {items.length} of {total}. Use Bookings or
                  Old Records to see them all.
                </p>
              ) : null}
              <ul className="grid gap-3 lg:grid-cols-2" aria-label="Records">
                {items.map((i) => (
                  <Row
                    key={`${i.kind}-${i.recordId ?? i.bookingId}-${i.amountPaise}`}
                    i={i}
                    resortNames={resortNames}
                  />
                ))}
              </ul>
            </>
          )}
          {kind === "payment" || kind === "refund" ? (
            <p className="text-sm text-muted-foreground">
              Every status is listed. Only approved money is counted as
              collected or refunded; waiting, rejected and reversed items are
              never counted.
            </p>
          ) : null}
        </>
      )}
    </main>
  );
}
