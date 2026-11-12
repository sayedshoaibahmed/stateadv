/**
 * The booking "History" tab: audit rows turned into plain sentences (UI spec 3.5). Pure and unit-tested.
 * Rows that only repeat another row (the individual plan lines, proof files, PDF versions, internal columns) give
 * `null` and are left out of the list.
 */
import { formatPaise } from "@/lib/money";

export interface AuditEvent {
  id: number;
  occurred_at: string;
  actor_name: string | null;
  action: string;
  table_name: string;
  changed_fields: string[] | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  reason: string | null;
}

const FIELD_LABELS: Record<string, string> = {
  guest_id: "the guest",
  guest_name: "the guest name",
  guest_mobile: "the guest mobile number",
  pax: "the number of people",
  co_category_id: "the C/O type",
  co_entry_id: "the C/O name",
  co_name: "the C/O name",
  stay_type_id: "the stay type",
  booking_date: "the booking date",
  check_in_at: "the check-in",
  check_out_at: "the check-out",
  nights: "the nights",
  pricing_method: "the pricing method",
  tariff_per_person_paise: "the tariff",
  extra_charges_paise: "the extra charges",
  extra_charges_note: "the extra charges note",
  discount_paise: "the discount",
  manual_adjustment_paise: "the final amount",
  manual_adjustment_reason: "the reason for the final amount",
  remarks: "the remarks",
};
// columns that follow from others, or are internal: never listed on their own
const QUIET = new Set([
  "base_amount_paise",
  "total_amount_paise",
  "final_amount_paise",
  "amount_due_paise",
  "co_mode",
  "co_category_name",
  "stay_type_name",
  "version",
  "updated_at",
  "updated_by",
  "cancelled_at",
  "cancelled_by",
]);

const STATUS_WORDS: Record<string, string> = {
  confirmed: "Confirmed",
  checked_in: "Checked-in",
  checked_out: "Checked-out",
  cancelled: "Cancelled",
  no_show: "No-show",
};

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === "string" && v !== "" ? v : null;
const withReason = (text: string, reason: string | null) =>
  reason ? `${text} Reason: ${reason}` : text;
const list = (xs: string[]) =>
  xs.length <= 1
    ? (xs[0] ?? "")
    : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;

export function describeBookingEvent(
  e: AuditEvent,
): { text: string; at: string } | null {
  const by = e.actor_name ?? "The system";
  const n = e.new_data ?? {};
  const o = e.old_data ?? {};
  const at = e.occurred_at;
  const fields = e.changed_fields ?? [];
  const reason = e.reason ?? null;

  switch (e.table_name) {
    case "bookings": {
      if (e.action === "insert")
        return { text: `${by} created the booking.`, at };
      if (e.action !== "update") return null;
      if (fields.includes("status")) {
        const from = STATUS_WORDS[String(o.status)] ?? String(o.status);
        const to = STATUS_WORDS[String(n.status)] ?? String(n.status);
        if (n.status === "cancelled" || n.status === "no_show") {
          const charge = num(n.cancellation_charge_paise);
          const why = str(n.cancellation_reason);
          const text = `${by} marked the booking as ${to}${charge !== null ? `. Cancellation charge ${formatPaise(charge)}` : ""}.`;
          return { text: withReason(text, why), at };
        }
        const back =
          (o.status === "checked_in" && n.status === "confirmed") ||
          (o.status === "checked_out" && n.status === "checked_in");
        return {
          text: withReason(
            `${by} changed the status from ${from} to ${to}${back ? " (undone)" : ""}.`,
            reason,
          ),
          at,
        };
      }
      if (fields.includes("cancellation_charge_paise")) {
        const a = num(o.cancellation_charge_paise);
        const b = num(n.cancellation_charge_paise);
        return {
          text: withReason(
            `${by} changed the cancellation charge${a !== null && b !== null ? ` from ${formatPaise(a)} to ${formatPaise(b)}` : ""}.`,
            str(n.charge_change_reason) ?? reason,
          ),
          at,
        };
      }
      const labels = [
        ...new Set(
          fields
            .filter((f) => !QUIET.has(f))
            .map((f) => FIELD_LABELS[f])
            .filter(Boolean),
        ),
      ];
      const dueA = num(o.amount_due_paise);
      const dueB = num(n.amount_due_paise);
      const amount =
        dueA !== null && dueB !== null && dueA !== dueB
          ? ` The Amount Due changed from ${formatPaise(dueA)} to ${formatPaise(dueB)}.`
          : "";
      if (labels.length === 0 && !amount) return null;
      const head =
        labels.length > 0
          ? `${by} changed ${list(labels)}.`
          : `${by} changed the booking.`;
      return { text: withReason(`${head}${amount}`, reason), at };
    }
    case "payment_plan_revisions": {
      if (e.action !== "insert") return null;
      const src = String(n.source);
      const no = num(n.revision_no);
      const text =
        src === "created"
          ? `${by} set the first payment plan.`
          : src === "amount_change"
            ? `${by} updated the payment plan because the amount changed (plan version ${no}).`
            : src === "move_overdue"
              ? `${by} moved an overdue amount to a new date (plan version ${no}).`
              : src === "cancellation"
                ? `${by} set the cancellation plan (plan version ${no}).`
                : src === "no_show"
                  ? `${by} set the no-show plan (plan version ${no}).`
                  : `${by} changed the payment plan (plan version ${no}).`;
      return {
        text: src === "created" ? text : withReason(text, str(n.reason)),
        at,
      };
    }
    case "expected_adjustments": {
      if (e.action !== "insert") return null;
      const amt = num(n.amount_paise);
      if (amt === null) return null;
      return {
        text: withReason(
          `The amount expected today was ${amt < 0 ? "reduced" : "increased"} by ${formatPaise(Math.abs(amt))} (an adjustment).`,
          str(n.reason),
        ),
        at,
      };
    }
    case "payments":
    case "refunds": {
      const what = e.table_name === "payments" ? "payment" : "refund";
      const amt = num(n.amount_paise);
      const money = amt !== null ? ` of ${formatPaise(amt)}` : "";
      if (e.action === "insert")
        return {
          text: `${by} added a ${what}${money}. It is waiting for approval.`,
          at,
        };
      if (fields.includes("status")) {
        const s = String(n.status);
        const verb =
          s === "approved"
            ? "approved"
            : s === "rejected"
              ? "rejected"
              : s === "reversed"
                ? "reversed"
                : "changed";
        return {
          text: withReason(
            `${by} ${verb} the ${what}${money}.`,
            str(n.rejection_reason) ?? str(n.reversal_reason) ?? reason,
          ),
          at,
        };
      }
      return {
        text: withReason(`${by} changed a ${what}${money}.`, reason),
        at,
      };
    }
    default:
      return null;
  }
}

/** The visible timeline, newest first. */
export function buildTimeline(
  events: readonly AuditEvent[],
): { id: number; text: string; at: string }[] {
  return [...events]
    .sort((a, b) => b.id - a.id)
    .flatMap((e) => {
      const d = describeBookingEvent(e);
      return d ? [{ id: e.id, ...d }] : [];
    });
}
