import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import {
  REPORT_KEYS,
  REPORTS,
  defaultFilter,
  reportHref,
} from "@/lib/reports/definitions";
import { cn } from "@/lib/utils";

/** The list of reports (UI spec 3.13): one card each, saying what it shows and which date it uses. */
export function ReportsIndex({ today }: { today: string }) {
  return (
    <main className="flex flex-1 flex-col gap-4 p-3 sm:p-4">
      <div>
        <h1 className="text-2xl font-semibold">Collection Reports</h1>
        <p className="text-sm text-muted-foreground">
          Choose a report. Each one can be downloaded as a CSV file (for Excel
          or Google Sheets) or a PDF. Every figure comes from the same records
          as the dashboard and the booking pages. Times are India time (IST).
        </p>
      </div>
      <ul
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
        aria-label="Reports"
      >
        {REPORT_KEYS.map((key) => {
          const def = REPORTS[key];
          const f = defaultFilter(def, today);
          return (
            <li
              key={key}
              className="flex flex-col gap-2 rounded-xl border bg-card p-4"
            >
              <h2 className="text-lg font-semibold">{def.title}</h2>
              <p className="text-sm">{def.blurb}</p>
              <p className="text-xs text-muted-foreground">
                Date used: {def.dateRule(f)}
              </p>
              <div className="mt-auto pt-2">
                <Link
                  href={reportHref(def, f)}
                  className={cn(buttonVariants(), "min-h-11")}
                  aria-label={`Open the ${def.title} report`}
                >
                  Open
                </Link>
              </div>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
