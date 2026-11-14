import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReportView } from "@/components/app/reports/report-view";
import { requireUser } from "@/lib/auth/session";
import { loadResorts } from "@/lib/bookings/data";
import { todayIst } from "@/lib/dates";
import { fetchReportPage } from "@/lib/reports/data";
import {
  PAGE_SIZE,
  REPORTS,
  isReportKey,
  parseReportFilter,
} from "@/lib/reports/definitions";
import { resortChoices, resortNameMap } from "@/lib/resorts";

export const metadata: Metadata = { title: "Report" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** One report (PRD 5.16): its filters, its totals and its table, with the CSV and PDF downloads. */
export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ report: string }>;
  searchParams: SearchParams;
}) {
  await requireUser();
  const { report } = await params;
  if (!isReportKey(report)) notFound();
  const def = REPORTS[report];
  const today = todayIst();
  const f = parseReportFilter(def, await searchParams, today);
  // one read of the resorts gives both the choices and the names
  const resorts = await loadResorts();
  const page = await fetchReportPage(
    def,
    f,
    resortNameMap(resorts),
    PAGE_SIZE,
    (f.page - 1) * PAGE_SIZE,
  );
  return (
    <ReportView
      def={def}
      f={f}
      page={page}
      resorts={resortChoices(resorts)}
      today={today}
    />
  );
}
