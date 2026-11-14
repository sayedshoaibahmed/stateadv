import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Shown when the report in the address is not one of the reports (the page calls notFound()). */
export default function ReportNotFound() {
  return (
    <main className="flex flex-1 flex-col gap-4 p-3 sm:p-4">
      <h1 className="text-2xl font-semibold">That report was not found</h1>
      <p className="max-w-prose text-muted-foreground">
        There is no report with that name. Go back to the list and choose one.
      </p>
      <div>
        <Link href="/reports" className={cn(buttonVariants(), "min-h-11")}>
          All reports
        </Link>
      </div>
    </main>
  );
}
