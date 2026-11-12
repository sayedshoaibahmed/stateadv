import { CardGridSkeleton } from "@/components/app/states";

export default function Loading() {
  return (
    <main className="flex flex-1 flex-col gap-4 p-3 sm:p-4" aria-busy="true">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <CardGridSkeleton count={8} />
    </main>
  );
}
