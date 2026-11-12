import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import { buildTimeline, type AuditEvent } from "@/lib/bookings/history";
import { listArgs, type BookingFilter } from "@/lib/bookings/list";

/**
 * Everything the booking, guest and search screens read. All reads run as the signed-in user (their own login), so
 * row-level security applies; nothing here uses a master key. Money is whole paise. A failed read returns
 * `{ ok: false }` so the page can show a small "Try again" instead of an error screen.
 */
export type Loaded<T> = { ok: true; data: T } | { ok: false };

async function load<T>(run: () => PromiseLike<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await run() };
  } catch {
    return { ok: false };
  }
}

type Booking = Database["public"]["Tables"]["bookings"]["Row"];
type Guest = Database["public"]["Tables"]["guests"]["Row"];
type Schedule = Database["public"]["Tables"]["payment_schedules"]["Row"];
type Revision = Database["public"]["Tables"]["payment_plan_revisions"]["Row"];
type Adjustment = Database["public"]["Tables"]["expected_adjustments"]["Row"];
type Financials = Database["public"]["Views"]["booking_financials"]["Row"];

// ------------------------------------------------------------ form choices
export interface FormOptions {
  resorts: { id: string; name: string; code: string; active: boolean }[];
  stayTypes: { id: number; name: string; active: boolean }[];
  categories: {
    id: number;
    name: string;
    nameMode: "listed" | "typed" | "none";
    active: boolean;
    entries: {
      id: string;
      name: string;
      mobile: string | null;
      active: boolean;
    }[];
  }[];
}

export async function loadFormOptions(): Promise<Loaded<FormOptions>> {
  const supabase = await createClient();
  return load(async () => {
    const [resorts, stays, cats, entries] = await Promise.all([
      supabase
        .from("resorts")
        .select("id, name, code, is_active")
        .order("name"),
      supabase
        .from("stay_types")
        .select("id, name, is_active")
        .order("sort_order")
        .order("name"),
      supabase
        .from("co_categories")
        .select("id, name, name_mode, is_active")
        .order("sort_order")
        .order("name"),
      supabase
        .from("co_entries")
        .select("id, category_id, name, mobile, is_active")
        .order("name")
        .limit(2000),
    ]);
    if (resorts.error || stays.error || cats.error || entries.error)
      throw new Error("options");
    return {
      resorts: (resorts.data ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        code: r.code,
        active: r.is_active,
      })),
      stayTypes: (stays.data ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        active: s.is_active,
      })),
      categories: (cats.data ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        nameMode: (["listed", "typed", "none"].includes(c.name_mode)
          ? c.name_mode
          : "listed") as "listed" | "typed" | "none",
        active: c.is_active,
        entries: (entries.data ?? [])
          .filter((e) => e.category_id === c.id)
          .map((e) => ({
            id: e.id,
            name: e.name,
            mobile: e.mobile,
            active: e.is_active,
          })),
      })),
    };
  });
}

// ----------------------------------------------------------- the booking page
export interface BookingDetail {
  booking: Booking;
  financials: Financials | null;
  resort: {
    id: string;
    name: string;
    code: string;
    logoPath: string | null;
  } | null;
  guest: Guest | null;
  schedules: Schedule[];
  revisions: Revision[];
  adjustments: Adjustment[];
  timeline: { id: number; text: string; at: string }[];
  createdByName: string | null;
  updatedByName: string | null;
  cancelledByName: string | null;
}

export async function loadBookingDetail(
  id: string,
): Promise<Loaded<BookingDetail | null>> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    return { ok: true, data: null };
  const supabase = await createClient();
  return load(async () => {
    const { data: booking, error } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error("booking");
    if (!booking) return null;
    const [fin, resort, guest, sched, revs, adj, audit, people] =
      await Promise.all([
        supabase
          .from("booking_financials")
          .select("*")
          .eq("booking_id", id)
          .maybeSingle(),
        supabase
          .from("resorts")
          .select("id, name, code, logo_path")
          .eq("id", booking.resort_id)
          .maybeSingle(),
        supabase
          .from("guests")
          .select("*")
          .eq("id", booking.guest_id)
          .maybeSingle(),
        supabase
          .from("payment_schedules")
          .select("*")
          .eq("booking_id", id)
          .order("due_date")
          .order("line_no"),
        supabase
          .from("payment_plan_revisions")
          .select("*")
          .eq("booking_id", id)
          .order("revision_no"),
        supabase
          .from("expected_adjustments")
          .select("*")
          .eq("booking_id", id)
          .order("created_at"),
        supabase
          .from("audit_logs")
          .select(
            "id, occurred_at, actor_name, action, table_name, changed_fields, old_data, new_data, reason",
          )
          .eq("booking_id", id)
          .order("id", { ascending: false })
          .limit(300),
        supabase
          .from("user_profiles")
          .select("id, full_name")
          .in(
            "id",
            [
              booking.created_by,
              booking.updated_by,
              booking.cancelled_by,
            ].filter((x): x is string => !!x),
          ),
      ]);
    const name = (uid: string | null) =>
      uid
        ? ((people.data ?? []).find((p) => p.id === uid)?.full_name ?? null)
        : null;
    return {
      booking,
      financials: fin.data ?? null,
      resort: resort.data
        ? {
            id: resort.data.id,
            name: resort.data.name,
            code: resort.data.code,
            logoPath: resort.data.logo_path,
          }
        : null,
      guest: guest.data ?? null,
      schedules: sched.data ?? [],
      revisions: revs.data ?? [],
      adjustments: adj.data ?? [],
      timeline: buildTimeline((audit.data ?? []) as unknown as AuditEvent[]),
      createdByName: name(booking.created_by),
      updatedByName: name(booking.updated_by),
      cancelledByName: name(booking.cancelled_by),
    };
  });
}

// ---------------------------------------------------------------- the list
export interface BookingRow {
  id: string;
  code: string;
  resortId: string;
  guestId: string;
  guestName: string;
  guestMobile: string;
  coCategory: string;
  coName: string | null;
  status: Booking["status"];
  bookingDate: string;
  checkInAt: string;
  checkOutAt: string;
  pax: number;
  adjusted: boolean;
  dueP: number;
  approvedP: number;
  waitingP: number;
  pendingP: number;
  refundDueP: number;
}

export async function loadBookingList(
  f: BookingFilter,
): Promise<Loaded<{ rows: BookingRow[]; total: number }>> {
  const supabase = await createClient();
  return load(async () => {
    const { data, error } = await supabase.rpc("booking_list", listArgs(f));
    if (error || !data) throw new Error("list");
    return {
      total: data.length > 0 ? Number(data[0].total_rows) : 0,
      rows: data.map((r) => ({
        id: r.booking_id,
        code: r.booking_code,
        resortId: r.resort_id,
        guestId: r.guest_id,
        guestName: r.guest_name,
        guestMobile: r.guest_mobile,
        coCategory: r.co_category_name,
        coName: r.co_name,
        status: r.status,
        bookingDate: r.booking_date,
        checkInAt: r.check_in_at,
        checkOutAt: r.check_out_at,
        pax: r.pax,
        adjusted: r.adjusted,
        dueP: Number(r.amount_due_paise),
        approvedP: Number(r.approved_paise),
        waitingP: Number(r.waiting_paise),
        pendingP: Number(r.pending_paise),
        refundDueP: Number(r.refund_due_paise),
      })),
    };
  });
}

// ------------------------------------------------------------------ guests
export interface GuestRow {
  id: string;
  fullName: string;
  mobile: string;
  email: string | null;
  bookings: number;
  lastCheckIn: string | null;
  netCollectionP: number;
  pendingP: number;
}

export async function loadGuestList(
  q: string,
  page: number,
  size: number,
): Promise<Loaded<{ rows: GuestRow[]; total: number }>> {
  const supabase = await createClient();
  return load(async () => {
    const { data, error } = await supabase.rpc("guest_list", {
      p_q: q === "" ? undefined : q,
      p_limit: size,
      p_offset: (page - 1) * size,
    });
    if (error || !data) throw new Error("guests");
    return {
      total: data.length > 0 ? Number(data[0].total_rows) : 0,
      rows: data.map((g) => ({
        id: g.guest_id,
        fullName: g.full_name,
        mobile: g.mobile,
        email: g.email,
        bookings: Number(g.bookings),
        lastCheckIn: g.last_check_in,
        netCollectionP: Number(g.net_collection_paise),
        pendingP: Number(g.pending_paise),
      })),
    };
  });
}

export interface GuestDetail {
  guest: Guest;
  bookings: BookingRow[];
  resortNames: Map<string, string>;
}

export async function loadGuestDetail(
  id: string,
): Promise<Loaded<GuestDetail | null>> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    return { ok: true, data: null };
  const supabase = await createClient();
  return load(async () => {
    const { data: guest, error } = await supabase
      .from("guests")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error("guest");
    if (!guest) return null;
    const [bk, resorts] = await Promise.all([
      supabase
        .from("bookings")
        .select("*")
        .eq("guest_id", id)
        .order("check_in_at", { ascending: false })
        .limit(500),
      supabase.from("resorts").select("id, name"),
    ]);
    if (bk.error) throw new Error("bookings");
    const ids = (bk.data ?? []).map((b) => b.id);
    const fin =
      ids.length > 0
        ? await supabase
            .from("booking_financials")
            .select("*")
            .in("booking_id", ids)
        : { data: [] as Financials[] };
    const finBy = new Map((fin.data ?? []).map((f) => [f.booking_id, f]));
    return {
      guest,
      resortNames: new Map((resorts.data ?? []).map((r) => [r.id, r.name])),
      bookings: (bk.data ?? []).map((b) => {
        const f = finBy.get(b.id);
        return {
          id: b.id,
          code: b.booking_code,
          resortId: b.resort_id,
          guestId: b.guest_id,
          guestName: b.guest_name,
          guestMobile: b.guest_mobile,
          coCategory: b.co_category_name,
          coName: b.co_name,
          status: b.status,
          bookingDate: b.booking_date,
          checkInAt: b.check_in_at,
          checkOutAt: b.check_out_at,
          pax: b.pax,
          adjusted: b.manual_adjustment_paise !== 0,
          dueP: Number(f?.due_paise ?? 0),
          approvedP: Number(f?.total_collection_paise ?? 0),
          waitingP: Number(f?.waiting_paise ?? 0),
          pendingP: Number(f?.pending_paise ?? 0),
          refundDueP: Number(f?.refund_due_paise ?? 0),
        };
      }),
    };
  });
}

// --------------------------------------------------------------- search
export async function loadSearch(q: string): Promise<
  Loaded<{
    bookings: BookingRow[];
    bookingTotal: number;
    guests: GuestRow[];
    guestTotal: number;
  }>
> {
  const supabase = await createClient();
  return load(async () => {
    const [b, g] = await Promise.all([
      supabase.rpc("booking_list", { p_q: q, p_limit: 10, p_offset: 0 }),
      supabase.rpc("guest_list", { p_q: q, p_limit: 10, p_offset: 0 }),
    ]);
    if (b.error || g.error || !b.data || !g.data) throw new Error("search");
    return {
      bookingTotal: b.data.length > 0 ? Number(b.data[0].total_rows) : 0,
      guestTotal: g.data.length > 0 ? Number(g.data[0].total_rows) : 0,
      bookings: b.data.map((r) => ({
        id: r.booking_id,
        code: r.booking_code,
        resortId: r.resort_id,
        guestId: r.guest_id,
        guestName: r.guest_name,
        guestMobile: r.guest_mobile,
        coCategory: r.co_category_name,
        coName: r.co_name,
        status: r.status,
        bookingDate: r.booking_date,
        checkInAt: r.check_in_at,
        checkOutAt: r.check_out_at,
        pax: r.pax,
        adjusted: r.adjusted,
        dueP: Number(r.amount_due_paise),
        approvedP: Number(r.approved_paise),
        waitingP: Number(r.waiting_paise),
        pendingP: Number(r.pending_paise),
        refundDueP: Number(r.refund_due_paise),
      })),
      guests: g.data.map((x) => ({
        id: x.guest_id,
        fullName: x.full_name,
        mobile: x.mobile,
        email: x.email,
        bookings: Number(x.bookings),
        lastCheckIn: x.last_check_in,
        netCollectionP: Number(x.net_collection_paise),
        pendingP: Number(x.pending_paise),
      })),
    };
  });
}

// --------------------------------------------------------- payment apps
export async function loadProviders() {
  const supabase = await createClient();
  return load(async () => {
    const { data, error } = await supabase
      .from("payment_providers")
      .select("id, method, name, is_active, sort_order")
      .order("method")
      .order("sort_order")
      .order("name");
    if (error || !data) throw new Error("providers");
    return data;
  });
}

export async function loadResortNames(): Promise<Map<string, string>> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("resorts").select("id, name");
    return new Map((data ?? []).map((r) => [r.id, r.name]));
  } catch {
    return new Map();
  }
}
