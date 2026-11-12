import { DateText } from "@/components/app/date-text";
import { EmptyState } from "@/components/app/states";
import {
  DownloadPdfButton,
  RegeneratePdfButton,
} from "@/components/app/pdf/pdf-actions";
import type { BookingDetail } from "@/lib/bookings/data";

export const kb = (bytes: number | null) =>
  bytes === null
    ? "—"
    : bytes < 1024
      ? `${bytes} B`
      : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** What the PDF queue says, in plain words. */
export function pdfStatusText(
  jobs: BookingDetail["pdfJobs"],
): { tone: "info" | "problem"; text: string } | null {
  if (jobs.some((j) => j.status === "failed"))
    return {
      tone: "problem",
      text: "The last attempt to make the PDF did not work. The booking is saved. It will be tried again automatically, or you can press Regenerate PDF.",
    };
  if (jobs.length > 0)
    return {
      tone: "info",
      text: "A new PDF is being prepared. It will appear here in a moment.",
    };
  return null;
}

/**
 * The PDFs tab (UI spec 3.5): every version that was ever made, newest first, the current one marked, each one
 * downloadable at any time (PRD FR-PDF-4).
 */
export function PdfTab({ d }: { d: BookingDetail }) {
  const status = pdfStatusText(d.pdfJobs);
  return (
    <div className="grid gap-4">
      {status ? (
        <p
          role="status"
          className={
            status.tone === "problem"
              ? "rounded-lg border border-rejected/40 bg-rejected-soft px-3 py-2 text-sm"
              : "rounded-lg border border-waiting/40 bg-waiting-soft px-3 py-2 text-sm"
          }
        >
          {status.text}
        </p>
      ) : null}
      <RegeneratePdfButton bookingId={d.booking.id} />
      {d.pdfs.length === 0 ? (
        <EmptyState title="No PDF yet">
          The PDF is made automatically after a booking is saved. If it does not
          appear, press Regenerate PDF.
        </EmptyState>
      ) : (
        <ul className="grid gap-2" aria-label="PDF versions">
          {d.pdfs.map((v, i) => (
            <li
              key={v.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3"
            >
              <div className="grid gap-0.5">
                <p className="font-medium">
                  Version {v.version_no}
                  {i === 0 ? (
                    <span className="ml-2 rounded-md bg-approved-soft px-1.5 py-0.5 text-xs font-medium text-approved">
                      Current
                    </span>
                  ) : null}
                </p>
                <p className="text-sm text-muted-foreground">
                  <DateText value={v.generated_at} withTime /> ·{" "}
                  {v.trigger_reason} · {kb(v.size_bytes)}
                </p>
              </div>
              <DownloadPdfButton
                versionId={v.id}
                label={`Download version ${v.version_no}`}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
