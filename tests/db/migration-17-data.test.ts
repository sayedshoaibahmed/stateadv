/**
 * Migration 17 must CONVERT existing data, never lose it (the hosted project is empty today, but this proves the
 * conversion is data-preserving for any database that already has bookings).
 *
 * The database is built up to migration 16 (the OLD fixed C/O lists), filled with bookings that use all four old
 * categories, a payment and a plan, and only then do migrations 17 and 18 run.
 * Runs on PGlite and on real PostgreSQL 17. Fictional data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type TestDb } from "./harness";
import { uid } from "./fixtures";

let db: TestDb;
// Test helper: rows are inspected loosely on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const owner = uid();
const resort = uid();
const guest = uid();
const agentEntry = uid();
const partnerEntry = uid();
const ids = { agent: uid(), partner: uid(), own: uid(), direct: uid() };
let before: Row[];
let stayTypeName: string;
let paymentId: string;

beforeAll(async () => {
  db = await createDb({ upTo: "20261111000016_refund_limits.sql" });

  // --- the OLD structure: enums and agents_partners ---
  expect(
    (await db.q(`select 1 from pg_type where typname = 'co_category'`)).length,
  ).toBe(1);
  expect(
    (await db.q(`select to_regclass('public.agents_partners') as t`))[0].t,
  ).not.toBeNull();

  await db.exec(
    `insert into auth.users (id, email) values ('${owner}', 'legacy-owner@test.example')`,
  );
  await db.q(
    `insert into public.user_profiles (id, full_name, email, role) values ($1, 'Test Legacy Owner', 'legacy-owner@test.example', 'owner')`,
    [owner],
  );
  await db.as({ role: "postgres", uid: owner }, async () => {
    await db.q(
      `insert into public.resorts (id, code, name) values ($1, 'LEG', 'Test Legacy Resort')`,
      [resort],
    );
    await db.q(
      `insert into public.guests (id, full_name, mobile) values ($1, 'Test Legacy Guest', '9876543210')`,
      [guest],
    );
    await db.q(
      `insert into public.agents_partners (id, type, name) values ($1, 'agent', 'Legacy Agent'), ($2, 'partner', 'Legacy Partner')`,
      [agentEntry, partnerEntry],
    );
  });
  stayTypeName = (
    await db.q<Row>(`select name from public.stay_types where name = 'Package'`)
  )[0].name;
  const stayId = (
    await db.q<Row>(`select id from public.stay_types where name = 'Package'`)
  )[0].id;

  const rows: Array<[keyof typeof ids, string, string | null, string | null]> =
    [
      ["agent", "agent", agentEntry, "Legacy Agent"],
      ["partner", "partner", partnerEntry, "Legacy Partner"],
      ["own", "own", null, "Legacy Cousin"],
      ["direct", "direct", null, null],
    ];
  let seq = 0;
  for (const [key, cat, entry, name] of rows) {
    seq++;
    await db.tx({ role: "postgres", uid: owner }, async () => {
      await db.q(
        `insert into public.bookings (id, booking_code, resort_id, booking_year, booking_seq, guest_id, guest_name, guest_mobile, pax,
           co_category, agent_partner_id, co_name, stay_type_id, booking_date, check_in_at, check_out_at, nights, pricing_method,
           tariff_per_person_paise, base_amount_paise, idempotency_key)
         values ($1, $2, $3, 2026, $4, $5, 'Test Legacy Guest', '9876543210', 2, $6::public.co_category, $7, $8, $9, '2026-05-05',
           '2026-05-06 14:00+05:30', '2026-05-07 11:00+05:30', 1, 'per_person_per_stay', 250000, 500000, $10)`,
        [
          ids[key],
          `LEG-2026-${String(seq).padStart(6, "0")}`,
          resort,
          seq,
          guest,
          cat,
          entry,
          name,
          stayId,
          uid(),
        ],
      );
      await db.q(
        `insert into public.payment_plan_revisions (booking_id, revision_no, source, amount_due_before, amount_due_after, locked_total_paise) values ($1, 1, 'created', null, 500000, 0)`,
        [ids[key]],
      );
      await db.q(
        `insert into public.payment_schedules (booking_id, revision_id, line_no, label, due_date, amount_paise)
                  select $1, id, 1, 'Balance', '2099-01-01', 500000 from public.payment_plan_revisions where booking_id = $1`,
        [ids[key]],
      );
    });
  }
  // a payment (money record) on the first booking
  paymentId = (
    await db.as({ role: "postgres", uid: owner }, () =>
      db.q<Row>(
        `insert into public.payments (booking_id, amount_paise, method, payment_date, idempotency_key) values ($1, 200000, 'cash', '2026-05-05', $2) returning id`,
        [ids.agent, uid()],
      ),
    )
  )[0].id;
  await db.as({ role: "postgres", uid: owner }, () =>
    db.q(`update public.payments set status = 'approved' where id = $1`, [
      paymentId,
    ]),
  );

  before = await db.q<Row>(
    `select b.id, b.booking_code, b.resort_id, b.final_amount_paise::text final, b.amount_due_paise::text due, b.status::text status, b.nights, b.guest_name,
            (select sum(amount_paise)::text from public.payments p where p.booking_id = b.id and p.status = 'approved') paid
       from public.bookings b order by b.booking_code`,
  );
  expect(before).toHaveLength(4);

  await db.applyRest!(); // migrations 17 and 18
}, 180_000);

describe("MIG17: migration 17 converts existing data without loss", () => {
  it("MIG17-01: every booking keeps its code, resort, amounts, status, payments", async () => {
    const after = await db.q<Row>(
      `select b.id, b.booking_code, b.resort_id, b.final_amount_paise::text final, b.amount_due_paise::text due, b.status::text status, b.nights, b.guest_name,
              (select sum(amount_paise)::text from public.payments p where p.booking_id = b.id and p.status = 'approved') paid
         from public.bookings b order by b.booking_code`,
    );
    expect(after).toEqual(before);
  });

  it("MIG17-02: each old category became the matching new category, with the copies of the names filled in", async () => {
    const rows = await db.q<Row>(
      `select booking_code, co_category_name, co_mode, co_name, co_entry_id, stay_type_name, c.name as live_category
         from public.bookings b join public.co_categories c on c.id = b.co_category_id order by booking_code`,
    );
    expect(rows).toEqual([
      {
        booking_code: "LEG-2026-000001",
        co_category_name: "Agent",
        co_mode: "listed",
        co_name: "Legacy Agent",
        co_entry_id: agentEntry,
        stay_type_name: stayTypeName,
        live_category: "Agent",
      },
      {
        booking_code: "LEG-2026-000002",
        co_category_name: "Partner",
        co_mode: "listed",
        co_name: "Legacy Partner",
        co_entry_id: partnerEntry,
        stay_type_name: stayTypeName,
        live_category: "Partner",
      },
      {
        booking_code: "LEG-2026-000003",
        co_category_name: "Own",
        co_mode: "typed",
        co_name: "Legacy Cousin",
        co_entry_id: null,
        stay_type_name: stayTypeName,
        live_category: "Own",
      },
      {
        booking_code: "LEG-2026-000004",
        co_category_name: "Direct",
        co_mode: "none",
        co_name: null,
        co_entry_id: null,
        stay_type_name: stayTypeName,
        live_category: "Direct",
      },
    ]);
  });

  it("MIG17-03: the old agents and partners kept their ids and names and now belong to the right category", async () => {
    const rows = await db.q<Row>(
      `select e.id, e.name, c.name as category from public.co_entries e join public.co_categories c on c.id = e.category_id order by e.name`,
    );
    expect(rows).toEqual([
      { id: agentEntry, name: "Legacy Agent", category: "Agent" },
      { id: partnerEntry, name: "Legacy Partner", category: "Partner" },
    ]);
  });

  it("MIG17-04: the old structure is gone, nothing is left half-converted", async () => {
    expect(
      (
        await db.q(
          `select 1 from pg_type where typname in ('co_category', 'partner_type')`,
        )
      ).length,
    ).toBe(0);
    expect(
      (await db.q<Row>(`select to_regclass('public.agents_partners') as t`))[0]
        .t,
    ).toBeNull();
    expect(
      (
        await db.q(
          `select 1 from information_schema.columns where table_schema = 'public' and ((table_name = 'bookings' and column_name in ('co_category', 'agent_partner_id')) or (table_name = 'co_entries' and column_name = 'type'))`,
        )
      ).length,
    ).toBe(0);
    // leftover names that still carry the old table name
    expect(
      (
        await db.q(
          `select 1 from pg_constraint where conrelid = 'public.co_entries'::regclass and conname like 'agents%'`,
        )
      ).length,
    ).toBe(0);
    expect(
      (
        await db.q(
          `select 1 from pg_indexes where schemaname = 'public' and tablename = 'co_entries' and indexname like 'agents%'`,
        )
      ).length,
    ).toBe(0);
  });

  it("MIG17-05: the starting categories and the four placeholder resorts exist next to the old data", async () => {
    expect(
      (
        await db.q<Row>(
          `select name from public.co_categories order by sort_order`,
        )
      ).map((r) => r.name),
    ).toEqual(["Agent", "Partner", "Own", "Direct"]);
    expect(
      (
        await db.q<Row>(
          `select code from public.resorts where code like 'SR_' order by code`,
        )
      ).map((r) => r.code),
    ).toEqual(["SR1", "SR2", "SR3", "SR4"]);
    expect(
      (await db.q(`select 1 from public.resorts where code = 'LEG'`)).length,
    ).toBe(1);
  });

  it("MIG17-06: the converted bookings work with the new functions: edit, new booking with the old name, rename without rewriting", async () => {
    const asOwner = <T>(fn: () => Promise<T>) =>
      db.as({ role: "authenticated", uid: owner }, fn);
    // The conversion touched each booking once, so its version went up by one (anyone with an edit screen open at
    // that moment is simply asked to reload). Nothing else about the booking changed (MIG17-01).
    const version = (
      await db.q<Row>(`select version from public.bookings where id = $1`, [
        ids.agent,
      ])
    )[0].version;
    expect(version).toBe(2);
    await asOwner(() =>
      db.q(
        `select public.update_booking($1, $2, '{"remarks": "Edited after the conversion"}'::jsonb)`,
        [ids.agent, version],
      ),
    );
    expect(
      (
        await db.q<Row>(
          `select remarks, co_name from public.bookings where id = $1`,
          [ids.agent],
        )
      )[0],
    ).toEqual({
      remarks: "Edited after the conversion",
      co_name: "Legacy Agent",
    });
    const cat = (
      await db.q<Row>(
        `select id from public.co_categories where name = 'Agent'`,
      )
    )[0].id;
    const stay = (
      await db.q<Row>(`select id from public.stay_types where name = 'Package'`)
    )[0].id;
    const payload = {
      resort_id: resort,
      guest_id: guest,
      pax: 2,
      co_category_id: cat,
      co_entry_id: agentEntry,
      stay_type_id: stay,
      booking_date: "2026-06-06",
      check_in_at: "2099-01-01T14:00:00+05:30",
      check_out_at: "2099-01-02T11:00:00+05:30",
      pricing_method: "per_person_per_stay",
      tariff_paise: 250000,
    };
    const plan = [
      { label: "Balance", due_date: "2099-01-01", amount_paise: 500000 },
    ];
    const made = await asOwner(() =>
      db.q<Row>(
        `select public.create_booking($1::jsonb, $2::jsonb, $3::uuid) as r`,
        [JSON.stringify(payload), JSON.stringify(plan), uid()],
      ),
    );
    expect(made[0].r.booking_code).toBe("LEG-2026-000005"); // numbering continues; the old counter was not disturbed
    await asOwner(() =>
      db.q(
        `select public.upsert_co_category($1::smallint, 'Agents (renamed)', 'listed')`,
        [cat],
      ),
    );
    expect(
      (
        await db.q<Row>(
          `select co_category_name from public.bookings where id = $1`,
          [ids.agent],
        )
      )[0].co_category_name,
    ).toBe("Agent");
  });

  it("MIG17-07: security stayed in place for the renamed and the new table", async () => {
    const rls = await db.q<Row>(
      `select tablename, rowsecurity from pg_tables where schemaname = 'public' and tablename in ('co_entries', 'co_categories') order by 1`,
    );
    expect(rls).toEqual([
      { tablename: "co_categories", rowsecurity: true },
      { tablename: "co_entries", rowsecurity: true },
    ]);
    const priv = await db.q<Row>(
      `select c.relname, has_table_privilege('authenticated', c.oid, 'SELECT') sel, has_table_privilege('authenticated', c.oid, 'INSERT') ins,
              has_table_privilege('anon', c.oid, 'SELECT') anon_sel
         from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('co_entries', 'co_categories') order by 1`,
    );
    expect(priv).toEqual([
      { relname: "co_categories", sel: true, ins: false, anon_sel: false },
      { relname: "co_entries", sel: true, ins: false, anon_sel: false },
    ]);
    const trg = await db.q<Row>(
      `select c.relname, count(*)::int n from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname in ('co_entries', 'co_categories') and not t.tgisinternal group by 1 order by 1`,
    );
    expect(trg.every((r) => r.n >= 5)).toBe(true); // no-delete, no-truncate, stamps, audit
  });
});
