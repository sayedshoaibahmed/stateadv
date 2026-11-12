import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { moneyArgs, type MoneyFilter } from "@/lib/payments/list";
import type { ProviderChoice } from "@/lib/payments/form";
import type { Kind, Status } from "@/lib/payments/rules";

/**
 * Everything the payment, refund and approval screens read. All reads run as the signed-in user (their own login), so
 * row-level security applies; nothing here uses a master key. Money is whole paise exactly as the database holds it:
 * no balance is ever calculated here (the booking figures come from the `booking_financials` view). A failed read
 * returns `{ ok: false }` so the page can show a small "Try again" instead of an error screen.
 */
export type Loaded<T> = { ok: true; data: T } | { ok: false };
async function load<T>(run: () => PromiseLike<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await run() };
  } catch {
    return { ok: false };
  }
}

export interface MoneyRow {
  id: string;
  code: string;
  bookingId: string;
  bookingCode: string;
  resortId: string;
  guestName: string;
  guestMobile: string;
  amountP: number;
  method: Database["public"]["Enums"]["payment_method"];
  providerName: string | null;
  providerOther: string | null;
  reference: string | null;
  date: string;
  time: string | null;
  reason: string | null;
  status: Status;
  selfApproved: boolean;
  recordedBy: string;
  recordedByName: string | null;
  recordedAt: string;
  decidedByName: string | null;
  rejectionReason: string | null;
  reversalReason: string | null;
  proofCount: number;
  version: number;
}

export async function loadMoneyList(
  f: MoneyFilter,
): Promise<Loaded<{ rows: MoneyRow[]; total: number }>> {
  const supabase = await createClient();
  return load(async () => {
    const args = moneyArgs(f);
    if (f.kind === "payment") {
      const { data, error } = await supabase.rpc("payment_list", args);
      if (error || !data) throw new Error("payments");
      return {
        total: data.length > 0 ? Number(data[0].total_rows) : 0,
        rows: data.map((r) => ({
          id: r.payment_id,
          code: r.payment_code,
          bookingId: r.booking_id,
          bookingCode: r.booking_code,
          resortId: r.resort_id,
          guestName: r.guest_name,
          guestMobile: r.guest_mobile,
          amountP: Number(r.amount_paise),
          method: r.method,
          providerName: r.provider_name,
          providerOther: r.provider_other,
          reference: r.reference_number,
          date: r.payment_date,
          time: r.payment_time,
          reason: null,
          status: r.status,
          selfApproved: r.is_self_approved,
          recordedBy: r.recorded_by,
          recordedByName: r.recorded_by_name,
          recordedAt: r.recorded_at,
          decidedByName: r.decided_by_name,
          rejectionReason: r.rejection_reason,
          reversalReason: r.reversal_reason,
          proofCount: Number(r.proof_count),
          version: r.version,
        })),
      };
    }
    const { data, error } = await supabase.rpc("refund_list", args);
    if (error || !data) throw new Error("refunds");
    return {
      total: data.length > 0 ? Number(data[0].total_rows) : 0,
      rows: data.map((r) => ({
        id: r.refund_id,
        code: r.refund_code,
        bookingId: r.booking_id,
        bookingCode: r.booking_code,
        resortId: r.resort_id,
        guestName: r.guest_name,
        guestMobile: r.guest_mobile,
        amountP: Number(r.amount_paise),
        method: r.method,
        providerName: r.provider_name,
        providerOther: r.provider_other,
        reference: r.reference_number,
        date: r.refund_date,
        time: r.refund_time,
        reason: r.reason,
        status: r.status,
        selfApproved: r.is_self_approved,
        recordedBy: r.recorded_by,
        recordedByName: r.recorded_by_name,
        recordedAt: r.recorded_at,
        decidedByName: r.decided_by_name,
        rejectionReason: r.rejection_reason,
        reversalReason: r.reversal_reason,
        proofCount: Number(r.proof_count),
        version: r.version,
      })),
    };
  });
}

export async function loadProviderChoices(): Promise<ProviderChoice[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("payment_providers")
      .select("id, name, method, is_active")
      .order("sort_order")
      .order("name");
    return (data ?? []).flatMap((p) =>
      p.method === "upi" || p.method === "card"
        ? [{ id: p.id, name: p.name, method: p.method, active: p.is_active }]
        : [],
    );
  } catch {
    return [];
  }
}

/** The number of payments and refunds waiting, for the tab labels (all dates, all resorts). */
export async function loadWaitingCounts(): Promise<{
  payments: number;
  refunds: number;
} | null> {
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
    return { payments: p.count ?? 0, refunds: r.count ?? 0 };
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------- one item
type Financials = Database["public"]["Views"]["booking_financials"]["Row"];
type Proof = Database["public"]["Tables"]["proofs"]["Row"];

export interface MoneyDetail {
  kind: Kind;
  item: MoneyRow;
  providerId: number | null;
  booking: {
    id: string;
    code: string;
    status: string;
    resortName: string | null;
    checkIn: string;
    finalP: number | null;
  };
  financials: Financials | null;
  proofs: (Proof & { uploadedByName: string | null })[];
  history: {
    id: number;
    at: string;
    by: string | null;
    from: Status | null;
    to: Status;
    reason: string | null;
    self: boolean;
  }[];
  remarks: string | null;
  /** refunds that depend on this payment's booking (shown when a reversal is refused) */
  otherRefunds: { id: string; code: string; status: Status; amountP: number }[];
}

export async function loadMoneyDetail(
  kind: Kind,
  id: string,
): Promise<Loaded<MoneyDetail | null>> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    return { ok: true, data: null };
  const supabase = await createClient();
  return load(async () => {
    const table = kind === "payment" ? "payments" : "refunds";
    const row = await supabase
      .from(table)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (row.error) throw new Error("item");
    if (!row.data) return null;
    const r = row.data as Database["public"]["Tables"]["payments"]["Row"] &
      Database["public"]["Tables"]["refunds"]["Row"];
    const [booking, fin, proofs, hist, provider, refunds] = await Promise.all([
      supabase
        .from("bookings")
        .select(
          "id, booking_code, status, resort_id, guest_name, guest_mobile, check_in_at, final_amount_paise",
        )
        .eq("id", r.booking_id)
        .maybeSingle(),
      supabase
        .from("booking_financials")
        .select("*")
        .eq("booking_id", r.booking_id)
        .maybeSingle(),
      supabase
        .from("proofs")
        .select("*")
        .eq(kind === "payment" ? "payment_id" : "refund_id", id)
        .order("uploaded_at"),
      supabase
        .from("approval_history")
        .select(
          "id, acted_at, acted_by, from_status, to_status, reason, is_self_action",
        )
        .eq(kind === "payment" ? "payment_id" : "refund_id", id)
        .order("id"),
      r.provider_id
        ? supabase
            .from("payment_providers")
            .select("name")
            .eq("id", r.provider_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("refunds")
        .select("id, refund_code, status, amount_paise")
        .eq("booking_id", r.booking_id)
        .order("recorded_at"),
    ]);
    const resort = booking.data
      ? await supabase
          .from("resorts")
          .select("name")
          .eq("id", booking.data.resort_id)
          .maybeSingle()
      : { data: null };
    const ids = [
      ...new Set(
        [
          r.recorded_by,
          r.approved_by,
          r.rejected_by,
          r.reversed_by,
          ...(proofs.data ?? []).map((p) => p.uploaded_by),
          ...(hist.data ?? []).map((h) => h.acted_by),
        ].filter((x): x is string => !!x),
      ),
    ];
    const people =
      ids.length > 0
        ? await supabase
            .from("user_profiles")
            .select("id, full_name")
            .in("id", ids)
        : { data: [] };
    const nameOf = (uid: string | null) =>
      uid
        ? ((people.data ?? []).find((p) => p.id === uid)?.full_name ?? null)
        : null;
    const item: MoneyRow = {
      id: r.id,
      code: kind === "payment" ? r.payment_code : r.refund_code,
      bookingId: r.booking_id,
      bookingCode: booking.data?.booking_code ?? "",
      resortId: r.resort_id,
      guestName: booking.data?.guest_name ?? "",
      guestMobile: booking.data?.guest_mobile ?? "",
      amountP: r.amount_paise,
      method: r.method,
      providerName: provider.data?.name ?? null,
      providerOther: r.provider_other,
      reference: r.reference_number,
      date: kind === "payment" ? r.payment_date : r.refund_date,
      time: kind === "payment" ? r.payment_time : r.refund_time,
      reason: kind === "refund" ? r.reason : null,
      status: r.status,
      selfApproved: !!r.is_self_approved,
      recordedBy: r.recorded_by,
      recordedByName: nameOf(r.recorded_by),
      recordedAt: r.recorded_at,
      decidedByName: nameOf(r.approved_by ?? r.rejected_by ?? r.reversed_by),
      rejectionReason: r.rejection_reason,
      reversalReason: r.reversal_reason,
      proofCount: (proofs.data ?? []).filter((p) => !p.hidden_at).length,
      version: r.version,
    };
    return {
      kind,
      item,
      providerId: r.provider_id,
      booking: {
        id: r.booking_id,
        code: booking.data?.booking_code ?? "",
        status: booking.data?.status ?? "",
        resortName: resort.data?.name ?? null,
        checkIn: booking.data?.check_in_at ?? "",
        finalP: booking.data?.final_amount_paise ?? null,
      },
      financials: fin.data ?? null,
      proofs: (proofs.data ?? []).map((p) => ({
        ...p,
        uploadedByName: nameOf(p.uploaded_by),
      })),
      history: (hist.data ?? []).map((h) => ({
        id: h.id,
        at: h.acted_at,
        by: nameOf(h.acted_by),
        from: h.from_status,
        to: h.to_status,
        reason: h.reason,
        self: h.is_self_action,
      })),
      remarks: r.remarks,
      otherRefunds: (refunds.data ?? []).map((x) => ({
        id: x.id,
        code: x.refund_code,
        status: x.status,
        amountP: x.amount_paise,
      })),
    };
  });
}

/** The booking the Add Payment / Add Refund screens work on, with the figures straight from the view. */
export interface BookingForMoney {
  id: string;
  code: string;
  status: string;
  guestName: string;
  resortName: string | null;
  financials: Financials | null;
}
export async function loadBookingForMoney(
  bookingId: string,
): Promise<Loaded<BookingForMoney | null>> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      bookingId,
    )
  )
    return { ok: true, data: null };
  const supabase = await createClient();
  return load(async () => {
    const b = await supabase
      .from("bookings")
      .select("id, booking_code, status, guest_name, resort_id")
      .eq("id", bookingId)
      .maybeSingle();
    if (b.error) throw new Error("booking");
    if (!b.data) return null;
    const [fin, resort] = await Promise.all([
      supabase
        .from("booking_financials")
        .select("*")
        .eq("booking_id", bookingId)
        .maybeSingle(),
      supabase
        .from("resorts")
        .select("name")
        .eq("id", b.data.resort_id)
        .maybeSingle(),
    ]);
    return {
      id: b.data.id,
      code: b.data.booking_code,
      status: b.data.status,
      guestName: b.data.guest_name,
      resortName: resort.data?.name ?? null,
      financials: fin.data ?? null,
    };
  });
}

export async function loadPeople(): Promise<{ id: string; name: string }[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("user_profiles")
      .select("id, full_name")
      .order("full_name");
    return (data ?? []).map((p) => ({ id: p.id, name: p.full_name }));
  } catch {
    return [];
  }
}
