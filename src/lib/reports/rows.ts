/**
 * Turns what the report functions return (migration 25) into rows for the table, the PDF and the CSV file, and takes the
 * totals the database sent with every row. Pure and unit-tested: nothing here adds, subtracts or recalculates a figure;
 * it picks the database's own columns and gives them the names the table uses.
 */
import { periodText } from "@/lib/dashboard/filters";
import type { Database } from "@/lib/supabase/database.types";
import {
  METHOD_LABELS,
  SOURCE_LABELS,
  type ReportFilter,
  type ReportKey,
} from "@/lib/reports/definitions";
import type { ReportRow } from "@/lib/reports/format";

type Fn = Database["public"]["Functions"];
type Ret<K extends keyof Fn> = Fn[K] extends { Returns: (infer R)[] }
  ? R
  : never;

export interface ReportPage {
  rows: ReportRow[];
  /** how many rows the report has in all (for a list report: not just this page) */
  total: number;
  /** the totals row, by summary key */
  summary: Record<string, number>;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "10 Mar 2026"; a whole week or part of one "2 Mar 2026 – 8 Mar 2026"; a whole month "March 2026"; a whole year "2026". */
export function periodLabel(
  group: ReportFilter["group"],
  start: string,
  end: string,
): string {
  if (group === "day" || start === end) return periodText(start, end);
  if (group === "month") {
    const [y, mo, d] = start.split("-").map(Number);
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    if (
      d === 1 &&
      end === `${start.slice(0, 8)}${String(last).padStart(2, "0")}`
    )
      return `${MONTHS[mo - 1]} ${y}`;
  }
  if (
    group === "year" &&
    start.endsWith("-01-01") &&
    end === `${start.slice(0, 4)}-12-31`
  )
    return start.slice(0, 4);
  return periodText(start, end);
}

const methodWord = (m: string | null | undefined): string =>
  m ? (METHOD_LABELS[m] ?? m) : "";
/** "UPI · PhonePe", "Cash" */
const paidBy = (
  m: string | null | undefined,
  provider: string | null | undefined,
): string => (provider ? `${methodWord(m)} · ${provider}` : methodWord(m));

export type Names = ReadonlyMap<string, string>;
const resortOf = (names: Names, id: string | null | undefined): string =>
  id ? (names.get(id) ?? "—") : "—";
const zero = (keys: string[]): Record<string, number> =>
  Object.fromEntries(keys.map((k) => [k, 0]));

export function mapCollection(
  data: Ret<"report_collection">[],
  f: ReportFilter,
): ReportPage {
  const first = data[0];
  return {
    rows: data.map((r) => ({
      period: periodLabel(f.group, r.period_start, r.period_end),
      resort: r.resort_name ?? "—",
      method: methodWord(r.method),
      approved: r.approved_paise,
      approvedCount: r.approved_count,
      waiting: r.waiting_paise,
      refunds: r.refunds_paise,
      net: r.net_paise,
    })),
    total: first?.total_rows ?? 0,
    summary: first
      ? {
          totalApproved: first.total_approved_paise,
          totalWaiting: first.total_waiting_paise,
          totalRefunds: first.total_refunds_paise,
          totalNet: first.total_net_paise,
        }
      : zero(["totalApproved", "totalWaiting", "totalRefunds", "totalNet"]),
  };
}

export function mapResortWise(
  data: Ret<"report_expected_vs_actual">[],
): ReportPage {
  const first = data[0];
  return {
    rows: data.map((r) => ({
      resort: r.is_active ? r.resort_name : `${r.resort_name} (closed)`,
      originallyExpected: r.originally_expected_paise,
      adjustments: r.expected_adjustments_paise,
      expected: r.expected_paise,
      approved: r.approved_paise,
      waiting: r.waiting_paise,
      refunds: r.refunds_paise,
      net: r.net_paise,
      difference: r.difference_paise,
    })),
    total: first?.total_rows ?? 0,
    summary: first
      ? {
          totalOriginallyExpected: first.total_originally_expected_paise,
          totalAdjustments: first.total_expected_adjustments_paise,
          totalExpected: first.total_expected_paise,
          totalApproved: first.total_approved_paise,
          totalWaiting: first.total_waiting_paise,
          totalRefunds: first.total_refunds_paise,
          totalNet: first.total_net_paise,
          totalDifference: first.total_difference_paise,
        }
      : zero([
          "totalOriginallyExpected",
          "totalAdjustments",
          "totalExpected",
          "totalApproved",
          "totalWaiting",
          "totalRefunds",
          "totalNet",
          "totalDifference",
        ]),
  };
}

export function mapMethods(data: Ret<"report_payment_methods">[]): ReportPage {
  const first = data[0];
  return {
    rows: data.map((r) => ({
      method: methodWord(r.method),
      provider: r.provider_name ?? "—",
      approved: r.approved_paise,
      approvedCount: r.approved_count,
      waiting: r.waiting_paise,
      waitingCount: r.waiting_count,
      refunds: r.refunds_paise,
      net: r.net_paise,
    })),
    total: first?.total_rows ?? 0,
    summary: first
      ? {
          totalApproved: first.total_approved_paise,
          totalWaiting: first.total_waiting_paise,
          totalRefunds: first.total_refunds_paise,
          totalNet: first.total_net_paise,
        }
      : zero(["totalApproved", "totalWaiting", "totalRefunds", "totalNet"]),
  };
}

const PRICING: Record<string, string> = {
  per_person_per_night: "Per person per night",
  per_person_per_stay: "Per person per stay",
};

export function mapBookings(
  data: Ret<"report_bookings">[],
  names: Names,
): ReportPage {
  const first = data[0];
  return {
    rows: data.map((r) => ({
      _booking: r.booking_id,
      code: r.booking_code,
      resort: resortOf(names, r.resort_id),
      guest: r.guest_name,
      bookingDate: r.booking_date,
      checkIn: r.check_in_at,
      pax: r.pax,
      pricing: PRICING[r.pricing_method] ?? r.pricing_method,
      co: [r.co_category_name, r.co_name].filter(Boolean).join(" · ") || "—",
      status: r.status,
      final: r.final_paise,
      due: r.due_paise,
    })),
    total: first?.total_rows ?? 0,
    summary: first
      ? {
          count: first.total_rows,
          pax: first.total_pax,
          final: first.total_final_paise,
          due: first.total_due_paise,
        }
      : zero(["count", "pax", "final", "due"]),
  };
}

export function mapPending(
  data: Ret<"report_pending">[],
  names: Names,
): ReportPage {
  const first = data[0];
  return {
    rows: data.map((r) => ({
      _booking: r.booking_id,
      code: r.booking_code,
      resort: resortOf(names, r.resort_id),
      guest: r.guest_name,
      checkIn: r.check_in_at,
      status: r.status,
      due: r.due_paise,
      approved: r.approved_paise,
      waiting: r.waiting_paise,
      pending: r.pending_paise,
      verified: r.verified_remaining_paise,
      overdue: r.overdue_paise,
    })),
    total: first?.total_rows ?? 0,
    summary: first
      ? {
          count: first.total_rows,
          pending: first.total_pending_paise,
          verified: first.total_verified_remaining_paise,
          overdue: first.total_overdue_paise,
        }
      : zero(["count", "pending", "verified", "overdue"]),
  };
}

export function mapWaiting(
  data: Ret<"report_waiting">[],
  names: Names,
): ReportPage {
  const first = data[0];
  return {
    rows: data.map((r) => ({
      _booking: r.booking_id,
      _href: `/${r.kind === "refund" ? "refunds" : "payments"}/${r.record_id}`,
      kind: r.kind === "refund" ? "Refund" : "Payment",
      code: r.record_code,
      booking: r.booking_code,
      resort: resortOf(names, r.resort_id),
      guest: r.guest_name,
      amount: r.amount_paise,
      method: paidBy(r.method, r.provider_name),
      recordDate: r.record_date,
      enteredOn: r.entered_on,
      by: r.recorded_by_name ?? "—",
      age: r.age_days,
    })),
    total: first?.total_rows ?? 0,
    summary: first
      ? {
          payments: first.total_payments_paise ?? 0,
          paymentsCount: first.total_payments_count,
          refunds: first.total_refunds_paise ?? 0,
          refundsCount: first.total_refunds_count,
        }
      : zero(["payments", "paymentsCount", "refunds", "refundsCount"]),
  };
}

export function mapRefunds(
  data: Ret<"report_refunds">[],
  names: Names,
): ReportPage {
  const first = data[0];
  return {
    rows: data.map((r) => ({
      _booking: r.booking_id,
      _href: `/refunds/${r.refund_id}`,
      code: r.refund_code,
      booking: r.booking_code,
      resort: resortOf(names, r.resort_id),
      guest: r.guest_name,
      amount: r.amount_paise,
      method: paidBy(r.method, r.provider_name),
      status: r.status,
      reason: r.reason,
      refundDate: r.refund_date,
      enteredOn: r.entered_on,
    })),
    total: first?.total_rows ?? 0,
    summary: first
      ? {
          approved: first.total_approved_paise,
          waiting: first.total_waiting_paise,
          rejected: first.total_rejected_paise,
          reversed: first.total_reversed_paise,
        }
      : zero(["approved", "waiting", "rejected", "reversed"]),
  };
}

export function mapCancellations(
  data: Ret<"report_cancellations">[],
  names: Names,
): ReportPage {
  const first = data[0];
  return {
    rows: data.map((r) => ({
      _booking: r.booking_id,
      code: r.booking_code,
      resort: resortOf(names, r.resort_id),
      guest: r.guest_name,
      status: r.status,
      cancelledOn: r.cancellation_date,
      checkIn: r.check_in_at,
      original: r.original_paise,
      charge: r.charge_paise,
      approved: r.approved_paise,
      refundDue: r.refund_due_paise,
      reason: r.reason ?? "—",
    })),
    total: first?.total_rows ?? 0,
    summary: first
      ? {
          count: first.total_rows,
          original: first.total_original_paise,
          charge: first.total_charge_paise,
          refundDue: first.total_refund_due_paise,
        }
      : zero(["count", "original", "charge", "refundDue"]),
  };
}

export function mapExpectedAdjustments(
  data: Ret<"report_expected_adjustments">[],
  names: Names,
): ReportPage {
  const first = data[0];
  return {
    rows: data.map((r) => ({
      _booking: r.booking_id,
      date: r.adjustment_date,
      booking: r.booking_code,
      resort: resortOf(names, r.resort_id),
      guest: r.guest_name,
      amount: r.amount_paise,
      source: SOURCE_LABELS[r.source] ?? r.source,
      reason: r.reason,
      by: r.created_by_name ?? "—",
    })),
    total: first?.total_rows ?? 0,
    summary: first
      ? { count: first.total_rows, total: first.total_paise }
      : zero(["count", "total"]),
  };
}

export function mapManualAdjustments(
  data: Ret<"report_manual_adjustments">[],
  names: Names,
): ReportPage {
  const first = data[0];
  return {
    rows: data.map((r) => ({
      _booking: r.booking_id,
      code: r.booking_code,
      resort: resortOf(names, r.resort_id),
      guest: r.guest_name,
      bookingDate: r.booking_date,
      status: r.status,
      total: r.total_paise,
      discount: r.discount_paise,
      adjustment: r.adjustment_paise,
      adjustmentReason: r.adjustment_reason ?? "—",
      final: r.final_paise,
      charge: r.charge_paise,
      chargeReason: r.charge_change_reason ?? "—",
    })),
    total: first?.total_rows ?? 0,
    summary: first
      ? { count: first.total_rows, total: first.total_adjustment_paise }
      : zero(["count", "total"]),
  };
}

export type { ReportKey };
