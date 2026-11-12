"use client";

import { ErrorState } from "@/components/app/states";

export default function DashboardError({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="flex flex-1 flex-col gap-4 p-3 sm:p-4">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <ErrorState onRetry={reset} />
    </main>
  );
}
