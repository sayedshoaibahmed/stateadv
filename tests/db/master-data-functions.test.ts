/**
 * Master data functions (migration 13). PGlite stand-in only; fictional data.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { expectDbError } from "./harness";
import { setupWorld, uid, type World } from "./fixtures";

let w: World;
beforeAll(async () => {
  w = await setupWorld();
}, 120_000);

const q = <T = Record<string, unknown>>(sql: string, p?: unknown[]) =>
  w.db.q<T>(sql, p);
const call = <T = Record<string, unknown>>(
  id: string | null,
  sql: string,
  p?: unknown[],
) => w.db.as({ role: "authenticated", uid: id }, () => q<T>(sql, p));

describe("resorts", () => {
  it("MDF-01: any active user adds a resort; the code is stored in capitals; audited", async () => {
    const [{ id }] = await call<{ id: string }>(
      w.manager,
      `select public.upsert_resort(null, ' tst1 ', ' Test Resort One ', 'Somewhere', '12345') as id`,
    );
    const r = await q<{ code: string; name: string; created_by: string }>(
      `select code, name, created_by from public.resorts where id = $1`,
      [id],
    );
    expect(r[0]).toEqual({
      code: "TST1",
      name: "Test Resort One",
      created_by: w.manager,
    });
    const a = await q(
      `select 1 from public.audit_logs where table_name = 'resorts' and record_id = $1 and actor_id = $2`,
      [id, w.manager],
    );
    expect(a.length).toBe(1);
  });

  it("MDF-02: bad codes, empty names and duplicates are refused with plain codes", async () => {
    await expectDbError(
      call(w.manager, `select public.upsert_resort(null, 'A', 'Test X')`),
      "INVALID_INPUT",
    );
    await expectDbError(
      call(w.manager, `select public.upsert_resort(null, 'AB-C', 'Test X')`),
      "INVALID_INPUT",
    );
    await expectDbError(
      call(w.manager, `select public.upsert_resort(null, 'TSTX', '  ')`),
      "INVALID_INPUT",
    );
    await expectDbError(
      call(
        w.manager,
        `select public.upsert_resort(null, 'tst1', 'Test Other')`,
      ),
      "DUPLICATE",
    );
    await expectDbError(
      call(
        w.manager,
        `select public.upsert_resort(null, 'TSTY', 'test resort one')`,
      ),
      "DUPLICATE",
    );
  });

  it("MDF-03: an edit keeps the id; the code is locked after the first booking (existing resort A has none yet)", async () => {
    await call(
      w.manager,
      `select public.upsert_resort($1, 'AAA2', 'Test Resort Alpha 2')`,
      [w.resorts.A.id],
    );
    expect(
      (
        await q<{ code: string }>(
          `select code from public.resorts where id = $1`,
          [w.resorts.A.id],
        )
      )[0].code,
    ).toBe("AAA2");
    await call(
      w.manager,
      `select public.upsert_resort($1, 'AAA', 'Test Resort Alpha')`,
      [w.resorts.A.id],
    );
    await expectDbError(
      call(w.manager, `select public.upsert_resort($1, 'AAA', 'x')`, [uid()]),
      "NOT_FOUND",
    );
  });

  it("MDF-04: a logo must be an uploaded file of THIS resort with a valid name", async () => {
    const name = `${w.resorts.A.id}/${uid()}.png`;
    await expectDbError(
      call(
        w.manager,
        `select public.upsert_resort($1, 'AAA', 'Test Resort Alpha', null, null, $2)`,
        [w.resorts.A.id, name],
      ),
      "INVALID_INPUT",
    );
    await q(
      `insert into storage.objects (bucket_id, name) values ('resort-logos', $1)`,
      [name],
    );
    await call(
      w.manager,
      `select public.upsert_resort($1, 'AAA', 'Test Resort Alpha', null, null, $2)`,
      [w.resorts.A.id, name],
    );
    expect(
      (
        await q<{ logo_path: string }>(
          `select logo_path from public.resorts where id = $1`,
          [w.resorts.A.id],
        )
      )[0].logo_path,
    ).toBe(name);
    // another resort's file, a bad shape, and a path in the wrong bucket are all refused
    const other = `${w.resorts.B.id}/${uid()}.png`;
    await q(
      `insert into storage.objects (bucket_id, name) values ('resort-logos', $1)`,
      [other],
    );
    await expectDbError(
      call(
        w.manager,
        `select public.upsert_resort($1, 'AAA', 'Test Resort Alpha', null, null, $2)`,
        [w.resorts.A.id, other],
      ),
      "INVALID_INPUT",
    );
    await expectDbError(
      call(
        w.manager,
        `select public.upsert_resort($1, 'AAA', 'Test Resort Alpha', null, null, '../x.png')`,
        [w.resorts.A.id],
      ),
      "INVALID_INPUT",
    );
    // unchanged when null, removed when empty
    await call(
      w.manager,
      `select public.upsert_resort($1, 'AAA', 'Test Resort Alpha')`,
      [w.resorts.A.id],
    );
    expect(
      (
        await q<{ logo_path: string | null }>(
          `select logo_path from public.resorts where id = $1`,
          [w.resorts.A.id],
        )
      )[0].logo_path,
    ).toBe(name);
    await call(
      w.manager,
      `select public.upsert_resort($1, 'AAA', 'Test Resort Alpha', null, null, '')`,
      [w.resorts.A.id],
    );
    expect(
      (
        await q<{ logo_path: string | null }>(
          `select logo_path from public.resorts where id = $1`,
          [w.resorts.A.id],
        )
      )[0].logo_path,
    ).toBeNull();
  });

  it("MDF-05: switching a resort off and on", async () => {
    await call(w.manager, `select public.set_resort_active($1, false)`, [
      w.resorts.B.id,
    ]);
    expect(
      (
        await q<{ is_active: boolean }>(
          `select is_active from public.resorts where id = $1`,
          [w.resorts.B.id],
        )
      )[0].is_active,
    ).toBe(false);
    await call(w.manager, `select public.set_resort_active($1, true)`, [
      w.resorts.B.id,
    ]);
    await expectDbError(
      call(w.manager, `select public.set_resort_active($1, null)`, [
        w.resorts.B.id,
      ]),
      "INVALID_INPUT",
    );
    await expectDbError(
      call(w.manager, `select public.set_resort_active($1, true)`, [uid()]),
      "NOT_FOUND",
    );
  });
});

describe("guests, agents and partners", () => {
  it("MDF-06: a guest is added with a normalised mobile; bad input is refused", async () => {
    const [{ id }] = await call<{ id: string }>(
      w.manager,
      `select public.upsert_guest(null, ' Test Guest Two ', '+91 98765-00000', ' Guest@Test.Example ') as id`,
    );
    const g = await q<{ mobile_normalized: string; email: string }>(
      `select mobile_normalized, email from public.guests where id = $1`,
      [id],
    );
    expect(g[0]).toEqual({
      mobile_normalized: "9876500000",
      email: "guest@test.example",
    });
    await expectDbError(
      call(w.manager, `select public.upsert_guest(null, 'T', '123')`),
      "INVALID_INPUT",
    );
    await expectDbError(
      call(
        w.manager,
        `select public.upsert_guest(null, 'T', '9876500001', 'nope')`,
      ),
      "INVALID_INPUT",
    );
    await expectDbError(
      call(w.manager, `select public.upsert_guest(null, '', '9876500001')`),
      "INVALID_INPUT",
    );
    await call(
      w.manager,
      `select public.upsert_guest($1, 'Test Guest Two Edited', '9876500000')`,
      [id],
    );
    expect(
      (
        await q<{ full_name: string }>(
          `select full_name from public.guests where id = $1`,
          [id],
        )
      )[0].full_name,
    ).toBe("Test Guest Two Edited");
  });

  it("MDF-07: C/O names: duplicates inside one category are refused, the same name may exist in another category, a name cannot move", async () => {
    const [{ id }] = await call<{ id: string }>(
      w.manager,
      `select public.upsert_co_entry(null, $1::smallint, 'Test Agent Two') as id`,
      [w.cat.agent],
    );
    await expectDbError(
      call(
        w.manager,
        `select public.upsert_co_entry(null, $1::smallint, 'test agent two')`,
        [w.cat.agent],
      ),
      "DUPLICATE",
    );
    await call(
      w.manager,
      `select public.upsert_co_entry(null, $1::smallint, 'Test Agent Two')`,
      [w.cat.partner],
    ); // same name, other category: fine
    await expectDbError(
      call(
        w.manager,
        `select public.upsert_co_entry($1, $2::smallint, 'Test Agent Two')`,
        [id, w.cat.partner],
      ),
      "INVALID_INPUT",
    );
    await call(
      w.manager,
      `select public.upsert_co_entry($1, $2::smallint, 'Test Agent Two', '99999', null, false)`,
      [id, w.cat.agent],
    );
    expect(
      (
        await q<{ is_active: boolean }>(
          `select is_active from public.co_entries where id = $1`,
          [id],
        )
      )[0].is_active,
    ).toBe(false);
  });
});

describe("stay types and payment apps", () => {
  it("MDF-08: stay types can be added and renamed; duplicates refused", async () => {
    const [{ id }] = await call<{ id: number }>(
      w.manager,
      `select public.upsert_stay_type(null, 'Test Weekend') as id`,
    );
    await expectDbError(
      call(w.manager, `select public.upsert_stay_type(null, 'test weekend')`),
      "DUPLICATE",
    );
    await call(
      w.manager,
      `select public.upsert_stay_type($1::smallint, 'Test Weekend 2', false, 5)`,
      [id],
    );
    const r = await q<{ name: string; is_active: boolean }>(
      `select name, is_active from public.stay_types where id = $1`,
      [id],
    );
    expect(r[0]).toEqual({ name: "Test Weekend 2", is_active: false });
    await expectDbError(
      call(w.manager, `select public.upsert_stay_type(32000::smallint, 'x')`),
      "NOT_FOUND",
    );
  });

  it("MDF-09: payment apps only for UPI and card; the type of an app cannot change", async () => {
    const [{ id }] = await call<{ id: number }>(
      w.manager,
      `select public.upsert_provider(null, 'upi', 'Test Pay') as id`,
    );
    await expectDbError(
      call(
        w.manager,
        `select public.upsert_provider(null, 'cash', 'Test Cash')`,
      ),
      "INVALID_INPUT",
    );
    await expectDbError(
      call(w.manager, `select public.upsert_provider(null, 'upi', 'test pay')`),
      "DUPLICATE",
    );
    await expectDbError(
      call(
        w.manager,
        `select public.upsert_provider($1::smallint, 'card', 'Test Pay')`,
        [id],
      ),
      "INVALID_INPUT",
    );
    await call(
      w.manager,
      `select public.upsert_provider($1::smallint, 'upi', 'Test Pay 2', false)`,
      [id],
    );
  });
});

describe("authorisation for all master data functions", () => {
  it("MDF-10: no session, no profile, a disabled user and the anonymous role are all refused", async () => {
    const dis = uid();
    await q(
      `insert into auth.users (id, email) values ($1, 'mdf10@test.example')`,
      [dis],
    );
    await w.db.as({ role: "postgres", uid: w.owner }, async () => {
      await q(
        `insert into public.user_profiles (id, full_name, email, role) values ($1, 'Test Mdf10', 'mdf10@test.example', 'manager')`,
        [dis],
      );
      await q(
        `update public.user_profiles set is_active = false, disabled_at = now() where id = $1`,
        [dis],
      );
    });
    const calls = [
      `select public.upsert_resort(null, 'ZZZ', 'Test Zed')`,
      `select public.set_resort_active('${w.resorts.A.id}', false)`,
      `select public.upsert_guest(null, 'Test', '9876500009')`,
      `select public.upsert_co_category(null, 'Test Z')`,
      `select public.upsert_co_entry(null, ${w.cat.agent}::smallint, 'Test Z')`,
      `select public.upsert_stay_type(null, 'Test Z')`,
      `select public.upsert_provider(null, 'upi', 'Test Z')`,
    ];
    for (const c of calls) {
      await expectDbError(call(null, c), "NOT_ALLOWED");
      await expectDbError(call(uid(), c), "NOT_ALLOWED");
      await expectDbError(call(dis, c), "NOT_ALLOWED");
      await expectDbError(
        w.db.as({ role: "anon" }, () => q(c)),
        "permission denied",
      );
    }
  });

  it("MDF-11: reading master data still works for active users, and there is no direct write", async () => {
    expect(
      (
        await w.db.as({ role: "authenticated", uid: w.manager }, () =>
          q(`select id from public.resorts`),
        )
      ).length,
    ).toBeGreaterThan(0);
    await expectDbError(
      w.db.as({ role: "authenticated", uid: w.manager }, () =>
        q(`insert into public.resorts (code, name) values ('QQQ', 'Test Q')`),
      ),
      "permission denied",
    );
  });
});
