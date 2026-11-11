/**
 * Owner requirement 2026-11-11: C/O categories and names, resorts and stay types are CONFIGURED by Managers and
 * Owners (CFG-CO, CFG-RES, CFG-STAY). History is protected: bookings keep their own copy of the names.
 * Runs on PGlite and on real PostgreSQL 17. Fictional data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { expectDbError } from "./harness";
import { dateOffset, setupWorld, uid, type World } from "./fixtures";

let w: World;
let disabled: string;
beforeAll(async () => {
  w = await setupWorld();
  disabled = uid();
  await w.db.q(
    `insert into auth.users (id, email) values ($1, 'cfg-off@test.example')`,
    [disabled],
  );
  await w.db.as({ role: "postgres", uid: w.owner }, async () => {
    await w.db.q(
      `insert into public.user_profiles (id, full_name, email, role) values ($1, 'Test Off', 'cfg-off@test.example', 'manager')`,
      [disabled],
    );
    await w.db.q(
      `update public.user_profiles set is_active = false, disabled_at = now() where id = $1`,
      [disabled],
    );
  });
}, 120_000);

// Test helper: rows and JSON results are inspected loosely on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const j = (x: unknown) => JSON.stringify(x);
const q = <T = Json>(sql: string, p?: unknown[]) => w.db.q<T>(sql, p);
const as = <T>(id: string | null, fn: () => Promise<T>) =>
  w.db.as({ role: "authenticated", uid: id }, fn);
const call = <T = Json>(
  sql: string,
  p?: unknown[],
  actor: string | null = w.manager,
) => as(actor, () => q<T>(sql, p));

async function payload(over: Json = {}): Promise<Json> {
  const in1 = await dateOffset(w.db, 2);
  return {
    resort_id: w.resorts.A.id,
    guest_id: w.guestId,
    pax: 2,
    co_category_id: w.cat.direct,
    stay_type_id: w.stayTypeId,
    booking_date: await dateOffset(w.db, 0),
    check_in_at: `${in1}T14:00:00+05:30`,
    check_out_at: `${await dateOffset(w.db, 3)}T11:00:00+05:30`,
    pricing_method: "per_person_per_stay",
    tariff_paise: 250000,
    ...over,
  };
}
async function newBooking(over: Json = {}, actor: string | null = w.manager) {
  const plan = [
    {
      label: "Balance",
      due_date: await dateOffset(w.db, 2),
      amount_paise: 500000,
    },
  ];
  const r = await call<{ r: Json }>(
    `select public.create_booking($1::jsonb, $2::jsonb, $3::uuid) as r`,
    [j(await payload(over)), j(plan), uid()],
    actor,
  );
  return r[0].r as { id: string; booking_code: string };
}
const booking = async (id: string) =>
  (await q(`select * from public.bookings where id = $1`, [id]))[0];
const edit = (
  id: string,
  version: number,
  p: Json,
  reason: string | null = null,
) =>
  call(`select public.update_booking($1, $2, $3::jsonb, null, 0, $4)`, [
    id,
    version,
    j(p),
    reason,
  ]);

const cat = async (
  name: string,
  mode = "listed",
  actor: string | null = w.manager,
) =>
  (
    await call<{ id: number }>(
      `select public.upsert_co_category(null, $1, $2) as id`,
      [name, mode],
      actor,
    )
  )[0].id;
const entry = async (
  categoryId: number,
  name: string,
  actor: string | null = w.manager,
) =>
  (
    await call<{ id: string }>(
      `select public.upsert_co_entry(null, $1::smallint, $2) as id`,
      [categoryId, name],
      actor,
    )
  )[0].id;
const resort = async (
  code: string,
  name: string,
  actor: string | null = w.manager,
) =>
  (
    await call<{ id: string }>(
      `select public.upsert_resort(null, $1, $2) as id`,
      [code, name],
      actor,
    )
  )[0].id;
const stay = async (name: string, actor: string | null = w.manager) =>
  (
    await call<{ id: number }>(
      `select public.upsert_stay_type(null, $1) as id`,
      [name],
      actor,
    )
  )[0].id;

// ========================================================================= C/O
describe("CFG-CO: C/O categories and names are configured by Managers and Owners", () => {
  it("CFG-CO-01: a Manager and an Owner can each add a category of any name and kind; the change is audited with the person", async () => {
    const a = await cat("Test Corporate", "listed", w.manager);
    const b = await cat("Test Walk-in referral", "typed", w.owner);
    const c = await cat("Test Website", "none", w.manager);
    const rows = await q<{
      name: string;
      name_mode: string;
      created_by: string;
      is_active: boolean;
    }>(
      `select name, name_mode, created_by, is_active from public.co_categories where id = any($1) order by id`,
      [[a, b, c]],
    );
    expect(rows).toEqual([
      {
        name: "Test Corporate",
        name_mode: "listed",
        created_by: w.manager,
        is_active: true,
      },
      {
        name: "Test Walk-in referral",
        name_mode: "typed",
        created_by: w.owner,
        is_active: true,
      },
      {
        name: "Test Website",
        name_mode: "none",
        created_by: w.manager,
        is_active: true,
      },
    ]);
    const au = await q<{ actor_id: string }>(
      `select actor_id from public.audit_logs where table_name = 'co_categories' and record_id = $1 and action = 'insert'`,
      [String(b)],
    );
    expect(au[0].actor_id).toBe(w.owner);
  });

  it("CFG-CO-02: there is no fixed number of categories", async () => {
    const before = (
      await q<{ n: number }>(`select count(*)::int n from public.co_categories`)
    )[0].n;
    for (let i = 0; i < 12; i++)
      await cat(
        `Test Extra ${i}`,
        i % 3 === 0 ? "typed" : i % 3 === 1 ? "none" : "listed",
      );
    expect(
      (
        await q<{ n: number }>(
          `select count(*)::int n from public.co_categories`,
        )
      )[0].n,
    ).toBe(before + 12);
  });

  it("CFG-CO-03: input is validated and names are unique ignoring capitals", async () => {
    await cat("Test Unique");
    await expectDbError(cat("  test unique "), "DUPLICATE");
    await expectDbError(cat(""), "INVALID_INPUT");
    await expectDbError(cat("   "), "INVALID_INPUT");
    await expectDbError(cat("x".repeat(61)), "INVALID_INPUT");
    await expectDbError(cat("Test Bad Mode", "sometimes"), "INVALID_INPUT");
    // no kind given: it is a list category (the most common kind)
    await call(
      `select public.upsert_co_category(null, 'Test Default Mode', null)`,
    );
    expect(
      (
        await q(
          `select name_mode from public.co_categories where name = 'Test Default Mode'`,
        )
      )[0].name_mode,
    ).toBe("listed");
  });

  it("CFG-CO-04: names are added to a LIST category only, edited freely, unique within the category, and cannot move", async () => {
    const corp = await cat("Test Corp List");
    const other = await cat("Test Other List");
    const typed = await cat("Test Typed Only", "typed");
    const e1 = await entry(corp, "Acme Test Ltd");
    await expectDbError(entry(corp, "acme test ltd"), "DUPLICATE");
    await entry(other, "Acme Test Ltd"); // same name, another category: fine
    await expectDbError(entry(typed, "Nope"), "INVALID_INPUT"); // a typed category has no list
    await expectDbError(entry(9999, "Nope"), "NOT_FOUND");
    await expectDbError(
      call(`select public.upsert_co_entry(null, $1::smallint, '  ')`, [corp]),
      "INVALID_INPUT",
    );
    await call(
      `select public.upsert_co_entry($1, $2::smallint, 'Acme Test Limited', '99999', 'Main contact', true)`,
      [e1, corp],
    );
    expect(
      (
        await q(
          `select name, mobile, notes from public.co_entries where id = $1`,
          [e1],
        )
      )[0],
    ).toEqual({
      name: "Acme Test Limited",
      mobile: "99999",
      notes: "Main contact",
    });
    await expectDbError(
      call(
        `select public.upsert_co_entry($1, $2::smallint, 'Acme Test Limited')`,
        [e1, other],
      ),
      "INVALID_INPUT",
    );
  });

  it("CFG-CO-05: a new category and name can be used on a new booking, and the booking keeps its own copy of the names", async () => {
    const c = await cat("Test Bookable");
    const e = await entry(c, "Test Travel Co");
    const b = await newBooking({ co_category_id: c, co_entry_id: e });
    expect(await booking(b.id)).toMatchObject({
      co_category_id: c,
      co_category_name: "Test Bookable",
      co_mode: "listed",
      co_entry_id: e,
      co_name: "Test Travel Co",
    });
    const t = await cat("Test Typed Source", "typed");
    expect(
      await booking(
        (
          await newBooking({
            co_category_id: t,
            co_name: "  A friend of the owner ",
          })
        ).id,
      ),
    ).toMatchObject({
      co_mode: "typed",
      co_entry_id: null,
      co_name: "A friend of the owner",
    });
    const n = await cat("Test No Name", "none");
    expect(
      await booking(
        (
          await newBooking({
            co_category_id: n,
            co_name: "ignored",
            co_entry_id: e,
          })
        ).id,
      ),
    ).toMatchObject({ co_mode: "none", co_entry_id: null, co_name: null });
  });

  it("CFG-CO-06: renaming a category or a name never rewrites an existing booking (history protected)", async () => {
    const c = await cat("Test Old Category");
    const e = await entry(c, "Test Old Name");
    const b = await newBooking({ co_category_id: c, co_entry_id: e });
    await call(
      `select public.upsert_co_category($1::smallint, 'Test Renamed Category', 'listed', true)`,
      [c],
    );
    await call(
      `select public.upsert_co_entry($1, $2::smallint, 'Test Renamed Name')`,
      [e, c],
    );
    expect(await booking(b.id)).toMatchObject({
      co_category_name: "Test Old Category",
      co_name: "Test Old Name",
    });
    const b2 = await newBooking({ co_category_id: c, co_entry_id: e });
    expect(await booking(b2.id)).toMatchObject({
      co_category_name: "Test Renamed Category",
      co_name: "Test Renamed Name",
    });
    // an unrelated edit of the old booking keeps its history too
    await edit(b.id, 1, { remarks: "Edited later" });
    expect(await booking(b.id)).toMatchObject({
      co_category_name: "Test Old Category",
      co_name: "Test Old Name",
      remarks: "Edited later",
    });
  });

  it("CFG-CO-07: switching a name off stops NEW bookings; old bookings stay readable and editable; switching on again works", async () => {
    const c = await cat("Test Switch");
    const e = await entry(c, "Test Switch Name");
    const old = await newBooking({ co_category_id: c, co_entry_id: e });
    await call(
      `select public.upsert_co_entry($1, $2::smallint, 'Test Switch Name', null, null, false)`,
      [e, c],
    );
    await expectDbError(
      newBooking({ co_category_id: c, co_entry_id: e }),
      "CO_INACTIVE",
    );
    expect(await booking(old.id)).toMatchObject({
      co_name: "Test Switch Name",
      co_entry_id: e,
    });
    await edit(old.id, 1, { remarks: "Still editable" });
    const other = await entry(c, "Test Other Name");
    await edit(old.id, 2, { co_entry_id: other }); // changing to an ACTIVE name is fine
    await expectDbError(edit(old.id, 3, { co_entry_id: e }), "CO_INACTIVE"); // changing BACK to the switched-off one is not
    await call(
      `select public.upsert_co_entry($1, $2::smallint, 'Test Switch Name', null, null, true)`,
      [e, c],
    );
    await newBooking({ co_category_id: c, co_entry_id: e });
  });

  it("CFG-CO-08: switching a category off stops NEW bookings; old ones stay; nothing is deleted", async () => {
    const c = await cat("Test Off Category", "typed");
    const old = await newBooking({ co_category_id: c, co_name: "Somebody" });
    await call(
      `select public.upsert_co_category($1::smallint, 'Test Off Category', 'typed', false)`,
      [c],
    );
    await expectDbError(
      newBooking({ co_category_id: c, co_name: "Somebody" }),
      "CO_INACTIVE",
    );
    expect(await booking(old.id)).toMatchObject({
      co_category_name: "Test Off Category",
      co_name: "Somebody",
    });
    await edit(old.id, 1, { remarks: "Still fine" });
    await edit(old.id, 2, { co_name: "Somebody Else" }); // the typed name of an old booking can still be corrected
    expect((await booking(old.id)).co_name).toBe("Somebody Else");
    expect(
      (await q(`select 1 from public.co_categories where id = $1`, [c])).length,
    ).toBe(1);
    await expectDbError(
      q(`delete from public.co_categories where id = $1`, [c]),
      "DELETE_NOT_ALLOWED",
    );
  });

  it("CFG-CO-09: a changed mode does not disturb old bookings; a booking can move to another category", async () => {
    const c = await cat("Test Mode Change");
    const e = await entry(c, "Test Mode Name");
    const old = await newBooking({ co_category_id: c, co_entry_id: e });
    await call(
      `select public.upsert_co_category($1::smallint, 'Test Mode Change', 'none', true)`,
      [c],
    );
    expect(await booking(old.id)).toMatchObject({
      co_mode: "listed",
      co_name: "Test Mode Name",
    });
    await edit(old.id, 1, { remarks: "Edited after the mode changed" }); // nothing about C/O changes
    expect(await booking(old.id)).toMatchObject({
      co_mode: "listed",
      co_name: "Test Mode Name",
    });
    await edit(old.id, 2, { co_category_id: w.cat.direct }); // moving to Direct clears the name and the list entry
    expect(await booking(old.id)).toMatchObject({
      co_category_name: "Direct",
      co_mode: "none",
      co_entry_id: null,
      co_name: null,
    });
    await edit(old.id, 3, {
      co_category_id: w.cat.agent,
      co_entry_id: w.agentId,
    });
    expect(await booking(old.id)).toMatchObject({
      co_category_name: "Agent",
      co_name: "Test Agent",
    });
    await expectDbError(
      edit(old.id, 4, { co_category_id: w.cat.partner }),
      "CO_TYPE_MISMATCH",
    ); // the Agent name is not in the Partner list
  });

  it("CFG-CO-10: the database itself keeps names and categories together and the copies honest, whoever writes", async () => {
    const b = await newBooking({
      co_category_id: w.cat.agent,
      co_entry_id: w.agentId,
    });
    const direct = (sql: string, p: unknown[]) =>
      w.db.as({ role: "postgres", uid: w.owner }, () => q(sql, p));
    // pointing a booking at another category's name is refused
    await expectDbError(
      direct(`update public.bookings set co_entry_id = $2 where id = $1`, [
        b.id,
        w.partnerId,
      ]),
      "CO_TYPE_MISMATCH",
    );
    // the copies cannot be overwritten
    await direct(
      `update public.bookings set co_category_name = 'Hacked', stay_type_name = 'Hacked', co_name = 'Hacked' where id = $1`,
      [b.id],
    );
    expect(await booking(b.id)).toMatchObject({
      co_category_name: "Agent",
      stay_type_name: "Resort Stay",
      co_name: "Test Agent",
    });
    // a direct insert cannot invent them either
    const id = uid();
    const plan = async () => {
      await q(
        `insert into public.payment_plan_revisions (booking_id, revision_no, source, amount_due_before, amount_due_after) select id, 1, 'created', null, amount_due_paise from public.bookings where id = $1`,
        [id],
      );
      await q(
        `insert into public.payment_schedules (booking_id, revision_id, line_no, label, due_date, amount_paise) select $1, r.id, 1, 'Balance', public.today_ist() + 2, 500000 from public.payment_plan_revisions r where r.booking_id = $1`,
        [id],
      );
    };
    await w.db.tx({ role: "postgres", uid: w.owner }, async () => {
      await q(
        `insert into public.bookings (id, booking_code, resort_id, booking_year, booking_seq, guest_id, guest_name, guest_mobile, pax, co_category_id, co_category_name, co_mode, co_entry_id, co_name,
           stay_type_id, stay_type_name, booking_date, check_in_at, check_out_at, nights, pricing_method, tariff_per_person_paise, base_amount_paise, idempotency_key)
         values ($1, 'AAA-2026-008888', $2, 2026, 8888, $3, 'T', '9876543210', 2, $4, 'Fake', 'none', $5, 'Fake', $6, 'Fake', public.today_ist(),
           now() + interval '2 days', now() + interval '3 days', 1, 'per_person_per_stay', 250000, 500000, $7)`,
        [
          id,
          w.resorts.A.id,
          w.guestId,
          w.cat.agent,
          w.agentId,
          w.stayTypeId,
          uid(),
        ],
      );
      await plan();
    });
    expect(await booking(id)).toMatchObject({
      co_category_name: "Agent",
      co_mode: "listed",
      co_name: "Test Agent",
      stay_type_name: "Resort Stay",
    });
  });

  it("CFG-CO-12: the database refuses a NEW booking with a switched-off or unknown choice even when the function is skipped", async () => {
    const raw = (
      cat: number,
      entryId: string | null,
      stayId: number,
      resortId = w.resorts.A.id,
    ) =>
      w.db.as({ role: "postgres", uid: w.owner }, () =>
        q(
          `insert into public.bookings (id, booking_code, resort_id, booking_year, booking_seq, guest_id, guest_name, guest_mobile, pax,
             co_category_id, co_entry_id, stay_type_id, booking_date, check_in_at, check_out_at, nights, pricing_method,
             tariff_per_person_paise, base_amount_paise, idempotency_key)
           values ($1, 'AAA-2026-007777', $2, 2026, 7777, $3, 'T', '9876543210', 2, $4, $5, $6, public.today_ist(),
             now() + interval '2 days', now() + interval '3 days', 1, 'per_person_per_stay', 250000, 500000, $7)`,
          [uid(), resortId, w.guestId, cat, entryId, stayId, uid()],
        ),
      );
    const offCat = await cat("Test Raw Off Category", "none");
    await call(
      `select public.upsert_co_category($1::smallint, 'Test Raw Off Category', 'none', false)`,
      [offCat],
    );
    await expectDbError(raw(offCat, null, w.stayTypeId), "CO_INACTIVE");
    await expectDbError(raw(9999, null, w.stayTypeId), "CO_TYPE_MISMATCH");

    const listed = await cat("Test Raw Listed");
    const offEntry = await entry(listed, "Test Raw Off Name");
    await call(
      `select public.upsert_co_entry($1, $2::smallint, 'Test Raw Off Name', null, null, false)`,
      [offEntry, listed],
    );
    await expectDbError(raw(listed, offEntry, w.stayTypeId), "CO_INACTIVE");
    await expectDbError(
      raw(w.cat.partner, w.agentId, w.stayTypeId),
      "CO_TYPE_MISMATCH",
    ); // a name from another category
    await expectDbError(raw(listed, null, w.stayTypeId), "CO_TYPE_MISMATCH"); // a list category needs a name

    const offStay = await stay("Test Raw Off Stay");
    await call(
      `select public.upsert_stay_type($1::smallint, 'Test Raw Off Stay', false)`,
      [offStay],
    );
    await expectDbError(raw(w.cat.direct, null, offStay), "STAY_TYPE_INACTIVE");
    await expectDbError(raw(w.cat.direct, null, 32000), "STAY_TYPE_INACTIVE");

    const offResort = await resort("RAW", "Test Raw Off Resort");
    await call(`select public.set_resort_active($1, false)`, [offResort]);
    await expectDbError(
      raw(w.cat.direct, null, w.stayTypeId, offResort),
      "RESORT_INACTIVE",
    );
  });

  it("CFG-CO-11: Managers and Owners may configure; everyone else is refused", async () => {
    const calls = [
      `select public.upsert_co_category(null, 'Test Denied')`,
      `select public.upsert_co_entry(null, ${w.cat.agent}::smallint, 'Test Denied')`,
    ];
    for (const sql of calls) {
      await call(
        sql.replace("Denied", `Ok ${uid().slice(0, 6)}`),
        [],
        w.manager,
      );
      await call(sql.replace("Denied", `Ok ${uid().slice(0, 6)}`), [], w.owner);
      await expectDbError(call(sql, [], null), "NOT_ALLOWED");
      await expectDbError(call(sql, [], uid()), "NOT_ALLOWED");
      await expectDbError(call(sql, [], disabled), "NOT_ALLOWED");
      await expectDbError(
        w.db.as({ role: "anon" }, () => q(sql)),
        "permission denied",
      );
    }
    // no direct write either
    await expectDbError(
      call(`insert into public.co_categories (name) values ('Test Direct')`),
      "permission denied",
    );
    await expectDbError(
      call(`update public.co_entries set name = 'x'`),
      "permission denied",
    );
    expect(
      (await call(`select count(*)::int n from public.co_categories`))[0].n,
    ).toBeGreaterThan(4); // reading is allowed
    expect(
      (await w.db.as({ role: "anon" }, () =>
        q(`select 1 from public.co_categories`).catch(() => "denied"),
      )) as unknown,
    ).toBe("denied");
  });
});

// ===================================================================== RESORTS
describe("CFG-RES: resorts are configured by Managers and Owners", () => {
  it("CFG-RES-01: the four starting resorts are placeholders, not special: not hard-coded anywhere", async () => {
    const rows = await q<{ code: string; name: string }>(
      `select code, name from public.resorts where code like 'SR_' order by code`,
    );
    expect(rows).toEqual([
      { code: "SR1", name: "Sample Resort One" },
      { code: "SR2", name: "Sample Resort Two" },
      { code: "SR3", name: "Sample Resort Three" },
      { code: "SR4", name: "Sample Resort Four" },
    ]);
    // they can be used straight away like any other resort
    const id = (
      await q<{ id: string }>(
        `select id from public.resorts where code = 'SR1'`,
      )
    )[0].id;
    const b = await newBooking({ resort_id: id });
    expect(b.booking_code).toMatch(/^SR1-\d{4}-000001$/);
  });

  it("CFG-RES-02: a Manager and an Owner can add as many resorts as they need", async () => {
    const before = (
      await q<{ n: number }>(`select count(*)::int n from public.resorts`)
    )[0].n;
    await resort("FIF", "Test Fifth Resort", w.manager);
    await resort("SIX", "Test Sixth Resort", w.owner);
    for (let i = 0; i < 10; i++)
      await resort(`T${i}X`, `Test Resort Number ${i}`);
    expect(
      (await q<{ n: number }>(`select count(*)::int n from public.resorts`))[0]
        .n,
    ).toBe(before + 12);
  });

  it("CFG-RES-03: name, location, contact and logo are editable at any time; the code is editable only until the first booking", async () => {
    const id = await resort("EDT", "Test Edit Resort");
    await call(
      `select public.upsert_resort($1, 'EDT', 'Test Renamed Resort', 'Test Valley', '+91 99999 00000')`,
      [id],
    );
    expect(
      (
        await q(
          `select name, location, contact_number from public.resorts where id = $1`,
          [id],
        )
      )[0],
    ).toEqual({
      name: "Test Renamed Resort",
      location: "Test Valley",
      contact_number: "+91 99999 00000",
    });
    await call(
      `select public.upsert_resort($1, 'ED2', 'Test Renamed Resort')`,
      [id],
    ); // no booking yet: the code may change
    const b = await newBooking({ resort_id: id });
    expect(b.booking_code).toMatch(/^ED2-/);
    await expectDbError(
      call(`select public.upsert_resort($1, 'ED3', 'Test Renamed Resort')`, [
        id,
      ]),
      "RESORT_CODE_LOCKED",
    );
    await call(
      `select public.upsert_resort($1, 'ED2', 'Test Another Name', 'Elsewhere')`,
      [id],
    ); // everything else stays editable
    const logo = `${id}/${uid()}.png`;
    await q(
      `insert into storage.objects (bucket_id, name) values ('resort-logos', $1)`,
      [logo],
    );
    await call(
      `select public.upsert_resort($1, 'ED2', 'Test Another Name', 'Elsewhere', null, $2)`,
      [id, logo],
    );
    expect(
      (await q(`select logo_path from public.resorts where id = $1`, [id]))[0]
        .logo_path,
    ).toBe(logo);
  });

  it("CFG-RES-04: editing a resort never changes an existing Booking ID, and numbering carries on", async () => {
    const id = await resort("KEP", "Test Keep Resort");
    const first = await newBooking({ resort_id: id });
    await call(
      `select public.upsert_resort($1, 'KEP', 'Test Completely New Name', 'Somewhere else', '12345')`,
      [id],
    );
    expect((await booking(first.id)).booking_code).toBe(first.booking_code);
    const second = await newBooking({ resort_id: id });
    expect(second.booking_code).toBe(
      first.booking_code.replace(/000001$/, "000002"),
    );
    // the audit history of the resort names who changed it
    const au = await q<{ actor_id: string }>(
      `select actor_id from public.audit_logs where table_name = 'resorts' and record_id = $1 and action = 'update' order by id desc limit 1`,
      [id],
    );
    expect(au[0].actor_id).toBe(w.manager);
  });

  it("CFG-RES-05: a switched-off resort takes no NEW booking, but its history, payments and edits are untouched", async () => {
    const id = await resort("OFF", "Test Off Resort");
    const b = await newBooking({ resort_id: id });
    await call(`select public.set_resort_active($1, false)`, [id]);
    await expectDbError(newBooking({ resort_id: id }), "RESORT_INACTIVE");
    expect((await booking(b.id)).booking_code).toBe(b.booking_code); // still there, readable
    await edit(b.id, 1, { remarks: "Edited while the resort is switched off" });
    const pay = await call<{ r: Json }>(
      `select public.add_payment($1::jsonb, null, $2::uuid) as r`,
      [
        j({
          booking_id: b.id,
          amount_paise: 1000,
          method: "cash",
          payment_date: await dateOffset(w.db, 0),
        }),
        uid(),
      ],
    );
    await call(`select public.approve_payment($1, 1)`, [pay[0].r.id], w.owner);
    await call(
      `select public.upsert_resort($1, 'OFF', 'Test Off Resort Renamed')`,
      [id],
    ); // can still be edited
    await call(`select public.set_resort_active($1, true)`, [id]);
    await newBooking({ resort_id: id });
  });

  it("CFG-RES-06: resort rules: unique code and name, valid code, switch on/off both ways", async () => {
    await resort("UNQ", "Test Unique Resort");
    await expectDbError(
      resort("UNQ", "Test Another Name Entirely"),
      "DUPLICATE",
    );
    await expectDbError(resort("UN2", "test unique resort"), "DUPLICATE");
    for (const bad of ["A", "ab-c", "ABCDEFGHIJK", "  "])
      await expectDbError(resort(bad, "Test Bad Code Resort"), "INVALID_INPUT");
    expect((await resort("low", "Test Lower Case Resort")) !== "").toBe(true);
    expect(
      (
        await q(
          `select code from public.resorts where name = 'Test Lower Case Resort'`,
        )
      )[0].code,
    ).toBe("LOW");
  });

  it("CFG-RES-07: Managers and Owners may manage resorts; everyone else is refused", async () => {
    const id = await resort("AUT", "Test Auth Resort");
    const calls = [
      `select public.upsert_resort(null, 'DEN', 'Test Denied Resort')`,
      `select public.set_resort_active('${id}', false)`,
    ];
    for (const sql of calls) {
      await expectDbError(call(sql, [], null), "NOT_ALLOWED");
      await expectDbError(call(sql, [], uid()), "NOT_ALLOWED");
      await expectDbError(call(sql, [], disabled), "NOT_ALLOWED");
      await expectDbError(
        w.db.as({ role: "anon" }, () => q(sql)),
        "permission denied",
      );
    }
    await call(`select public.set_resort_active($1, false)`, [id], w.owner);
    await call(`select public.set_resort_active($1, true)`, [id], w.manager);
  });
});

// ================================================================== STAY TYPES
describe("CFG-STAY: stay types are configured by Managers and Owners", () => {
  it("CFG-STAY-01: any number of stay types, any name; Manager and Owner both can add", async () => {
    const before = (
      await q<{ n: number }>(`select count(*)::int n from public.stay_types`)
    )[0].n;
    const a = await stay("Test Honeymoon Package", w.manager);
    const b = await stay("Test Corporate Retreat", w.owner);
    for (let i = 0; i < 15; i++) await stay(`Test Type ${i}`);
    expect(
      (
        await q<{ n: number }>(`select count(*)::int n from public.stay_types`)
      )[0].n,
    ).toBe(before + 17);
    const book = await newBooking({ stay_type_id: a });
    expect((await booking(book.id)).stay_type_name).toBe(
      "Test Honeymoon Package",
    );
    await newBooking({ stay_type_id: b });
  });

  it("CFG-STAY-02: renaming never rewrites an existing booking; new bookings use the new name", async () => {
    const id = await stay("Test Old Stay Name");
    const old = await newBooking({ stay_type_id: id });
    await call(
      `select public.upsert_stay_type($1::smallint, 'Test New Stay Name')`,
      [id],
    );
    expect((await booking(old.id)).stay_type_name).toBe("Test Old Stay Name");
    expect(
      (await booking((await newBooking({ stay_type_id: id })).id))
        .stay_type_name,
    ).toBe("Test New Stay Name");
    await edit(old.id, 1, { remarks: "Edited later" });
    expect((await booking(old.id)).stay_type_name).toBe("Test Old Stay Name");
  });

  it("CFG-STAY-03: switching a stay type off stops NEW use; old bookings stay readable and editable", async () => {
    const id = await stay("Test Seasonal Stay");
    const other = await stay("Test Active Stay");
    const old = await newBooking({ stay_type_id: id });
    await call(
      `select public.upsert_stay_type($1::smallint, 'Test Seasonal Stay', false)`,
      [id],
    );
    await expectDbError(newBooking({ stay_type_id: id }), "STAY_TYPE_INACTIVE");
    expect(await booking(old.id)).toMatchObject({
      stay_type_id: id,
      stay_type_name: "Test Seasonal Stay",
    });
    await edit(old.id, 1, { remarks: "Still editable" });
    await edit(old.id, 2, { stay_type_id: other });
    expect((await booking(old.id)).stay_type_name).toBe("Test Active Stay");
    await expectDbError(
      edit(old.id, 3, { stay_type_id: id }),
      "STAY_TYPE_INACTIVE",
    );
    await expectDbError(newBooking({ stay_type_id: 32000 }), "INVALID_INPUT");
    await call(
      `select public.upsert_stay_type($1::smallint, 'Test Seasonal Stay', true)`,
      [id],
    );
    await newBooking({ stay_type_id: id });
    expect(
      (await q(`select 1 from public.stay_types where id = $1`, [id])).length,
    ).toBe(1); // never deleted
    await expectDbError(
      q(`delete from public.stay_types where id = $1`, [id]),
      "DELETE_NOT_ALLOWED",
    );
  });

  it("CFG-STAY-04: names are unique ignoring capitals; sort order; authorization", async () => {
    await stay("Test Unique Stay");
    await expectDbError(stay("test unique stay"), "DUPLICATE");
    await expectDbError(stay(""), "INVALID_INPUT");
    await expectDbError(stay("x".repeat(61)), "INVALID_INPUT");
    const sql = `select public.upsert_stay_type(null, 'Test Denied Stay')`;
    await expectDbError(call(sql, [], null), "NOT_ALLOWED");
    await expectDbError(call(sql, [], uid()), "NOT_ALLOWED");
    await expectDbError(call(sql, [], disabled), "NOT_ALLOWED");
    await expectDbError(
      w.db.as({ role: "anon" }, () => q(sql)),
      "permission denied",
    );
    await expectDbError(
      call(`insert into public.stay_types (name) values ('Test Direct')`),
      "permission denied",
    );
  });
});
