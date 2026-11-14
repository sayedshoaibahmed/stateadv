/**
 * Fictional report data in the exact shape the database functions of migration 25 return (money in paise), for the unit
 * tests of the report screens, files and mapping. Every figure is simple on purpose so a test can add it up by hand.
 */
import type { Database } from "@/lib/supabase/database.types";
import type { ReportPage } from "@/lib/reports/rows";
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
} from "@/lib/reports/rows";
import {
  REPORTS,
  parseReportFilter,
  type ReportKey,
} from "@/lib/reports/definitions";

type Fn = Database["public"]["Functions"];
type Ret<K extends keyof Fn> = Fn[K] extends { Returns: (infer R)[] }
  ? R
  : never;

export const R = (rupees: number) => rupees * 100;
export const RESORT_A = "11111111-2222-4333-8444-555555555555";
export const RESORT_B = "66666666-2222-4333-8444-555555555555";
export const NAMES = new Map([
  [RESORT_A, "Test Resort Alpha"],
  [RESORT_B, "Test Resort Beta"],
]);
export const BOOKING_1 = "aaaaaaaa-2222-4333-8444-555555555555";

export const collectionRows = (): Ret<"report_collection">[] => [
  {
    period_start: "2026-03-02",
    period_end: "2026-03-02",
    resort_id: null as never,
    resort_name: null as never,
    method: null as never,
    approved_paise: R(2000),
    approved_count: 1,
    waiting_paise: 0,
    waiting_count: 0,
    refunds_paise: 0,
    refunds_count: 0,
    net_paise: R(2000),
    total_approved_paise: R(3500),
    total_waiting_paise: R(1000),
    total_refunds_paise: R(500),
    total_net_paise: R(3000),
    total_rows: 2,
  },
  {
    period_start: "2026-03-11",
    period_end: "2026-03-11",
    resort_id: null as never,
    resort_name: null as never,
    method: null as never,
    approved_paise: R(1500),
    approved_count: 1,
    waiting_paise: R(1000),
    waiting_count: 1,
    refunds_paise: R(500),
    refunds_count: 1,
    net_paise: R(1000),
    total_approved_paise: R(3500),
    total_waiting_paise: R(1000),
    total_refunds_paise: R(500),
    total_net_paise: R(3000),
    total_rows: 2,
  },
];

export const resortWiseRows = (): Ret<"report_expected_vs_actual">[] => [
  {
    resort_id: RESORT_A,
    resort_name: "Test Resort Alpha",
    is_active: true,
    originally_expected_paise: R(15000),
    expected_adjustments_paise: -R(1000),
    expected_paise: R(14000),
    approved_paise: R(10000),
    waiting_paise: R(1000),
    refunds_paise: R(500),
    net_paise: R(9500),
    difference_paise: R(4000),
    total_originally_expected_paise: R(24000),
    total_expected_adjustments_paise: -R(2500),
    total_expected_paise: R(21500),
    total_approved_paise: R(15000),
    total_waiting_paise: R(4000),
    total_refunds_paise: R(500),
    total_net_paise: R(14500),
    total_difference_paise: R(6500),
    total_rows: 2,
  },
  {
    resort_id: RESORT_B,
    resort_name: "Old Beta",
    is_active: false,
    originally_expected_paise: R(9000),
    expected_adjustments_paise: -R(1500),
    expected_paise: R(7500),
    approved_paise: R(5000),
    waiting_paise: R(3000),
    refunds_paise: 0,
    net_paise: R(5000),
    difference_paise: R(2500),
    total_originally_expected_paise: R(24000),
    total_expected_adjustments_paise: -R(2500),
    total_expected_paise: R(21500),
    total_approved_paise: R(15000),
    total_waiting_paise: R(4000),
    total_refunds_paise: R(500),
    total_net_paise: R(14500),
    total_difference_paise: R(6500),
    total_rows: 2,
  },
];

export const methodRows = (): Ret<"report_payment_methods">[] => [
  {
    method: "cash",
    provider_name: null as never,
    approved_paise: R(7500),
    approved_count: 3,
    waiting_paise: 0,
    waiting_count: 0,
    refunds_paise: R(500),
    refunds_count: 1,
    net_paise: R(7000),
    total_approved_paise: R(15000),
    total_waiting_paise: R(4000),
    total_refunds_paise: R(500),
    total_net_paise: R(14500),
    total_rows: 2,
  },
  {
    method: "upi",
    provider_name: "PhonePe",
    approved_paise: R(7500),
    approved_count: 3,
    waiting_paise: R(4000),
    waiting_count: 2,
    refunds_paise: 0,
    refunds_count: 0,
    net_paise: R(7500),
    total_approved_paise: R(15000),
    total_waiting_paise: R(4000),
    total_refunds_paise: R(500),
    total_net_paise: R(14500),
    total_rows: 2,
  },
];

export const bookingRows = (): Ret<"report_bookings">[] => [
  {
    booking_id: BOOKING_1,
    booking_code: "AAA-2026-000001",
    resort_id: RESORT_A,
    guest_name: "Asha Rao",
    booking_date: "2026-03-02",
    check_in_at: "2026-03-10T08:30:00Z",
    check_out_at: "2026-03-12T05:30:00Z",
    pax: 2,
    pricing_method: "per_person_per_stay",
    co_category_name: "Agent",
    co_name: "Test Agent",
    status: "confirmed",
    final_paise: R(5000),
    due_paise: R(5000),
    total_pax: 6,
    total_final_paise: R(12000),
    total_due_paise: R(9000),
    total_rows: 2,
  },
  {
    booking_id: "bbbbbbbb-2222-4333-8444-555555555555",
    booking_code: "AAA-2026-000002",
    resort_id: RESORT_B,
    guest_name: "=Evil Guest",
    booking_date: "2026-03-03",
    check_in_at: "2026-03-31T18:00:00Z",
    check_out_at: "2026-04-01T19:00:00Z",
    pax: 4,
    pricing_method: "per_person_per_night",
    co_category_name: "Direct",
    co_name: null as never,
    status: "cancelled",
    final_paise: R(7000),
    due_paise: R(4000),
    total_pax: 6,
    total_final_paise: R(12000),
    total_due_paise: R(9000),
    total_rows: 2,
  },
];

export const pendingRows = (): Ret<"report_pending">[] => [
  {
    booking_id: BOOKING_1,
    booking_code: "AAA-2026-000001",
    resort_id: RESORT_A,
    guest_name: "Asha Rao",
    guest_mobile: "9811100001",
    check_in_at: "2026-03-10T08:30:00Z",
    status: "confirmed",
    due_paise: R(5000),
    approved_paise: R(3500),
    waiting_paise: R(1000),
    pending_paise: R(1000),
    verified_remaining_paise: R(2000),
    overdue_paise: R(2000),
    as_of: "2026-03-31",
    total_pending_paise: R(1000),
    total_verified_remaining_paise: R(2000),
    total_overdue_paise: R(2000),
    total_rows: 1,
  },
];

export const waitingRows = (): Ret<"report_waiting">[] => [
  {
    kind: "payment",
    record_id: "cccccccc-2222-4333-8444-555555555555",
    record_code: "AAA-2026-000001-P3",
    booking_id: BOOKING_1,
    booking_code: "AAA-2026-000001",
    resort_id: RESORT_A,
    guest_name: "Asha Rao",
    amount_paise: R(1000),
    method: "upi",
    provider_name: "PhonePe",
    record_date: "2026-03-10",
    entered_on: "2026-03-10",
    recorded_by_name: "Test Manager One",
    age_days: 4,
    total_payments_paise: R(1000),
    total_refunds_paise: R(300),
    total_payments_count: 1,
    total_refunds_count: 1,
    total_rows: 2,
  },
  {
    kind: "refund",
    record_id: "dddddddd-2222-4333-8444-555555555555",
    record_code: "AAA-2026-000001-R2",
    booking_id: BOOKING_1,
    booking_code: "AAA-2026-000001",
    resort_id: RESORT_A,
    guest_name: "Asha Rao",
    amount_paise: R(300),
    method: "cash",
    provider_name: null as never,
    record_date: "2026-03-12",
    entered_on: "2026-03-12",
    recorded_by_name: null as never,
    age_days: 2,
    total_payments_paise: R(1000),
    total_refunds_paise: R(300),
    total_payments_count: 1,
    total_refunds_count: 1,
    total_rows: 2,
  },
];

export const refundRows = (): Ret<"report_refunds">[] => [
  {
    refund_id: "dddddddd-2222-4333-8444-555555555555",
    refund_code: "AAA-2026-000001-R1",
    booking_id: BOOKING_1,
    booking_code: "AAA-2026-000001",
    resort_id: RESORT_A,
    guest_name: "Asha Rao",
    amount_paise: R(500),
    method: "cash",
    provider_name: null as never,
    status: "approved",
    reason: 'Guest left early, "early" checkout',
    refund_date: "2026-03-11",
    entered_on: "2026-03-11",
    recorded_by_name: "Test Manager One",
    total_approved_paise: R(500),
    total_waiting_paise: R(300),
    total_rejected_paise: R(200),
    total_reversed_paise: R(100),
    total_rows: 1,
  },
];

export const cancellationRows = (): Ret<"report_cancellations">[] => [
  {
    booking_id: BOOKING_1,
    booking_code: "AAA-2026-000001",
    resort_id: RESORT_A,
    guest_name: "Asha Rao",
    status: "cancelled",
    cancellation_date: "2026-03-15",
    check_in_at: "2026-03-20T08:30:00Z",
    original_paise: R(6000),
    charge_paise: R(1000),
    approved_paise: R(2000),
    refund_due_paise: 0,
    reason: "Guest unwell",
    charge_change_reason: null as never,
    total_original_paise: R(6000),
    total_charge_paise: R(1000),
    total_refund_due_paise: 0,
    total_rows: 1,
  },
];

export const adjustmentRows = (): Ret<"report_expected_adjustments">[] => [
  {
    adjustment_id: "eeeeeeee-2222-4333-8444-555555555555",
    adjustment_date: "2026-03-20",
    booking_id: BOOKING_1,
    booking_code: "AAA-2026-000001",
    resort_id: RESORT_A,
    guest_name: "Asha Rao",
    amount_paise: -R(1500),
    source: "move_overdue",
    reason: "Guest will pay at check-in",
    created_by_name: "Test Manager One",
    total_paise: -R(1500),
    total_rows: 1,
  },
];

export const manualRows = (): Ret<"report_manual_adjustments">[] => [
  {
    booking_id: BOOKING_1,
    booking_code: "AAA-2026-000001",
    resort_id: RESORT_A,
    guest_name: "Asha Rao",
    booking_date: "2026-03-20",
    status: "confirmed",
    total_paise: R(5000),
    discount_paise: R(300),
    adjustment_paise: -R(200),
    adjustment_reason: "Regular guest",
    final_paise: R(4500),
    charge_paise: null as never,
    charge_change_reason: null as never,
    total_adjustment_paise: -R(200),
    total_rows: 1,
  },
];

/** A full report page for every report, built through the real mapping functions. */
export function samplePage(
  key: ReportKey,
  params: Record<string, string> = {},
): ReportPage {
  const f = parseReportFilter(REPORTS[key], params, "2026-03-31");
  switch (key) {
    case "collection":
      return mapCollection(collectionRows(), f);
    case "resort-wise":
      return mapResortWise(resortWiseRows());
    case "payment-methods":
      return mapMethods(methodRows());
    case "bookings":
      return mapBookings(bookingRows(), NAMES);
    case "pending":
      return mapPending(pendingRows(), NAMES);
    case "waiting":
      return mapWaiting(waitingRows(), NAMES);
    case "refunds":
      return mapRefunds(refundRows(), NAMES);
    case "cancellations":
      return mapCancellations(cancellationRows(), NAMES);
    case "expected-adjustments":
      return mapExpectedAdjustments(adjustmentRows(), NAMES);
    case "manual-adjustments":
      return mapManualAdjustments(manualRows(), NAMES);
  }
}
