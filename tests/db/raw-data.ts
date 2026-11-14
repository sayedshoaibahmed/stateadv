/**
 * Builders for hand-made test data with exact dates and statuses (fictional). They write rows directly with the guard
 * triggers switched off (as dashboard.test.ts and calendar-records.test.ts do), so any combination of dates, statuses and
 * amounts can be built; the guards themselves are tested elsewhere. Used by the report tests.
 */
import { uid, type World } from "./fixtures";

export interface RawBooking {
  id: string;
  code: string;
  resortId: string;
  /** the final amount in paise, as the database computed it */
  final: number;
}

export interface PlanLine {
  label: string;
  due: string; // YYYY-MM-DD
  amount: number; // paise
}

export interface BookingOpts {
  resort: "A" | "B";
  /** booking date, YYYY-MM-DD */
  bookingDate: string;
  /** IST wall-clock, "2026-03-10T14:00" */
  checkIn: string;
  checkOut: string;
  pax?: number;
  tariff?: number; // per person, paise (per stay)
  discount?: number;
  adjustment?: number;
  adjustmentReason?: string;
  name?: string;
  plan?: PlanLine[];
  adjustments?: {
    date: string;
    amount: number;
    reason: string;
    source:
      | "cancellation"
      | "no_show"
      | "amount_change"
      | "plan_change"
      | "charge_change"
      | "move_overdue";
  }[];
  /** make it cancelled or no-show */
  cancel?: {
    status: "cancelled" | "no_show";
    date: string;
    charge: number;
    reason?: string;
    chargeChangeReason?: string;
  };
}

export type Status = "waiting" | "approved" | "rejected" | "reversed";

export function makeBuilders(
  w: World,
  q: (sql: string, p?: unknown[]) => Promise<unknown[]>,
) {
  const counters = new Map<string, number>();
  const raw = async <T>(fn: () => Promise<T>): Promise<T> => {
    await w.db.exec("set session_replication_role = replica");
    try {
      return await fn();
    } finally {
      await w.db.exec("set session_replication_role = origin");
    }
  };
  const nights = (a: string, b: string) => {
    const d = (s: string) =>
      Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
    return Math.max(1, Math.round((d(b) - d(a)) / 86_400_000));
  };

  async function booking(o: BookingOpts): Promise<RawBooking> {
    const id = uid();
    const resortId = w.resorts[o.resort].id;
    const year = o.bookingDate.slice(0, 4);
    const key = `${o.resort}-${year}`;
    const n = (counters.get(key) ?? 700000) + 1;
    counters.set(key, n);
    const code = `RPT${o.resort}-${year}-${String(n).padStart(6, "0")}`;
    const pax = o.pax ?? 2;
    const tariff = o.tariff ?? 250000;
    const base = pax * tariff;
    const discount = o.discount ?? 0;
    const adjustment = o.adjustment ?? 0;
    let final = 0;
    await raw(async () => {
      await q(
        `insert into public.bookings
           (id, booking_code, resort_id, booking_year, booking_seq, guest_id, guest_name, guest_mobile, pax,
            co_category_id, co_category_name, co_mode, stay_type_id, stay_type_name, booking_date, check_in_at, check_out_at,
            nights, pricing_method, tariff_per_person_paise, base_amount_paise, discount_paise, manual_adjustment_paise,
            manual_adjustment_reason, idempotency_key, created_at)
         values ($1,$2,$3,$4::int,$5,$6,$7,'9876543210',$8,$9,'Direct','none',$10,'Resort Stay',$11::date,
                 ($12::text || ':00+05:30')::timestamptz, ($13::text || ':00+05:30')::timestamptz, $14,
                 'per_person_per_stay', $15, $16, $17, $18, $19, $20, ($11::text || ' 10:00:00+05:30')::timestamptz)`,
        [
          id,
          code,
          resortId,
          year,
          n,
          w.guestId,
          o.name ?? "Test Guest",
          pax,
          w.cat.direct,
          w.stayTypeId,
          o.bookingDate,
          o.checkIn.replace("T", " "),
          o.checkOut.replace("T", " "),
          nights(o.checkIn.slice(0, 10), o.checkOut.slice(0, 10)),
          tariff,
          base,
          discount,
          adjustment,
          o.adjustmentReason ?? null,
          uid(),
        ],
      );
      const rev = uid();
      const [{ f }] = (await q(
        `select final_amount_paise::text f from public.bookings where id = $1`,
        [id],
      )) as { f: string }[];
      final = Number(f);
      await q(
        `insert into public.payment_plan_revisions (id, booking_id, revision_no, source, amount_due_before, amount_due_after, locked_total_paise)
         values ($1, $2, 1, 'created', null, $3, 0)`,
        [rev, id, final],
      );
      let line = 1;
      for (const p of o.plan ?? [])
        await q(
          `insert into public.payment_schedules (booking_id, revision_id, line_no, label, due_date, amount_paise)
           values ($1, $2, $3, $4, $5::date, $6)`,
          [id, rev, line++, p.label, p.due, p.amount],
        );
      for (const a of o.adjustments ?? [])
        await q(
          `insert into public.expected_adjustments (booking_id, resort_id, adjustment_date, amount_paise, reason, revision_id, created_by, source)
           values ($1, $2, $3::date, $4, $5, $6, $7, $8::public.adjustment_source)`,
          [id, resortId, a.date, a.amount, a.reason, rev, w.manager, a.source],
        );
      if (o.cancel)
        await q(
          `update public.bookings set status = $2::public.booking_status, cancellation_reason = $3, cancellation_date = $4::date,
                  cancellation_charge_paise = $5, charge_change_reason = $6, cancelled_at = now(), cancelled_by = $7
            where id = $1`,
          [
            id,
            o.cancel.status,
            o.cancel.reason ?? "Guest unwell",
            o.cancel.date,
            o.cancel.charge,
            o.cancel.chargeChangeReason ?? null,
            w.owner,
          ],
        );
    });
    return { id, code, resortId, final };
  }

  let seq = 0;
  async function money(
    b: RawBooking,
    kind: "payments" | "refunds",
    status: Status,
    amount: number,
    date: string,
    o: {
      method?: "cash" | "upi" | "card" | "cheque" | "other";
      provider?: string; // provider name, e.g. "PhonePe"
      recordedAt?: string; // "2026-03-31 23:50:00+05:30"
      reason?: string;
    } = {},
  ): Promise<string> {
    const id = uid();
    const isPay = kind === "payments";
    const method = o.method ?? "cash";
    let providerId: number | null = null;
    if (o.provider) {
      const rows = (await q(
        `select id from public.payment_providers where method = $1::public.payment_method and name = $2`,
        [method, o.provider],
      )) as { id: number }[];
      providerId = rows[0].id;
    }
    const cols = [
      "id",
      isPay ? "payment_code" : "refund_code",
      "booking_id",
      "resort_id",
      "amount_paise",
      "method",
      "provider_id",
      isPay ? "payment_date" : "refund_date",
      "status",
      "recorded_by",
      "recorded_at",
      "idempotency_key",
    ];
    const vals = [
      `'${id}'`,
      `'${b.code}-${isPay ? "P" : "R"}${++seq}'`,
      `'${b.id}'`,
      `'${b.resortId}'`,
      String(amount),
      `'${method}'`,
      providerId === null ? "null" : String(providerId),
      `'${date}'::date`,
      `'${status}'`,
      `'${w.manager}'`,
      `'${o.recordedAt ?? `${date} 12:00:00+05:30`}'::timestamptz`,
      `'${uid()}'`,
    ];
    const add = (c: string, v: string) => (cols.push(c), vals.push(v));
    if (!isPay)
      add(
        "reason",
        `'${(o.reason ?? "Guest left early").replace(/'/g, "''")}'`,
      );
    if (status === "approved" || status === "reversed") {
      add("approved_by", `'${w.owner}'`);
      add("approved_at", "now()");
    }
    if (status === "rejected") {
      add("rejected_by", `'${w.owner}'`);
      add("rejected_at", "now()");
      add("rejection_reason", "'wrong booking'");
    }
    if (status === "reversed") {
      add("reversed_by", `'${w.owner}'`);
      add("reversed_at", "now()");
      add("reversal_reason", "'entered twice'");
    }
    await raw(() =>
      q(
        `insert into public.${kind} (${cols.join(",")}) values (${vals.join(",")})`,
      ),
    );
    return id;
  }

  /** an extra dated adjustment on an existing booking (for the "past months never change" checks) */
  async function adjustment(
    b: RawBooking,
    date: string,
    amount: number,
    reason: string,
    source: NonNullable<BookingOpts["adjustments"]>[number]["source"],
  ) {
    await raw(async () => {
      const [rev] = (await q(
        `select id from public.payment_plan_revisions where booking_id = $1 order by revision_no limit 1`,
        [b.id],
      )) as { id: string }[];
      await q(
        `insert into public.expected_adjustments (booking_id, resort_id, adjustment_date, amount_paise, reason, revision_id, created_by, source)
         values ($1, $2, $3::date, $4, $5, $6, $7, $8::public.adjustment_source)`,
        [b.id, b.resortId, date, amount, reason, rev.id, w.manager, source],
      );
    });
  }

  return { booking, money, adjustment, raw };
}
