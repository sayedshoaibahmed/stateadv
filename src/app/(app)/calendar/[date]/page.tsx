import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarDayView } from "@/components/app/calendar/day-view";
import { requireUser } from "@/lib/auth/session";
import { loadResortNames } from "@/lib/bookings/data";
import { loadDay } from "@/lib/calendar/data";
import { parseDay, parseResort, parseTab } from "@/lib/calendar/model";
import { todayIst } from "@/lib/dates";

export const metadata: Metadata = { title: "Calendar day" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** One day (PRD FR-CAL-2): check-ins, check-outs, staying, payments received, refunds and payments due. */
export default async function CalendarDayPage({
  params,
  searchParams,
}: {
  params: Promise<{ date: string }>;
  searchParams: SearchParams;
}) {
  await requireUser();
  const date = parseDay((await params).date);
  if (!date) notFound();
  const sp = await searchParams;
  const resort = parseResort(sp.resort).resort;
  const [day, names] = await Promise.all([
    loadDay(date, resort),
    loadResortNames(),
  ]);
  return (
    <CalendarDayView
      date={date}
      resort={resort}
      resortName={resort ? (names.get(resort) ?? null) : null}
      today={todayIst()}
      tab={parseTab(sp.tab)}
      day={day}
      resortNames={names}
    />
  );
}
