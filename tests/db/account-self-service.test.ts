/**
 * Account self-service (PRD FR-AUTH-5; migration 11).
 * PGlite only (stand-in for Supabase). Everything is fictional.
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
const asAuth = <T>(id: string | null, fn: () => Promise<T>) =>
  w.db.as({ role: "authenticated", uid: id }, fn);
const flag = async (id: string) =>
  (
    await q<{ must_change_password: boolean }>(
      `select must_change_password from public.user_profiles where id = $1`,
      [id],
    )
  )[0].must_change_password;

describe("complete_password_change", () => {
  it("ACC-01: a new user starts with the flag on and clears only their own flag", async () => {
    expect(await flag(w.manager)).toBe(true);
    expect(await flag(w.manager2)).toBe(true);
    await asAuth(w.manager, () =>
      q(`select public.complete_password_change()`),
    );
    expect(await flag(w.manager)).toBe(false);
    expect(await flag(w.manager2)).toBe(true); // someone else's flag is untouched
    expect(await flag(w.owner)).toBe(true); // the Owner's flag is untouched too
  });

  it("ACC-02: the change is audited with the logged-in user as actor", async () => {
    const rows = await q<{ actor_id: string; changed_fields: string[] }>(
      `select actor_id, changed_fields from public.audit_logs
       where table_name = 'user_profiles' and record_id = $1 and action = 'update'
       order by id desc limit 1`,
      [w.manager],
    );
    expect(rows[0].actor_id).toBe(w.manager);
    expect(rows[0].changed_fields).toContain("must_change_password");
  });

  it("ACC-03: calling it again is harmless", async () => {
    await asAuth(w.manager, () =>
      q(`select public.complete_password_change()`),
    );
    expect(await flag(w.manager)).toBe(false);
  });

  it("ACC-04: an Owner can clear their own flag", async () => {
    await asAuth(w.owner, () => q(`select public.complete_password_change()`));
    expect(await flag(w.owner)).toBe(false);
  });

  it("ACC-05: nobody without an active profile can call it", async () => {
    // logged in but no profile
    await expectDbError(
      asAuth(uid(), () => q(`select public.complete_password_change()`)),
      "NOT_ALLOWED",
    );
    // no session user at all
    await expectDbError(
      asAuth(null, () => q(`select public.complete_password_change()`)),
      "NOT_ALLOWED",
    );
  });

  it("ACC-06: a disabled user cannot call it", async () => {
    const id = uid();
    await q(
      `insert into auth.users (id, email) values ($1, 'acc06@test.example')`,
      [id],
    );
    await w.db.as({ role: "postgres", uid: w.owner }, () =>
      q(
        `insert into public.user_profiles (id, full_name, email, role) values ($1, 'Test Acc06', 'acc06@test.example', 'manager')`,
        [id],
      ),
    );
    await w.db.as({ role: "postgres", uid: w.owner }, () =>
      q(
        `update public.user_profiles set is_active = false, disabled_at = now() where id = $1`,
        [id],
      ),
    );
    await expectDbError(
      asAuth(id, () => q(`select public.complete_password_change()`)),
      "NOT_ALLOWED",
    );
    expect(await flag(id)).toBe(true);
  });

  it("ACC-07: the anonymous role cannot call it", async () => {
    await expectDbError(
      w.db.as({ role: "anon" }, () =>
        q(`select public.complete_password_change()`),
      ),
      "permission denied",
    );
  });

  it("ACC-08: there is still no way to write to the table directly", async () => {
    await expectDbError(
      asAuth(w.manager2, () =>
        q(
          `update public.user_profiles set must_change_password = false where id = $1`,
          [w.manager2],
        ),
      ),
      "permission denied",
    );
    expect(await flag(w.manager2)).toBe(true);
  });
});

describe("function privileges (applies to every function, now and later)", () => {
  it("ACC-09: no function in schema public is executable by PUBLIC", async () => {
    const rows = await q<{ proname: string }>(`
      select p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
      where p.prokind = 'f'
        and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                    where a.grantee = 0 and a.privilege_type = 'EXECUTE')`);
    expect(rows).toEqual([]);
  });

  it("ACC-10: every function has a fixed search_path", async () => {
    const rows = await q<{ proname: string }>(`
      select p.proname from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
      where p.prokind = 'f'
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`);
    expect(rows).toEqual([]);
  });
});
