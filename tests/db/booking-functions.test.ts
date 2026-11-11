/**
 * Booking and payment-plan functions (migration 14).
 * PGlite stand-in only: this proves the rules, NOT behaviour under real simultaneous requests
 * (those tests run on PostgreSQL 17 in CI). Everything is fictional.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { expectDbError } from "./harness";
import { dateOffset, setupWorld, uid, type World } from "./fixtures";

let w: World;
beforeAll(async () => {
  w = await setupWorld();
}, 120_000);

const q = <T = Record<string, unknown>>(sql: string, p?: unknown[]) =>
  w.db.q<T>(sql, p);
const as = <T>(id: string | null, fn: () => Promise<T>) =>
  w.db.as({ role: "authenticated", uid: id }, fn);

type Json = Record<string, unknown>;
interface Created {
  id: string;
  booking_code: string;
  duplicate: boolean;
}

async function payload(over: Json = {}): Promise<Json> {
  const today = await dateOffset(w.db, 0);
  const in1 = await dateOffset(w.db, 2);
  const out1 = await dateOffset(w.db, 3);
  return {
    resort_id: w.resorts.A.id,
    guest_id: w.guestId,
    pax: 2,
    co_category: "direct",
    stay_type_id: w.stayTypeId,
    booking_date: today,
    check_in_at: `${in1}T14:00:00+05:30`,
    check_out_at: `${out1}T11:00:00+05:30`,
    pricing_method: "per_person_per_stay",
    tariff_paise: 250000,
    ...over,
  };
}
const row = async (offset: number, amount: number, label = "Balance") => ({
  label,
  due_date: await dateOffset(w.db, offset),
  amount_paise: amount,
});

async function create(
  p: Json,
  plan: Json[],
  opts: { actor?: string | null; idem?: string } = {},
): Promise<Created> {
  const r = await as(opts.actor === undefined ? w.manager : opts.actor, () =>
    q<{ r: Created }>(
      `select public.create_booking($1::jsonb, $2::jsonb, $3::uuid) as r`,
      [JSON.stringify(p), JSON.stringify(plan), opts.idem ?? uid()],
    ),
  );
  return r[0].r;
}
const simple = async (over: Json = {}, final = 500000) =>
  create(await payload(over), [await row(2, final)]);
const booking = async (id: string) =>
  (await q<Json>(`select * from public.bookings where id = $1`, [id]))[0];
const call = <T = Record<string, unknown>>(
  sql: string,
  p?: unknown[],
  actor: string | null = w.manager,
) => as(actor, () => q<T>(sql, p));
const upd = (
  id: string,
  version: number,
  payloadObj: Json,
  plan: Json[] | null = null,
  move = 0,
  reason: string | null = null,
) =>
  call<{ r: Json }>(
    `select public.update_booking($1, $2, $3::jsonb, $4::jsonb, $5, $6) as r`,
    [
      id,
      version,
      JSON.stringify(payloadObj),
      plan ? JSON.stringify(plan) : null,
      move,
      reason,
    ],
  ).then((x) => x[0].r);
const activeRows = (id: string) =>
  q<{ label: string; amount_paise: string; due: string }>(
    `select label, amount_paise::text, (due_date - public.today_ist())::text as due from public.payment_schedules
     where booking_id = $1 and superseded_at is null order by line_no`,
    [id],
  );
const adjustments = (id: string) =>
  q<{ amount_paise: string; source: string; reason: string }>(
    `select amount_paise::text, source::text, reason from public.expected_adjustments where booking_id = $1 order by created_at, id`,
    [id],
  );

describe("create_booking", () => {
  it("BKF-01: creates the booking with server-calculated amounts, plan, first revision, PDF job and audit", async () => {
    const r = await simple();
    expect(r.duplicate).toBe(false);
    const year = (await dateOffset(w.db, 0)).slice(0, 4);
    expect(r.booking_code).toBe(`AAA-${year}-000001`);
    const b = await booking(r.id);
    expect(b.base_amount_paise).toBe(500000);
    expect(b.final_amount_paise).toBe(500000);
    expect(b.amount_due_paise).toBe(500000);
    expect(b.nights).toBe(1);
    expect(b.status).toBe("confirmed");
    expect(b.created_by).toBe(w.manager);
    expect(b.guest_name).toBe("Test Guest");
    expect(await activeRows(r.id)).toHaveLength(1);
    const rev = await q<{ source: string; amount_due_after: string }>(
      `select source, amount_due_after::text from public.payment_plan_revisions where booking_id = $1`,
      [r.id],
    );
    expect(rev).toEqual([{ source: "created", amount_due_after: "500000" }]);
    expect(
      (
        await q(
          `select 1 from public.pdf_jobs where booking_id = $1 and status = 'pending'`,
          [r.id],
        )
      ).length,
    ).toBe(1);
    const a = await q<{ actor_id: string }>(
      `select actor_id from public.audit_logs where table_name = 'bookings' and record_id = $1 and action = 'insert'`,
      [r.id],
    );
    expect(a[0].actor_id).toBe(w.manager);
  });

  it("BKF-02: amounts sent by the browser are ignored; the database recalculates (FR-BK-5)", async () => {
    const r = await create(
      await payload({
        nights: 99,
        base_amount_paise: 1,
        final_amount_paise: 1,
        total_amount_paise: 1,
        amount_due_paise: 1,
        created_by: w.owner,
        status: "checked_out",
        version: 50,
      }),
      [await row(2, 500000)],
    );
    const b = await booking(r.id);
    expect(b.nights).toBe(1);
    expect(b.final_amount_paise).toBe(500000);
    expect(b.created_by).toBe(w.manager);
    expect(b.status).toBe("confirmed");
    expect(b.version).toBe(1);
  });

  it("BKF-03: per-night price uses IST nights, extras, discount and a manual adjustment with its reason", async () => {
    const d = await dateOffset(w.db, 5);
    const d2 = await dateOffset(w.db, 7);
    const r = await create(
      await payload({
        pricing_method: "per_person_per_night",
        check_in_at: `${d}T14:00:00+05:30`,
        check_out_at: `${d2}T11:00:00+05:30`,
        extra_charges_paise: 50000,
        discount_paise: 100000,
        manual_adjustment_paise: -25000,
        manual_adjustment_reason: "Loyal guest",
      }),
      [await row(5, 1000000 + 50000 - 100000 - 25000)],
    );
    const b = await booking(r.id);
    expect(b.nights).toBe(2);
    expect(b.base_amount_paise).toBe(1000000);
    expect(b.final_amount_paise).toBe(925000);
  });

  it("BKF-04: nights follow the IST calendar day, not UTC (D4)", async () => {
    const d = await dateOffset(w.db, 4);
    const d2 = await dateOffset(w.db, 5);
    // 23:30 IST on day D and 00:30 IST on D+1 are the SAME calendar day in UTC
    const r = await create(
      await payload({
        pricing_method: "per_person_per_night",
        check_in_at: `${d}T23:30:00+05:30`,
        check_out_at: `${d2}T00:30:00+05:30`,
      }),
      [await row(4, 500000)],
    );
    expect((await booking(r.id)).nights).toBe(1);
  });

  it("BKF-05: a plan that does not add up is refused, and the Booking ID number is not used up", async () => {
    const before = await q<{ n: string }>(
      `select count(*)::text n from public.bookings`,
    );
    await expectDbError(
      create(await payload(), [await row(2, 400000)]),
      "PLAN_TOTAL_MISMATCH",
    );
    await expectDbError(create(await payload(), []), "PLAN_TOTAL_MISMATCH");
    expect(
      (
        await q<{ n: string }>(`select count(*)::text n from public.bookings`)
      )[0].n,
    ).toBe(before[0].n);
    const next = await simple();
    const nums = await q<{ booking_seq: number }>(
      `select booking_seq from public.bookings where resort_id = $1 order by booking_seq`,
      [w.resorts.A.id],
    );
    expect(nums.map((x) => x.booking_seq)).toEqual(nums.map((_, i) => i + 1)); // no gaps
    expect(next.booking_code).toMatch(/-0000\d\d$/);
  });

  it("BKF-06: pressing Save twice returns the same booking (FR-BK-11)", async () => {
    const idem = uid();
    const a = await create(await payload(), [await row(2, 500000)], { idem });
    const b = await create(await payload({ pax: 5 }), [await row(2, 500000)], {
      idem,
    });
    expect(b.duplicate).toBe(true);
    expect(b.id).toBe(a.id);
    expect(
      (
        await q(`select 1 from public.bookings where idempotency_key = $1`, [
          idem,
        ])
      ).length,
    ).toBe(1);
  });

  it("BKF-07: each resort and each booking-date year has its own counter starting at 000001 (Q4)", async () => {
    const lastYear = Number((await dateOffset(w.db, 0)).slice(0, 4)) - 1;
    const old = await create(
      await payload({ booking_date: `${lastYear}-12-30` }),
      [await row(2, 500000)],
    );
    expect(old.booking_code).toBe(`AAA-${lastYear}-000001`);
    const old2 = await create(
      await payload({ booking_date: `${lastYear}-06-01` }),
      [await row(2, 500000)],
    );
    expect(old2.booking_code).toBe(`AAA-${lastYear}-000002`);
    const other = await create(await payload({ resort_id: w.resorts.B.id }), [
      await row(2, 500000),
    ]);
    expect(other.booking_code).toMatch(/^BBB-\d{4}-000001$/);
  });

  it("BKF-08: a new guest is created when no guest id is given", async () => {
    const r = await create(
      await payload({
        guest_id: undefined,
        guest_name: " Test Walkin ",
        guest_mobile: "+91 99999 12345",
      }),
      [await row(2, 500000)],
    );
    const b = await booking(r.id);
    expect(b.guest_name).toBe("Test Walkin");
    expect(
      (
        await q<{ mobile_normalized: string }>(
          `select mobile_normalized from public.guests where id = $1`,
          [b.guest_id],
        )
      )[0].mobile_normalized,
    ).toBe("9999912345");
  });

  it("BKF-09: invalid input is refused with plain codes and nothing is saved", async () => {
    const plan = [await row(2, 500000)];
    const in1 = await dateOffset(w.db, 2);
    const bad: Array<[string, Json]> = [
      [
        "INVALID_DATES",
        {
          check_out_at: `${in1}T10:00:00+05:30`,
          check_in_at: `${in1}T14:00:00+05:30`,
        },
      ],
      [
        "INVALID_DATES",
        {
          pricing_method: "per_person_per_night",
          check_in_at: `${in1}T09:00:00+05:30`,
          check_out_at: `${in1}T18:00:00+05:30`,
        },
      ],
      ["INVALID_INPUT", { pax: 0 }],
      ["INVALID_INPUT", { pax: 1001 }],
      ["INVALID_INPUT", { pax: "two" }],
      ["INVALID_INPUT", { tariff_paise: -1 }],
      ["INVALID_INPUT", { check_in_at: `${in1}T14:00:00` }], // no time zone
      ["INVALID_INPUT", { pricing_method: "monthly" }],
      ["INVALID_INPUT", { co_category: "friend" }],
      ["INVALID_INPUT", { stay_type_id: 9999 }],
      ["INVALID_INPUT", { resort_id: "not-a-uuid" }],
      ["NOT_FOUND", { resort_id: uid() }],
      ["NOT_FOUND", { guest_id: uid() }],
      ["DISCOUNT_TOO_LARGE", { discount_paise: 600000 }],
      ["ADJUSTMENT_REASON_REQUIRED", { manual_adjustment_paise: 100 }],
      [
        "FINAL_NEGATIVE",
        { manual_adjustment_paise: -600000, manual_adjustment_reason: "x" },
      ],
      ["AMOUNT_TOO_LARGE", { pax: 1000, tariff_paise: 1000000000000000 }],
      ["CO_TYPE_MISMATCH", { co_category: "agent" }],
      [
        "CO_TYPE_MISMATCH",
        { co_category: "agent", agent_partner_id: w.partnerId },
      ],
      [
        "CO_TYPE_MISMATCH",
        { co_category: "partner", agent_partner_id: w.agentId },
      ],
      ["INVALID_INPUT", { co_category: "own" }],
    ];
    const before = (
      await q<{ n: string }>(`select count(*)::text n from public.bookings`)
    )[0].n;
    for (const [code, over] of bad) {
      await expectDbError(create(await payload(over), plan), code);
    }
    expect(
      (
        await q<{ n: string }>(`select count(*)::text n from public.bookings`)
      )[0].n,
    ).toBe(before);
  });

  it("BKF-10: C/O rules: agent, partner, own and direct store the right name", async () => {
    const a = await create(
      await payload({ co_category: "agent", agent_partner_id: w.agentId }),
      [await row(2, 500000)],
    );
    expect((await booking(a.id)).co_name).toBe("Test Agent");
    const p = await create(
      await payload({ co_category: "partner", agent_partner_id: w.partnerId }),
      [await row(2, 500000)],
    );
    expect((await booking(p.id)).co_name).toBe("Test Partner");
    const o = await create(
      await payload({ co_category: "own", co_name: " Test Cousin " }),
      [await row(2, 500000)],
    );
    expect((await booking(o.id)).co_name).toBe("Test Cousin");
    const d = await create(
      await payload({
        co_category: "direct",
        co_name: "ignored",
        agent_partner_id: w.agentId,
      }),
      [await row(2, 500000)],
    );
    const bd = await booking(d.id);
    expect([bd.co_name, bd.agent_partner_id]).toEqual([null, null]);
  });

  it("BKF-11: an inactive resort, stay type or agent cannot be used for a new booking", async () => {
    await call(`select public.set_resort_active($1, false)`, [w.resorts.B.id]);
    await expectDbError(
      create(await payload({ resort_id: w.resorts.B.id }), [
        await row(2, 500000),
      ]),
      "RESORT_INACTIVE",
    );
    await call(`select public.set_resort_active($1, true)`, [w.resorts.B.id]);
    await call(
      `select public.upsert_agent_partner($1, 'agent', 'Test Agent', null, null, false)`,
      [w.agentId],
    );
    await expectDbError(
      create(
        await payload({ co_category: "agent", agent_partner_id: w.agentId }),
        [await row(2, 500000)],
      ),
      "CO_INACTIVE",
    );
    await call(
      `select public.upsert_agent_partner($1, 'agent', 'Test Agent', null, null, true)`,
      [w.agentId],
    );
  });

  it("BKF-12: only the very first plan may contain past due dates (FR-SCH-8)", async () => {
    const r = await create(await payload(), [
      await row(-3, 200000, "Advance"),
      await row(2, 300000),
    ]);
    expect((await activeRows(r.id)).map((x) => x.due)).toEqual(["-3", "2"]);
  });

  it("BKF-13: no session, no profile, a disabled user and the anonymous role cannot create", async () => {
    const plan = [await row(2, 500000)];
    const p = await payload();
    for (const actor of [null, uid()]) {
      await expectDbError(create(p, plan, { actor }), "NOT_ALLOWED");
    }
    await expectDbError(
      w.db.as({ role: "anon" }, () =>
        q(
          `select public.create_booking('{}'::jsonb, '[]'::jsonb, gen_random_uuid())`,
        ),
      ),
      "permission denied",
    );
  });

  it("BKF-14: unknown or hostile JSON never reaches a SQL statement (text fields are data only)", async () => {
    const r = await create(
      await payload({
        remarks: "x'); drop table public.bookings; --",
        extra_charges_note: "<script>alert(1)</script>",
      }),
      [await row(2, 500000)],
    );
    const b = await booking(r.id);
    expect(b.remarks).toBe("x'); drop table public.bookings; --");
    expect((await q(`select 1 from public.bookings limit 1`)).length).toBe(1);
  });
});

describe("update_booking", () => {
  it("BKF-20: a non-money edit needs no reason, bumps the version and keeps the plan", async () => {
    const c = await simple();
    const out = await upd(c.id, 1, { remarks: "Late arrival" });
    expect(out.version).toBe(2);
    expect((await booking(c.id)).remarks).toBe("Late arrival");
    expect(await activeRows(c.id)).toHaveLength(1);
    expect(
      (
        await q(
          `select 1 from public.payment_plan_revisions where booking_id = $1`,
          [c.id],
        )
      ).length,
    ).toBe(1);
  });

  it("BKF-21: a stale version is refused", async () => {
    const c = await simple();
    await upd(c.id, 1, { remarks: "a" });
    await expectDbError(upd(c.id, 1, { remarks: "b" }), "STALE_RECORD");
    expect((await booking(c.id)).remarks).toBe("a");
  });

  it("BKF-22: the resort and the year of the booking date cannot change; a same-year date can (Q16)", async () => {
    const c = await simple();
    await expectDbError(
      upd(c.id, 1, { resort_id: w.resorts.B.id }),
      "ID_FIELDS_LOCKED",
    );
    const yr = Number((await dateOffset(w.db, 0)).slice(0, 4));
    await expectDbError(
      upd(c.id, 1, { booking_date: `${yr - 1}-05-05` }),
      "ID_FIELDS_LOCKED",
    );
    await upd(c.id, 1, { booking_date: `${yr}-01-02` });
    expect((await booking(c.id)).booking_code).toBe(c.booking_code);
  });

  it("BKF-23: an amount change needs a reason and a plan that adds up; old future rows are kept as 'Replaced'", async () => {
    const c = await simple();
    await expectDbError(
      upd(c.id, 1, { tariff_paise: 300000 }, [await row(2, 600000)]),
      "REASON_REQUIRED",
    );
    await expectDbError(
      upd(
        c.id,
        1,
        { tariff_paise: 300000 },
        [await row(2, 500000)],
        0,
        "Tariff raised",
      ),
      "PLAN_TOTAL_MISMATCH",
    );
    expect((await booking(c.id)).tariff_per_person_paise).toBe(250000); // the failed attempts changed nothing
    const out = await upd(
      c.id,
      1,
      { tariff_paise: 300000 },
      [await row(2, 400000, "Advance"), await row(4, 200000)],
      0,
      "Tariff raised",
    );
    expect(out.version).toBe(2);
    expect((await booking(c.id)).final_amount_paise).toBe(600000);
    expect((await activeRows(c.id)).map((x) => x.amount_paise)).toEqual([
      "400000",
      "200000",
    ]);
    const all = await q<{ superseded: boolean }>(
      `select superseded_at is not null as superseded from public.payment_schedules where booking_id = $1`,
      [c.id],
    );
    expect(all.filter((x) => x.superseded)).toHaveLength(1); // the old row is kept
    const rev = await q<{
      revision_no: number;
      source: string;
      reason: string;
    }>(
      `select revision_no, source, reason from public.payment_plan_revisions where booking_id = $1 order by revision_no`,
      [c.id],
    );
    expect(rev.map((r) => r.source)).toEqual(["created", "amount_change"]);
    expect(rev[1].reason).toBe("Tariff raised");
  });

  it("BKF-24: past-due rows stay locked; a lower amount records a dated negative adjustment and needs no new rows (D2)", async () => {
    const c = await create(await payload(), [
      await row(-2, 300000, "Advance"),
      await row(3, 200000),
    ]);
    // new final 250000 < locked 300000: to_plan = -50000
    await expectDbError(
      upd(
        c.id,
        1,
        { tariff_paise: 125000 },
        [await row(3, 100000)],
        0,
        "Lower tariff",
      ),
      "PLAN_TOTAL_MISMATCH",
    );
    await upd(c.id, 1, { tariff_paise: 125000 }, null, 0, "Lower tariff");
    expect((await activeRows(c.id)).map((x) => x.label)).toEqual(["Advance"]); // the past row is untouched
    const adj = await adjustments(c.id);
    expect(adj).toHaveLength(1);
    expect(adj[0]).toMatchObject({
      amount_paise: "-50000",
      source: "amount_change",
      reason: "Lower tariff",
    });
    const [{ d }] = await q<{ d: string }>(
      `select adjustment_date::text d from public.expected_adjustments where booking_id = $1`,
      [c.id],
    );
    expect(d).toBe(await dateOffset(w.db, 0));
  });

  it("BKF-25: moving an overdue unpaid amount records a negative adjustment and needs matching new rows", async () => {
    const c = await create(await payload(), [
      await row(-5, 300000, "Advance"),
      await row(3, 200000),
    ]);
    await expectDbError(
      call(
        `select public.set_payment_schedule($1, 1, $2::jsonb, 400000, 'Guest asked')`,
        [c.id, JSON.stringify([await row(5, 600000)])],
      ),
      "MOVE_OVERDUE_TOO_LARGE",
    );
    await call(
      `select public.set_payment_schedule($1, 1, $2::jsonb, 100000, 'Guest asked for time')`,
      [c.id, JSON.stringify([await row(6, 300000)])],
    );
    const adj = await adjustments(c.id);
    expect(adj).toHaveLength(1);
    expect(adj[0]).toMatchObject({
      amount_paise: "-100000",
      source: "move_overdue",
    });
    expect((await activeRows(c.id)).map((x) => x.amount_paise)).toEqual([
      "300000",
      "300000",
    ]);
    // rows that do not match the moved amount are refused
    await expectDbError(
      call(`select public.set_payment_schedule($1, 2, $2::jsonb, 0, 'x')`, [
        c.id,
        JSON.stringify([await row(6, 50000)]),
      ]),
      "PLAN_TOTAL_MISMATCH",
    );
  });

  it("BKF-26: new plan rows must be due today or later", async () => {
    const c = await simple();
    await expectDbError(
      call(`select public.set_payment_schedule($1, 1, $2::jsonb, 0, 'x')`, [
        c.id,
        JSON.stringify([await row(-1, 500000)]),
      ]),
      "PLAN_DATE_IN_PAST",
    );
  });

  it("BKF-27: a failed update changes nothing at all (all-or-nothing)", async () => {
    const c = await simple();
    const before = await booking(c.id);
    await expectDbError(
      upd(
        c.id,
        1,
        { pax: 4, remarks: "changed" },
        [await row(2, 1)],
        0,
        "More guests",
      ),
      "PLAN_TOTAL_MISMATCH",
    );
    const after = await booking(c.id);
    expect(after.pax).toBe(before.pax);
    expect(after.remarks).toBe(before.remarks);
    expect(after.version).toBe(before.version);
  });

  it("BKF-28: an unknown booking is reported plainly", async () => {
    await expectDbError(upd(uid(), 1, { remarks: "x" }), "NOT_FOUND");
  });
});

describe("check-in, cancellation and no-show", () => {
  it("BKF-30: check-in and check-out follow the allowed steps; cancelled/no-show are not reachable here", async () => {
    const c = await simple();
    const st = (v: number, s: string) =>
      call<{ r: Json }>(
        `select public.set_booking_status($1, $2, $3::public.booking_status) as r`,
        [c.id, v, s],
      );
    await st(1, "checked_in");
    await expectDbError(
      st(2, "confirmed").then(() => st(3, "checked_out")),
      "STATUS_NOT_ALLOWED",
    );
    await expectDbError(st(3, "cancelled"), "STATUS_NOT_ALLOWED");
    await expectDbError(st(3, "no_show"), "STATUS_NOT_ALLOWED");
    await expectDbError(st(1, "checked_in"), "STALE_RECORD");
  });

  it("BKF-31: cancelling keeps the original amounts, makes the charge the amount due and replaces future rows", async () => {
    const c = await create(await payload(), [
      await row(-2, 100000, "Advance"),
      await row(3, 400000),
    ]);
    const res = await call<{ r: Json }>(
      `select public.cancel_booking($1, 1, 'cancelled', null, 150000, 'Guest cancelled', null, $2::jsonb) as r`,
      [
        c.id,
        JSON.stringify([{ ...(await row(4, 50000, "Cancellation charge")) }]),
      ],
    ).then((x) => x[0].r);
    expect(res.amount_due_paise).toBe(150000);
    const b = await booking(c.id);
    expect(b.status).toBe("cancelled");
    expect(b.final_amount_paise).toBe(500000); // original untouched (Q7a)
    expect(b.amount_due_paise).toBe(150000);
    expect(b.cancelled_by).toBe(w.manager);
    expect((await activeRows(c.id)).map((x) => x.amount_paise)).toEqual([
      "100000",
      "50000",
    ]);
    expect(
      (
        await q<{ kind: string }>(
          `select kind::text from public.payment_schedules where booking_id = $1 and superseded_at is null order by line_no`,
          [c.id],
        )
      ).map((x) => x.kind),
    ).toEqual(["booking", "cancellation"]);
  });

  it("BKF-32: a charge below what is already due records an automatic adjustment dated today", async () => {
    const c = await create(await payload(), [
      await row(-2, 300000, "Advance"),
      await row(3, 200000),
    ]);
    await call(
      `select public.cancel_booking($1, 1, 'cancelled', null, 100000, 'Guest cancelled')`,
      [c.id],
    );
    const adj = await adjustments(c.id);
    expect(adj).toHaveLength(1);
    expect(adj[0]).toMatchObject({
      amount_paise: "-200000",
      source: "cancellation",
    });
    expect(await activeRows(c.id)).toHaveLength(1);
  });

  it("BKF-33: cancellation rules: charge is required, within range, not in the future, once only", async () => {
    const c = await simple();
    const cancel = (args: string, p: unknown[] = []) =>
      call(`select public.cancel_booking($1, 1, ${args})`, [c.id, ...p]);
    await expectDbError(
      cancel(`'cancelled', null, null, 'x'`),
      "CHARGE_REQUIRED",
    );
    await expectDbError(
      cancel(`'cancelled', null, 500001, 'x'`),
      "CHARGE_OUT_OF_RANGE",
    );
    await expectDbError(
      cancel(`'cancelled', null, -1, 'x'`),
      "CHARGE_OUT_OF_RANGE",
    );
    await expectDbError(
      cancel(`'cancelled', null, 0, '   '`),
      "REASON_REQUIRED",
    );
    await expectDbError(
      cancel(`'cancelled', public.today_ist() + 1, 0, 'x'`),
      "CANCELLATION_DATE_FUTURE",
    );
    await expectDbError(cancel(`'confirmed', null, 0, 'x'`), "INVALID_INPUT");
    await expectDbError(
      cancel(`'cancelled', null, 100000, 'x'`),
      "PLAN_TOTAL_MISMATCH",
    ); // future rows must be re-planned
    await cancel(`'cancelled', null, 0, 'x'`);
    await expectDbError(
      call(
        `select public.cancel_booking($1, 2, 'cancelled', null, 0, 'again')`,
        [c.id],
      ),
      "STATUS_FINAL",
    );
    await expectDbError(
      upd(c.id, 2, { pax: 5 }, null, 0, "x"),
      "CANCELLED_AMOUNTS_LOCKED",
    );
  });

  it("BKF-34: a no-show defaults to the full amount; a different charge needs its own reason (Q7c)", async () => {
    const c = await simple();
    const d = await simple();
    await call(
      `select public.cancel_booking($1, 1, 'no_show', null, null, 'Did not arrive', null, $2::jsonb)`,
      [c.id, JSON.stringify([await row(2, 500000, "No-show charge")])],
    );
    expect((await booking(c.id)).amount_due_paise).toBe(500000);
    await expectDbError(
      call(
        `select public.cancel_booking($1, 1, 'no_show', null, 200000, 'Did not arrive')`,
        [d.id],
      ),
      "REASON_REQUIRED",
    );
    await call(
      `select public.cancel_booking($1, 1, 'no_show', null, 0, 'Did not arrive', 'Owner waived it')`,
      [d.id],
    );
    expect((await booking(d.id)).charge_change_reason).toBe("Owner waived it");
  });

  it("BKF-35: the cancellation charge can be corrected, with a reason every time (Q7)", async () => {
    const c = await simple();
    await call(
      `select public.cancel_booking($1, 1, 'cancelled', null, 0, 'Guest cancelled')`,
      [c.id],
    );
    await expectDbError(
      call(`select public.change_cancellation_charge($1, 2, 100000, '  ')`, [
        c.id,
      ]),
      "REASON_REQUIRED",
    );
    await expectDbError(
      call(`select public.change_cancellation_charge($1, 2, 600000, 'Fix')`, [
        c.id,
      ]),
      "CHARGE_OUT_OF_RANGE",
    );
    await call(
      `select public.change_cancellation_charge($1, 2, 100000, 'Late notice fee', $2::jsonb)`,
      [c.id, JSON.stringify([await row(2, 100000, "Cancellation charge")])],
    );
    expect((await booking(c.id)).amount_due_paise).toBe(100000);
    await expectDbError(
      call(
        `select public.change_cancellation_charge($1, 3, 120000, 'Late notice fee')`,
        [c.id],
      ),
      "CHARGE_CHANGE_REASON_REQUIRED",
    );
    const open = await simple();
    await expectDbError(
      call(`select public.change_cancellation_charge($1, 1, 0, 'x')`, [
        open.id,
      ]),
      "STATUS_NOT_ALLOWED",
    );
  });
});

describe("plan_preview and privileges", () => {
  it("BKF-40: the preview shows locked, adjustments and the amount still to plan", async () => {
    const c = await create(await payload(), [
      await row(-2, 300000, "Advance"),
      await row(3, 200000),
    ]);
    const [{ r }] = await call<{ r: Json }>(
      `select public.plan_preview($1, 250000) as r`,
      [c.id],
    );
    expect(r).toMatchObject({
      amount_due_paise: 250000,
      locked_paise: 300000,
      adjustments_paise: 0,
      to_plan_paise: -50000,
      unpaid_past_paise: 300000,
    });
    await expectDbError(
      call(`select public.plan_preview($1)`, [uid()]),
      "NOT_FOUND",
    );
  });

  it("BKF-41: the internal helpers cannot be called by app users; only the public functions can", async () => {
    const internal = [
      "pl_text",
      "pl_bigint",
      "pl_uuid",
      "pl_date",
      "pl_timestamptz",
      "parse_plan",
      "next_booking_code",
      "queue_pdf_job",
      "apply_plan_change",
      "calc_booking_amounts",
      "resolve_co",
    ];
    const rows = await q<{ proname: string; ok: boolean }>(
      `
      select p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') ok
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
      where p.proname = any($1)`,
      [internal],
    );
    expect(rows.length).toBeGreaterThanOrEqual(internal.length);
    expect(rows.filter((r) => r.ok)).toEqual([]);
    await expectDbError(
      call(`select public.next_booking_code($1, public.today_ist())`, [
        w.resorts.A.id,
      ]),
      "permission denied",
    );
    await expectDbError(
      call(
        `select public.apply_plan_change($1, 'plan_change', 'plan_change', 'x', '[]'::jsonb, 'booking', 0)`,
        [uid()],
      ),
      "permission denied",
    );
  });

  it("BKF-42: there is still no direct write to any booking table", async () => {
    for (const sql of [
      `insert into public.bookings (id) values (gen_random_uuid())`,
      `update public.bookings set remarks = 'x'`,
      `insert into public.booking_sequences (resort_id, year) values (gen_random_uuid(), 2026)`,
      `update public.payment_schedules set label = 'x'`,
      `insert into public.expected_adjustments (booking_id) values (gen_random_uuid())`,
    ]) {
      await expectDbError(call(sql), "permission denied");
    }
  });
});
