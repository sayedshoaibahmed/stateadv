/**
 * The dashboard's view model: plain data shapes, and the rules that turn database numbers into what a person reads.
 * Pure (no Next.js, no database) and unit-tested. Money is whole paise everywhere.
 */
import { formatPaise } from "@/lib/money";

export interface Summary {
  totalResorts: number;
  totalBookings: number;
  checkinsToday: number;
  checkoutsToday: number;
  expectedPaise: number;
  totalCollectionPaise: number;
  waitingPaise: number;
  waitingItems: number;
  refundsPaise: number;
  netCollectionPaise: number;
  pendingPaise: number;
}

export interface ResortRow {
  resortId: string;
  code: string;
  name: string;
  isActive: boolean;
  bookings: number;
  expectedPaise: number;
  totalCollectionPaise: number;
  waitingPaise: number;
  refundsPaise: number;
  netCollectionPaise: number;
  pendingPaise: number;
}

export interface ChartPoint {
  /** first day of the day/month, "2026-11-12" */
  start: string;
  totalCollectionPaise: number;
  waitingPaise: number;
  expectedPaise: number;
}

export interface Alerts {
  waitingOldItems: number;
  overdueBookings: number;
  overduePaise: number;
  selfApproved: number;
  failedPdfs: number;
  backupAt: string | null;
  backupOld: boolean;
}

export type AlertTone = "warning" | "danger" | "info";
export interface AlertItem {
  key: string;
  tone: AlertTone;
  text: string;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * The alert lines, most serious first. Nothing is listed for a zero. A backup that was never recorded is not an
 * alert (nothing to compare with); one that is recorded and older than 36 hours is.
 */
export function buildAlerts(a: Alerts, periodText: string): AlertItem[] {
  const out: AlertItem[] = [];
  if (a.overdueBookings > 0)
    out.push({
      key: "overdue",
      tone: "danger",
      text: `${a.overdueBookings} ${plural(a.overdueBookings, "booking is", "bookings are")} behind on the payment plan (${formatPaise(a.overduePaise)} overdue).`,
    });
  if (a.waitingOldItems > 0)
    out.push({
      key: "waiting-old",
      tone: "warning",
      text: `${a.waitingOldItems} ${plural(a.waitingOldItems, "payment or refund has", "payments or refunds have")} been waiting for approval for more than 3 days.`,
    });
  if (a.failedPdfs > 0)
    out.push({
      key: "pdf",
      tone: "warning",
      text: `${a.failedPdfs} booking ${plural(a.failedPdfs, "PDF", "PDFs")} could not be made. It will be tried again; ask for help if it stays.`,
    });
  if (a.backupOld)
    out.push({
      key: "backup",
      tone: "danger",
      text: "The last backup was more than 36 hours ago.",
    });
  if (a.selfApproved > 0)
    out.push({
      key: "self-approved",
      tone: "info",
      text: `${a.selfApproved} ${plural(a.selfApproved, "item was", "items were")} approved by the same person who entered ${plural(a.selfApproved, "it", "them")} (${periodText}).`,
    });
  return out;
}

export interface ActivityRow {
  id: number;
  at: string;
  actor: string | null;
  action: string;
  table: string;
  status: string | null;
  fields: string[] | null;
}

/**
 * One plain sentence for the "recent activity" list, or null for rows that are not shown there (account changes have
 * their own notices; re-authentication rows are for Owners only and never shown here).
 */
export function describeActivity(r: ActivityRow): string | null {
  const by = r.actor ?? "The system";
  const thing = {
    bookings: "booking",
    payments: "payment",
    refunds: "refund",
    resorts: "resort",
  }[r.table];
  if (!thing) return null;
  if (r.action === "insert") return `${by} added a ${thing}.`;
  if (r.action !== "update") return null;
  if ((r.table === "payments" || r.table === "refunds") && r.status) {
    const verb = {
      approved: "approved",
      rejected: "rejected",
      reversed: "reversed",
      waiting: "changed",
    }[r.status];
    if (verb && (r.fields ?? []).includes("status"))
      return `${by} ${verb} a ${thing}.`;
  }
  if (
    r.table === "bookings" &&
    r.status &&
    (r.fields ?? []).includes("status")
  ) {
    const label = {
      cancelled: "cancelled a booking",
      no_show: "marked a booking as no-show",
      checked_in: "checked a guest in",
      checked_out: "checked a guest out",
      confirmed: "confirmed a booking",
    }[r.status];
    if (label) return `${by} ${label}.`;
  }
  return `${by} changed a ${thing}.`;
}
