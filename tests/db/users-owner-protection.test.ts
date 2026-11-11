/**
 * Account rules and Owner protection (PRD FR-AUTH-4, 9-15; O1, O2, O5; TEST_PLAN USR-*, OWN-*).
 * Everything is fictional. True simultaneous requests (two Owners disabling each other
 * at the same instant) need two connections and run later in CI against real Postgres.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { expectDbError } from "./harness";
import { setupWorld, uid, type World } from "./fixtures";

let w: World;
beforeAll(async () => {
  w = await setupWorld();
}, 120_000);

const asUser = <T>(id: string | null, fn: () => Promise<T>) =>
  w.db.as({ role: "postgres", uid: id }, fn);
const q = <T = Record<string, unknown>>(sql: string, p?: unknown[]) =>
  w.db.q<T>(sql, p);

/** Create a profile as `actor` (fictional person). */
async function addUser(
  actor: string | null,
  role: "owner" | "manager",
  tag = uid().slice(0, 8),
): Promise<string> {
  const id = uid();
  await q(`insert into auth.users (id, email) values ($1, $2)`, [
    id,
    `${tag}@test.example`,
  ]);
  await asUser(actor, () =>
    q(
      `insert into public.user_profiles (id, full_name, email, role) values ($1, $2, $3, $4::public.user_role)`,
      [id, `Test ${tag}`, `${tag}@test.example`, role],
    ),
  );
  return id;
}
const profile = async (id: string) =>
  (
    await q<{
      is_active: boolean;
      role: string;
      disabled_by: string | null;
      email: string;
    }>(
      `select is_active, role, disabled_by, email from public.user_profiles where id = $1`,
      [id],
    )
  )[0];

describe("first account (O5: one real Owner at the start)", () => {
  it("the very first account must be an Owner, and later accounts need a logged-in active user", async () => {
    const fresh = await (await import("./harness")).createDb();
    const first = uid();
    await fresh.q(
      `insert into auth.users (id, email) values ($1, 'x@test.example')`,
      [first],
    );
    // a Manager cannot be the first account
    await expectDbError(
      fresh.q(
        `insert into public.user_profiles (id, full_name, email, role) values ($1, 'T', 'x@test.example', 'manager')`,
        [first],
      ),
      "FIRST_USER_MUST_BE_OWNER",
    );
    await fresh.q(
      `insert into public.user_profiles (id, full_name, email, role) values ($1, 'T', 'x@test.example', 'owner')`,
      [first],
    );
    // from now on no session = no new accounts (OWN-15 equivalent at database level)
    const second = uid();
    await fresh.q(
      `insert into auth.users (id, email) values ($1, 'y@test.example')`,
      [second],
    );
    await expectDbError(
      fresh.q(
        `insert into public.user_profiles (id, full_name, email, role) values ($1, 'U', 'y@test.example', 'manager')`,
        [second],
      ),
      "NOT_ALLOWED",
    );
  }, 120_000);

  it("the system works with exactly one active Owner", async () => {
    const [{ n }] = await q<{ n: number }>(
      `select count(*)::int n from public.user_profiles where role = 'owner' and is_active`,
    );
    expect(n).toBe(1);
  });
});

describe("adding users (O2, O6 at database level)", () => {
  it("OWN-12: a Manager cannot create an Owner", async () => {
    await expectDbError(
      addUser(w.manager, "owner"),
      "OWNER_ACTION_REQUIRES_OWNER",
    );
  });
  it("a Manager can create another Manager", async () => {
    const id = await addUser(w.manager, "manager");
    expect((await profile(id)).role).toBe("manager");
  });
  it("USR-01: created_by comes from the session, not from the caller", async () => {
    const id = await addUser(w.manager, "manager");
    const [r] = await q<{ created_by: string }>(
      `select created_by from public.user_profiles where id = $1`,
      [id],
    );
    expect(r.created_by).toBe(w.manager);
  });
  it("a disabled/unknown user cannot add anyone", async () => {
    await expectDbError(addUser(uid(), "manager"), "NOT_ALLOWED");
    await expectDbError(addUser(null, "manager"), "NOT_ALLOWED");
  });
  it("emails must be lower-case and well-formed", async () => {
    const id = uid();
    await q(`insert into auth.users (id, email) values ($1, 'bad')`, [id]);
    await expectDbError(
      asUser(w.owner, () =>
        q(
          `insert into public.user_profiles (id, full_name, email) values ($1, 'Bad', 'Bad@Test.example')`,
          [id],
        ),
      ),
      "user_profiles_email_fmt",
    );
  });
});

describe("disabling and re-enabling (Q10)", () => {
  it("USR-04: nobody can disable themselves", async () => {
    await expectDbError(
      asUser(w.manager, () =>
        q(`update public.user_profiles set is_active = false where id = $1`, [
          w.manager,
        ]),
      ),
      "CANNOT_DISABLE_SELF",
    );
    await expectDbError(
      asUser(w.owner, () =>
        q(`update public.user_profiles set is_active = false where id = $1`, [
          w.owner,
        ]),
      ),
      "CANNOT_DISABLE_SELF",
    );
  });

  it("USR-03: a Manager can disable another Manager; who and when come from the session", async () => {
    await asUser(w.manager, () =>
      q(
        `update public.user_profiles set is_active = false, disabled_by = $2 where id = $1`,
        [w.manager2, w.owner],
      ),
    ); // lying about disabled_by
    const p = await profile(w.manager2);
    expect(p.is_active).toBe(false);
    expect(p.disabled_by).toBe(w.manager); // overwritten with the real actor
  });

  it("USR-07: a disabled user can no longer read or change anything", async () => {
    const seen = await w.db.as({ role: "authenticated", uid: w.manager2 }, () =>
      q<{ n: number }>(`select count(*)::int n from public.resorts`),
    );
    expect(seen[0].n).toBe(0);
    await expectDbError(addUser(w.manager2, "manager"), "NOT_ALLOWED");
    await expectDbError(
      asUser(w.manager2, () =>
        q(`update public.user_profiles set full_name = 'x' where id = $1`, [
          w.manager,
        ]),
      ),
      "NOT_ALLOWED",
    );
  });

  it("USR-06: a Manager can re-enable a Manager", async () => {
    await asUser(w.manager, () =>
      q(`update public.user_profiles set is_active = true where id = $1`, [
        w.manager2,
      ]),
    );
    const p = await profile(w.manager2);
    expect(p.is_active).toBe(true);
    expect(p.disabled_by).toBeNull();
  });
});

describe("Owner accounts are protected (O1, O2, OWN-01..05, OWN-11, OWN-12)", () => {
  it("OWN-12: a Manager cannot disable, re-email, demote or flag-for-reset the Owner", async () => {
    // The Owner has logged in and changed the first-login password (the user can clear their own flag).
    await asUser(w.owner, () =>
      q(
        `update public.user_profiles set must_change_password = false where id = $1`,
        [w.owner],
      ),
    );
    for (const sql of [
      `update public.user_profiles set is_active = false where id = $1`,
      `update public.user_profiles set email = 'stolen@test.example' where id = $1`,
      `update public.user_profiles set role = 'manager' where id = $1`,
      `update public.user_profiles set must_change_password = true where id = $1`,
    ]) {
      await expectDbError(
        asUser(w.manager, () => q(sql, [w.owner])),
        "OWNER_ACTION_REQUIRES_OWNER",
      );
    }
  });

  it("OWN-02: a Manager cannot promote themselves or anyone to Owner", async () => {
    await expectDbError(
      asUser(w.manager, () =>
        q(`update public.user_profiles set role = 'owner' where id = $1`, [
          w.manager,
        ]),
      ),
      "OWNER_ACTION_REQUIRES_OWNER",
    );
    await expectDbError(
      asUser(w.manager, () =>
        q(`update public.user_profiles set role = 'owner' where id = $1`, [
          w.manager2,
        ]),
      ),
      "OWNER_ACTION_REQUIRES_OWNER",
    );
  });

  it("OWN-11: the sole Owner cannot disable or demote themselves", async () => {
    await expectDbError(
      asUser(w.owner, () =>
        q(`update public.user_profiles set is_active = false where id = $1`, [
          w.owner,
        ]),
      ),
      "CANNOT_DISABLE_SELF",
    );
    await expectDbError(
      asUser(w.owner, () =>
        q(`update public.user_profiles set role = 'manager' where id = $1`, [
          w.owner,
        ]),
      ),
      "OWNER_ACTION_REQUIRES_OWNER",
    );
  });

  it("the Owner cannot edit their own email directly - it must go through the verified process (O7)", async () => {
    await expectDbError(
      asUser(w.owner, () =>
        q(
          `update public.user_profiles set email = 'new@test.example' where id = $1`,
          [w.owner],
        ),
      ),
      "EMAIL_CHANGE_REQUIRES_VERIFICATION",
    );
  });

  it("OWN-13: an Owner can add a second Owner (O6); a Manager can then no longer touch either", async () => {
    const second = await addUser(w.owner, "owner");
    expect((await profile(second)).role).toBe("owner");
    await expectDbError(
      asUser(w.manager, () =>
        q(`update public.user_profiles set is_active = false where id = $1`, [
          second,
        ]),
      ),
      "OWNER_ACTION_REQUIRES_OWNER",
    );
  });

  it("an Owner can promote a Manager to Owner", async () => {
    const m = await addUser(w.owner, "manager");
    await asUser(w.owner, () =>
      q(`update public.user_profiles set role = 'owner' where id = $1`, [m]),
    );
    expect((await profile(m)).role).toBe("owner");
  });

  it("OWN-03: with two Owners, one can disable the other; the disabled Owner is locked out; the remaining Owner is protected", async () => {
    const a = await addUser(w.owner, "owner");
    const b = await addUser(w.owner, "owner");
    await asUser(a, () =>
      q(`update public.user_profiles set is_active = false where id = $1`, [b]),
    );
    expect((await profile(b)).is_active).toBe(false);
    // the disabled Owner can no longer act (so two Owners can never disable each other in turn)
    await expectDbError(
      asUser(b, () =>
        q(`update public.user_profiles set is_active = false where id = $1`, [
          a,
        ]),
      ),
      "NOT_ALLOWED",
    );
    // another Owner can re-enable
    await asUser(a, () =>
      q(`update public.user_profiles set is_active = true where id = $1`, [b]),
    );
    expect((await profile(b)).is_active).toBe(true);
  });
});

describe("at least one active Owner ALWAYS exists (OWN-05)", () => {
  it("cannot disable or demote the last active Owner - not even through the recovery path", async () => {
    // A throwaway system whose only active Owner is `solo` (a second, disabled Owner exists).
    const db = await (await import("./harness")).createDb();
    const solo = uid();
    const other = uid();
    await db.q(
      `insert into auth.users (id, email) values ($1, 's@test.example'), ($2, 'o@test.example')`,
      [solo, other],
    );
    await db.q(
      `insert into public.user_profiles (id, full_name, email, role) values ($1, 'Solo', 's@test.example', 'owner')`,
      [solo],
    );
    await db.as({ role: "postgres", uid: solo }, async () => {
      await db.q(
        `insert into public.user_profiles (id, full_name, email, role) values ($1, 'Other', 'o@test.example', 'owner')`,
        [other],
      );
      await db.q(
        `update public.user_profiles set is_active = false where id = $1`,
        [other],
      );
    });

    // Recovery path: no session user + the recovery flag. It may re-enable an Owner...
    await db.exec(`select set_config('app.owner_recovery', 'on', false)`);
    await db.q(
      `update public.user_profiles set is_active = true where id = $1`,
      [other],
    );
    // ...but it can never remove the last one.
    await db.as({ role: "postgres", uid: solo }, async () => {
      await db.q(
        `update public.user_profiles set is_active = false where id = $1`,
        [other],
      ); // other disabled again; solo is last
    });
    await expectDbError(
      db.q(`update public.user_profiles set is_active = false where id = $1`, [
        solo,
      ]),
      "LAST_OWNER_PROTECTED",
    );
    await expectDbError(
      db.q(`update public.user_profiles set role = 'manager' where id = $1`, [
        solo,
      ]),
      "LAST_OWNER_PROTECTED",
    );
    await db.exec(`select set_config('app.owner_recovery', 'off', false)`);

    const [{ n }] = await db.q<{ n: number }>(
      `select count(*)::int n from public.user_profiles where role = 'owner' and is_active`,
    );
    expect(n).toBe(1);
  }, 120_000);

  it("without the recovery flag, a database session with no user cannot change accounts at all", async () => {
    await expectDbError(
      q(`update public.user_profiles set full_name = 'x' where id = $1`, [
        w.owner,
      ]),
      "NOT_ALLOWED",
    );
    await q(`select set_config('app.owner_recovery', 'on', false)`);
    await q(
      `update public.user_profiles set full_name = 'Test Owner' where id = $1`,
      [w.owner],
    ); // recovery path works...
    await q(`select set_config('app.owner_recovery', 'off', false)`);
    // ...and an ordinary logged-in user cannot use the flag to bypass anything
    await q(`select set_config('app.owner_recovery', 'on', false)`);
    await expectDbError(
      asUser(w.manager, () =>
        q(`update public.user_profiles set is_active = false where id = $1`, [
          w.owner,
        ]),
      ),
      "OWNER_ACTION_REQUIRES_OWNER",
    );
    await q(`select set_config('app.owner_recovery', 'off', false)`);
  });
});

describe("history and permanence (AUD-03, no deletes)", () => {
  it("AUD-03: account changes are audited with the actor and the target user", async () => {
    const id = await addUser(w.owner, "manager", "audited");
    await asUser(w.manager, () =>
      q(`update public.user_profiles set is_active = false where id = $1`, [
        id,
      ]),
    );
    const rows = await q<{
      action: string;
      actor_id: string;
      actor_name: string;
      target_user_id: string;
      changed_fields: string[];
    }>(
      `select action, actor_id, actor_name, target_user_id, changed_fields from public.audit_logs
       where table_name = 'user_profiles' and target_user_id = $1 order by id`,
      [id],
    );
    expect(rows.map((r) => r.action)).toEqual(["insert", "update"]);
    expect(rows[0].actor_id).toBe(w.owner);
    expect(rows[0].actor_name).toBe("Test Owner");
    expect(rows[1].actor_id).toBe(w.manager);
    expect(rows[1].changed_fields).toEqual(
      expect.arrayContaining(["is_active", "disabled_at", "disabled_by"]),
    );
  });

  it("profiles are never deleted", async () => {
    await expectDbError(
      q(`delete from public.user_profiles where id = $1`, [w.manager]),
      "DELETE_NOT_ALLOWED",
    );
  });

  it("the identity columns cannot be rewritten", async () => {
    await expectDbError(
      asUser(w.owner, () =>
        q(`update public.user_profiles set created_by = $1 where id = $2`, [
          w.manager,
          w.manager2,
        ]),
      ),
      "IMMUTABLE_FIELD",
    );
  });
});
