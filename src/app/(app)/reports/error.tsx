"use client";

import { ErrorState } from "@/components/app/states";

/** Shown when this page breaks unexpectedly: `retry` fetches the page again (Next.js docs: file-conventions/error); the error itself is never shown. */
export default function ReportsError({
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <main className="flex flex-1 flex-col gap-4 p-3 sm:p-4">
      <h1 className="text-2xl font-semibold">Collection Reports</h1>
      <ErrorState onRetry={retry} />
    </main>
  );
}
