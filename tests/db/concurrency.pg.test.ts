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
import { dateOffset, reauth, setupWorld, uid, type World } from "./fixtures";

const REAL = Boolean(process.env.STATEADV_PG_URL);
let w: World;
// Dates are looked up once, up front: preparing requests must not run several queries at once on the shared connection.
const dayCache = new Map<number, string>();
async function day(offset: number): Promise<string> {
  const hit = dayCache.get(offset);
  if (hit) return hit;
  const value = await dateOffset(w.db, offset);
  dayCache.set(offset, value);
  return value;
}
beforeAll(async () => {
  if (REAL) {
    w = await setupWorld();
    for (const n of [0, 1, 2, 3]) await day(n);
  }
}, 120_000);

// Test helper: rows and JSON results are inspected loosely on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const j = (x: unknown) => JSON.stringify(x);

/** One independent database connection, logged in as `userId` (like one browser request). */
async function connect(userId: string) {
  const c = new pg.Client({ connectionString: w.db.url });
  // a connection that the server closes must never become an uncaught error in the test process
  c.on("error", () => undefined);
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
    // close one at a time: closing dozens of sockets in the same instant can crash Node on Windows
    for (const c of clients) await c.end().catch(() => undefined);
  }
}

/** Connections that act as the SERVICE ROLE (what the server does with the secret key), all started at the same moment. */
async function parallelService<T>(
  n: number,
  job: (c: pg.Client, i: number) => Promise<T>,
) {
  const clients = await Promise.all(
    Array.from({ length: n }, async () => {
      const c = new pg.Client({ connectionString: w.db.url });
      c.on("error", () => undefined);
      await c.connect();
      await c.query("set role service_role");
      return c;
    }),
  );
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
    for (const c of clients) await c.end().catch(() => undefined);
  }
}

async function bookingPayload(over: Json = {}, resortId = w.resorts.A.id) {
  const in1 = await day(2);
  const out1 = await day(3);
  return {
    resort_id: resortId,
    guest_id: w.guestId,
    pax: 2,
    co_category_id: w.cat.direct,
    stay_type_id: w.stayTypeId,
    booking_date: await day(0),
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
      due_date: await day(2),
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
// as a signed-in Manager (the functions refuse anyone else)
const mq = <T = Json>(sql: string, p?: unknown[]) =>
  asManager(() => w.db.q<T>(sql, p));
const asManager = <T>(fn: () => Promise<T>) =>
  w.db.as({ role: "authenticated", uid: w.manager }, fn);
/** a booking with `held` paise of approved money, cancelled with a zero charge so everything held is refundable */
async function heldBooking(held: number): Promise<{ b: string; pay: string }> {
  const b = await newBooking(500000);
  const d = await day(0);
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

/** A booking with amount due D=500000 and A=600000 approved. state 'active' keeps it running; 'cancelled' cancels it with charge D. */
async function overpaidBooking(state: "active" | "cancelled"): Promise<string> {
  const b = await newBooking(500000);
  const d = await day(0);
  const pay = await asManager(() =>
    w.db.q<{ r: Json }>(
      `select public.add_payment($1::jsonb, null, $2::uuid) as r`,
      [
        j({
          booking_id: b,
          amount_paise: 600000,
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
  if (state === "cancelled") {
    const plan = [
      {
        label: "Cancellation charge",
        due_date: await day(1),
        amount_paise: 500000,
      },
    ];
    await asManager(() =>
      w.db.q(
        `select public.cancel_booking($1, 1, 'cancelled', null, 500000, 'Guest cancelled', null, $2::jsonb)`,
        [b, j(plan)],
      ),
    );
  }
  return b;
}

describe.skipIf(!REAL)("concurrent requests on real PostgreSQL", () => {
  it("CON-01 (BID-02/03): 20 bookings saved at the same moment get 20 different, gap-free numbers", async () => {
    const payloads = await Promise.all(
      Array.from({ length: 20 }, () => bookingPayload()),
    );
    const plan = [
      {
        label: "Balance",
        due_date: await day(2),
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
        due_date: await day(2),
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
        due_date: await day(2),
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
    await reauth(w.db, w.owner, "add_owner", o2);
    await w.db.as({ role: "authenticated", uid: w.owner }, () =>
      w.db.q(
        `select public.profile_create($1, 'Test Con04', 'con04@test.example', 'owner', null, 'Second owner for the test')`,
        [o2],
      ),
    );
    for (let round = 0; round < 5; round++) {
      // each Owner has confirmed their own password for switching the OTHER Owner off
      await reauth(w.db, w.owner, "set_active", o2);
      await reauth(w.db, o2, "set_active", w.owner);
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
    const d = await day(0);
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
    const d = await day(0);
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
      const d = await day(0);
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
    const d = await day(0);
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
        due_date: await day(3),
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
    const d = await day(0);
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
  it("CON-12 (decision 5): on a RUNNING booking 10 simultaneous refunds can never go above A - D - RA - RW", async () => {
    const b = await overpaidBooking("active"); // A=600000, D=500000: room 100000
    const d = await day(0);
    const res = await parallel(Array(10).fill(w.manager), (c) =>
      c.query(`select public.add_refund($1::jsonb, null, $2::uuid) as r`, [
        j({
          booking_id: b,
          amount_paise: 30000,
          method: "cash",
          refund_date: d,
          reason: "Guest overpaid",
        }),
        uid(),
      ]),
    );
    expect(res.filter((r) => r.ok)).toHaveLength(3); // 90000 fits, a fourth would make 120000 > 100000
    for (const r of res)
      if (!r.ok) expect(r.error).toContain("REFUND_TOO_LARGE");
    const sum = await w.db.q<{ s: number }>(
      `select coalesce(sum(amount_paise), 0)::bigint s from public.refunds where booking_id = $1 and status in ('waiting','approved')`,
      [b],
    );
    expect(sum[0].s).toBeLessThanOrEqual(100000);
  });

  it("CON-13 (decision 5): same numbers, different states: simultaneous 70000 refunds → 1 succeeds when running (room 100000), 8 when cancelled (room 600000)", async () => {
    const d = await day(0);
    const run = async (b: string) =>
      parallel(Array(12).fill(w.manager), (c) =>
        c.query(`select public.add_refund($1::jsonb, null, $2::uuid) as r`, [
          j({
            booking_id: b,
            amount_paise: 70000,
            method: "cash",
            refund_date: d,
            reason: "Guest overpaid",
          }),
          uid(),
        ]),
      );
    const running = await run(await overpaidBooking("active"));
    expect(running.filter((r) => r.ok)).toHaveLength(1);
    const cancelled = await run(await overpaidBooking("cancelled"));
    expect(cancelled.filter((r) => r.ok)).toHaveLength(8); // 8 x 70000 = 560000 <= 600000 < 9 x 70000
    for (const r of [...running, ...cancelled])
      if (!r.ok) expect(r.error).toContain("REFUND_TOO_LARGE");
  });

  it("CON-14 (decision 5): two waiting refunds both raised at the same moment can never together go above the room", async () => {
    for (const state of ["active", "cancelled"] as const) {
      const b = await overpaidBooking(state);
      const room = state === "active" ? 100000 : 600000;
      const d = await day(0);
      const mk = () =>
        asManager(() =>
          w.db.q<{ r: Json }>(
            `select public.add_refund($1::jsonb, null, $2::uuid) as r`,
            [
              j({
                booking_id: b,
                amount_paise: 10000,
                method: "cash",
                refund_date: d,
                reason: "Guest overpaid",
              }),
              uid(),
            ],
          ),
        ).then((x) => x[0].r.id as string);
      const [r1, r2] = [await mk(), await mk()];
      const target = Math.floor(room * 0.8); // each alone fits; together they cannot
      const res = await parallel([w.manager, w.manager2], (c, i) =>
        c.query(
          `select public.update_waiting_refund($1, 1, $2::jsonb, 'Corrected the amount')`,
          [i === 0 ? r1 : r2, j({ amount_paise: target })],
        ),
      );
      expect(
        res.filter((r) => r.ok),
        state,
      ).toHaveLength(1);
      const sum = await w.db.q<{ s: number }>(
        `select sum(amount_paise)::bigint s from public.refunds where booking_id = $1 and status = 'waiting'`,
        [b],
      );
      expect(sum[0].s).toBeLessThanOrEqual(room);
    }
  });
  it("CON-15: the same new C/O category created by 10 people at once exists exactly once", async () => {
    const res = await parallel(Array(10).fill(w.manager), (c) =>
      c.query(
        `select public.upsert_co_category(null, 'Test Race Category') as id`,
      ),
    );
    expect(res.filter((r) => r.ok)).toHaveLength(1);
    for (const r of res) if (!r.ok) expect(r.error).toContain("DUPLICATE");
    expect(
      (
        await w.db.q(
          `select 1 from public.co_categories where name = 'Test Race Category'`,
        )
      ).length,
    ).toBe(1);
  });

  it("CON-16: bookings saved while the category, name, stay type and resort are being renamed always get a consistent copy of the names", async () => {
    const cat = (
      await mq<{ id: number }>(
        `select public.upsert_co_category(null, 'Test Name 0', 'listed') as id`,
      )
    )[0].id;
    const ent = (
      await mq<{ id: string }>(
        `select public.upsert_co_entry(null, $1::smallint, 'Test Entry 0') as id`,
        [cat],
      )
    )[0].id;
    const stayId = (
      await mq<{ id: number }>(
        `select public.upsert_stay_type(null, 'Test Stay 0') as id`,
      )
    )[0].id;
    const plan = [
      {
        label: "Balance",
        due_date: await day(2),
        amount_paise: 500000,
      },
    ];
    const payloads = await Promise.all(
      Array.from({ length: 8 }, async () =>
        bookingPayload({
          co_category_id: cat,
          co_entry_id: ent,
          stay_type_id: stayId,
        }),
      ),
    );
    const res = await parallel(Array(14).fill(w.manager), (c, i) =>
      i < 8
        ? c
            .query(
              `select public.create_booking($1::jsonb, $2::jsonb, $3::uuid) as r`,
              [j(payloads[i]), j(plan), uid()],
            )
            .then((r) => r.rows[0].r as Json)
        : i < 10
          ? c.query(
              `select public.upsert_co_category($1::smallint, $2, 'listed')`,
              [cat, `Test Name ${i}`],
            )
          : i < 12
            ? c.query(`select public.upsert_co_entry($1, $2::smallint, $3)`, [
                ent,
                cat,
                `Test Entry ${i}`,
              ])
            : c.query(`select public.upsert_stay_type($1::smallint, $2)`, [
                stayId,
                `Test Stay ${i}`,
              ]),
    );
    expect(res.filter((r) => !r.ok)).toEqual([]);
    const rows = await w.db.q<{
      co_category_name: string;
      co_name: string;
      stay_type_name: string;
    }>(
      `select co_category_name, co_name, stay_type_name from public.bookings where co_category_id = $1`,
      [cat],
    );
    expect(rows).toHaveLength(8);
    for (const r of rows) {
      expect(r.co_category_name).toMatch(/^Test Name \d+$/); // always a real name the category had, never empty or mixed up
      expect(r.co_name).toMatch(/^Test Entry \d+$/);
      expect(r.stay_type_name).toMatch(/^Test Stay \d+$/);
    }
  });

  it("CON-17: Booking IDs stay unique and gap-free across the four placeholder resorts and a new one at the same moment", async () => {
    await mq(
      `select public.upsert_resort(null, 'CON', 'Test Concurrent Resort')`,
    );
    const ids = await w.db.q<{ id: string; code: string }>(
      `select id, code from public.resorts where code in ('SR1','SR2','SR3','SR4','CON') order by code`,
    );
    const plan = [
      {
        label: "Balance",
        due_date: await day(2),
        amount_paise: 500000,
      },
    ];
    const payloads = await Promise.all(
      Array.from({ length: 30 }, async (_, i) =>
        bookingPayload({}, ids[i % ids.length].id),
      ),
    );
    const res = await parallel(Array(30).fill(w.manager), (c, i) =>
      c.query(
        `select public.create_booking($1::jsonb, $2::jsonb, $3::uuid) as r`,
        [j(payloads[i]), j(plan), uid()],
      ),
    );
    expect(res.filter((r) => !r.ok)).toEqual([]);
    for (const r of ids) {
      const seqs = await w.db.q<{ s: number }>(
        `select booking_seq s from public.bookings where resort_id = $1 order by 1`,
        [r.id],
      );
      // other tests also booked SR1.. earlier, so check contiguity, not the starting point
      expect(seqs.map((x) => x.s)).toEqual(
        Array.from({ length: seqs.length }, (_, i) => i + 1),
      );
      expect(seqs.length).toBeGreaterThanOrEqual(6);
    }
    const dup = await w.db.q(
      `select booking_code from public.bookings group by 1 having count(*) > 1`,
    );
    expect(dup).toEqual([]);
  });

  it("CON-18: a resort switched off while bookings are being saved: afterwards nothing new is accepted, nothing saved is lost", async () => {
    const id = (
      await mq<{ id: string }>(
        `select public.upsert_resort(null, 'OFX', 'Test Switch Off Resort') as id`,
      )
    )[0].id;
    const plan = [
      {
        label: "Balance",
        due_date: await day(2),
        amount_paise: 500000,
      },
    ];
    const payloads = await Promise.all(
      Array.from({ length: 8 }, async () => bookingPayload({}, id)),
    );
    const res = await parallel(Array(9).fill(w.manager), (c, i) =>
      i < 8
        ? c.query(
            `select public.create_booking($1::jsonb, $2::jsonb, $3::uuid) as r`,
            [j(payloads[i]), j(plan), uid()],
          )
        : c.query(`select public.set_resort_active($1, false)`, [id]),
    );
    const created = res.slice(0, 8).filter((r) => r.ok).length;
    for (const r of res.slice(0, 8))
      if (!r.ok) expect(r.error).toContain("RESORT_INACTIVE");
    expect(res[8].ok).toBe(true);
    const seqs = await w.db.q<{ s: number }>(
      `select booking_seq s from public.bookings where resort_id = $1 order by 1`,
      [id],
    );
    expect(seqs.map((x) => x.s)).toEqual(
      Array.from({ length: created }, (_, i) => i + 1),
    ); // no gaps, no loss
    const late = await parallel([w.manager], (c) =>
      c.query(
        `select public.create_booking($1::jsonb, $2::jsonb, $3::uuid) as r`,
        [j(payloads[0]), j(plan), uid()],
      ),
    );
    expect(late[0].ok).toBe(false);
  });

  it("CON-19 (O3): one grant claimed by several simultaneous protected calls is used exactly once, and only by the call for the exact operation it was issued for", async () => {
    const o2 = uid();
    await w.db.q(
      `insert into auth.users (id, email) values ($1, 'con19@test.example')`,
      [o2],
    );
    await reauth(w.db, w.owner, "add_owner", o2);
    await w.db.as({ role: "authenticated", uid: w.owner }, () =>
      w.db.q(
        `select public.profile_create($1, 'Test Con19', 'con19@test.example', 'owner', null, 'Second owner for the test')`,
        [o2],
      ),
    );
    for (let round = 0; round < 3; round++) {
      const good = `con19-${round}@test.example`;
      const g = await reauth(w.db, w.owner, "change_email", o2, good);
      // six calls at the same moment: three for the confirmed email (only one can win), three for other emails (never)
      const res = await parallel(Array(6).fill(w.owner), (c, i) =>
        c.query(
          `select public.profile_change_email($1, $2, 'Six calls, one grant')`,
          [o2, i < 3 ? good : `other-${round}-${i}@test.example`],
        ),
      );
      expect(res.filter((r) => r.ok)).toHaveLength(1);
      expect(res.slice(0, 3).filter((r) => r.ok)).toHaveLength(1);
      for (const r of res.filter((r) => !r.ok))
        expect((r as { error: string }).error).toContain("REAUTH_REQUIRED");
      const used = await w.db.q<{ n: string }>(
        `select count(*)::text n from public.reauth_grants where id = $1 and used_at is not null`,
        [g],
      );
      expect(used[0].n).toBe("1");
      const email = await w.db.q<{ email: string }>(
        `select email from public.user_profiles where id = $1`,
        [o2],
      );
      expect(email[0].email).toBe(good);
    }
    // simultaneous switch-offs of each other, each Owner holding a grant: still never zero active Owners (as CON-04)
    await reauth(w.db, w.owner, "set_active", o2);
    await reauth(w.db, o2, "set_active", w.owner);
    await parallel([w.owner, o2], (c, i) =>
      c.query(
        `select public.profile_set_active($1, false, 'Switching the other Owner off')`,
        [i === 0 ? o2 : w.owner],
      ),
    );
    const active = await w.db.q<{ n: string }>(
      `select count(*)::text n from public.user_profiles where role = 'owner' and is_active`,
    );
    expect(Number(active[0].n)).toBeGreaterThanOrEqual(1);
    // put both back (recovery path, service role): later tests must start with the first Owner active
    await w.db.as({ role: "service_role" }, async () => {
      await w.db.q(
        `select public.recover_owner_account($1, 'Reset after the test')`,
        [w.owner],
      );
      await w.db.q(
        `select public.recover_owner_account($1, 'Reset after the test')`,
        [o2],
      );
    });
  });

  it("CON-20 (O3): twenty simultaneous password attempts reserve at most five; a success resets the count; other Owners are not blocked", async () => {
    // start with the first Owner active (an earlier test may have switched either Owner off)
    await w.db.as({ role: "service_role" }, () =>
      w.db.q(
        `select public.recover_owner_account($1, 'Reset before the test')`,
        [w.owner],
      ),
    );
    const mk = async (email: string) => {
      const id = uid();
      await w.db.q(`insert into auth.users (id, email) values ($1, $2)`, [
        id,
        email,
      ]);
      await reauth(w.db, w.owner, "add_owner", id);
      await w.db.as({ role: "authenticated", uid: w.owner }, () =>
        w.db.q(
          `select public.profile_create($1, 'Test Con20', $2, 'owner', null, 'Owner for the attempt test')`,
          [id, email],
        ),
      );
      return id;
    };
    const a = await mk("con20a@test.example");
    const b = await mk("con20b@test.example");
    const attempts = async (id: string) =>
      Number(
        (
          await w.db.q<{ n: string }>(
            `select count(*)::text n from public.audit_logs where actor_id = $1 and action = 'reauth_attempt'`,
            [id],
          )
        )[0].n,
      );
    for (let round = 0; round < 2; round++) {
      const res = await parallelService(20, (c) =>
        c.query(`select public.reauth_begin($1, 'set_active', $2)`, [
          a,
          w.owner,
        ]),
      );
      expect(res.filter((r) => r.ok)).toHaveLength(5);
      for (const r of res.filter((r) => !r.ok))
        expect((r as { error: string }).error).toContain("REAUTH_LOCKED");
      expect(await attempts(a)).toBe(5 * (round + 1));
      // locked now, also for a sequential try
      await expect(
        w.db.as({ role: "service_role" }, () =>
          w.db.q(`select public.reauth_begin($1, 'set_active', $2)`, [
            a,
            w.owner,
          ]),
        ),
      ).rejects.toThrow(/REAUTH_LOCKED/);
      // another Owner is not affected by a's lock
      await w.db.as({ role: "service_role" }, () =>
        w.db.q(`select public.reauth_begin($1, 'set_active', $2)`, [
          b,
          w.owner,
        ]),
      );
      // a correct password for a (issue) resets a's count
      await reauth(w.db, a, "set_active", w.owner);
    }
    // after the last reset the next attempt is allowed again
    await w.db.as({ role: "service_role" }, () =>
      w.db.q(`select public.reauth_begin($1, 'set_active', $2)`, [a, w.owner]),
    );
  });
  it("CON-21 (M4): a check-in and a cancellation of the same booking version at the same moment: exactly one wins, and a cancelled booking is never checked in", async () => {
    const b = await newBooking();
    const res = await parallel([w.manager, w.manager2], (c, i) =>
      i === 0
        ? c.query(
            `select public.set_booking_status($1, 1, 'checked_in', null) as r`,
            [b],
          )
        : c.query(
            `select public.cancel_booking($1, 1, 'cancelled', null, 0, 'Guest cancelled', null, '[]'::jsonb) as r`,
            [b],
          ),
    );
    expect(res.filter((r) => r.ok)).toHaveLength(1);
    for (const r of res) if (!r.ok) expect(r.error).toContain("STALE_RECORD");
    const [{ status }] = await mq<{ status: string }>(
      `select status from public.bookings where id = $1`,
      [b],
    );
    expect(["checked_in", "cancelled"]).toContain(status);
    const pc = await mq<{ n: string }>(
      `select count(*)::text n from public.payment_plan_revisions where booking_id = $1`,
      [b],
    );
    expect(Number(pc[0].n)).toBe(status === "cancelled" ? 2 : 1);
  });

  it("CON-22 (M4): the same Cancel pressed by two people at once cancels once; the plan has one cancellation version", async () => {
    const b = await newBooking();
    const res = await parallel([w.manager, w.manager2], (c) =>
      c.query(
        `select public.cancel_booking($1, 1, 'cancelled', null, 0, 'Guest cancelled', null, '[]'::jsonb) as r`,
        [b],
      ),
    );
    expect(res.filter((r) => r.ok)).toHaveLength(1);
    const rows = await mq<{ source: string }>(
      `select source from public.payment_plan_revisions where booking_id = $1 order by revision_no`,
      [b],
    );
    expect(rows.map((r) => r.source)).toEqual(["created", "cancellation"]);
  });
  it("CON-23 (M5): one person approving and another rejecting the same payment at the same moment: exactly one decision is recorded", async () => {
    const b = await newBooking();
    const d = await day(0);
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
    const res = await parallel([w.owner, w.manager2], (c, i) =>
      i === 0
        ? c.query(`select public.approve_payment($1, 1)`, [id])
        : c.query(`select public.reject_payment($1, 1, 'Wrong booking')`, [id]),
    );
    expect(res.filter((r) => r.ok)).toHaveLength(1);
    for (const r of res)
      if (!r.ok) expect(r.error).toMatch(/ALREADY_DECIDED|STALE_RECORD/);
    const h = await w.db.q<{ to_status: string }>(
      `select to_status::text from public.approval_history where payment_id = $1 and to_status in ('approved', 'rejected')`,
      [id],
    );
    expect(h).toHaveLength(1);
    const [{ s, a, r }] = await w.db.q<{
      s: string;
      a: string | null;
      r: string | null;
    }>(
      `select status::text s, approved_by::text a, rejected_by::text r from public.payments where id = $1`,
      [id],
    );
    expect(
      (s === "approved" && a !== null && r === null) ||
        (s === "rejected" && r !== null && a === null),
    ).toBe(true);
  });

  it("CON-24 (M5): the same Add Payment pressed 10 times at once saves exactly one payment and one number", async () => {
    const b = await newBooking();
    const d = await day(0);
    const key = uid();
    const payload = j({
      booking_id: b,
      amount_paise: 100000,
      method: "cash",
      payment_date: d,
    });
    const res = await parallel(Array(10).fill(w.manager), (c) =>
      c.query(`select public.add_payment($1::jsonb, null, $2::uuid) as r`, [
        payload,
        key,
      ]),
    );
    expect(res.every((r) => r.ok)).toBe(true);
    const ids = new Set(
      res.map((r) => (r.ok ? (r.value.rows[0].r as Json).id : "")),
    );
    expect(ids.size).toBe(1);
    const rows = await w.db.q<{ n: string }>(
      `select count(*)::text n from public.payments where idempotency_key = $1`,
      [key],
    );
    expect(rows[0].n).toBe("1");
  });
});
