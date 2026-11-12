import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { DashboardFilter } from "@/lib/dashboard/filters";
import { chartGrain } from "@/lib/dashboard/filters";
import type {
  ActivityRow,
  Alerts,
  ChartPoint,
  ResortRow,
  Summary,
} from "@/lib/dashboard/model";

/**
 * Loads what the dashboard shows. Every part is loaded on its own and returns `{ ok: false }` when it fails, so one
 * broken part shows a small "Try again" box instead of taking the whole page down. All reads run as the signed-in
 * user: row-level security and the functions' own checks apply (nothing here uses a master key).
 */
export type Part<T> = { ok: true; data: T } | { ok: false };

async function part<T>(run: () => PromiseLike<T>): Promise<Part<T>> {
  try {
    return { ok: true, data: await run() };
  } catch {
    return { ok: false };
  }
}

const args = (f: DashboardFilter) => ({
  p_resort: f.resort ?? undefined,
  p_from: f.from,
  p_to: f.to,
});

export async function loadSummary(f: DashboardFilter): Promise<Part<Summary>> {
  const supabase = await createClient();
  return part(async () => {
    const { data, error } = await supabase.rpc("dashboard_summary", args(f));
    const r = data?.[0];
    if (error || !r) throw new Error("summary");
    return {
      totalResorts: r.total_resorts,
      totalBookings: r.total_bookings,
      checkinsToday: r.checkins_today,
      checkoutsToday: r.checkouts_today,
      expectedPaise: r.expected_paise,
      totalCollectionPaise: r.total_collection_paise,
      waitingPaise: r.waiting_paise,
      waitingItems: r.waiting_items,
      refundsPaise: r.refunds_paise,
      netCollectionPaise: r.net_collection_paise,
      pendingPaise: r.pending_paise,
    };
  });
}

export async function loadResorts(
  f: DashboardFilter,
): Promise<Part<ResortRow[]>> {
  const supabase = await createClient();
  return part(async () => {
    const { data, error } = await supabase.rpc("dashboard_by_resort", args(f));
    if (error || !data) throw new Error("resorts");
    return data.map((r) => ({
      resortId: r.resort_id,
      code: r.resort_code,
      name: r.resort_name,
      isActive: r.is_active,
      bookings: r.bookings,
      expectedPaise: r.expected_paise,
      totalCollectionPaise: r.total_collection_paise,
      waitingPaise: r.waiting_paise,
      refundsPaise: r.refunds_paise,
      netCollectionPaise: r.net_collection_paise,
      pendingPaise: r.pending_paise,
    }));
  });
}

export async function loadChart(
  f: DashboardFilter,
): Promise<Part<{ grain: "day" | "month"; points: ChartPoint[] }>> {
  const supabase = await createClient();
  const grain = chartGrain(f.from, f.to);
  return part(async () => {
    const { data, error } = await supabase.rpc("dashboard_by_date", {
      ...args(f),
      p_grain: grain,
    });
    if (error || !data) throw new Error("chart");
    return {
      grain,
      points: data.map((r) => ({
        start: r.bucket_start,
        totalCollectionPaise: r.total_collection_paise,
        waitingPaise: r.waiting_paise,
        expectedPaise: r.expected_paise,
      })),
    };
  });
}

export async function loadAlerts(f: DashboardFilter): Promise<Part<Alerts>> {
  const supabase = await createClient();
  return part(async () => {
    const { data, error } = await supabase.rpc("dashboard_alerts", args(f));
    const r = data?.[0];
    if (error || !r) throw new Error("alerts");
    return {
      waitingOldItems: r.waiting_old_items,
      overdueBookings: r.overdue_bookings,
      overduePaise: r.overdue_paise,
      selfApproved: r.self_approved,
      failedPdfs: r.failed_pdfs,
      backupAt: r.backup_at ?? null,
      backupOld: r.backup_old,
    };
  });
}

export interface RecentBooking {
  id: string;
  code: string;
  guest: string;
  resortId: string;
  status: string;
  checkIn: string;
  finalPaise: number | null;
}
export interface RecentMoney {
  id: string;
  code: string;
  kind: "payment" | "refund";
  resortId: string;
  status: "approved" | "waiting" | "rejected" | "reversed";
  amountPaise: number;
  date: string;
  selfApproved: boolean;
}

export async function loadRecentBookings(
  f: DashboardFilter,
): Promise<Part<RecentBooking[]>> {
  const supabase = await createClient();
  return part(async () => {
    let q = supabase
      .from("bookings")
      .select(
        "id, booking_code, guest_name, resort_id, status, check_in_at, final_amount_paise",
      )
      .order("created_at", { ascending: false })
      .limit(5);
    if (f.resort) q = q.eq("resort_id", f.resort);
    const { data, error } = await q;
    if (error || !data) throw new Error("bookings");
    return data.map((b) => ({
      id: b.id,
      code: b.booking_code,
      guest: b.guest_name,
      resortId: b.resort_id,
      status: b.status,
      checkIn: b.check_in_at,
      finalPaise: b.final_amount_paise,
    }));
  });
}

export async function loadRecentMoney(
  f: DashboardFilter,
): Promise<Part<RecentMoney[]>> {
  const supabase = await createClient();
  return part(async () => {
    let p = supabase
      .from("payments")
      .select(
        "id, payment_code, resort_id, status, amount_paise, payment_date, is_self_approved, recorded_at",
      )
      .order("recorded_at", { ascending: false })
      .limit(5);
    let r = supabase
      .from("refunds")
      .select(
        "id, refund_code, resort_id, status, amount_paise, refund_date, is_self_approved, recorded_at",
      )
      .order("recorded_at", { ascending: false })
      .limit(5);
    if (f.resort) {
      p = p.eq("resort_id", f.resort);
      r = r.eq("resort_id", f.resort);
    }
    const [pay, ref] = await Promise.all([p, r]);
    if (pay.error || ref.error) throw new Error("money");
    const rows: (RecentMoney & { at: string })[] = [
      ...(pay.data ?? []).map((x) => ({
        id: x.id,
        code: x.payment_code,
        kind: "payment" as const,
        resortId: x.resort_id,
        status: x.status,
        amountPaise: x.amount_paise,
        date: x.payment_date,
        selfApproved: !!x.is_self_approved,
        at: x.recorded_at,
      })),
      ...(ref.data ?? []).map((x) => ({
        id: x.id,
        code: x.refund_code,
        kind: "refund" as const,
        resortId: x.resort_id,
        status: x.status,
        amountPaise: x.amount_paise,
        date: x.refund_date,
        selfApproved: !!x.is_self_approved,
        at: x.recorded_at,
      })),
    ];
    return rows.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 5);
  });
}

export async function loadActivity(
  f: DashboardFilter,
): Promise<Part<(ActivityRow & { at: string })[]>> {
  const supabase = await createClient();
  return part(async () => {
    let q = supabase
      .from("audit_logs")
      .select(
        "id, occurred_at, actor_name, action, table_name, changed_fields, new_data",
      )
      .in("table_name", ["bookings", "payments", "refunds", "resorts"])
      .order("id", { ascending: false })
      .limit(25);
    if (f.resort) q = q.eq("resort_id", f.resort);
    const { data, error } = await q;
    if (error || !data) throw new Error("activity");
    return data.map((a) => {
      const nd = (a.new_data ?? {}) as Record<string, unknown>;
      return {
        id: a.id,
        at: a.occurred_at,
        actor: a.actor_name,
        action: a.action,
        table: a.table_name,
        status: typeof nd.status === "string" ? nd.status : null,
        fields: a.changed_fields,
      };
    });
  });
}

/** Payments and refunds waiting for approval, all dates (the menu badge). null if it could not be counted. */
export async function loadWaitingCount(): Promise<number | null> {
  try {
    const supabase = await createClient();
    const [p, r] = await Promise.all([
      supabase
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("status", "waiting"),
      supabase
        .from("refunds")
        .select("id", { count: "exact", head: true })
        .eq("status", "waiting"),
    ]);
    if (p.error || r.error) return null;
    return (p.count ?? 0) + (r.count ?? 0);
  } catch {
    return null;
  }
}

export async function loadResortChoices(): Promise<
  { id: string; name: string }[]
> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("resorts")
      .select("id, name, is_active")
      .order("name");
    return (data ?? []).map((r) => ({
      id: r.id,
      name: r.is_active ? r.name : `${r.name} (closed)`,
    }));
  } catch {
    return [];
  }
}
