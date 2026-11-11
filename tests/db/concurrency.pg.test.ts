/**
 * CONCURRENCY tests: many real connections acting at the same moment.
 * They need a real PostgreSQL server, so they run ONLY when STATEADV_PG_URL is set
 * (PostgreSQL 17 service container in CI, or a throw-away local server). PGlite has one connection and
 * skips them. Fictional data only; each test file gets its own scratch database.
 *
 * What each test proves is stated in its name; the IDs match TEST_PLAN (BID-02/03, OWN-06, REF-04, APR-05).
 */
import { randomBytes } from "node:crypto";
import pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { dateOffset, setupWorld, uid, type World } from "./fixtures";

const REAL = Boolean(process.env.STATEADV_PG_URL);
let w: World;
beforeAll(async () => {
  if (REAL) w = await setupWorld();
}, 120_000);

// Test helper: rows and JSON results are inspected loosely on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const j = (x: unknown) => JSON.stringify(x);

/** One independent database connection, logged in as `userId` (like one browser request). */
async function connect(userId: string) {
  const c = new pg.Client({ connectionString: w.db.url });
  await c.connect();
  await c.query(
    `select set_config('request.jwt.claim.sub', '${userId}', false); set role authenticated`,
  );
  return c;
}

/** Run all jobs at once, each on its own connection; report success or error message for each. */
async function parallel<T>(
  userIds: string[],
  job: (c: pg.Client, i: number) => Promise<T>,
) {
  const clients = await Promise.all(userIds.map((u) => connect(u)));
  try {
    return await Promise.all(
      clients.map((c, i) =>
        job(c, i).then(
          (value) => ({ ok: true as const, value }),
          (e: Error) => ({ ok: false as const, error: e.message }),
        ),
      ),
    );
  } finally {
    await Promise.all(clients.map((c) => c.end()));
  }
}

async function bookingPayload(over: Json = {}, resortId = w.resorts.A.id) {
  const in1 = await dateOffset(w.db, 2);
  const out1 = await dateOffset(w.db, 3);
  return {
    resort_id: resortId,
    guest_id: w.guestId,
    pax: 2,
    co_category: "direct",
    stay_type_id: w.stayTypeId,
    booking_date: await dateOffset(w.db, 0),
    check_in_at: `${in1}T14:00:00+05:30`,
    check_out_at: `${out1}T11:00:00+05:30`,
    pricing_method: "per_person_per_stay",
    tariff_paise: 250000,
    ...over,
  };
}
async function newBooking(final = 500000): Promise<string> {
  const p = await bookingPayload({ tariff_paise: final / 2 });
  const plan = [
    {
      label: "Balance",
      due_date: await dateOffset(w.db, 2),
      amount_paise: final,
    },
  ];
  const r = await w.db.as({ role: "authenticated", uid: w.manager }, () =>
    w.db.q<{ r: Json }>(
      `select public.create_booking($1::jsonb, $2::jsonb, $3::uuid) as r`,
      [j(p), j(plan), uid()],
    ),
  );
  return r[0].r.id as string;
}
const asManager = <T>(fn: () => Promise<T>) =>
  w.db.as({ role: "authenticated", uid: w.manager }, fn);
/** a booking with `held` paise of approved money, cancelled with a zero charge so everything held is refundable */
async function heldBooking(held: number): Promise<{ b: string; pay: string }> {
  const b = await newBooking(500000);
  const d = await dateOffset(w.db, 0);
  const pay = await asManager(() =>
    w.db.q<{ r: Json }>(
      `select public.add_payment($1::jsonb, null, $2::uuid) as r`,
      [
        j({
          booking_id: b,
          amount_paise: held,
          method: "cash",
          payment_date: d,
        }),
        uid(),
      ],
    ),
  );
  await w.db.as({ role: "authenticated", uid: w.owner }, () =>
    w.db.q(`select public.approve_payment($1, 1)`, [pay[0].r.id]),
  );
  await asManager(() =>
    w.db.q(
      `select public.cancel_booking($1, 1, 'cancelled', null, 0, 'Guest cancelled', null, '[]'::jsonb)`,
      [b],
    ),
  );
  return { b, pay: pay[0].r.id as string };
}

describe.skipIf(!REAL)("concurrent requests on real PostgreSQL", () => {
  it("CON-01 (BID-02/03): 20 bookings saved at the same moment get 20 different, gap-free numbers", async () => {
    const payloads = await Promise.all(
      Array.from({ length: 20 }, () => bookingPayload()),
    );
    const plan = [
      {
        label: "Balance",
        due_date: await dateOffset(w.db, 2),
        amount_paise: 500000,
      },
    ];
    const res = await parallel(Array(20).fill(w.manager), (c, i) =>
      c
        .query(
          `select public.create_booking($1::jsonb, $2::jsonb, $3::uuid) as r`,
          [j(payloads[i]), j(plan), uid()],
        )
        .then((r) => r.rows[0].r as Json),
    );
    expect(res.filter((r) => !r.ok)).toEqual([]);
    const seqs = await w.db.q<{ booking_seq: number }>(
      `select booking_seq from public.bookings where resort_id = $1 order by booking_seq`,
      [w.resorts.A.id],
    );
    expect(seqs.map((s) => s.booking_seq)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
    const codes = new Set(res.map((r) => (r.ok ? r.value.booking_code : "")));
    expect(codes.size).toBe(20);
  });

  it("CON-02 (FR-BK-11): the same Save pressed 10 times at once creates exactly one booking", async () => {
    const idem = uid();
    const p = await bookingPayload({ remarks: "con-02" });
    const plan = [
      {
        label: "Balance",
        due_date: await dateOffset(w.db, 2),
        amount_paise: 500000,
      },
    ];
    const res = await parallel(Array(10).fill(w.manager), (c) =>
      c
        .query(
          `select public.create_booking($1::jsonb, $2::jsonb, $3::uuid) as r`,
          [j(p), j(plan), idem],
        )
        .then((r) => r.rows[0].r as Json),
    );
    expect(res.filter((r) => !r.ok)).toEqual([]);
    const ids = new Set(res.map((r) => (r.ok ? r.value.id : "")));
    expect(ids.size).toBe(1);
    expect(
      (
        await w.db.q(
          `select 1 from public.bookings where idempotency_key = $1`,
          [idem],
        )
      ).length,
    ).toBe(1);
  });

  it("CON-03: different resorts have independent counters even when saved together", async () => {
    const a = await bookingPayload();
    const b = await bookingPayload({}, w.resorts.B.id);
    const plan = [
      {
        label: "Balance",
        due_date: await dateOffset(w.db, 2),
        amount_paise: 500000,
      },
    ];
    const res = await parallel(Array(10).fill(w.manager), (c, i) =>
      c
        .query(
          `select public.create_booking($1::jsonb, $2::jsonb, $3::uuid) as r`,
          [j(i % 2 ? a : b), j(plan), uid()],
        )
        .then((r) => r.rows[0].r as Json),
    );
    expect(res.filter((r) => !r.ok)).toEqual([]);
    const counts = await w.db.q<{ resort_id: string; max: number; n: string }>(
      `select resort_id, max(booking_seq) as max, count(*)::text n from public.bookings where resort_id in ($1, $2) and remarks is null group by 1`,
      [w.resorts.A.id, w.resorts.B.id],
    );
    for (const row of counts) expect(row.max).toBeGreaterThanOrEqual(5);
  });

  it("CON-04 (OWN-06): two Owners switching each other off at the same moment can never leave zero active Owners", async () => {
    const o2 = uid();
    await w.db.q(
      `insert into auth.users (id, email) values ($1, 'con04@test.example')`,
      [o2],
    );
    await w.db.as({ role: "authenticated", uid: w.owner }, () =>
      w.db.q(
        `select public.profile_create($1, 'Test Con04', 'con04@test.example', 'owner', null, 'Second owner for the test')`,
        [o2],
      ),
    );
    for (let round = 0; round < 5; round++) {
      const res = await parallel([w.owner, o2], (c, i) =>
        c.query(
          `select public.profile_set_active($1, false, 'Switching the other Owner off')`,
          [i === 0 ? o2 : w.owner],
        ),
      );
      const active = await w.db.q<{ n: string }>(
        `select count(*)::text n from public.user_profiles where role = 'owner' and is_active`,
      );
      expect(Number(active[0].n)).toBeGreaterThanOrEqual(1);
      expect(res.filter((r) => r.ok).length).toBeLessThanOrEqual(1);
      // put both back for the next round (recovery path: service role)
      await w.db.as({ role: "service_role" }, async () => {
        await w.db.q(
          `select public.recover_owner_account($1, 'Reset for the next round')`,
          [w.owner],
        );
        await w.db.q(
          `select public.recover_owner_account($1, 'Reset for the next round')`,
          [o2],
        );
      });
    }
  });

  it("CON-05 (REF-04): refunds recorded at the same moment can never exceed the approved money held", async () => {
    const { b } = await heldBooking(100000);
    const d = await dateOffset(w.db, 0);
    const res = await parallel(Array(10).fill(w.manager), (c) =>
      c.query(`select public.add_refund($1::jsonb, null, $2::uuid) as r`, [
        j({
          booking_id: b,
          amount_paise: 30000,
          method: "cash",
          refund_date: d,
          reason: "Guest cancelled",
        }),
        uid(),
      ]),
    );
    const ok = res.filter((r) => r.ok).length;
    expect(ok).toBe(3); // 3 x 30,000 = 90,000 fits; a 4th would make 120,000 > 100,000
    for (const r of res)
      if (!r.ok) expect(r.error).toContain("REFUND_TOO_LARGE");
    const sum = await w.db.q<{ s: number }>(
      `select coalesce(sum(amount_paise), 0)::bigint s from public.refunds where booking_id = $1 and status in ('waiting','approved')`,
      [b],
    );
    expect(sum[0].s).toBeLessThanOrEqual(100000);
  });

  it("CON-06 (APR-05): 8 people approving the same payment at once: exactly one succeeds, the rest are told it is already decided", async () => {
    const b = await newBooking();
    const d = await dateOffset(w.db, 0);
    const pay = await asManager(() =>
      w.db.q<{ r: Json }>(
        `select public.add_payment($1::jsonb, null, $2::uuid) as r`,
        [
          j({
            booking_id: b,
            amount_paise: 100000,
            method: "cash",
            payment_date: d,
          }),
          uid(),
        ],
      ),
    );
    const id = pay[0].r.id;
    const res = await parallel(Array(8).fill(w.owner), (c) =>
      c.query(`select public.approve_payment($1, 1)`, [id]),
    );
    expect(res.filter((r) => r.ok)).toHaveLength(1);
    for (const r of res)
      if (!r.ok) expect(r.error).toMatch(/ALREADY_DECIDED|STALE_RECORD/);
    const h = await w.db.q(
      `select 1 from public.approval_history where payment_id = $1 and to_status = 'approved'`,
      [id],
    );
    expect(h).toHaveLength(1); // one history row, never two
  });

  it("CON-07 (D5): reversing a payment while a refund is recorded at the same moment never leaves refunds without money", async () => {
    for (let round = 0; round < 6; round++) {
      const { b, pay } = await heldBooking(100000);
      const d = await dateOffset(w.db, 0);
      await parallel([w.owner, w.manager], (c, i) =>
        i === 0
          ? c.query(
              `select public.reverse_payment($1, 2, 'Bounced at the bank')`,
              [pay],
            )
          : c.query(
              `select public.add_refund($1::jsonb, null, $2::uuid) as r`,
              [
                j({
                  booking_id: b,
                  amount_paise: 60000,
                  method: "cash",
                  refund_date: d,
                  reason: "Guest cancelled",
                }),
                uid(),
              ],
            ),
      );
      const m = await w.db.q<{ held: number }>(
        `select (coalesce((select sum(amount_paise) from public.payments where booking_id = $1 and status = 'approved'), 0)
               - coalesce((select sum(amount_paise) from public.refunds where booking_id = $1 and status in ('approved', 'waiting')), 0))::bigint as held`,
        [b],
      );
      expect(m[0].held).toBeGreaterThanOrEqual(0);
    }
  });

  it("CON-08: payment numbers (-P1, -P2 ...) stay unique and gap-free when 10 payments are recorded together", async () => {
    const b = await newBooking();
    const d = await dateOffset(w.db, 0);
    const res = await parallel(Array(10).fill(w.manager), (c) =>
      c.query(`select public.add_payment($1::jsonb, null, $2::uuid) as r`, [
        j({
          booking_id: b,
          amount_paise: 1000,
          method: "cash",
          payment_date: d,
        }),
        uid(),
      ]),
    );
    expect(res.filter((r) => !r.ok)).toEqual([]);
    const codes = await w.db.q<{ payment_code: string }>(
      `select payment_code from public.payments where booking_id = $1`,
      [b],
    );
    const nums = codes
      .map((c) => Number(c.payment_code.split("-P")[1]))
      .sort((a, c) => a - c);
    expect(nums).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
  });

  it("CON-09 (FR-BK-12): two people saving the same booking version at once: one wins, the other is told to reload", async () => {
    const b = await newBooking();
    const res = await parallel([w.manager, w.manager2], (c, i) =>
      c.query(`select public.update_booking($1, 1, $2::jsonb) as r`, [
        b,
        j({ remarks: `edit ${i}` }),
      ]),
    );
    expect(res.filter((r) => r.ok)).toHaveLength(1);
    for (const r of res) if (!r.ok) expect(r.error).toContain("STALE_RECORD");
  });

  it("CON-10: plan changes at the same moment keep 'plan + adjustments = amount due'", async () => {
    const b = await newBooking(500000);
    const rows = async (n: number) => [
      {
        label: `Part ${n}`,
        due_date: await dateOffset(w.db, 3),
        amount_paise: 500000,
      },
    ];
    const plans = await Promise.all([1, 2, 3, 4].map((n) => rows(n)));
    const res = await parallel(Array(4).fill(w.manager), (c, i) =>
      c.query(
        `select public.set_payment_schedule($1, 1, $2::jsonb, 0, 'Moved') as r`,
        [b, j(plans[i])],
      ),
    );
    expect(res.filter((r) => r.ok)).toHaveLength(1);
    const s = await w.db.q<{ sched: number; adj: number; due: number }>(
      `select (select coalesce(sum(amount_paise),0) from public.payment_schedules where booking_id = $1 and superseded_at is null)::bigint sched,
              (select coalesce(sum(amount_paise),0) from public.expected_adjustments where booking_id = $1)::bigint adj,
              (select amount_due_paise from public.bookings where id = $1) due`,
      [b],
    );
    expect(s[0].sched + s[0].adj).toBe(s[0].due);
  });

  it("CON-11: the same screenshot file attached twice at once is a warning, never two rows for one stored file", async () => {
    const b = await newBooking();
    const d = await dateOffset(w.db, 0);
    const path = `${b}/${uid()}.png`;
    await w.db.q(
      `insert into storage.objects (bucket_id, name, metadata) values ('payment-proofs', $1, $2::jsonb)`,
      [path, j({ size: 1000, mimetype: "image/png" })],
    );
    const file = {
      storage_path: path,
      original_file_name: "a.png",
      mime_type: "image/png",
      size_bytes: 1000,
      sha256: randomBytes(32).toString("hex"),
    };
    const res = await parallel(Array(4).fill(w.manager), (c) =>
      c.query(
        `select public.add_payment($1::jsonb, $2::jsonb, $3::uuid) as r`,
        [
          j({
            booking_id: b,
            amount_paise: 1000,
            method: "upi",
            provider_id: 1,
            payment_date: d,
          }),
          j([file]),
          uid(),
        ],
      ),
    );
    expect(res.filter((r) => r.ok)).toHaveLength(1);
    expect(
      (
        await w.db.q(`select 1 from public.proofs where storage_path = $1`, [
          path,
        ])
      ).length,
    ).toBe(1);
  });
});
