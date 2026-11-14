/**
 * PERFORMANCE and scale checks for the report functions (migration 25; TEST_PLAN M8: "performance with about 50k bookings").
 * RPT-PERF-01..
 *
 * Like records-performance.pg.test.ts they run ONLY when STATEADV_PG_URL is set (PostgreSQL 17), or on PGlite with
 * STATEADV_PERF_SMALL=1 and a smaller PERF_BOOKINGS to check the test itself. Fictional data only.
 *
 * Data: 50,000 bookings over 2020-2035 in two resorts, one plan row each, about 37,500 approved payments and 2,000 approved
 * refunds. The time limits are generous (they catch a query that scans everything again for every request); the answers are
 * also compared with independent SQL so a fast but wrong query cannot pass.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { setupWorld, type World } from "./fixtures";

const REAL = Boolean(process.env.STATEADV_PG_URL);
// Real PostgreSQL: the full 50,000. PGlite (one connection, slower) only when asked, with a smaller size, to check the test itself.
const SMALL = !REAL && process.env.STATEADV_PERF_SMALL === "1";
const RUN = REAL || SMALL;
const BOOKINGS = REAL ? 50_000 : Number(process.env.PERF_BOOKINGS ?? 3000);
let w: World;
const q = <T = Record<string, unknown>>(sql: string, p?: unknown[]) =>
  w.db.q<T>(sql, p);
const asUser = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
  w.db.as({ role: "authenticated", uid: w.manager }, () => q<T>(sql, p));

async function timed<T>(
  fn: () => Promise<T>,
): Promise<{ ms: number; value: T }> {
  const t0 = performance.now();
  const value = await fn();
  return { ms: performance.now() - t0, value };
}

beforeAll(async () => {
  if (!RUN) return;
  w = await setupWorld();
  await w.db.exec("set session_replication_role = replica");
  try {
    await q(
      `insert into public.bookings
         (id, booking_code, resort_id, booking_year, booking_seq, guest_id, guest_name, guest_mobile, pax,
          co_category_id, co_category_name, co_mode, stay_type_id, stay_type_name, booking_date, check_in_at, check_out_at,
          nights, pricing_method, tariff_per_person_paise, base_amount_paise, idempotency_key, status, created_at)
       select md5(i::text)::uuid, 'PERF-' || extract(year from d) || '-' || lpad(i::text, 6, '0'),
              case when i % 2 = 0 then $1::uuid else $2::uuid end, extract(year from d)::int, i, $3,
              'Perf Guest ' || (i % 977), '98' || lpad((i % 100000000)::text, 8, '0'), 2,
              $4, 'Direct', 'none', $5, 'Resort Stay', d,
              (d::text || ' 14:00:00+05:30')::timestamptz, ((d + n)::text || ' 11:00:00+05:30')::timestamptz,
              n, 'per_person_per_stay', 250000, 500000, md5('k' || i::text)::uuid,
              case when d < current_date then 'checked_out' else 'confirmed' end::public.booking_status,
              (d::text || ' 10:00:00+05:30')::timestamptz
         from (select i, date '2020-01-01' + ((i * 7) % 5844) as d, 1 + (i % 3) as n from generate_series(1, ${BOOKINGS}) i) s`,
      [w.resorts.A.id, w.resorts.B.id, w.guestId, w.cat.direct, w.stayTypeId],
    );
    await q(
      `insert into public.payment_plan_revisions (id, booking_id, revision_no, source, amount_due_before, amount_due_after, locked_total_paise)
       select id, id, 1, 'created', null, 500000, 0 from public.bookings where booking_code like 'PERF-%'`,
    );
    await q(
      `insert into public.payment_schedules (booking_id, revision_id, line_no, label, due_date, amount_paise)
       select id, id, 1, 'Balance', (check_in_at at time zone 'Asia/Kolkata')::date, 500000 from public.bookings where booking_code like 'PERF-%'`,
    );
    await q(
      `insert into public.payments
         (id, payment_code, booking_id, resort_id, amount_paise, method, payment_date, status, approved_by, approved_at,
          recorded_by, recorded_at, idempotency_key)
       select md5('p' || booking_seq::text)::uuid, 'PERF-PAY-' || lpad(booking_seq::text, 6, '0'), id, resort_id, 500000, 'cash',
              booking_date, 'approved', $1, now(), $2, (booking_date::text || ' 12:00:00+05:30')::timestamptz, md5('pk' || booking_seq::text)::uuid
         from public.bookings where booking_code like 'PERF-%' and booking_seq % 4 <> 0`,
      [w.owner, w.manager],
    );
    await q(
      `insert into public.refunds
         (id, refund_code, booking_id, resort_id, amount_paise, method, refund_date, reason, status, approved_by, approved_at,
          recorded_by, recorded_at, idempotency_key)
       select md5('r' || booking_seq::text)::uuid, 'PERF-REF-' || lpad(booking_seq::text, 6, '0'), id, resort_id, 100000, 'cash',
              booking_date, 'Perf refund', 'approved', $1, now(), $2, (booking_date::text || ' 15:00:00+05:30')::timestamptz, md5('rk' || booking_seq::text)::uuid
         from public.bookings where booking_code like 'PERF-%' and booking_seq % 25 = 0`,
      [w.owner, w.manager],
    );
  } finally {
    await w.db.exec("set session_replication_role = origin");
  }
  await q(
    `insert into public.audit_logs (occurred_at, actor_id, actor_name, action, table_name, record_id, booking_id, resort_id, changed_fields, old_data, new_data)
     select now() - (i % 20000) * interval '10 minutes', $1, 'Test Owner', case when i % 3 = 0 then 'insert' else 'update' end,
            case when i % 2 = 0 then 'bookings' else 'payments' end, md5(i::text), b.id, b.resort_id,
            case when i % 3 = 0 then null else array['status'] end,
            case when i % 3 = 0 then null else '{"status":"waiting"}'::jsonb end, '{"status":"approved"}'::jsonb
       from generate_series(1, ${BOOKINGS * 2}) i
       join public.bookings b on b.booking_seq = 1 + (i % ${BOOKINGS}) and b.resort_id = case when (1 + i % ${BOOKINGS}) % 2 = 0 then $2::uuid else $3::uuid end`,
    [w.owner, w.resorts.A.id, w.resorts.B.id],
  );
  await w.db.exec("analyze");
}, 900_000);

describe.skipIf(!RUN)("reports at scale (RPT-PERF-01..)", () => {
  const ALL = ["2026-01-01", "2035-12-31"] as const;
  it("RPT-PERF-01: the data is there", async () => {
    const [c] = await q<{ b: string }>(
      `select count(*)::text b from public.bookings where booking_code like 'PERF-%'`,
    );
    expect(c.b).toBe(String(BOOKINGS));
  });

  it("RPT-PERF-02: the collection report over the 10-year maximum, by month, by year and by day for one year, is fast and equals independent SQL", async () => {
    const [o] = await q<{ a: string; r: string }>(
      `select (select coalesce(sum(amount_paise),0) from public.payments where status='approved' and payment_date between $1 and $2)::text a,
              (select coalesce(sum(amount_paise),0) from public.refunds where status='approved' and refund_date between $1 and $2)::text r`,
      [...ALL],
    );
    for (const group of ["month", "year"]) {
      const { ms, value } = await timed(() =>
        asUser<{
          total_approved_paise: string;
          total_refunds_paise: string;
          total_net_paise: string;
        }>(
          `select total_approved_paise::text, total_refunds_paise::text, total_net_paise::text
             from public.report_collection($1::date, $2::date, null, $3, 'none') limit 1`,
          [...ALL, group],
        ),
      );
      expect(ms).toBeLessThan(4000);
      expect(value[0].total_approved_paise).toBe(o.a);
      expect(value[0].total_refunds_paise).toBe(o.r);
      expect(BigInt(value[0].total_net_paise)).toBe(BigInt(o.a) - BigInt(o.r));
    }
    const { ms } = await timed(() =>
      asUser(
        `select * from public.report_collection('2026-01-01', '2026-12-31', null, 'day', 'resort')`,
      ),
    );
    expect(ms).toBeLessThan(4000);
  });

  it("RPT-PERF-03: expected vs actual over the 10-year maximum equals independent SQL for collection and is fast", async () => {
    const { ms, value } = await timed(() =>
      asUser<{ total_approved_paise: string; total_rows: number }>(
        `select total_approved_paise::text, total_rows from public.report_expected_vs_actual($1::date, $2::date, null) limit 1`,
        [...ALL],
      ),
    );
    expect(ms).toBeLessThan(5000);
    const [o] = await q<{ a: string }>(
      `select coalesce(sum(amount_paise),0)::text a from public.payments where status='approved' and payment_date between $1 and $2`,
      [...ALL],
    );
    expect(value[0].total_approved_paise).toBe(o.a);
    const [rc] = await q<{ n: number }>(
      `select count(*)::int n from public.resorts`,
    );
    expect(value[0].total_rows).toBe(rc.n); // one row for every resort
  });

  it("RPT-PERF-04: payment methods, pending and bookings (a page of 25 and of 1,000) are fast, and the row counts equal independent SQL", async () => {
    const { ms: m1 } = await timed(() =>
      asUser(
        `select * from public.report_payment_methods($1::date, $2::date, null)`,
        [...ALL],
      ),
    );
    expect(m1).toBeLessThan(4000);
    const [c] = await q<{ n: number }>(
      `select count(*)::int n from public.bookings where booking_date between $1 and $2`,
      [...ALL],
    );
    for (const lim of [25, 1000]) {
      const { ms, value } = await timed(() =>
        asUser<{ total_rows: number }>(
          `select total_rows from public.report_bookings('booking', $1::date, $2::date, null, null, $3, 0)`,
          [...ALL, lim],
        ),
      );
      expect(ms).toBeLessThan(4000);
      expect(value).toHaveLength(Math.min(lim, c.n));
      expect(Number(value[0].total_rows)).toBe(c.n);
    }
    const { ms: m2 } = await timed(() =>
      asUser(`select * from public.report_pending('2026-03-31', null, 25, 0)`),
    );
    expect(m2).toBeLessThan(6000);
  });

  it("RPT-PERF-05: refunds, cancellations, waiting and adjustments over the 10-year maximum are fast, and the refund total equals independent SQL", async () => {
    const { ms, value } = await timed(() =>
      asUser<{ total_approved_paise: string; total_rows: number }>(
        `select total_approved_paise::text, total_rows from public.report_refunds($1::date, $2::date, null, null, null, 25, 0)`,
        [...ALL],
      ),
    );
    expect(ms).toBeLessThan(4000);
    const [o] = await q<{ a: string; n: number }>(
      `select coalesce(sum(amount_paise),0)::text a, count(*)::int n from public.refunds where status='approved' and refund_date between $1 and $2`,
      [...ALL],
    );
    expect(value[0].total_approved_paise).toBe(o.a);
    expect(Number(value[0].total_rows)).toBe(o.n);
    for (const sql of [
      `select * from public.report_cancellations($1::date, $2::date, null, null, 25, 0)`,
      `select * from public.report_waiting('entry', $1::date, $2::date, null, null, 25, 0)`,
      `select * from public.report_expected_adjustments($1::date, $2::date, null, null, 25, 0)`,
      `select * from public.report_manual_adjustments($1::date, $2::date, null, 25, 0)`,
    ]) {
      const t = await timed(() => asUser(sql, [...ALL]));
      expect(t.ms).toBeLessThan(5000);
    }
  });

  it("RPT-PERF-06: a file is read page by page (1,000 rows a call) over the whole 10-year range: every row once, in a stable order, and the time per page does not grow badly with the offset", async () => {
    const [c] = await q<{ n: number }>(
      `select count(*)::int n from public.bookings where booking_date between $1 and $2`,
      [...ALL],
    );
    const seen = new Set<string>();
    const times: number[] = [];
    let last = "";
    for (let off = 0; off < c.n; off += 1000) {
      const { ms, value } = await timed(() =>
        asUser<{ booking_code: string }>(
          `select booking_code from public.report_bookings('booking', $1::date, $2::date, null, null, 1000, $3)`,
          [...ALL, off],
        ),
      );
      times.push(ms);
      for (const r of value) {
        expect(seen.has(r.booking_code)).toBe(false);
        seen.add(r.booking_code);
        last = r.booking_code;
      }
    }
    expect(last).not.toBe("");
    expect(seen.size).toBe(c.n);
    const worst = Math.max(...times);
    const total = times.reduce((a, b) => a + b, 0);
    console.log(
      `RPT-PERF-06 pages=${times.length} rows=${c.n} worst=${Math.round(worst)}ms total=${Math.round(total)}ms`,
    );
    expect(worst).toBeLessThan(5000);
    expect(total).toBeLessThan(120_000);
  }, 300_000);
});
