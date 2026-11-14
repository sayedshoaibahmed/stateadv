import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import type { ReportDef, ReportFilter } from "@/lib/reports/definitions";
import {
  mapBookings,
  mapCancellations,
  mapCollection,
  mapExpectedAdjustments,
  mapManualAdjustments,
  mapMethods,
  mapPending,
  mapRefunds,
  mapResortWise,
  mapWaiting,
  type Names,
  type ReportPage,
} from "@/lib/reports/rows";

/**
 * Reads one page of a report through its database function (migration 25), as the signed-in user: row-level security and
 * the functions' own checks apply, and nothing here uses a master key. Returns null when the read failed, so the page can
 * show a small "Try again" and the file download can say so in plain words, without any technical detail.
 * A one-table report (collection, resort-wise, methods) has no pages: `limit` and `offset` are ignored for it.
 */
type E = Database["public"]["Enums"];

export async function fetchReportPage(
  def: ReportDef,
  f: ReportFilter,
  names: Names,
  limit: number,
  offset: number,
): Promise<ReportPage | null> {
  try {
    const supabase = await createClient();
    const resort = f.resort ?? undefined;
    const from = f.from ?? undefined;
    const to = f.to ?? undefined;
    const paging = { p_limit: limit, p_offset: offset };
    switch (def.key) {
      case "collection": {
        if (!f.from || !f.to) return null;
        const r = await supabase.rpc("report_collection", {
          p_from: f.from,
          p_to: f.to,
          p_resort: resort,
          p_group: f.group,
          p_split: f.split,
        });
        return r.error || !r.data ? null : mapCollection(r.data, f);
      }
      case "resort-wise": {
        if (!f.from || !f.to) return null;
        const r = await supabase.rpc("report_expected_vs_actual", {
          p_from: f.from,
          p_to: f.to,
          p_resort: resort,
        });
        return r.error || !r.data ? null : mapResortWise(r.data);
      }
      case "payment-methods": {
        if (!f.from || !f.to) return null;
        const r = await supabase.rpc("report_payment_methods", {
          p_from: f.from,
          p_to: f.to,
          p_resort: resort,
        });
        return r.error || !r.data ? null : mapMethods(r.data);
      }
      case "bookings": {
        const r = await supabase.rpc("report_bookings", {
          p_date_field: f.dateField,
          p_from: from,
          p_to: to,
          p_resort: resort,
          p_status: (f.status ?? undefined) as E["booking_status"] | undefined,
          ...paging,
        });
        return r.error || !r.data ? null : mapBookings(r.data, names);
      }
      case "pending": {
        const r = await supabase.rpc("report_pending", {
          p_as_of: f.asOf ?? undefined,
          p_resort: resort,
          ...paging,
        });
        return r.error || !r.data ? null : mapPending(r.data, names);
      }
      case "waiting": {
        const r = await supabase.rpc("report_waiting", {
          p_date_type: f.dateType,
          p_from: from,
          p_to: to,
          p_resort: resort,
          p_kind: f.kind ?? undefined,
          ...paging,
        });
        return r.error || !r.data ? null : mapWaiting(r.data, names);
      }
      case "refunds": {
        const r = await supabase.rpc("report_refunds", {
          p_from: from,
          p_to: to,
          p_resort: resort,
          p_status: (f.status ?? undefined) as E["approval_status"] | undefined,
          p_method: (f.method ?? undefined) as E["payment_method"] | undefined,
          ...paging,
        });
        return r.error || !r.data ? null : mapRefunds(r.data, names);
      }
      case "cancellations": {
        const r = await supabase.rpc("report_cancellations", {
          p_from: from,
          p_to: to,
          p_resort: resort,
          p_status: (f.status ?? undefined) as E["booking_status"] | undefined,
          ...paging,
        });
        return r.error || !r.data ? null : mapCancellations(r.data, names);
      }
      case "expected-adjustments": {
        const r = await supabase.rpc("report_expected_adjustments", {
          p_from: from,
          p_to: to,
          p_resort: resort,
          p_source: (f.source ?? undefined) as
            E["adjustment_source"] | undefined,
          ...paging,
        });
        return r.error || !r.data
          ? null
          : mapExpectedAdjustments(r.data, names);
      }
      case "manual-adjustments": {
        const r = await supabase.rpc("report_manual_adjustments", {
          p_from: from,
          p_to: to,
          p_resort: resort,
          ...paging,
        });
        return r.error || !r.data ? null : mapManualAdjustments(r.data, names);
      }
    }
  } catch {
    return null;
  }
}
