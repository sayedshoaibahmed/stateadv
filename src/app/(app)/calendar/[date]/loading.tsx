import { ListSkeleton } from "@/components/app/states";

/** The day page is a dynamic route: its own loading screen is shown at once while the day is read (Next.js docs: linking and navigating). */
export default function Loading() {
  return (
    <main className="flex flex-1 flex-col gap-4 p-3 sm:p-4" aria-busy="true">
      <h1 className="text-2xl font-semibold">Calendar day</h1>
      <ListSkeleton />
    </main>
  );
}
