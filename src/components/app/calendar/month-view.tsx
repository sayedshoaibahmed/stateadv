import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Money } from "@/components/app/money";
import { EmptyState, ErrorState } from "@/components/app/states";
import {
  WEEKDAY_HEADS,
  addBookingHref,
  agendaDays,
  defaultBookingDay,
  dayHref,
  dayLabel,
  dayShort,
  isQuiet,
  monthGrid,
  monthHref,
  monthKey,
  monthLabel,
  monthOf,
  shiftMonth,
  type CalendarDay,
  type MonthRef,
} from "@/lib/calendar/model";
import type { Loaded } from "@/lib/calendar/data";
import { cn } from "@/lib/utils";

const input =
  "min-h-11 w-full rounded-lg border bg-background px-2 text-base sm:text-sm";

/** The figures of one day, in the same words in the grid and in the phone list. */
function Figures({ d }: { d: CalendarDay }) {
  return (
    <dl className="grid gap-0.5 text-xs">
      {d.checkIns ? (
        <div className="flex justify-between gap-1">
          <dt className="text-muted-foreground">Check-in</dt>
          <dd className="font-medium tabular-nums">{d.checkIns}</dd>
        </div>
      ) : null}
      {d.checkOuts ? (
        <div className="flex justify-between gap-1">
          <dt className="text-muted-foreground">Check-out</dt>
          <dd className="font-medium tabular-nums">{d.checkOuts}</dd>
        </div>
      ) : null}
      {d.staying ? (
        <div className="flex justify-between gap-1">
          <dt className="text-muted-foreground">Staying</dt>
          <dd className="font-medium tabular-nums">{d.staying}</dd>
        </div>
      ) : null}
      {d.duePaise !== 0 ? (
        <div className="flex justify-between gap-1">
          <dt className="text-muted-foreground">Due</dt>
          <dd>
            <Money paise={d.duePaise} tone="pending" />
          </dd>
        </div>
      ) : null}
      {d.collectedPaise !== 0 ? (
        <div className="flex justify-between gap-1">
          <dt className="text-muted-foreground">Collected</dt>
          <dd>
            <Money paise={d.collectedPaise} tone="approved" />
          </dd>
        </div>
      ) : null}
      {d.waitingPaise !== 0 ? (
        <div className="flex justify-between gap-1">
          <dt className="text-muted-foreground">Waiting</dt>
          <dd>
            <Money paise={d.waitingPaise} tone="waiting" />
          </dd>
        </div>
      ) : null}
      {d.refundsPaise !== 0 ? (
        <div className="flex justify-between gap-1">
          <dt className="text-muted-foreground">Refunds</dt>
          <dd>
            <Money paise={d.refundsPaise} tone="refund" />
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

export function MonthNav({
  month,
  resort,
  today,
}: {
  month: MonthRef;
  resort: string | null;
  today: string;
}) {
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const outline = cn(buttonVariants({ variant: "outline" }), "min-h-11");
  return (
    <nav aria-label="Choose a month" className="flex flex-wrap items-end gap-2">
      {prev ? (
        <Link
          href={monthHref(prev, resort)}
          className={outline}
          aria-label={`Previous month, ${monthLabel(prev)}`}
        >
          Previous
        </Link>
      ) : (
        <span className={cn(outline, "pointer-events-none opacity-50")}>
          Previous
        </span>
      )}
      <Link href={monthHref(monthOf(today), resort)} className={outline}>
        Today
      </Link>
      {next ? (
        <Link
          href={monthHref(next, resort)}
          className={outline}
          aria-label={`Next month, ${monthLabel(next)}`}
        >
          Next
        </Link>
      ) : (
        <span className={cn(outline, "pointer-events-none opacity-50")}>
          Next
        </span>
      )}
      <form
        action="/calendar"
        method="get"
        className="flex flex-wrap items-end gap-2"
        aria-label="Go to a month"
      >
        {resort ? <input type="hidden" name="resort" value={resort} /> : null}
        <div className="grid gap-1">
          <label htmlFor="month" className="text-sm font-medium">
            Go to month
          </label>
          <input
            id="month"
            name="month"
            type="month"
            defaultValue={monthKey(month)}
            min="1990-01"
            max="2100-12"
            pattern="[0-9]{4}-[0-9]{2}"
            placeholder="2026-03"
            className={cn(input, "w-44")}
          />
        </div>
        <button
          type="submit"
          className="min-h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Show
        </button>
      </form>
    </nav>
  );
}

export function CalendarMonthView({
  month,
  resort,
  resortName,
  today,
  problem,
  days,
}: {
  month: MonthRef;
  resort: string | null;
  resortName: string | null;
  today: string;
  problem: string | null;
  days: Loaded<CalendarDay[]>;
}) {
  const retry = monthHref(month, resort);
  const byDate = new Map(days.ok ? days.data.map((d) => [d.date, d]) : []);
  return (
    <main className="flex flex-1 flex-col gap-4 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Calendar</h1>
          <p className="text-sm text-muted-foreground">
            {resortName ?? "All resorts"} · India time (IST)
          </p>
        </div>
        <Link
          href={addBookingHref(defaultBookingDay(month, today), resort)}
          className={cn(buttonVariants(), "min-h-11")}
        >
          Add Booking
        </Link>
      </div>
      {problem ? (
        <p
          role="status"
          className="rounded-lg border border-waiting/40 bg-waiting-soft p-3 text-sm"
        >
          {problem}
        </p>
      ) : null}
      <MonthNav month={month} resort={resort} today={today} />
      <h2 className="text-xl font-semibold" aria-live="polite">
        {monthLabel(month)}
      </h2>
      {!days.ok ? (
        <ErrorState
          title="The calendar could not be loaded"
          retryHref={retry}
        />
      ) : (
        <>
          <div className="hidden md:block" data-testid="calendar-grid">
            <table className="w-full table-fixed border-collapse">
              <caption className="sr-only">
                {monthLabel(month)}: check-ins, check-outs, guests staying,
                money due and collected for each day
              </caption>
              <thead>
                <tr>
                  {WEEKDAY_HEADS.map((w) => (
                    <th
                      key={w}
                      scope="col"
                      className="border-b py-2 text-sm font-medium text-muted-foreground"
                    >
                      {w}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {monthGrid(month).map((week, i) => (
                  <tr key={i}>
                    {week.map((date, j) => {
                      const d = date ? byDate.get(date) : undefined;
                      if (!date || !d)
                        return (
                          <td key={j} className="border bg-muted/30 p-1" />
                        );
                      const isToday = date === today;
                      return (
                        <td
                          key={j}
                          className={cn(
                            "h-28 border p-0 align-top",
                            isToday && "bg-primary/5",
                          )}
                        >
                          <Link
                            href={dayHref(date, resort)}
                            aria-label={dayLabel(d)}
                            aria-current={isToday ? "date" : undefined}
                            className="block h-full min-h-11 p-1.5 hover:bg-muted/50 focus-visible:outline-2"
                          >
                            <span
                              className={cn(
                                "mb-1 inline-flex size-7 items-center justify-center rounded-full text-sm font-medium",
                                isToday && "bg-primary text-primary-foreground",
                                isQuiet(d) &&
                                  !isToday &&
                                  "text-muted-foreground",
                              )}
                            >
                              {Number(date.slice(8))}
                            </span>
                            <Figures d={d} />
                          </Link>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="md:hidden" data-testid="calendar-agenda">
            {agendaDays(days.data).length === 0 ? (
              <EmptyState title="Nothing on this month's calendar">
                No check-ins, check-outs, stays or payments fall in{" "}
                {monthLabel(month)}.
              </EmptyState>
            ) : (
              <ul className="grid gap-2">
                {agendaDays(days.data).map((d) => (
                  <li key={d.date}>
                    <Link
                      href={dayHref(d.date, resort)}
                      aria-label={dayLabel(d)}
                      className={cn(
                        "flex min-h-11 items-start gap-3 rounded-xl border p-3",
                        d.date === today && "border-primary bg-primary/5",
                      )}
                    >
                      <span className="w-24 shrink-0 font-semibold">
                        {dayShort(d.date)}
                        {d.date === today ? (
                          <span className="block text-xs font-normal text-primary">
                            Today
                          </span>
                        ) : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <Figures d={d} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarDays className="size-4" aria-hidden="true" />
              Only days with something on them are listed. Use a bigger screen
              for the whole month.
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            <strong className="font-medium">Due</strong> is the money the
            payment plans and changes expect that day.{" "}
            <strong className="font-medium">Collected</strong> counts approved
            payments only; payments waiting for approval are shown apart.
            Cancelled and no-show bookings are not counted as guests.
          </p>
        </>
      )}
    </main>
  );
}
