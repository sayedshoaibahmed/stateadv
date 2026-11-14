import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Shown when the date in the address is not a real date between 1990 and 2100 (the page calls notFound()). */
export default function CalendarDayNotFound() {
  return (
    <main className="flex flex-1 flex-col gap-4 p-3 sm:p-4">
      <h1 className="text-2xl font-semibold">That date was not found</h1>
      <p className="max-w-prose text-muted-foreground">
        The address does not hold a real date between 1990 and 2100. Go back to
        the calendar and choose a day.
      </p>
      <div>
        <Link href="/calendar" className={cn(buttonVariants(), "min-h-11")}>
          Open the calendar
        </Link>
      </div>
    </main>
  );
}
