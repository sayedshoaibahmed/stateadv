import type { Metadata } from "next";
import { ReportsIndex } from "@/components/app/reports/reports-index";
import { requireUser } from "@/lib/auth/session";
import { todayIst } from "@/lib/dates";

export const metadata: Metadata = { title: "Collection Reports" };

/** The list of reports (PRD 5.16, UI spec 3.13). */
export default async function ReportsPage() {
  await requireUser();
  return <ReportsIndex today={todayIst()} />;
}
