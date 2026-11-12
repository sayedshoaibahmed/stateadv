import "server-only";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { processBookingPdf, type PipelineClient } from "@/lib/pdf/pipeline";
import { renderBookingPdf } from "@/lib/pdf/render";

/**
 * Called by the server actions AFTER a booking, payment or refund has been saved (PRD FR-PDF-1). The work runs after
 * the response is sent, with the signed-in person's own session, and can never change what the action returned or
 * undo what it saved (FR-PDF-6): any failure is swallowed here and left to the retry job. Only the booking number is
 * handed over; the database decides whether a new version is needed.
 */
export function schedulePdf(bookingId: string): void {
  try {
    after(async () => {
      try {
        const supabase = await createClient();
        await processBookingPdf(
          supabase as unknown as PipelineClient,
          bookingId,
          { render: renderBookingPdf },
        );
      } catch {
        /* the job stays open; the retry job tries again */
      }
    });
  } catch {
    /* outside a request: nothing to schedule */
  }
}

/** Same, for a payment or refund when only its own id is known: its booking is read first (row-level security applies). */
export function schedulePdfForItem(
  kind: "payment" | "refund",
  itemId: string,
): void {
  try {
    after(async () => {
      try {
        const supabase = await createClient();
        const table = kind === "payment" ? "payments" : "refunds";
        const { data } = await supabase
          .from(table)
          .select("booking_id")
          .eq("id", itemId)
          .maybeSingle();
        if (!data) return;
        await processBookingPdf(
          supabase as unknown as PipelineClient,
          data.booking_id,
          { render: renderBookingPdf },
        );
      } catch {
        /* the job stays open; the retry job tries again */
      }
    });
  } catch {
    /* outside a request: nothing to schedule */
  }
}
