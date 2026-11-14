"use client";

import { ErrorState } from "@/components/app/states";

/**
 * Shown when this page breaks unexpectedly. Next.js (docs: file-conventions/error) hands the boundary `retry`, which
 * fetches the page again and shows it, and `reset`, which only redraws what it already has; `retry` is the one that
 * can fix a failed read. The error itself is never shown (it may hold details nobody should see).
 */
export default function OldRecordsError({
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <main className="flex flex-1 flex-col gap-4 p-3 sm:p-4">
      <h1 className="text-2xl font-semibold">Old Records</h1>
      <ErrorState onRetry={retry} />
    </main>
  );
}
