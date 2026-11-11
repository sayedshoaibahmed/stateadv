/**
 * What the database does when the one-time script inserts the very first Owner as the service role
 * (no logged-in user). Fresh empty database, fictional data.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createDb, expectDbError, type TestDb } from "./harness";
import { uid } from "./fixtures";

let db: TestDb;
beforeAll(async () => {
  db = await createDb();
}, 120_000);

const svc = <T>(fn: () => Promise<T>) => db.as({ role: "service_role" }, fn);
async function login(email: string) {
  const id = uid();
  await db.q(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
  return id;
}

describe("first Owner via the service role", () => {
  it("FUO-DB-1: the first profile must be an active Owner", async () => {
    const id = await login("first1@test.example");
    await expectDbError(
      svc(() =>
        db.q(
          `insert into public.user_profiles (id, full_name, email, role) values ($1, 'Test First', 'first1@test.example', 'manager')`,
          [id],
        ),
      ),
      "FIRST_USER_MUST_BE_OWNER",
    );
    expect((await db.q(`select 1 from public.user_profiles`)).length).toBe(0);
  });

  it("FUO-DB-2: the first Owner is created, must change the password, and the creation is audited", async () => {
    const id = await login("first2@test.example");
    await svc(() =>
      db.q(
        `insert into public.user_profiles (id, full_name, email, role) values ($1, 'Test First', 'first2@test.example', 'owner')`,
        [id],
      ),
    );
    const p = await db.q<{
      role: string;
      is_active: boolean;
      must_change_password: boolean;
    }>(
      `select role, is_active, must_change_password from public.user_profiles where id = $1`,
      [id],
    );
    expect(p[0]).toEqual({
      role: "owner",
      is_active: true,
      must_change_password: true,
    });
    const a = await db.q<{ actor_id: string | null; action: string }>(
      `select actor_id, action from public.audit_logs where table_name = 'user_profiles' and record_id = $1`,
      [id],
    );
    expect(a).toEqual([{ actor_id: null, action: "insert" }]);
  });

  it("FUO-DB-3: after that, the service role without a logged-in user cannot add anyone (no hidden second Owner)", async () => {
    const id = await login("second@test.example");
    for (const role of ["owner", "manager"]) {
      await expectDbError(
        svc(() =>
          db.q(
            `insert into public.user_profiles (id, full_name, email, role) values ($1, 'Test Second', 'second@test.example', $2::public.user_role)`,
            [id, role],
          ),
        ),
        "NOT_ALLOWED",
      );
    }
    expect((await db.q(`select 1 from public.user_profiles`)).length).toBe(1);
  });
});
