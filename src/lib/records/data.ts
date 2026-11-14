import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  searchArgs,
  type RecordFilter,
  type RecordType,
} from "@/lib/records/filters";

/**
 * Old Records: one page of bookings, payments and refunds. The read runs as the signed-in user (row-level security and
 * the function's own check apply; nothing here uses a master key). A failed read returns `{ ok: false }`.
 */
export type Loaded<T> = { ok: true; data: T } | { ok: false };

export interface RecordRow {
  type: RecordType;
  id: string;
  code: string;
  bookingId: string;
  bookingCode: string;
  resortId: string;
  guestName: string;
  guestMobile: string;
  /** a booking status or an approval status */
  status: string;
  /** a booking: its Amount Due; a payment or refund: its own amount (whole paise) */
  amountPaise: number;
  recordDate: string;
  enteredOn: string;
  /** the stored date the range was applied to for this row (see Basis) */
  matchedDate: string;
  backdated: boolean;
  /** a booking: PDF versions; a payment or refund: files that are not hidden */
  fileCount: number;
}

export async function loadRecords(
  f: RecordFilter,
): Promise<Loaded<{ rows: RecordRow[]; total: number }>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc(
      "old_records_search",
      searchArgs(f),
    );
    if (error || !data) return { ok: false };
    return {
      ok: true,
      data: {
        total: data[0]?.total_rows ?? 0,
        rows: data.map((r) => ({
          type: r.record_type as RecordType,
          id: r.record_id,
          code: r.record_code,
          bookingId: r.booking_id,
          bookingCode: r.booking_code,
          resortId: r.resort_id,
          guestName: r.guest_name,
          guestMobile: r.guest_mobile,
          status: r.status,
          amountPaise: r.amount_paise,
          recordDate: r.record_date,
          enteredOn: r.entered_on,
          matchedDate: r.matched_date,
          backdated: r.backdated,
          fileCount: r.file_count,
        })),
      },
    };
  } catch {
    return { ok: false };
  }
}
