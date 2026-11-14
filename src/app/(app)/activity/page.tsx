import type { Metadata } from "next";
import { ActivityView } from "@/components/app/activity/activity-view";
import { requireUser } from "@/lib/auth/session";
import { loadResorts } from "@/lib/bookings/data";
import { loadActivity, loadPeopleChoices } from "@/lib/activity/data";
import { parseActivityFilter } from "@/lib/activity/filters";
import { resortChoices, resortNameMap } from "@/lib/resorts";

export const metadata: Metadata = { title: "Activity" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Activity (PRD FR-AUD-3): the audit log with filters, including account actions; each entry shows what changed. */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireUser();
  const f = parseActivityFilter(await searchParams);
  // one read of the resorts gives both the choices and the names
  const [list, people, resorts] = await Promise.all([
    loadActivity(f),
    loadPeopleChoices(),
    loadResorts(),
  ]);
  return (
    <ActivityView
      f={f}
      list={list}
      people={people}
      resorts={resortChoices(resorts)}
      resortNames={resortNameMap(resorts)}
    />
  );
}
