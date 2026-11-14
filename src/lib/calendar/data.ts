import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import type { CalendarDay, Kind, MonthRef } from "@/lib/calendar/model";

/**
 * What the calendar screens read. Every read runs as the signed-in user (their own login), so row-level security and the
 * functions' own checks apply; nothing here uses a master key. A failed read returns `{ ok: false }` so the page can
 * show a small "Try again" instead of an error screen. No figure is calculated here: the database gives them.
 */
export type Loaded<T> = { ok: true; data: T } | { ok: false };

export async function loadMonth(
  ref: MonthRef,
  resort: string | null,
): Promise<Loaded<CalendarDay[]>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("calendar_month", {
      p_year: ref.year,
      p_month: ref.month,
      p_resort: resort ?? undefined,
    });
    if (error || !data) return { ok: false };
    return {
      ok: true,
      data: data.map((r) => ({
        date: r.day_date,
        checkIns: r.check_ins,
        checkOuts: r.check_outs,
        staying: r.staying,
        duePaise: r.due_paise,
        collectedPaise: r.collected_paise,
        waitingPaise: r.waiting_paise,
        refundsPaise: r.refunds_paise,
      })),
    };
  } catch {
    return { ok: false };
  }
}

type DayRow =
  Database["public"]["Functions"]["calendar_day"]["Returns"][number];

/** One line of a day list. `kind` says which tab it belongs to; money is whole paise. */
export interface DayItem {
  kind: Kind;
  bookingId: string;
  bookingCode: string;
  resortId: string;
  guestName: string;
  guestMobile: string;
  bookingStatus: DayRow["booking_status"];
  checkInAt: string;
  checkOutAt: string;
  pax: number;
  recordId: string | null;
  recordCode: string | null;
  amountPaise: number | null;
  recordStatus: DayRow["record_status"] | null;
  /** payments and refunds: the way it was paid; payments due: "plan" or "adjustment" */
  method: string | null;
  /** payments and refunds: the app or bank; payments due: the plan row's name or the adjustment's reason */
  label: string | null;
  recordDate: string | null;
  enteredOn: string | null;
  backdated: boolean;
  pendingPaise: number;
}

export interface DayData {
  items: DayItem[];
  /** how many rows each kind has in all (a list on screen holds at most 300) */
  totals: Record<Kind, number>;
}

export async function loadDay(
  date: string,
  resort: string | null,
): Promise<Loaded<DayData>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("calendar_day", {
      p_date: date,
      p_resort: resort ?? undefined,
    });
    if (error || !data) return { ok: false };
    const totals: Record<Kind, number> = {
      check_in: 0,
      check_out: 0,
      staying: 0,
      payment: 0,
      refund: 0,
      due: 0,
    };
    const items: DayItem[] = [];
    for (const r of data) {
      const kind = r.kind as Kind;
      if (!(kind in totals)) continue;
      totals[kind] = r.kind_total;
      items.push({
        kind,
        bookingId: r.booking_id,
        bookingCode: r.booking_code,
        resortId: r.resort_id,
        guestName: r.guest_name,
        guestMobile: r.guest_mobile,
        bookingStatus: r.booking_status,
        checkInAt: r.check_in_at,
        checkOutAt: r.check_out_at,
        pax: r.pax,
        recordId: r.record_id ?? null,
        recordCode: r.record_code ?? null,
        amountPaise: r.amount_paise ?? null,
        recordStatus: r.record_status ?? null,
        method: r.method ?? null,
        label: r.label ?? null,
        recordDate: r.record_date ?? null,
        enteredOn: r.entered_on ?? null,
        backdated: !!r.backdated,
        pendingPaise: r.pending_paise,
      });
    }
    return { ok: true, data: { items, totals } };
  } catch {
    return { ok: false };
  }
}
