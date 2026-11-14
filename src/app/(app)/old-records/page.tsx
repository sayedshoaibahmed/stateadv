import type { Metadata } from "next";
import { OldRecordsView } from "@/components/app/records/old-records-view";
import { requireUser } from "@/lib/auth/session";
import { loadResorts } from "@/lib/bookings/data";
import { loadRecords } from "@/lib/records/data";
import { parseRecordFilter } from "@/lib/records/filters";
import { resortChoices, resortNameMap } from "@/lib/resorts";

export const metadata: Metadata = { title: "Old Records" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Old Records (PRD FR-CAL-4, FR-CAL-5): bookings, payments and refunds of any date, with their files and PDFs. */
export default async function OldRecordsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireUser();
  const f = parseRecordFilter(await searchParams);
  // one read of the resorts gives both the choices and the names
  const [list, resorts] = await Promise.all([loadRecords(f), loadResorts()]);
  return (
    <OldRecordsView
      f={f}
      list={list}
      resorts={resortChoices(resorts)}
      resortNames={resortNameMap(resorts)}
    />
  );
}
