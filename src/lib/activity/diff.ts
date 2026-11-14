/**
 * Turns an audit-log entry into plain words and a readable "before -> after" table (TEST_PLAN AUD-04). Pure and
 * unit-tested; it only formats what the database gives (activity_list, migration 24) and never calculates a figure.
 *
 * Rules for the table: only fields that changed are shown (a new record shows its filled-in fields); money fields
 * (names ending in _paise) are shown as rupees; dates and times are shown in India time; true/false are Yes/No;
 * internal numbers (names ending in _id or _by, and any value that is a long identifier) are left out because nobody
 * can read them.
 */
import { formatDisplayDate, formatDisplayTime, isIsoDate } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import { STATUS_LABELS } from "@/lib/bookings/list";

export interface ActivityEntry {
  id: number;
  at: string;
  actorName: string | null;
  action: string;
  recordType: string;
  tableName: string;
  recordId: string;
  recordCode: string | null;
  bookingId: string | null;
  bookingCode: string | null;
  resortId: string | null;
  targetUserName: string | null;
  changedFields: string[] | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  reason: string | null;
}

const LABELS: Record<string, string> = {
  status: "Status",
  guest_name: "Guest name",
  guest_mobile: "Mobile number",
  pax: "People (PAX)",
  check_in_at: "Check-in",
  check_out_at: "Check-out",
  booking_date: "Booking date",
  nights: "Nights",
  stay_type_name: "Stay type",
  co_category_name: "C/O type",
  co_name: "C/O name",
  pricing_method: "Pricing method",
  tariff_per_person_paise: "Rate per person",
  base_amount_paise: "Base amount",
  extra_charges_paise: "Extra charges",
  extra_charges_note: "Extra charges note",
  discount_paise: "Discount",
  manual_adjustment_paise: "Manual adjustment",
  manual_adjustment_reason: "Adjustment reason",
  total_amount_paise: "Total amount",
  final_amount_paise: "Final amount",
  amount_due_paise: "Amount due",
  cancellation_date: "Cancellation date",
  cancellation_charge_paise: "Cancellation charge",
  cancellation_reason: "Cancellation reason",
  charge_change_reason: "Reason for changing the charge",
  remarks: "Remarks",
  amount_paise: "Amount",
  method: "Paid by",
  provider_other: "App or bank (typed)",
  payment_date: "Payment date",
  refund_date: "Refund date",
  reference_number: "Reference number",
  reason: "Reason",
  rejection_reason: "Rejection reason",
  reversal_reason: "Reversal reason",
  approved_at: "Approved on",
  rejected_at: "Rejected on",
  reversed_at: "Reversed on",
  recorded_at: "Entered on",
  is_self_approved: "Approved by the same person",
  is_correction: "Added after approval",
  correction_reason: "Reason for adding it after approval",
  original_file_name: "File name",
  mime_type: "File type",
  size_bytes: "File size (bytes)",
  hidden_at: "Hidden on",
  hidden_reason: "Reason for hiding",
  full_name: "Name",
  email: "Email",
  role: "Role",
  is_active: "Switched on",
  disabled_at: "Switched off on",
  name: "Name",
  code: "Code",
  location: "Location",
  contact_number: "Contact number",
  label: "Name",
  due_date: "Due date",
  adjustment_date: "Adjustment date",
  line_no: "Line",
  version_no: "Version",
  trigger_reason: "Why it was made",
};

/** "extra_charges_note" -> "Extra charges note" when there is no better name */
export function fieldLabel(key: string): string {
  if (LABELS[key]) return LABELS[key];
  const words = key
    .replace(/_paise$/, "")
    .replace(/_/g, " ")
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const APPROVAL_LABELS: Record<string, string> = {
  approved: "Approved",
  waiting: "Waiting for Approval",
  rejected: "Rejected",
  reversed: "Reversed",
};
const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  cheque: "Cheque",
  other: "Other",
};

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const LONG_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for fields nobody can read (internal numbers) or that carry no meaning for a reader. */
export function isHiddenField(key: string, value: unknown): boolean {
  if (/(_id|_by)$/.test(key)) return true;
  if (
    [
      "id",
      "version",
      "created_at",
      "updated_at",
      "booking_year",
      "booking_seq",
      "booking_code",
      "payment_code",
      "refund_code",
      "co_mode",
      "storage_path",
      "sha256",
      "idempotency_key",
    ].includes(key)
  )
    return true;
  return typeof value === "string" && LONG_ID.test(value);
}

export function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" && key.endsWith("_paise"))
    return formatPaise(value);
  if (typeof value === "string") {
    if (key === "status")
      return (
        APPROVAL_LABELS[value] ??
        (STATUS_LABELS as Record<string, string>)[value] ??
        value
      );
    if (key === "method") return METHOD_LABELS[value] ?? value;
    if (ISO_TIME.test(value)) {
      const t = new Date(value);
      if (!Number.isNaN(t.getTime()))
        return `${formatDisplayDate(t)}, ${formatDisplayTime(t)}`;
    }
    if (isIsoDate(value)) return formatDisplayDate(value);
    return value;
  }
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}

export interface DiffRow {
  key: string;
  label: string;
  before: string;
  after: string;
}

/**
 * The rows of the "What changed" table. A change shows only the changed fields; a new record shows what was filled in
 * (at most 14 rows).
 */
export function diffRows(e: ActivityEntry): DiffRow[] {
  const newer = e.newValues ?? {};
  const older = e.oldValues ?? {};
  const keys =
    e.action === "update" && e.changedFields
      ? e.changedFields
      : Object.keys(newer);
  const rows: DiffRow[] = [];
  for (const key of keys) {
    const after = newer[key];
    const before = older[key];
    if (isHiddenField(key, after) && isHiddenField(key, before)) continue;
    if (e.action !== "update" && (after === null || after === "")) continue;
    if (e.action === "update" && before === after) continue;
    rows.push({
      key,
      label: fieldLabel(key),
      before: e.action === "update" ? formatValue(key, before) : "—",
      after: formatValue(key, after),
    });
  }
  return e.action === "update" ? rows : rows.slice(0, 14);
}

const THING: Record<string, string> = {
  booking: "booking",
  payment: "payment",
  refund: "refund",
  file: "file",
  plan: "payment plan",
  guest: "guest",
  resort: "resort",
  setting: "setting",
  user: "account",
  approval: "approval step",
  pdf: "PDF",
  other: "record",
};
export const thingWord = (recordType: string) =>
  THING[recordType] ?? THING.other;

/** One plain sentence for an entry, for example "Asha approved a payment." */
export function describeEntry(e: ActivityEntry): string {
  const by = e.actorName ?? "The system";
  const thing = thingWord(e.recordType);
  const target = e.targetUserName ?? "a person";
  if (e.action.startsWith("reauth_"))
    return `${by} was asked to type their password again for a sensitive step.`;
  if (e.action === "password_reset")
    return `${by} set a new temporary password for ${target}.`;
  if (e.action === "owner_recovered")
    return `${by} recovered the Owner account of ${target}.`;
  if (e.action !== "insert" && e.action !== "update")
    return `${by} did an account action (${e.action.replace(/_/g, " ")}) for ${target}.`;

  const newer = e.newValues ?? {};
  const fields = e.changedFields ?? [];
  const status = typeof newer.status === "string" ? newer.status : null;

  if (e.action === "insert") {
    if (e.recordType === "file")
      return newer.is_correction === true
        ? `${by} added a file after approval.`
        : `${by} added a file.`;
    if (e.recordType === "user") return `${by} added the account of ${target}.`;
    return `${by} added a ${thing}.`;
  }
  if (e.recordType === "user") {
    if (fields.includes("is_active"))
      return newer.is_active === false
        ? `${by} switched off the account of ${target}.`
        : `${by} switched on the account of ${target}.`;
    return `${by} changed the account of ${target}.`;
  }
  if (e.recordType === "payment" || e.recordType === "refund") {
    if (fields.includes("status") && status) {
      const verb = {
        approved: "approved",
        rejected: "rejected",
        reversed: "reversed",
      }[status];
      if (verb) return `${by} ${verb} a ${thing}.`;
    }
    if (fields.includes("hidden_at")) return `${by} hid a file of a ${thing}.`;
  }
  if (e.recordType === "booking" && fields.includes("status") && status) {
    if (status === "cancelled") return `${by} cancelled a booking.`;
    if (status === "no_show") return `${by} marked a booking as a no-show.`;
    const label = (STATUS_LABELS as Record<string, string>)[status];
    if (label) return `${by} changed a booking to ${label}.`;
  }
  if (e.recordType === "file" && fields.includes("hidden_at"))
    return `${by} hid a file.`;
  return `${by} changed a ${thing}.`;
}
