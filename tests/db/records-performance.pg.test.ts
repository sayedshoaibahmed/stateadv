/**
 * PERFORMANCE and scale checks for the calendar, old records and activity functions (migration 24; TEST_PLAN M7:
 * "multi-year data (2020-2035), performance with about 50k bookings"). PERF-01..
 *
 * They need a real PostgreSQL server (like concurrency.pg.test.ts), so they run ONLY when STATEADV_PG_URL is set
 * (PostgreSQL 17 in CI, or a throw-away local server); PGlite skips them. Fictional data only.
 *
 * Data: 50,000 bookings spread over 2020-2035 in two resorts, one plan row each, about 37,500 approved payments, 2,000
 * approved refunds and 100,000 audit rows. The time limits are deliberately generous (they catch a plan that scans
 * everything for every request, not small differences between machines); the answers are also checked against
 * independent SQL so a fast but wrong query cannot pass.
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

describe.skipIf(!RUN)(
  "scale: about 50,000 bookings over 2020-2035 (PERF-01..)",
  () => {
    it("PERF-01: the data is there: 50,000 bookings, the expected payments and refunds", async () => {
      const [c] = await q<{ b: string; p: string; r: string; a: string }>(
        `select (select count(*) from public.bookings where booking_code like 'PERF-%')::text b,
              (select count(*) from public.payments where payment_code like 'PERF-%')::text p,
              (select count(*) from public.refunds where refund_code like 'PERF-%')::text r,
              (select count(*) from public.audit_logs)::text a`,
      );
      expect(c.b).toBe(String(BOOKINGS));
      expect(Number(c.p)).toBe(BOOKINGS - Math.floor(BOOKINGS / 4));
      expect(Number(c.r)).toBe(Math.floor(BOOKINGS / 25));
      expect(Number(c.a)).toBeGreaterThanOrEqual(BOOKINGS * 2 - 1000);
    });

    it("PERF-02: a month of the calendar (all resorts, one resort) is fast and equals independent SQL, for years across the whole range", async () => {
      for (const [y, m] of [
        [2020, 1],
        [2026, 3],
        [2030, 9],
        [2035, 12],
      ] as const) {
        for (const resort of [null, w.resorts.A.id]) {
          const { ms, value } = await timed(() =>
            asUser<{
              check_ins: number;
              check_outs: number;
              staying: number;
              collected_paise: string;
            }>(
              `select check_ins, check_outs, staying, collected_paise::text from public.calendar_month($1, $2, $3)`,
              [y, m, resort],
            ),
          );
          expect(ms).toBeLessThan(2500);
          const first = `${y}-${String(m).padStart(2, "0")}-01`;
          const [o] = await q<{ ci: number; co: number; col: string }>(
            `select (select count(*) from public.bookings b where b.status not in ('cancelled','no_show') and ($2::uuid is null or b.resort_id = $2)
                    and (b.check_in_at at time zone 'Asia/Kolkata')::date >= $1::date and (b.check_in_at at time zone 'Asia/Kolkata')::date < ($1::date + interval '1 month'))::int ci,
                  (select count(*) from public.bookings b where b.status not in ('cancelled','no_show') and ($2::uuid is null or b.resort_id = $2)
                    and (b.check_out_at at time zone 'Asia/Kolkata')::date >= $1::date and (b.check_out_at at time zone 'Asia/Kolkata')::date < ($1::date + interval '1 month'))::int co,
                  (select coalesce(sum(p.amount_paise), 0) from public.payments p where p.status = 'approved' and ($2::uuid is null or p.resort_id = $2)
                    and p.payment_date >= $1::date and p.payment_date < ($1::date + interval '1 month'))::text col`,
            [first, resort],
          );
          expect(value.reduce((s, r) => s + r.check_ins, 0)).toBe(o.ci);
          expect(value.reduce((s, r) => s + r.check_outs, 0)).toBe(o.co);
          expect(
            value.reduce((s, r) => s + BigInt(r.collected_paise), BigInt(0)),
          ).toBe(BigInt(o.col));
          expect(value.some((r) => r.staying > 0)).toBe(true);
        }
      }
    });

    it("PERF-03: a day page is fast and its lists have the right sizes", async () => {
      for (const d of ["2020-06-15", "2026-03-10", "2033-11-02"]) {
        const { ms, value } = await timed(() =>
          asUser<{ kind: string; kind_total: string }>(
            `select kind, kind_total::text from public.calendar_day($1::date, null)`,
            [d],
          ),
        );
        expect(ms).toBeLessThan(2000);
        const [o] = await q<{ ci: string; pay: string }>(
          `select (select count(*) from public.bookings b where b.status not in ('cancelled','no_show') and (b.check_in_at at time zone 'Asia/Kolkata')::date = $1::date)::text ci,
                (select count(*) from public.payments p where p.payment_date = $1::date)::text pay`,
          [d],
        );
        expect(value.filter((r) => r.kind === "check_in").length).toBe(
          Math.min(300, Number(o.ci)),
        );
        expect(value.filter((r) => r.kind === "payment").length).toBe(
          Math.min(300, Number(o.pay)),
        );
      }
    });

    it("PERF-04: Old Records: a whole year of everything, a text search, and a search with no filter at all, each fast and counted right", async () => {
      const year = await timed(() =>
        asUser<{ total_rows: string }>(
          `select total_rows::text from public.old_records_search(null, null, null, 'record', '2027-01-01', '2027-12-31', 25, 0)`,
        ),
      );
      expect(year.ms).toBeLessThan(4000);
      const [o] = await q<{ n: string }>(
        `select ((select count(*) from public.bookings where booking_date between '2027-01-01' and '2027-12-31')
             + (select count(*) from public.payments where payment_date between '2027-01-01' and '2027-12-31')
             + (select count(*) from public.refunds where refund_date between '2027-01-01' and '2027-12-31'))::text n`,
      );
      expect(year.value[0].total_rows).toBe(o.n);
      const code = await timed(() =>
        asUser<{ record_type: string }>(
          `select record_type from public.old_records_search('PERF-2031-', null, null, 'record', null, null, 25, 0)`,
        ),
      );
      expect(code.ms).toBeLessThan(4000);
      expect(code.value.length).toBe(25);
      const name = await timed(() =>
        asUser(
          `select * from public.old_records_search('Perf Guest 500', null, array['booking'], 'record', null, null, 25, 0)`,
        ),
      );
      expect(name.ms).toBeLessThan(4000);
      const everything = await timed(() =>
        asUser<{ total_rows: string }>(
          `select total_rows::text from public.old_records_search(null, null, null, 'record', null, null, 25, 1000)`,
        ),
      );
      expect(everything.ms).toBeLessThan(8000);
      expect(Number(everything.value[0].total_rows)).toBe(
        BOOKINGS +
          (BOOKINGS - Math.floor(BOOKINGS / 4)) +
          Math.floor(BOOKINGS / 25),
      );
    });

    it("PERF-05: Activity: the first page, a date filter, and one booking's history are fast; the total matches", async () => {
      const first = await timed(() =>
        asUser<{ total_rows: string }>(
          `select total_rows::text from public.activity_list()`,
        ),
      );
      expect(first.ms).toBeLessThan(3000);
      const [all] = await q<{ n: string }>(
        `select count(*)::text n from public.audit_logs`,
      );
      expect(first.value[0].total_rows).toBe(all.n);
      const [{ d }] = await q<{ d: string }>(
        `select public.today_ist()::text d`,
      );
      const today = await timed(() =>
        asUser(
          `select * from public.activity_list(null, null, null, null, null, $1::date, $1::date)`,
          [d],
        ),
      );
      expect(today.ms).toBeLessThan(3000);
      const [{ id }] = await q<{ id: string }>(
        `select id::text from public.bookings where booking_seq = 777 and booking_code like 'PERF-%' limit 1`,
      );
      const one = await timed(() =>
        asUser(
          `select * from public.activity_list(null, null, null, null, $1::uuid)`,
          [id],
        ),
      );
      expect(one.ms).toBeLessThan(3000);
      const typed = await timed(() =>
        asUser(`select * from public.activity_list(null, 'update', 'payment')`),
      );
      expect(typed.ms).toBeLessThan(4000);
    });

    it("PERF-06: Old Records by the booking's check-in, check-out and cancellation dates is fast on 50,000 bookings and counted right (the payments and refunds come with their bookings)", async () => {
      for (const basis of ["check_in", "check_out"] as const) {
        const col = basis === "check_in" ? "check_in_at" : "check_out_at";
        const { ms, value } = await timed(() =>
          asUser<{ total_rows: string }>(
            `select total_rows::text from public.old_records_search(null, null, null, $1, '2027-01-01', '2027-12-31', 25, 0)`,
            [basis],
          ),
        );
        expect(ms).toBeLessThan(4000);
        const [o] = await q<{ n: string }>(
          `select ((select count(*) from public.bookings b where (b.${col} at time zone 'Asia/Kolkata')::date between '2027-01-01' and '2027-12-31')
               + (select count(*) from public.payments p join public.bookings b on b.id = p.booking_id where (b.${col} at time zone 'Asia/Kolkata')::date between '2027-01-01' and '2027-12-31')
               + (select count(*) from public.refunds r join public.bookings b on b.id = r.booking_id where (b.${col} at time zone 'Asia/Kolkata')::date between '2027-01-01' and '2027-12-31'))::text n`,
        );
        expect(value[0].total_rows).toBe(o.n);
      }
      // none of the 50,000 test bookings is cancelled: the cancellation choice finds nothing
      const none = await timed(() =>
        asUser<{ total_rows: string }>(
          `select total_rows::text from public.old_records_search(null, null, null, 'cancellation', null, null, 25, 0)`,
        ),
      );
      expect(none.ms).toBeLessThan(4000);
      expect(none.value).toEqual([]);
    });
  },
);
