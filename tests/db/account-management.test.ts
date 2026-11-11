/**
 * Account management functions (migration 12; PRD FR-AUTH-3..16; O1-O7).
 * PGlite stand-in only. Everything is fictional. Password re-entry (O3) is enforced by the
 * database through single-use grants (migration 19); every protected call below first issues one with reauth().
 * The grants themselves are tested in reauth-grants.test.ts.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { expectDbError } from "./harness";
import { reauth as issueGrant, setupWorld, uid, type World } from "./fixtures";

let w: World;
beforeAll(async () => {
  w = await setupWorld();
}, 120_000);

const q = <T = Record<string, unknown>>(sql: string, p?: unknown[]) =>
  w.db.q<T>(sql, p);
const as = <T>(id: string | null, fn: () => Promise<T>) =>
  w.db.as({ role: "authenticated", uid: id }, fn);
const call = (id: string | null, sql: string, p?: unknown[]) =>
  as(id, () => q(sql, p));

const reauth = (
  action: Parameters<typeof issueGrant>[2],
  target: string,
  actor: string = w.owner,
) => issueGrant(w.db, actor, action, target);

const LONG = "A proper written reason for this.";

/** A login in Supabase Auth (stand-in). Returns id + email. */
async function login(tag = uid().slice(0, 8)) {
  const id = uid();
  const email = `${tag}@test.example`;
  await q(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
  return { id, email };
}
async function makeProfile(
  actor: string,
  role: "owner" | "manager",
  tag?: string,
) {
  const l = await login(tag);
  if (role === "owner") await reauth("add_owner", l.id, actor);
  await call(
    actor,
    `select public.profile_create($1, $2, $3, $4::public.user_role, null, $5)`,
    [l.id, `Test ${l.email.split("@")[0]}`, l.email, role, LONG],
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
      phone: string | null;
      email: string;
    }>(`select * from public.user_profiles where id = $1`, [id])
  )[0];

describe("profile_create", () => {
  it("ACM-01: a Manager can add a Manager; the new account must change its password", async () => {
    const l = await login("acm01");
    await call(
      w.manager,
      `select public.profile_create($1, 'Test Acm01', $2, 'manager')`,
      [l.id, l.email],
    );
    const p = await profile(l.id);
    expect(p.role).toBe("manager");
    expect(p.is_active).toBe(true);
    expect(p.must_change_password).toBe(true);
    const a = await q<{ actor_id: string }>(
      `select actor_id from public.audit_logs where table_name = 'user_profiles' and record_id = $1 and action = 'insert'`,
      [l.id],
    );
    expect(a[0].actor_id).toBe(w.manager);
  });

  it("ACM-02: a Manager cannot add an Owner (O2)", async () => {
    const l = await login();
    await expectDbError(
      call(
        w.manager,
        `select public.profile_create($1, 'Test X', $2, 'owner', null, $3)`,
        [l.id, l.email, LONG],
      ),
      "OWNER_ACTION_REQUIRES_OWNER",
    );
    expect(
      await q(`select 1 from public.user_profiles where id = $1`, [l.id]),
    ).toEqual([]);
  });

  it("ACM-03: adding an Owner needs a written reason of 10+ characters (O6) and the reason is audited", async () => {
    const l = await login("acm03");
    await expectDbError(
      call(
        w.owner,
        `select public.profile_create($1, 'Test Acm03', $2, 'owner', null, 'short')`,
        [l.id, l.email],
      ),
      "REASON_REQUIRED",
    );
    await expectDbError(
      call(
        w.owner,
        `select public.profile_create($1, 'Test Acm03', $2, 'owner')`,
        [l.id, l.email],
      ),
      "REASON_REQUIRED",
    );
    await reauth("add_owner", l.id);
    await call(
      w.owner,
      `select public.profile_create($1, 'Test Acm03', $2, 'owner', null, $3)`,
      [l.id, l.email, LONG],
    );
    expect((await profile(l.id)).role).toBe("owner");
    const a = await q<{ reason: string }>(
      `select reason from public.audit_logs where table_name = 'user_profiles' and record_id = $1 and action = 'insert'`,
      [l.id],
    );
    expect(a[0].reason).toBe(LONG);
    // keep the world at one Owner for the other tests: remove this extra Owner's activity by disabling later tests' reliance
    await reauth("set_active", l.id);
    await call(w.owner, `select public.profile_set_active($1, false, $2)`, [
      l.id,
      LONG,
    ]);
  });

  it("ACM-04: the profile must match a real login with the same email", async () => {
    const l = await login();
    await expectDbError(
      call(
        w.owner,
        `select public.profile_create($1, 'Test X', 'other@test.example', 'manager')`,
        [l.id],
      ),
      "AUTH_EMAIL_MISMATCH",
    );
    await expectDbError(
      call(
        w.owner,
        `select public.profile_create($1, 'Test X', 'ghost@test.example', 'manager')`,
        [uid()],
      ),
      "AUTH_USER_MISSING",
    );
  });

  it("ACM-05: a duplicate email or duplicate login is refused with a clear code", async () => {
    const l = await login("acm05");
    await call(
      w.owner,
      `select public.profile_create($1, 'Test Acm05', $2, 'manager')`,
      [l.id, l.email],
    );
    await expectDbError(
      call(
        w.owner,
        `select public.profile_create($1, 'Test Again', $2, 'manager')`,
        [l.id, l.email],
      ),
      "DUPLICATE_ACCOUNT",
    );
    // a second login whose email differs only by capital letters
    const l2 = await login("acm05b");
    await q(
      `update auth.users set email = 'Acm05@Test.Example' where id = $1`,
      [l2.id],
    );
    await expectDbError(
      call(
        w.owner,
        `select public.profile_create($1, 'Test Dup', 'ACM05@test.example', 'manager')`,
        [l2.id],
      ),
      "DUPLICATE_ACCOUNT",
    );
  });

  it("ACM-06: no session, no profile, or a disabled user cannot add users; empty input is refused", async () => {
    const l = await login();
    await expectDbError(
      call(null, `select public.profile_create($1, 'T', $2, 'manager')`, [
        l.id,
        l.email,
      ]),
      "NOT_ALLOWED",
    );
    await expectDbError(
      call(uid(), `select public.profile_create($1, 'T', $2, 'manager')`, [
        l.id,
        l.email,
      ]),
      "NOT_ALLOWED",
    );
    await expectDbError(
      call(w.owner, `select public.profile_create($1, '   ', $2, 'manager')`, [
        l.id,
        l.email,
      ]),
      "INVALID_INPUT",
    );
    await expectDbError(
      call(w.owner, `select public.profile_create($1, 'T', $2, null)`, [
        l.id,
        l.email,
      ]),
      "INVALID_INPUT",
    );
  });
});

describe("profile_update", () => {
  it("ACM-07: name and phone change; the email never does", async () => {
    const m = await makeProfile(w.owner, "manager", "acm07");
    await call(
      w.manager,
      `select public.profile_update($1, 'Test Renamed', ' 99999 ')`,
      [m.id],
    );
    const p = await profile(m.id);
    expect(p.full_name).toBe("Test Renamed");
    expect(p.phone).toBe("99999");
    expect(p.email).toBe(m.email);
    await call(w.manager, `select public.profile_update($1, null, '')`, [m.id]);
    expect((await profile(m.id)).phone).toBeNull();
  });

  it("ACM-08: nobody changes their own role, even to the same value being a no-op", async () => {
    await expectDbError(
      call(
        w.manager,
        `select public.profile_update($1, null, null, 'owner', $2)`,
        [w.manager, LONG],
      ),
      "CANNOT_CHANGE_OWN_ROLE",
    );
    await expectDbError(
      call(
        w.owner,
        `select public.profile_update($1, null, null, 'manager', $2)`,
        [w.owner, LONG],
      ),
      "CANNOT_CHANGE_OWN_ROLE",
    );
    await call(
      w.manager,
      `select public.profile_update($1, 'Test Manager One')`,
      [w.manager],
    ); // harmless
    expect((await profile(w.manager)).role).toBe("manager");
  });

  it("ACM-09: a Manager cannot make another person an Owner (O2) nor change an Owner's details", async () => {
    const m = await makeProfile(w.owner, "manager", "acm09");
    await expectDbError(
      call(
        w.manager,
        `select public.profile_update($1, null, null, 'owner', $2)`,
        [m.id, LONG],
      ),
      "OWNER_ACTION_REQUIRES_OWNER",
    );
    expect((await profile(m.id)).role).toBe("manager");
  });

  it("ACM-10: a role change needs a reason; an Owner can promote a Manager, and that is audited with the reason", async () => {
    const m = await makeProfile(w.owner, "manager", "acm10");
    await expectDbError(
      call(w.owner, `select public.profile_update($1, null, null, 'owner')`, [
        m.id,
      ]),
      "REASON_REQUIRED",
    );
    await reauth("change_role", m.id);
    await call(
      w.owner,
      `select public.profile_update($1, null, null, 'owner', $2)`,
      [m.id, LONG],
    );
    expect((await profile(m.id)).role).toBe("owner");
    const a = await q<{ reason: string; changed_fields: string[] }>(
      `select reason, changed_fields from public.audit_logs where table_name = 'user_profiles' and record_id = $1 and action = 'update' order by id desc limit 1`,
      [m.id],
    );
    expect(a[0].reason).toBe(LONG);
    expect(a[0].changed_fields).toContain("role");
    // a second Owner now exists: it is allowed to demote nobody here, but the first Owner can be disabled by it
    await reauth("set_active", m.id);
    await call(w.owner, `select public.profile_set_active($1, false, $2)`, [
      m.id,
      LONG,
    ]);
  });

  it("ACM-11: an unknown person is reported plainly", async () => {
    await expectDbError(
      call(w.owner, `select public.profile_update($1, 'X')`, [uid()]),
      "PROFILE_NOT_FOUND",
    );
  });
});

describe("profile_set_active", () => {
  it("ACM-12: a Manager can switch a Manager off and on; history keeps the person", async () => {
    const m = await makeProfile(w.owner, "manager", "acm12");
    await call(
      w.manager,
      `select public.profile_set_active($1, false, 'left the team')`,
      [m.id],
    );
    let p = await profile(m.id);
    expect(p.is_active).toBe(false);
    const d = await q<{ disabled_by: string }>(
      `select disabled_by from public.user_profiles where id = $1`,
      [m.id],
    );
    expect(d[0].disabled_by).toBe(w.manager);
    await call(w.manager, `select public.profile_set_active($1, true)`, [m.id]);
    p = await profile(m.id);
    expect(p.is_active).toBe(true);
    // doing it twice changes nothing and does not fail
    await call(w.manager, `select public.profile_set_active($1, true)`, [m.id]);
  });

  it("ACM-13: nobody can switch off their own account", async () => {
    await expectDbError(
      call(w.manager, `select public.profile_set_active($1, false)`, [
        w.manager,
      ]),
      "CANNOT_DISABLE_SELF",
    );
    await reauth("set_active", w.owner);
    await expectDbError(
      call(w.owner, `select public.profile_set_active($1, false, $2)`, [
        w.owner,
        LONG,
      ]),
      "CANNOT_DISABLE_SELF",
    );
  });

  it("ACM-14: a Manager cannot switch an Owner off (O1)", async () => {
    await expectDbError(
      call(w.manager, `select public.profile_set_active($1, false, $2)`, [
        w.owner,
        LONG,
      ]),
      "OWNER_ACTION_REQUIRES_OWNER",
    );
    expect((await profile(w.owner)).is_active).toBe(true);
  });

  it("ACM-15: an Owner can switch another Owner off with a reason, never the last one", async () => {
    const o2 = await makeProfile(w.owner, "owner", "acm15");
    await expectDbError(
      call(w.owner, `select public.profile_set_active($1, false)`, [o2.id]),
      "REASON_REQUIRED",
    );
    await reauth("set_active", o2.id);
    await call(w.owner, `select public.profile_set_active($1, false, $2)`, [
      o2.id,
      LONG,
    ]);
    expect((await profile(o2.id)).is_active).toBe(false);
    // only one active Owner is left: the second Owner (now disabled) cannot be used, the first cannot be removed
    expect(
      await call(w.owner, `select public.active_owner_count() as n`).then(
        (r) => (r[0] as { n: number }).n,
      ),
    ).toBe(1);
  });

  it("ACM-16: a disabled user can do nothing", async () => {
    const m = await makeProfile(w.owner, "manager", "acm16");
    await call(w.owner, `select public.profile_set_active($1, false)`, [m.id]);
    await expectDbError(
      call(m.id, `select public.profile_set_active($1, false)`, [w.manager2]),
      "NOT_ALLOWED",
    );
    await expectDbError(
      call(m.id, `select public.active_owner_count()`),
      "NOT_ALLOWED",
    );
  });
});

describe("profile_change_email (someone else's email)", () => {
  it("ACM-17: a Manager can correct a Manager's email with a reason; never their own", async () => {
    const m = await makeProfile(w.owner, "manager", "acm17");
    await expectDbError(
      call(
        w.manager,
        `select public.profile_change_email($1, 'new17@test.example', 'x')`,
        [m.id],
      ),
      "REASON_REQUIRED",
    );
    await call(
      w.manager,
      `select public.profile_change_email($1, 'NEW17@test.example', $2)`,
      [m.id, LONG],
    );
    expect((await profile(m.id)).email).toBe("new17@test.example");
    await expectDbError(
      call(
        w.manager,
        `select public.profile_change_email($1, 'mine@test.example', $2)`,
        [w.manager, LONG],
      ),
      "EMAIL_CHANGE_REQUIRES_VERIFICATION",
    );
  });

  it("ACM-18: only another Owner changes an Owner's email (O1); duplicates and bad addresses are refused", async () => {
    await expectDbError(
      call(
        w.manager,
        `select public.profile_change_email($1, 'x18@test.example', $2)`,
        [w.owner, LONG],
      ),
      "OWNER_ACTION_REQUIRES_OWNER",
    );
    const m = await makeProfile(w.owner, "manager", "acm18");
    await expectDbError(
      call(
        w.owner,
        `select public.profile_change_email($1, 'manager1@test.example', $2)`,
        [m.id, LONG],
      ),
      "DUPLICATE_ACCOUNT",
    );
    await expectDbError(
      call(
        w.owner,
        `select public.profile_change_email($1, 'not-an-email', $2)`,
        [m.id, LONG],
      ),
      "INVALID_INPUT",
    );
  });
});

describe("profile_reset_password", () => {
  it("ACM-19: a Manager's password reset marks 'must change' and is always audited", async () => {
    const m = await makeProfile(w.owner, "manager", "acm19");
    await call(m.id, `select public.complete_password_change()`).catch(
      () => undefined,
    );
    await call(
      w.manager,
      `select public.profile_reset_password($1, 'forgot it')`,
      [m.id],
    );
    expect((await profile(m.id)).must_change_password).toBe(true);
    // again while the flag is already on: still an audit entry
    await call(w.manager, `select public.profile_reset_password($1)`, [m.id]);
    const n = await q<{ n: string }>(
      `select count(*)::text n from public.audit_logs where action = 'password_reset' and target_user_id = $1`,
      [m.id],
    );
    expect(Number(n[0].n)).toBe(2);
  });

  it("ACM-20: a Manager can NEVER reset an Owner's password - even if the flag is already on (O1)", async () => {
    expect((await profile(w.owner)).must_change_password).toBe(true);
    await expectDbError(
      call(w.manager, `select public.profile_reset_password($1, $2)`, [
        w.owner,
        LONG,
      ]),
      "OWNER_ACTION_REQUIRES_OWNER",
    );
  });

  it("ACM-21: an Owner can reset another Owner's password only with a reason; nobody resets their own here", async () => {
    const o2 = await makeProfile(w.owner, "owner", "acm21");
    await expectDbError(
      call(w.owner, `select public.profile_reset_password($1)`, [o2.id]),
      "REASON_REQUIRED",
    );
    await reauth("reset_password", o2.id);
    await call(w.owner, `select public.profile_reset_password($1, $2)`, [
      o2.id,
      LONG,
    ]);
    const a = await q<{ reason: string; actor_id: string }>(
      `select reason, actor_id from public.audit_logs where action = 'password_reset' and target_user_id = $1`,
      [o2.id],
    );
    expect(a[0].reason).toBe(LONG);
    expect(a[0].actor_id).toBe(w.owner);
    await expectDbError(
      call(w.owner, `select public.profile_reset_password($1, $2)`, [
        w.owner,
        LONG,
      ]),
      "CANNOT_RESET_OWN_PASSWORD",
    );
    await reauth("set_active", o2.id);
    await call(w.owner, `select public.profile_set_active($1, false, $2)`, [
      o2.id,
      LONG,
    ]);
  });

  it("ACM-22: a disabled account cannot be reset until it is switched on", async () => {
    const m = await makeProfile(w.owner, "manager", "acm22");
    await call(w.owner, `select public.profile_set_active($1, false)`, [m.id]);
    await expectDbError(
      call(w.manager, `select public.profile_reset_password($1)`, [m.id]),
      "ACCOUNT_DISABLED",
    );
  });
});

describe("recover_owner_account (service role only)", () => {
  it("ACM-23: app users, including Owners, cannot call it", async () => {
    await expectDbError(
      call(w.owner, `select public.recover_owner_account($1, $2)`, [
        w.owner,
        LONG,
      ]),
      "permission denied",
    );
    await expectDbError(
      w.db.as({ role: "anon" }, () =>
        q(`select public.recover_owner_account($1, $2)`, [w.owner, LONG]),
      ),
      "permission denied",
    );
  });

  it("ACM-24: the server script re-enables a disabled Owner, forces a password change and audits 'owner_recovered'", async () => {
    // two Owners: switch the second one off, then recover it
    const o2 = await makeProfile(w.owner, "owner", "acm24");
    await reauth("set_active", o2.id);
    await call(w.owner, `select public.profile_set_active($1, false, $2)`, [
      o2.id,
      LONG,
    ]);
    await expectDbError(
      w.db.as({ role: "service_role" }, () =>
        q(`select public.recover_owner_account($1, 'short')`, [o2.id]),
      ),
      "REASON_REQUIRED",
    );
    await w.db.as({ role: "service_role" }, () =>
      q(`select public.recover_owner_account($1, $2)`, [o2.id, LONG]),
    );
    const p = await profile(o2.id);
    expect(p.is_active).toBe(true);
    expect(p.must_change_password).toBe(true);
    const a = await q<{ actor_id: string | null; reason: string }>(
      `select actor_id, reason from public.audit_logs where action = 'owner_recovered' and target_user_id = $1`,
      [o2.id],
    );
    expect(a).toHaveLength(1);
    expect(a[0].actor_id).toBeNull();
    expect(a[0].reason).toBe(LONG);
    await reauth("set_active", o2.id);
    await call(w.owner, `select public.profile_set_active($1, false, $2)`, [
      o2.id,
      LONG,
    ]);
  });

  it("ACM-25: it works only on Owner accounts and cannot be used as a back door for managers", async () => {
    await expectDbError(
      w.db.as({ role: "service_role" }, () =>
        q(`select public.recover_owner_account($1, $2)`, [w.manager, LONG]),
      ),
      "PROFILE_NOT_FOUND",
    );
  });

  it("ACM-26: the recovery switch does not stay on afterwards", async () => {
    // an ordinary change right after recovery gets no special treatment
    await expectDbError(
      call(w.manager, `select public.profile_set_active($1, false, $2)`, [
        w.owner,
        LONG,
      ]),
      "OWNER_ACTION_REQUIRES_OWNER",
    );
    expect((await profile(w.owner)).is_active).toBe(true);
  });
});

describe("function privileges for migration 12", () => {
  it("ACM-27: internal helpers are not callable by app users; the public ones only by authenticated", async () => {
    const rows = await q<{
      proname: string;
      anon: boolean;
      auth: boolean;
      svc: boolean;
    }>(`
      select p.proname,
             has_function_privilege('anon', p.oid, 'EXECUTE') anon,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') auth,
             has_function_privilege('service_role', p.oid, 'EXECUTE') svc
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
      where p.proname in ('require_reason','audit_account_action','active_owner_count','profile_create','profile_update',
                          'profile_change_email','profile_set_active','profile_reset_password','recover_owner_account')
      order by 1`);
    const by = Object.fromEntries(rows.map((r) => [r.proname, r]));
    for (const n of ["require_reason", "audit_account_action"]) {
      expect(by[n].anon || by[n].auth).toBe(false);
    }
    for (const n of [
      "active_owner_count",
      "profile_create",
      "profile_update",
      "profile_change_email",
      "profile_set_active",
      "profile_reset_password",
    ]) {
      expect(by[n].anon).toBe(false);
      expect(by[n].auth).toBe(true);
    }
    expect(by.recover_owner_account.anon).toBe(false);
    expect(by.recover_owner_account.auth).toBe(false);
    expect(by.recover_owner_account.svc).toBe(true);
  });
});
