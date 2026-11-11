/**
 * FICTIONAL test data only (decided 2026-11-11). Every name, e-mail address and
 * amount below is made up. Emails use the reserved ".example" domain.
 * All of it lives in an in-memory database that is thrown away after the test run.
 */
import { randomUUID } from "node:crypto";
import { createDb, type TestDb } from "./harness";

export const uid = () => randomUUID();

export interface World {
  db: TestDb;
  owner: string;
  manager: string;
  manager2: string;
  resorts: { A: { id: string; code: string }; B: { id: string; code: string } };
  guestId: string;
  stayTypeId: number;
  /** ids of the four STARTING categories seeded by migration 17 */
  cat: { agent: number; partner: number; own: number; direct: number };
  /** a name in the Agent list and one in the Partner list */
  agentId: string;
  partnerId: string;
  seq: Map<string, number>;
}

export async function setupWorld(): Promise<World> {
  const db = await createDb();
  const owner = uid();
  const manager = uid();
  const manager2 = uid();

  // The very first account is created with no session user (the one-time script path).
  await db.exec(
    `insert into auth.users (id, email) values ('${owner}', 'owner@test.example')`,
  );
  await db.q(
    `insert into public.user_profiles (id, full_name, email, role) values ($1, 'Test Owner', 'owner@test.example', 'owner')`,
    [owner],
  );
  // Everyone else is created by the logged-in Owner.
  await db.as({ role: "postgres", uid: owner }, async () => {
    for (const [id, name, email] of [
      [manager, "Test Manager One", "manager1@test.example"],
      [manager2, "Test Manager Two", "manager2@test.example"],
    ]) {
      await db.q(`insert into auth.users (id, email) values ($1, $2)`, [
        id,
        email,
      ]);
      await db.q(
        `insert into public.user_profiles (id, full_name, email, role) values ($1, $2, $3, 'manager')`,
        [id, name, email],
      );
    }
  });

  const resorts = {
    A: { id: uid(), code: "AAA" },
    B: { id: uid(), code: "BBB" },
  };
  const guestId = uid();
  const agentId = uid();
  const partnerId = uid();
  const catRows = await db.q<{ id: number; name: string }>(
    `select id, name from public.co_categories`,
  );
  const catId = (n: string) => catRows.find((c) => c.name === n)!.id;
  const cat = {
    agent: catId("Agent"),
    partner: catId("Partner"),
    own: catId("Own"),
    direct: catId("Direct"),
  };
  await db.as({ role: "postgres", uid: owner }, async () => {
    await db.q(
      `insert into public.resorts (id, code, name) values ($1, 'AAA', 'Test Resort Alpha'), ($2, 'BBB', 'Test Resort Beta')`,
      [resorts.A.id, resorts.B.id],
    );
    await db.q(
      `insert into public.guests (id, full_name, mobile) values ($1, 'Test Guest', '+91 98765 43210')`,
      [guestId],
    );
    await db.q(
      `insert into public.co_entries (id, category_id, name) values ($1, $3, 'Test Agent'), ($2, $4, 'Test Partner')`,
      [agentId, partnerId, cat.agent, cat.partner],
    );
  });
  const [{ id: stayTypeId }] = await db.q<{ id: number }>(
    `select id from public.stay_types where name = 'Resort Stay'`,
  );

  return {
    db,
    owner,
    manager,
    manager2,
    resorts,
    guestId,
    stayTypeId,
    cat,
    agentId,
    partnerId,
    seq: new Map(),
  };
}

/** A date relative to today (India), as 'YYYY-MM-DD'. */
export async function dateOffset(db: TestDb, days: number): Promise<string> {
  const [{ d }] = await db.q<{ d: string }>(
    `select (public.today_ist() + $1::int)::text as d`,
    [days],
  );
  return d;
}

export interface PlanRow {
  label: string;
  dueOffset: number; // days from today
  amount: number; // paise
}

export interface BookingSpec {
  resort?: "A" | "B";
  actor?: string;
  pax?: number;
  tariff?: number; // paise per person
  nights?: number;
  method?: "per_person_per_night" | "per_person_per_stay";
  extra?: number;
  discount?: number;
  adjustment?: number;
  adjustmentReason?: string | null;
  co?: {
    category: "agent" | "partner" | "own" | "direct";
    partnerId?: string | null;
    name?: string | null;
  };
  bookingDateOffset?: number;
  checkInOffset?: number;
  /** 'auto' = one "Balance" row for the whole final amount, due at check-in. */
  plan?: PlanRow[] | "auto" | "none";
}

export interface Booking {
  id: string;
  code: string;
  resortId: string;
  final: number;
  revisionId: string;
}

export async function createBooking(
  w: World,
  spec: BookingSpec = {},
): Promise<Booking> {
  const { db } = w;
  const resort = w.resorts[spec.resort ?? "A"];
  const pax = spec.pax ?? 2;
  const tariff = spec.tariff ?? 250000;
  const method = spec.method ?? "per_person_per_stay";
  const nights = spec.nights ?? 1;
  const extra = spec.extra ?? 0;
  const discount = spec.discount ?? 0;
  const adjustment = spec.adjustment ?? 0;
  const base =
    method === "per_person_per_night" ? pax * tariff * nights : pax * tariff;
  const final = base + extra - discount + adjustment;

  const bookingDate = await dateOffset(db, spec.bookingDateOffset ?? 0);
  const checkInDate = await dateOffset(db, spec.checkInOffset ?? 2);
  const checkOutDate = await dateOffset(db, (spec.checkInOffset ?? 2) + nights);
  const year = Number(bookingDate.slice(0, 4));
  const key = `${resort.code}-${year}`;
  const seq = (w.seq.get(key) ?? 0) + 1;
  w.seq.set(key, seq);
  const code = `${resort.code}-${year}-${String(seq).padStart(6, "0")}`;

  const co = spec.co ?? { category: "direct" };
  const bookingId = uid();
  const revisionId = uid();
  const plan: PlanRow[] =
    spec.plan === "none"
      ? []
      : Array.isArray(spec.plan)
        ? spec.plan
        : final > 0
          ? [
              {
                label: "Balance",
                dueOffset: spec.checkInOffset ?? 2,
                amount: final,
              },
            ]
          : [];

  await db.tx({ role: "postgres", uid: spec.actor ?? w.owner }, async () => {
    await db.q(
      `insert into public.bookings
         (id, booking_code, resort_id, booking_year, booking_seq, guest_id, guest_name, guest_mobile, pax,
          co_category_id, co_entry_id, co_name, stay_type_id, booking_date, check_in_at, check_out_at, nights,
          pricing_method, tariff_per_person_paise, base_amount_paise, extra_charges_paise, discount_paise,
          manual_adjustment_paise, manual_adjustment_reason, idempotency_key)
       values ($1,$2,$3,$4,$5,$6,'Test Guest','9876543210',$7,
               $8,$9,$10,$11,$12::date,
               ($13::text || ' 14:00:00+05:30')::timestamptz,
               ($14::text || case when $15::int = 0 then ' 18:00:00+05:30' else ' 11:00:00+05:30' end)::timestamptz,
               $15, $16::public.pricing_method,$17,$18,$19,$20,$21,$22,$23)`,
      [
        bookingId,
        code,
        resort.id,
        year,
        seq,
        w.guestId,
        pax,
        w.cat[co.category],
        co.partnerId ?? null,
        co.name ?? null,
        w.stayTypeId,
        bookingDate,
        checkInDate,
        checkOutDate,
        nights,
        method,
        tariff,
        base,
        extra,
        discount,
        adjustment,
        spec.adjustmentReason ?? null,
        uid(),
      ],
    );
    await db.q(
      `insert into public.payment_plan_revisions (id, booking_id, revision_no, source, amount_due_before, amount_due_after, locked_total_paise)
       values ($1, $2, 1, 'created', null, $3, 0)`,
      [revisionId, bookingId, final],
    );
    let line = 1;
    for (const row of plan) {
      await db.q(
        `insert into public.payment_schedules (booking_id, revision_id, line_no, label, due_date, amount_paise)
         values ($1, $2, $3, $4, (public.today_ist() + $5::int), $6)`,
        [bookingId, revisionId, line++, row.label, row.dueOffset, row.amount],
      );
    }
  });
  return { id: bookingId, code, resortId: resort.id, final, revisionId };
}

/** A payment recorded the normal way (as a logged-in user). Returns its id. */
export async function addPayment(
  w: World,
  booking: Booking,
  o: {
    actor?: string;
    amount?: number;
    method?: string;
    dateOffset?: number;
    withProof?: boolean;
    providerId?: number | null;
  } = {},
): Promise<string> {
  const id = uid();
  const method = o.method ?? "cash";
  await w.db.tx({ role: "postgres", uid: o.actor ?? w.owner }, async () => {
    await w.db.q(
      `insert into public.payments (id, booking_id, amount_paise, method, provider_id, payment_date, reference_number, idempotency_key)
       values ($1, $2, $3, $4::public.payment_method, $5, public.today_ist() + $6::int, $8, $7)`,
      [
        id,
        booking.id,
        o.amount ?? 100000,
        method,
        o.providerId ?? null,
        o.dateOffset ?? 0,
        uid(),
        `REF-${id.slice(0, 8)}`,
      ],
    );
    if (
      o.withProof ??
      (method === "upi" || method === "card" || method === "cheque")
    ) {
      await addProof(w, { paymentId: id, bookingId: booking.id });
    }
  });
  return id;
}

let proofCounter = 0;
export async function addProof(
  w: World,
  o: { paymentId?: string; refundId?: string; bookingId: string },
): Promise<string> {
  const id = uid();
  const hex = (proofCounter++).toString(16).padStart(64, "0");
  const prefix = o.refundId ? "refunds/" : "";
  await w.db.q(
    `insert into public.proofs (id, payment_id, refund_id, storage_path, original_file_name, mime_type, size_bytes, sha256, uploaded_by)
     values ($1, $2, $3, $4, 'screenshot.jpg', 'image/jpeg', 12345, $5, $6)`,
    [
      id,
      o.paymentId ?? null,
      o.refundId ?? null,
      `${prefix}${o.bookingId}/${uid()}.jpg`,
      hex,
      w.owner,
    ],
  );
  return id;
}

export async function addRefund(
  w: World,
  booking: Booking,
  o: { actor?: string; amount?: number; method?: string } = {},
): Promise<string> {
  const id = uid();
  const method = o.method ?? "cash";
  await w.db.tx({ role: "postgres", uid: o.actor ?? w.owner }, async () => {
    await w.db.q(
      `insert into public.refunds (id, booking_id, amount_paise, method, refund_date, reason, idempotency_key)
       values ($1, $2, $3, $4::public.payment_method, public.today_ist(), 'Test refund', $5)`,
      [id, booking.id, o.amount ?? 50000, method, uid()],
    );
    if (method === "upi" || method === "card" || method === "cheque") {
      await addProof(w, { refundId: id, bookingId: booking.id });
    }
  });
  return id;
}

export async function setStatus(
  w: World,
  table: "payments" | "refunds",
  id: string,
  status: "approved" | "rejected" | "reversed",
  actor: string,
  reason?: string,
): Promise<void> {
  const col =
    status === "rejected"
      ? "rejection_reason"
      : status === "reversed"
        ? "reversal_reason"
        : null;
  await w.db.tx({ role: "postgres", uid: actor }, async () => {
    await w.db.q(
      `update public.${table} set status = $2::public.approval_status${col ? `, ${col} = $3` : ""} where id = $1`,
      col ? [id, status, reason ?? "test reason"] : [id, status],
    );
  });
}

/** Cancel in one transaction: booking update + a new plan revision (+ optional adjustment). */
export async function cancelBooking(
  w: World,
  b: Booking,
  o: {
    status?: "cancelled" | "no_show";
    charge: number;
    reason?: string | null;
    chargeReason?: string | null;
    date?: string;
    actor?: string;
    newRows?: Array<{ dueOffset: number; amount: number }>;
    adjustment?: number; // negative
    supersedeFuture?: boolean;
    lockedPast?: number; // sum of already past-due active rows
  },
) {
  const actor = o.actor ?? w.owner;
  await w.db.tx({ role: "postgres", uid: actor }, async () => {
    await w.db.q(
      `update public.bookings set status = $2::public.booking_status, cancellation_charge_paise = $3, cancellation_reason = $4,
         cancellation_date = $5::date, charge_change_reason = $6 where id = $1`,
      [
        b.id,
        o.status ?? "cancelled",
        o.charge,
        o.reason === undefined ? "Guest cancelled" : o.reason,
        o.date ?? (await dateOffset(w.db, 0)),
        o.chargeReason ?? null,
      ],
    );
    const revId = uid();
    await w.db.q(
      `insert into public.payment_plan_revisions (id, booking_id, revision_no, source, reason, amount_due_before, amount_due_after, locked_total_paise)
       values ($1, $2, (select max(revision_no) + 1 from public.payment_plan_revisions where booking_id = $2), $3, 'Guest cancelled', $4, $5, $6)`,
      [
        revId,
        b.id,
        o.status === "no_show" ? "no_show" : "cancellation",
        b.final,
        o.charge,
        o.lockedPast ?? 0,
      ],
    );
    if (o.supersedeFuture !== false) {
      await w.db.q(
        `update public.payment_schedules set superseded_revision_id = $2 where booking_id = $1 and superseded_at is null and due_date >= public.today_ist()`,
        [b.id, revId],
      ); // (superseded_at is set by the guard)
    }
    let line = 10;
    for (const r of o.newRows ?? []) {
      await w.db.q(
        `insert into public.payment_schedules (booking_id, revision_id, kind, line_no, label, due_date, amount_paise)
         values ($1, $2, 'cancellation', $3, 'Cancellation charge', public.today_ist() + $4::int, $5)`,
        [b.id, revId, line++, r.dueOffset, r.amount],
      );
    }
    if (o.adjustment) {
      await w.db.q(
        `insert into public.expected_adjustments (booking_id, revision_id, adjustment_date, amount_paise, source, reason)
         values ($1, $2, public.today_ist(), $3, $4::public.adjustment_source, 'Guest cancelled')`,
        [
          b.id,
          revId,
          o.adjustment,
          o.status === "no_show" ? "no_show" : "cancellation",
        ],
      );
    }
  });
}

/**
 * The server's step after a verified password (migration 19): a 60-second, single-use grant for ONE protected action on
 * ONE account and ONE exact operation, bound to the acting Owner. Only the service role may issue it.
 * `detail` is the operation: 'true'/'false' (set_active), 'owner'/'manager' (change_role), the lower-cased email
 * (change_email, add_owner), null (reset_password). When omitted the common case is used: set_active -> 'false',
 * change_role -> 'owner', reset_password -> null, add_owner -> the login's own email; change_email must say.
 * Returns the id of the grant that was recorded (found afterwards: the database itself returns nothing).
 */
export async function reauth(
  db: TestDb,
  actor: string,
  action:
    | "add_owner"
    | "change_role"
    | "set_active"
    | "reset_password"
    | "change_email",
  target: string,
  detail?: string | null,
): Promise<string> {
  let d = detail;
  if (d === undefined) {
    if (action === "set_active") d = "false";
    else if (action === "change_role") d = "owner";
    else if (action === "reset_password") d = null;
    else if (action === "add_owner")
      d =
        (
          await db.q<{ e: string }>(
            `select lower(email) e from auth.users where id = $1`,
            [target],
          )
        )[0]?.e ?? null;
    else throw new Error("change_email needs the new email");
  }
  await db.as({ role: "service_role" }, () =>
    db.q(`select public.issue_reauth($1, $2, $3, $4)`, [
      actor,
      action,
      target,
      d,
    ]),
  );
  const r = await db.q<{ id: string }>(
    `select id from public.reauth_grants where user_id = $1 and action = $2 and target_id = $3 order by created_at desc, id limit 1`,
    [actor, action, target],
  );
  return r[0].id;
}
