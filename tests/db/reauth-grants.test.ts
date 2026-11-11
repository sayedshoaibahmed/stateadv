/**
 * Re-authentication grants (migration 19; owner decision O3 enforced by the database).
 * A protected Owner action needs a single-use grant (60 seconds, bound to the acting user, the action, the target AND
 * the exact operation) that only the service role can issue, after reserving a password attempt with reauth_begin.
 * These tests call the database directly, the way a stolen session token would.
 * PGlite stand-in; the simultaneous-request tests are in concurrency.pg.test.ts (CON-19, CON-20). Everything is fictional.
 * (REA-01..16)
 */
import { beforeAll, describe, expect, it } from "vitest";
import { grantActionFor } from "@/lib/accounts/reauth";
import {
  isProtectedAction,
  type AccountAction,
  type Role,
} from "@/lib/accounts/rules";
import { expectDbError } from "./harness";
import { reauth, setupWorld, uid, type World } from "./fixtures";

let w: World;
beforeAll(async () => {
  w = await setupWorld();
}, 120_000);

const LONG = "A proper written reason for this.";
type GrantAction = Parameters<typeof reauth>[2];

const q = <T = Record<string, unknown>>(sql: string, p?: unknown[]) =>
  w.db.q<T>(sql, p);
const as = <T>(id: string | null, fn: () => Promise<T>) =>
  w.db.as({ role: "authenticated", uid: id }, fn);
const call = (id: string | null, sql: string, p?: unknown[]) =>
  as(id, () => q(sql, p));
const asService = <T>(fn: () => Promise<T>) =>
  w.db.as({ role: "service_role" }, fn);
const issue = (
  action: GrantAction,
  target: string,
  actor = w.owner,
  detail?: string | null,
) => reauth(w.db, actor, action, target, detail);
const issueRaw = (
  actor: string | null,
  action: string,
  target: string | null,
  detail: string | null,
) =>
  asService(() =>
    q(`select public.issue_reauth($1, $2, $3, $4)`, [
      actor,
      action,
      target,
      detail,
    ]),
  );
const begin = (actor: string | null, action: string, target: string | null) =>
  asService(() =>
    q(`select public.reauth_begin($1, $2, $3)`, [actor, action, target]),
  );

async function login(tag = uid().slice(0, 8)) {
  const id = uid();
  const email = `${tag}@test.example`;
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
  return { id, email };
}
async function newManager(tag?: string) {
  const l = await login(tag);
  await call(
    w.owner,
    `select public.profile_create($1, $2, $3, 'manager', null, $4)`,
    [l.id, `Test ${l.email.split("@")[0]}`, l.email, LONG],
  );
  return l;
}
async function newOwner(tag?: string) {
  const l = await login(tag);
  await issue("add_owner", l.id);
  await call(
    w.owner,
    `select public.profile_create($1, $2, $3, 'owner', null, $4)`,
    [l.id, `Test ${l.email.split("@")[0]}`, l.email, LONG],
  );
  return l;
}
const profile = async (id: string) =>
  (
    await q<{
      role: string;
      is_active: boolean;
      must_change_password: boolean;
      full_name: string;
      email: string;
    }>(`select * from public.user_profiles where id = $1`, [id])
  )[0];
const auditCount = async (target: string) =>
  Number(
    (
      await q<{ n: string }>(
        `select count(*)::text n from public.audit_logs where target_user_id = $1 or record_id = $1::text`,
        [target],
      )
    )[0].n,
  );
const grantRow = async (id: string) =>
  (
    await q<{
      used_at: string | null;
      user_id: string;
      action: string;
      detail: string | null;
    }>(
      `select used_at, user_id, action, detail from public.reauth_grants where id = $1`,
      [id],
    )
  )[0];
/** 'ok', or the error text, so cases can be compared without throwing */
async function attempt(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "ok";
  } catch (e) {
    return String((e as Error).message);
  }
}

// the five protected calls, as a stolen session token would send them straight to the database
const setActive = (actor: string, target: string, active = false) =>
  call(actor, `select public.profile_set_active($1, $2, $3)`, [
    target,
    active,
    LONG,
  ]);
const resetPw = (actor: string, target: string) =>
  call(actor, `select public.profile_reset_password($1, $2)`, [target, LONG]);
const changeEmail = (actor: string, target: string, to = "x@test.example") =>
  call(actor, `select public.profile_change_email($1, $2, $3)`, [
    target,
    to,
    LONG,
  ]);
const setRole = (actor: string, target: string, role: Role) =>
  call(
    actor,
    `select public.profile_update($1, null, null, $2::public.user_role, $3)`,
    [target, role, LONG],
  );
const addOwner = (actor: string, login: { id: string; email: string }) =>
  call(
    actor,
    `select public.profile_create($1, 'Test Added', $2, 'owner', null, $3)`,
    [login.id, login.email, LONG],
  );

describe("direct database calls without re-authentication (REA-01..02)", () => {
  it("REA-01: every protected Owner action is refused without a grant, and nothing changes", async () => {
    const o = await newOwner("rea01");
    const m = await newManager("rea01m");
    const l = await login("rea01n");
    const before = await auditCount(o.id);

    await expectDbError(addOwner(w.owner, l), "REAUTH_REQUIRED");
    expect(
      await q(`select 1 from public.user_profiles where id = $1`, [l.id]),
    ).toEqual([]);
    await expectDbError(setRole(w.owner, m.id, "owner"), "REAUTH_REQUIRED");
    expect((await profile(m.id)).role).toBe("manager");
    await expectDbError(setRole(w.owner, o.id, "manager"), "REAUTH_REQUIRED");
    await expectDbError(setActive(w.owner, o.id), "REAUTH_REQUIRED");
    await expectDbError(resetPw(w.owner, o.id), "REAUTH_REQUIRED");
    await expectDbError(changeEmail(w.owner, o.id), "REAUTH_REQUIRED");

    const p = await profile(o.id);
    expect(p).toMatchObject({
      role: "owner",
      is_active: true,
      must_change_password: true,
    });
    expect(p.email).toBe(o.email);
    expect(await auditCount(o.id)).toBe(before); // not even an audit row: the action never started
  });

  it("REA-02: actions that are NOT protected need no grant and behave exactly as before", async () => {
    const m = await newManager("rea02");
    const o = await newOwner("rea02o");
    await call(
      w.owner,
      `select public.profile_update($1, 'Test Renamed', '12345')`,
      [m.id],
    );
    expect((await profile(m.id)).full_name).toBe("Test Renamed");
    await call(
      w.manager,
      `select public.profile_update($1, 'Test Renamed Again')`,
      [m.id],
    );
    // editing the NAME of an Owner is not a protected action
    await call(
      w.owner,
      `select public.profile_update($1, 'Test Owner Renamed')`,
      [o.id],
    );
    expect((await profile(o.id)).full_name).toBe("Test Owner Renamed");
    // switching a Manager off and on, resetting a Manager's password, changing a Manager's email
    await setActive(w.owner, m.id, false);
    await setActive(w.owner, m.id, true);
    await resetPw(w.owner, m.id);
    await changeEmail(w.owner, m.id, "rea02-new@test.example");
    expect((await profile(m.id)).email).toBe("rea02-new@test.example");
    // adding a Manager
    await newManager("rea02n");
  });
});

describe("normal authorised use, replay and expiry (REA-03..05)", () => {
  it("REA-03: with a grant the action succeeds; the grant is used; the steps are audited in order", async () => {
    const o = await newOwner("rea03");
    await begin(w.owner, "set_active", o.id); // the server reserves an attempt before trying the password
    const g = await issue("set_active", o.id);
    expect((await grantRow(g)).used_at).toBeNull();
    expect((await grantRow(g)).detail).toBe("false");
    await setActive(w.owner, o.id, false);
    expect((await profile(o.id)).is_active).toBe(false);
    expect((await grantRow(g)).used_at).not.toBeNull();
    const rows = await q<{
      id: string;
      action: string;
      actor_id: string;
      reason: string | null;
      changed_fields: string[] | null;
    }>(
      `select id, action, actor_id, reason, changed_fields from public.audit_logs
        where target_user_id = $1 and action in ('reauth_attempt', 'reauth_verified', 'update') order by id`,
      [o.id],
    );
    const attemptRow = rows
      .filter((r) => r.action === "reauth_attempt")
      .at(-1)!;
    const verified = rows.filter((r) => r.action === "reauth_verified").at(-1)!;
    expect(attemptRow.actor_id).toBe(w.owner);
    expect(attemptRow.changed_fields).toEqual(["set_active"]);
    expect(verified.actor_id).toBe(w.owner);
    expect(verified.changed_fields).toEqual(["set_active"]);
    expect(verified.reason).toBeNull();
    const update = rows.filter((r) => r.action === "update").at(-1)!;
    expect(update.changed_fields).toContain("is_active");
    expect(update.reason).toBe(LONG);
    expect(Number(attemptRow.id)).toBeLessThan(Number(verified.id));
    expect(Number(verified.id)).toBeLessThan(Number(update.id));
  });

  it("REA-04: a grant works once; a second call needs a fresh grant (replay refused)", async () => {
    const o = await newOwner("rea04");
    await issue("set_active", o.id);
    await setActive(w.owner, o.id, false);
    await expectDbError(setActive(w.owner, o.id, true), "REAUTH_REQUIRED"); // not even the opposite switch can reuse it
    expect((await profile(o.id)).is_active).toBe(false);
    await issue("set_active", o.id, w.owner, "true");
    await setActive(w.owner, o.id, true);
    expect((await profile(o.id)).is_active).toBe(true);
    // two grants issued, one used: exactly one call succeeds, whatever the order
    await issue("set_active", o.id);
    await setActive(w.owner, o.id, false);
    await expectDbError(setActive(w.owner, o.id, true), "REAUTH_REQUIRED");
  });

  it("REA-05: an expired grant is refused (60-second window)", async () => {
    const o = await newOwner("rea05");
    const g = await issue("set_active", o.id);
    const [{ ttl }] = await q<{ ttl: string }>(
      `select (expires_at - created_at)::text ttl from public.reauth_grants where id = $1`,
      [g],
    );
    expect(ttl).toBe("00:01:00");
    // the clock cannot be moved here, so the grant is aged: issued two minutes ago, expired one second ago
    await q(
      `update public.reauth_grants set created_at = now() - interval '2 minutes', expires_at = now() - interval '1 second' where id = $1`,
      [g],
    );
    await expectDbError(setActive(w.owner, o.id), "REAUTH_REQUIRED");
    expect((await profile(o.id)).is_active).toBe(true);
    expect((await grantRow(g)).used_at).toBeNull();
    // a fresh grant for the same call works
    await issue("set_active", o.id);
    await setActive(w.owner, o.id);
    expect((await profile(o.id)).is_active).toBe(false);
  });
});

describe("invalid grants and grant stealing (REA-06..07)", () => {
  it("REA-06: a grant for another action, another account, another user, or a different login is refused", async () => {
    const o = await newOwner("rea06a");
    const o2 = await newOwner("rea06b");
    const l = await login("rea06l");
    const other = await login("rea06m");

    await issue("change_email", o.id, w.owner, "x@test.example"); // wrong action
    await expectDbError(setActive(w.owner, o.id), "REAUTH_REQUIRED");
    await issue("set_active", o2.id); // wrong target
    await expectDbError(setActive(w.owner, o.id), "REAUTH_REQUIRED");
    // wrong user: the OTHER Owner's grant cannot be used by this Owner (bound to auth.uid())
    await issue("set_active", o.id, o2.id);
    await expectDbError(setActive(w.owner, o.id), "REAUTH_REQUIRED");
    // a grant to add THIS login as an Owner does not let a different login be added
    await issue("add_owner", l.id);
    await expectDbError(addOwner(w.owner, other), "REAUTH_REQUIRED");
    expect((await profile(o.id)).is_active).toBe(true);
    // and the grants that were not used are still unused
    const unused = await q<{ n: string }>(
      `select count(*)::text n from public.reauth_grants where used_at is null and target_id = $1`,
      [o.id],
    );
    expect(Number(unused[0].n)).toBe(2); // the wrong-action one and the other Owner's one
  });

  it("REA-06b: no grant can be made up: the table cannot be written or read by any app role", async () => {
    const o = await newOwner("rea06c");
    for (const run of [
      () =>
        call(
          w.owner,
          `insert into public.reauth_grants (user_id, action, target_id, detail) values ($1, 'set_active', $2, 'false')`,
          [w.owner, o.id],
        ),
      () => call(w.owner, `select * from public.reauth_grants`),
      () =>
        asService(() =>
          q(
            `insert into public.reauth_grants (user_id, action, target_id, detail) values ($1, 'set_active', $2, 'false')`,
            [w.owner, o.id],
          ),
        ),
      () => asService(() => q(`select * from public.reauth_grants`)),
      () =>
        w.db.as({ role: "anon" }, () =>
          q(`select * from public.reauth_grants`),
        ),
    ]) {
      await expectDbError(run(), "permission denied");
    }
    await expectDbError(setActive(w.owner, o.id), "REAUTH_REQUIRED");
  });

  it("REA-07: a grant is bound to the EXACT operation: a call with other arguments cannot use it, and cannot steal it", async () => {
    const o = await newOwner("rea07o");
    const m = await newManager("rea07m");
    const l = await login("rea07l");

    // set_active: confirmed for switching ON, attempted OFF
    await issue("set_active", o.id, w.owner, "true");
    await expectDbError(setActive(w.owner, o.id, false), "REAUTH_REQUIRED");
    expect((await profile(o.id)).is_active).toBe(true);

    // change_role: confirmed for 'manager', attempted 'owner'
    const g2 = await issue("change_role", m.id, w.owner, "manager");
    await expectDbError(setRole(w.owner, m.id, "owner"), "REAUTH_REQUIRED");
    expect((await profile(m.id)).role).toBe("manager");
    expect((await grantRow(g2)).used_at).toBeNull(); // the attempt did NOT consume (steal) the grant

    // change_email: confirmed for one address, attempted another; then the confirmed one still works, once
    const g3 = await issue(
      "change_email",
      o.id,
      w.owner,
      "confirmed@test.example",
    );
    await expectDbError(
      changeEmail(w.owner, o.id, "attacker@test.example"),
      "REAUTH_REQUIRED",
    );
    expect((await profile(o.id)).email).toBe(o.email);
    expect((await grantRow(g3)).used_at).toBeNull();
    await changeEmail(w.owner, o.id, "Confirmed@Test.Example "); // same address, different case and a space: still the same operation
    expect((await profile(o.id)).email).toBe("confirmed@test.example");
    expect((await grantRow(g3)).used_at).not.toBeNull();

    // add_owner: confirmed for a different address than the login's
    await issue("add_owner", l.id, w.owner, "someone.else@test.example");
    await expectDbError(addOwner(w.owner, l), "REAUTH_REQUIRED");
    expect(
      await q(`select 1 from public.user_profiles where id = $1`, [l.id]),
    ).toEqual([]);

    // reset_password has no argument: any call for that account is "the same operation"
    await issue("reset_password", o.id);
    await resetPw(w.owner, o.id);
    expect((await profile(o.id)).must_change_password).toBe(true);
  });
});

describe("who may reserve, issue and claim (REA-08..10)", () => {
  it("REA-08: only the service role can reserve, issue or record; nobody can claim directly; the old lock function is gone", async () => {
    const o = await newOwner("rea08");
    const fns = [
      `select public.reauth_begin($1, 'set_active', $2)`,
      `select public.issue_reauth($1, 'set_active', $2, 'false')`,
      `select public.record_reauth_failure($1, 'set_active', $2)`,
      `select public.consume_reauth($1, 'set_active', $2, 'false')`,
    ];
    for (const sql of fns) {
      const params = [w.owner, o.id];
      await expectDbError(call(w.owner, sql, params), "permission denied");
      await expectDbError(call(w.manager, sql, params), "permission denied");
      await expectDbError(call(null, sql, params), "permission denied");
      await expectDbError(
        w.db.as({ role: "anon" }, () => q(sql, params)),
        "permission denied",
      );
    }
    // the service role may use the first three, never consume_reauth
    for (const sql of fns.slice(0, 3))
      await asService(() => q(sql, [w.owner, o.id]));
    await expectDbError(
      asService(() => q(fns[3], [w.owner, o.id])),
      "permission denied",
    );
    const pub = await q<{ n: string }>(
      `select count(*)::text n from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname in ('reauth_begin','issue_reauth','record_reauth_failure','consume_reauth')
        and (has_function_privilege('public', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))`,
    );
    expect(pub[0].n).toBe("0");
    expect(
      await q(`select 1 from pg_proc where proname = 'reauth_is_locked'`),
    ).toEqual([]);
  });

  it("REA-09: a grant is issued only to an active Owner and only for a valid operation", async () => {
    const m = await newManager("rea09m");
    const o = await newOwner("rea09o");
    await expectDbError(
      issueRaw(m.id, "set_active", o.id, "false"),
      "NOT_ALLOWED",
    ); // a Manager
    await expectDbError(
      issueRaw(uid(), "set_active", o.id, "false"),
      "NOT_ALLOWED",
    ); // unknown
    await expectDbError(begin(m.id, "set_active", o.id), "NOT_ALLOWED");
    await expectDbError(begin(uid(), "set_active", o.id), "NOT_ALLOWED");
    await issue("set_active", o.id);
    await setActive(w.owner, o.id, false); // o is now switched off
    await expectDbError(
      issueRaw(o.id, "set_active", w.owner, "false"),
      "NOT_ALLOWED",
    );
    await expectDbError(begin(o.id, "set_active", w.owner), "NOT_ALLOWED");
    // invalid requests
    await expectDbError(
      issueRaw(w.owner, "delete_everything", o.id, null),
      "INVALID_INPUT",
    );
    await expectDbError(
      issueRaw(null, "set_active", o.id, "false"),
      "INVALID_INPUT",
    );
    await expectDbError(
      issueRaw(w.owner, "set_active", null, "false"),
      "INVALID_INPUT",
    );
    await expectDbError(
      begin(w.owner, "delete_everything", o.id),
      "INVALID_INPUT",
    );
    // the operation must be stated, exactly
    await expectDbError(
      issueRaw(w.owner, "set_active", o.id, null),
      "INVALID_INPUT",
    );
    await expectDbError(
      issueRaw(w.owner, "set_active", o.id, "yes"),
      "INVALID_INPUT",
    );
    await expectDbError(
      issueRaw(w.owner, "change_role", o.id, "admin"),
      "INVALID_INPUT",
    );
    await expectDbError(
      issueRaw(w.owner, "reset_password", o.id, "anything"),
      "INVALID_INPUT",
    );
    await expectDbError(
      issueRaw(w.owner, "change_email", o.id, null),
      "INVALID_INPUT",
    );
    await expectDbError(
      issueRaw(w.owner, "change_email", o.id, "Mixed@Case.Example"),
      "INVALID_INPUT",
    ); // must be lower-case
    await expectDbError(
      issueRaw(w.owner, "add_owner", o.id, "ab"),
      "INVALID_INPUT",
    );
    // a failure record for a stranger or a non-Owner writes nothing
    const n0 = await auditCount(m.id);
    await asService(() =>
      q(`select public.record_reauth_failure($1, 'set_active', $2)`, [
        m.id,
        o.id,
      ]),
    );
    await asService(() =>
      q(`select public.record_reauth_failure($1, 'set_active', $2)`, [
        uid(),
        o.id,
      ]),
    );
    expect(await auditCount(m.id)).toBe(n0);
    expect(
      await q(
        `select 1 from public.audit_logs where action like 'reauth\\_%' and actor_id = $1`,
        [m.id],
      ),
    ).toEqual([]);
  });

  it("REA-10: a caller who is not an Owner still gets the original error first, never a hint about grants", async () => {
    const o = await newOwner("rea10");
    const l = await login("rea10l");
    await expectDbError(addOwner(w.manager, l), "OWNER_ACTION_REQUIRES_OWNER");
    await expectDbError(
      setRole(w.manager, o.id, "manager"),
      "OWNER_ACTION_REQUIRES_OWNER",
    );
    const m = await newManager("rea10m");
    await expectDbError(
      setRole(w.manager, m.id, "owner"),
      "OWNER_ACTION_REQUIRES_OWNER",
    );
    await expectDbError(
      setActive(w.manager, o.id),
      "OWNER_ACTION_REQUIRES_OWNER",
    );
    await expectDbError(
      resetPw(w.manager, o.id),
      "OWNER_ACTION_REQUIRES_OWNER",
    );
    await expectDbError(
      changeEmail(w.manager, o.id),
      "OWNER_ACTION_REQUIRES_OWNER",
    );
    // a signed-out call and a stranger are refused before anything else
    await expectDbError(setActive(uid(), o.id), "NOT_ALLOWED");
    await expectDbError(
      call(null, `select public.profile_set_active($1, false, $2)`, [
        o.id,
        LONG,
      ]),
      "NOT_ALLOWED",
    );
  });
});

describe("attempts, failed passwords and the lock (REA-11..12)", () => {
  it("REA-11: five attempts per 15 minutes, reserved BEFORE the password; the sixth is refused; a success resets; others are unaffected", async () => {
    const lo = await newOwner("rea11a");
    const target = await newOwner("rea11t");
    const attemptsOf = async (id: string) =>
      Number(
        (
          await q<{ n: string }>(
            `select count(*)::text n from public.audit_logs where actor_id = $1 and action = 'reauth_attempt'`,
            [id],
          )
        )[0].n,
      );
    for (let i = 0; i < 5; i++) await begin(lo.id, "set_active", target.id);
    expect(await attemptsOf(lo.id)).toBe(5);
    await expectDbError(begin(lo.id, "set_active", target.id), "REAUTH_LOCKED");
    expect(await attemptsOf(lo.id)).toBe(5); // a refused reservation adds nothing
    // the Owner whose password was right on the 5th try still gets the grant (the attempt was already counted)
    await issue("set_active", target.id, lo.id);
    // ... and a success resets the count
    for (let i = 0; i < 5; i++) await begin(lo.id, "set_active", target.id);
    await expectDbError(begin(lo.id, "set_active", target.id), "REAUTH_LOCKED");
    // another Owner is not affected by lo's lock
    await begin(w.owner, "set_active", target.id);
    // a wrong password is audited without any password data; the attempt stays counted
    const l2 = await newOwner("rea11b");
    await begin(l2.id, "set_active", target.id);
    await asService(() =>
      q(`select public.record_reauth_failure($1, 'set_active', $2)`, [
        l2.id,
        target.id,
      ]),
    );
    const rows = await q<{
      action: string;
      reason: string | null;
      changed_fields: string[];
      actor_id: string;
      old_data: unknown;
      new_data: unknown;
    }>(
      `select action, reason, changed_fields, actor_id, old_data, new_data from public.audit_logs
        where actor_id = $1 and action like 'reauth\\_%' order by id`,
      [l2.id],
    );
    expect(rows.map((r) => r.action)).toEqual([
      "reauth_attempt",
      "reauth_failed",
    ]);
    for (const r of rows) {
      expect(r.changed_fields).toEqual(["set_active"]);
      expect(r.reason).toBeNull();
      expect(r.old_data).toBeNull();
      expect(r.new_data).toBeNull(); // nothing but who, what and which account
    }
    expect(await attemptsOf(l2.id)).toBe(1); // the failure row is not an extra attempt
  });

  it("REA-12: a refused or failed protected call does not use up the grant, and the existing Owner rules still apply with a grant", async () => {
    // nobody switches themselves off, and nobody changes their own role: refused by the existing rules, not by the grant
    const g = await issue("set_active", w.owner);
    await expectDbError(
      setActive(w.owner, w.owner, false),
      "CANNOT_DISABLE_SELF",
    );
    expect((await grantRow(g)).used_at).toBeNull(); // the claim was rolled back together with the refused call
    expect((await profile(w.owner)).is_active).toBe(true);
    await expectDbError(
      setRole(w.owner, w.owner, "manager"),
      "CANNOT_CHANGE_OWN_ROLE",
    );
    // a grant for another Owner is still usable afterwards, once
    const o = await newOwner("rea12");
    await issue("set_active", o.id);
    await setActive(w.owner, o.id, false);
    expect((await profile(o.id)).is_active).toBe(false);
    // an Owner cannot reset their own password here, grant or not
    await issue("reset_password", w.owner);
    await expectDbError(resetPw(w.owner, w.owner), "CANNOT_RESET_OWN_PASSWORD");
    await expectDbError(
      changeEmail(w.owner, w.owner),
      "EMAIL_CHANGE_REQUIRES_VERIFICATION",
    );
  });
});

describe("no grant id anywhere, and audit visibility (REA-13..14)", () => {
  it("REA-13: issue_reauth returns nothing; the grant id appears in no audit row", async () => {
    const o = await newOwner("rea13");
    const rt = await q<{ t: string }>(
      `select prorettype::regtype::text t from pg_proc where proname = 'issue_reauth' and pronamespace = 'public'::regnamespace`,
    );
    expect(rt).toEqual([{ t: "void" }]);
    const res = await asService(() =>
      q<Record<string, unknown>>(
        `select public.issue_reauth($1, 'set_active', $2, 'false') as r`,
        [w.owner, o.id],
      ),
    );
    // a void function gives an empty value, never an id
    const value = res[0].r;
    expect(value === null || value === "").toBe(true);
    const g = await q<{ id: string }>(
      `select id::text id from public.reauth_grants where target_id = $1 order by created_at desc limit 1`,
      [o.id],
    );
    const hits = await q<{ n: string }>(
      `select count(*)::text n from public.audit_logs a where a::text like '%' || $1 || '%'`,
      [g[0].id],
    );
    expect(hits[0].n).toBe("0");
  });

  it("REA-14: re-authentication audit rows are readable by Owners only; they all stay in the table", async () => {
    const o = await newOwner("rea14");
    await begin(w.owner, "set_active", o.id);
    await issue("set_active", o.id);
    await asService(() =>
      q(`select public.record_reauth_failure($1, 'set_active', $2)`, [
        w.owner,
        o.id,
      ]),
    );
    const total = Number(
      (
        await q<{ n: string }>(
          `select count(*)::text n from public.audit_logs where action like 'reauth\\_%'`,
        )
      )[0].n,
    );
    expect(total).toBeGreaterThanOrEqual(3);
    const count = async (id: string) =>
      Number(
        (
          await call(
            id,
            `select count(*)::text n from public.audit_logs where action like 'reauth\\_%'`,
          )
        )[0].n as string,
      );
    expect(await count(w.owner)).toBe(total); // an Owner sees them all
    expect(await count(o.id)).toBe(total); // so does any other active Owner
    expect(await count(w.manager)).toBe(0); // a Manager sees none, also when asking for one account's history
    const history = await call(
      w.manager,
      `select action from public.audit_logs where table_name = 'user_profiles' and target_user_id = $1`,
      [o.id],
    );
    expect(
      history.some((r) =>
        String((r as { action: string }).action).startsWith("reauth_"),
      ),
    ).toBe(false);
    expect(history.length).toBeGreaterThan(0); // the ordinary account history is still visible to the Manager
    // the same table still shows a Manager everything else, and nothing was removed
    const others = await call(
      w.manager,
      `select count(*)::int n from public.audit_logs where action not like 'reauth\\_%'`,
    );
    expect((others[0] as { n: number }).n).toBeGreaterThan(0);
    expect(
      Number(
        (
          await q<{ n: string }>(
            `select count(*)::text n from public.audit_logs where action like 'reauth\\_%'`,
          )
        )[0].n,
      ),
    ).toBe(total);
    // a switched-off Owner no longer sees them
    await issue("set_active", o.id);
    await setActive(w.owner, o.id, false);
    expect(await count(o.id)).toBe(0);
  });
});

describe("the SQL decision equals the application rule (REA-15)", () => {
  const roles: Role[] = ["owner", "manager"];
  const grantFor = (
    a: AccountAction,
    target: Role,
    nw?: Role,
  ): GrantAction | null =>
    grantActionFor({ action: a, targetRole: target, newRole: nw });

  it("REA-15a: the mapping function and isProtectedAction agree for every input", () => {
    const actions: AccountAction[] = [
      "add_user",
      "edit_details",
      "change_role",
      "switch_off",
      "switch_on",
      "reset_password",
      "change_email",
    ];
    for (const a of actions)
      for (const t of roles)
        for (const nw of [undefined, ...roles]) {
          const check = { action: a, targetRole: t, newRole: nw };
          expect(grantActionFor(check) !== null, JSON.stringify(check)).toBe(
            isProtectedAction(check),
          );
        }
  });

  it("REA-15b: for every action and role the database asks for a grant exactly when the application asks for the password", async () => {
    function addAs(role: Role, l: { id: string; email: string }) {
      return call(
        w.owner,
        `select public.profile_create($1, 'Test Parity', $2, $3::public.user_role, null, $4)`,
        [l.id, l.email, role, LONG],
      );
    }
    // add_user: no grant -> REAUTH_REQUIRED only for an Owner
    for (const role of roles) {
      const l = await login();
      const r = await attempt(() => addAs(role, l));
      const asked = r.includes("REAUTH_REQUIRED");
      expect(asked, `add_user ${role}: ${r}`).toBe(
        isProtectedAction({ action: "add_user", targetRole: role }),
      );
      expect(asked).toBe(grantFor("add_user", role) !== null);
      if (asked) {
        await issue(grantFor("add_user", role)!, l.id);
        expect(await attempt(() => addAs(role, l))).toBe("ok");
      }
    }
    // the other actions on a fresh account of each role
    for (const role of roles) {
      const fresh = async () => (role === "owner" ? newOwner() : newManager());
      const other: Role = role === "owner" ? "manager" : "owner";
      const sets: Array<
        [
          AccountAction,
          Role | undefined,
          (id: string) => Promise<unknown>,
          string | null,
        ]
      > = [
        [
          "edit_details",
          undefined,
          (id) =>
            call(
              w.owner,
              `select public.profile_update($1, 'Test Parity Name')`,
              [id],
            ),
          null,
        ],
        ["change_role", other, (id) => setRole(w.owner, id, other), other],
        [
          "switch_off",
          undefined,
          (id) => setActive(w.owner, id, false),
          "false",
        ],
        ["reset_password", undefined, (id) => resetPw(w.owner, id), null],
        [
          "change_email",
          undefined,
          (id) => changeEmail(w.owner, id, "parity@test.example"),
          "parity@test.example",
        ],
      ];
      for (const [action, newRole, run, detail] of sets) {
        const t = await fresh();
        const check = { action, targetRole: role, newRole };
        const r = await attempt(() => run(t.id));
        const asked = r.includes("REAUTH_REQUIRED");
        expect(asked, `${action} on ${role}: ${r}`).toBe(
          isProtectedAction(check),
        );
        expect(asked).toBe(grantActionFor(check) !== null);
        if (asked) {
          await issue(grantActionFor(check)!, t.id, w.owner, detail); // the mapped grant is the one the database accepts
          expect(
            await attempt(() => run(t.id)),
            `${action} on ${role} with its grant`,
          ).toBe("ok");
        }
      }
      // switch_on: needs a switched-off account first
      const t = await fresh();
      if (role === "owner") await issue("set_active", t.id);
      await setActive(w.owner, t.id, false);
      const check = { action: "switch_on" as const, targetRole: role };
      const r = await attempt(() => setActive(w.owner, t.id, true));
      expect(r.includes("REAUTH_REQUIRED")).toBe(isProtectedAction(check));
      expect(r.includes("REAUTH_REQUIRED")).toBe(
        grantActionFor(check) !== null,
      );
    }
  });
});

describe("the 15-minute attempt window, with controlled timestamps (REA-16)", () => {
  // The audit table is append-only, so the clock cannot be moved and rows cannot be aged. Instead the re-authentication
  // rows that reauth_begin counts are INSERTED with a chosen occurred_at (only the owner role can write audit_logs),
  // and the real reauth_begin is then called. It is the same SQL predicate that real elapsed time would meet.
  const MIN = 60;
  const rowAt = (actor: string, action: string, secondsAgo: number) =>
    q(
      `insert into public.audit_logs (actor_id, actor_name, action, table_name, record_id, target_user_id, changed_fields, occurred_at)
       values ($1, 'Test', $2, 'user_profiles', $3, $4, array['set_active'], now() - ($5 || ' seconds')::interval)`,
      [actor, action, w.owner, w.owner, String(secondsAgo)],
    );
  const attemptsAt = async (actor: string, agesInSeconds: number[]) => {
    for (const age of agesInSeconds) await rowAt(actor, "reauth_attempt", age);
  };
  /** true = an attempt was reserved; false = REAUTH_LOCKED (any other error is a test failure) */
  const reserve = async (actor: string) => {
    try {
      await begin(actor, "set_active", w.owner);
      return true;
    } catch (e) {
      if (String((e as Error).message).includes("REAUTH_LOCKED")) return false;
      throw e;
    }
  };
  /** how many MORE attempts can be reserved before the lock */
  const roomLeft = async (actor: string) => {
    let n = 0;
    while (await reserve(actor)) n++;
    return n;
  };

  it("REA-16a: five attempts inside the 15 minutes lock the Owner; four do not", async () => {
    const five = await newOwner("rea16a");
    await attemptsAt(five.id, [14 * MIN, 10 * MIN, 6 * MIN, 3 * MIN, 1 * MIN]);
    expect(await reserve(five.id)).toBe(false);
    const four = await newOwner("rea16a4");
    await attemptsAt(four.id, [14 * MIN, 10 * MIN, 6 * MIN, 3 * MIN]);
    expect(await reserve(four.id)).toBe(true); // the fifth is allowed ...
    expect(await reserve(four.id)).toBe(false); // ... and the sixth is not
  });

  it("REA-16b: attempts older than 15 minutes do not count, however many there are", async () => {
    const o = await newOwner("rea16b");
    await attemptsAt(o.id, [
      20 * MIN,
      30 * MIN,
      60 * MIN,
      120 * MIN,
      24 * 60 * MIN,
      7 * 24 * 60 * MIN,
    ]);
    // all six are outside the window: a full set of five NEW attempts still fits, and then the lock
    expect(await roomLeft(o.id)).toBe(5);
  });

  it("REA-16c: attempts inside and outside the window are counted separately", async () => {
    const o = await newOwner("rea16c");
    await attemptsAt(o.id, [2 * MIN, 5 * MIN, 9 * MIN, 16 * MIN, 40 * MIN]); // three inside, two outside
    expect(await roomLeft(o.id)).toBe(2); // two more fit (three + two = five inside), then locked
    expect(await reserve(o.id)).toBe(false);
  });

  it("REA-16d: the 15-minute boundary: 14m55s is inside, 15m05s has aged out", async () => {
    const inside = await newOwner("rea16d1");
    await attemptsAt(inside.id, [
      15 * MIN - 5,
      4 * MIN,
      3 * MIN,
      2 * MIN,
      1 * MIN,
    ]);
    expect(await reserve(inside.id)).toBe(false); // five inside: locked
    const outside = await newOwner("rea16d2");
    await attemptsAt(outside.id, [
      15 * MIN + 5,
      4 * MIN,
      3 * MIN,
      2 * MIN,
      1 * MIN,
    ]);
    expect(await reserve(outside.id)).toBe(true); // the oldest aged out: four count, one more fits
    expect(await reserve(outside.id)).toBe(false); // and that fifth locks it
    // exactly on the line (15 minutes old) is already outside: the rule is "newer than 15 minutes"
    const online = await newOwner("rea16d3");
    await attemptsAt(online.id, [15 * MIN, 4 * MIN, 3 * MIN, 2 * MIN, 1 * MIN]);
    expect(await reserve(online.id)).toBe(true);
  });

  it("REA-16e: a successful verification resets the window; only attempts made after it count", async () => {
    const o = await newOwner("rea16e");
    await attemptsAt(o.id, [14 * MIN, 10 * MIN, 6 * MIN, 3 * MIN, 1 * MIN]);
    expect(await reserve(o.id)).toBe(false); // locked before the password was right
    await issue("set_active", o.id, o.id, "false"); // the server issues a grant after a correct password
    // the five older attempts are still inside 15 minutes, but they came BEFORE the success: they no longer count
    expect(await roomLeft(o.id)).toBe(5);
    // attempts recorded AFTER a success count again
    const p = await newOwner("rea16e2");
    await issue("set_active", p.id, p.id, "false");
    await attemptsAt(p.id, [4 * MIN, 3 * MIN, 2 * MIN, 1 * MIN, 30]);
    expect(await reserve(p.id)).toBe(false);
    // a success after the attempts clears them again
    await issue("set_active", p.id, p.id, "false");
    expect(await reserve(p.id)).toBe(true);
  });

  it("REA-16f: different Owners have independent counters", async () => {
    const x = await newOwner("rea16fx");
    const y = await newOwner("rea16fy");
    const z = await newOwner("rea16fz");
    await attemptsAt(x.id, [14 * MIN, 10 * MIN, 6 * MIN, 3 * MIN, 1 * MIN]);
    await attemptsAt(y.id, [3 * MIN, 2 * MIN, 1 * MIN]); // three
    await attemptsAt(z.id, [4 * MIN, 3 * MIN, 2 * MIN, 1 * MIN]); // four
    expect(await reserve(x.id)).toBe(false); // x is locked ...
    expect(await roomLeft(y.id)).toBe(2); // ... y still has its own two ...
    expect(await roomLeft(z.id)).toBe(1); // ... and z its own one; nobody borrows from anybody
    // the first Owner (w.owner) has a counter of its own as well
    expect(await reserve(w.owner)).toBe(true);
  });

  it("REA-16g: failure rows and other re-authentication rows are audit records, not attempts: they never cause a lock", async () => {
    const o = await newOwner("rea16g");
    for (const age of [1 * MIN, 2 * MIN, 3 * MIN, 4 * MIN, 5 * MIN, 6 * MIN]) {
      await rowAt(o.id, "reauth_failed", age); // failures without a reserved attempt
    }
    for (const age of [1 * MIN, 2 * MIN, 3 * MIN]) {
      await rowAt(o.id, "reauth_verified", age + 600); // earlier successes (ten minutes before those failures)
    }
    expect(await roomLeft(o.id)).toBe(5); // only reserved attempts count: all five still fit
    // attempts written by other actors never count for this one
    const other = await newOwner("rea16g2");
    await attemptsAt(other.id, [60, 120, 180, 240, 300]);
    const clean = await newOwner("rea16g3");
    expect(await reserve(other.id)).toBe(false);
    expect(await roomLeft(clean.id)).toBe(5);
  });
});
