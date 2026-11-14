import type { Metadata } from "next";
import { CalendarMonthView } from "@/components/app/calendar/month-view";
import { requireUser } from "@/lib/auth/session";
import { loadResortNames } from "@/lib/bookings/data";
import { loadMonth } from "@/lib/calendar/data";
import { parseMonth, parseResort } from "@/lib/calendar/model";
import { todayIst } from "@/lib/dates";

export const metadata: Metadata = { title: "Calendar" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The month calendar (PRD FR-CAL-1): check-ins, check-outs, guests staying, money due and collected, any month. */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireUser();
  const sp = await searchParams;
  const today = todayIst();
  const month = parseMonth(sp.month, today);
  const resort = parseResort(sp.resort);
  const [days, names] = await Promise.all([
    loadMonth(month.ref, resort.resort),
    loadResortNames(),
  ]);
  return (
    <CalendarMonthView
      month={month.ref}
      resort={resort.resort}
      resortName={resort.resort ? (names.get(resort.resort) ?? null) : null}
      today={today}
      problem={month.problem ?? resort.problem}
      days={days}
    />
  );
}
