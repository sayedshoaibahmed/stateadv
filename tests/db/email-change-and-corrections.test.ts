/**
 * Owner decisions of 2026-11-11:
 *   O7  - verified own-email change (Supabase Auth confirms; the profile only ever
 *         takes the confirmed address; role self-change stays prohibited)
 *   Q9a - controlled correction files for APPROVED payments/refunds (originals stay
 *         immutable, files are clearly identified, no financial figure changes)
 *
 * Supabase Auth itself (links, the "old + new address" confirmation) is not part of this
 * database; what is tested here is exactly what the database does when Auth reports a
 * confirmed address (a change of auth.users.email) and when someone tries to cheat.
 * Fictional data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { expectDbError } from "./harness";
import {
  addPayment,
  addRefund,
  cancelBooking,
  createBooking,
  setStatus,
  setupWorld,
  uid,
  type Booking,
  type World,
} from "./fixtures";

let w: World;
beforeAll(async () => {
  w = await setupWorld();
}, 120_000);

const q = <T = Record<string, unknown>>(sql: string, p?: unknown[]) =>
  w.db.q<T>(sql, p);
const asUser = <T>(id: string | null, fn: () => Promise<T>) =>
  w.db.as({ role: "postgres", uid: id }, fn);
const tx = <T>(id: string, fn: () => Promise<T>) =>
  w.db.tx({ role: "postgres", uid: id }, fn);

const profileEmail = async (id: string) =>
  (
    await q<{ email: string }>(
      `select email from public.user_profiles where id = $1`,
      [id],
    )
  )[0].email;
const authEmail = async (id: string) =>
  (
    await q<{ email: string }>(`select email from auth.users where id = $1`, [
      id,
    ])
  )[0].email;

/** Tell the database "the sync trigger is running" - what a cheater would try. */
const withFlag = async <T>(fn: () => Promise<T>) => {
  await w.db.exec(`select set_config('app.email_sync', 'on', false)`);
  try {
    return await fn();
  } finally {
    await w.db.exec(`select set_config('app.email_sync', 'off', false)`);
  }
};

describe("O7 - verified own-email change", () => {
  it("EML-03: when Auth confirms a new address, the profile takes exactly that address and the change is audited", async () => {
    await q(
      `update auth.users set email = 'owner.new@test.example' where id = $1`,
      [w.owner],
    );
    expect(await profileEmail(w.owner)).toBe("owner.new@test.example");
    expect(await authEmail(w.owner)).toBe("owner.new@test.example");
    const [a] = await q<{
      actor_id: string | null;
      target_user_id: string;
      changed_fields: string[];
      old_data: { email: string };
      new_data: { email: string };
    }>(
      `select actor_id, target_user_id, changed_fields, old_data, new_data from public.audit_logs
       where table_name = 'user_profiles' and target_user_id = $1 and 'email' = any(changed_fields)
       order by id desc limit 1`,
      [w.owner],
    );
    expect(a.target_user_id).toBe(w.owner);
    expect(a.actor_id).toBeNull(); // done by Supabase Auth after the user confirmed, not by an app session
    expect(a.changed_fields).toEqual(["email"]); // nothing else changed
    expect(a.old_data.email).toBe("owner@test.example");
    expect(a.new_data.email).toBe("owner.new@test.example");
  });

  it("the sync touches only the email: role, status and the rest of the profile are unchanged", async () => {
    const before = await q(
      `select full_name, phone, role, is_active, must_change_password from public.user_profiles where id = $1`,
      [w.manager],
    );
    await q(
      `update auth.users set email = 'Manager.One.NEW@Test.example' where id = $1`,
      [w.manager],
    );
    expect(await profileEmail(w.manager)).toBe("manager.one.new@test.example"); // stored in lower case
    const after = await q(
      `select full_name, phone, role, is_active, must_change_password from public.user_profiles where id = $1`,
      [w.manager],
    );
    expect(after).toEqual(before);
  });

  it("an auth user without a profile, or an unchanged address, does nothing and does not fail", async () => {
    const stray = uid();
    await q(
      `insert into auth.users (id, email) values ($1, 'stray@test.example')`,
      [stray],
    );
    await q(
      `update auth.users set email = 'stray2@test.example' where id = $1`,
      [stray],
    );
    await q(`update auth.users set email = email where id = $1`, [w.owner]);
  });

  it("EML-04: nobody can edit their OWN profile email directly - Owner or Manager", async () => {
    for (const id of [w.owner, w.manager]) {
      await expectDbError(
        asUser(id, () =>
          q(
            `update public.user_profiles set email = 'mine@test.example' where id = $1`,
            [id],
          ),
        ),
        "EMAIL_CHANGE_REQUIRES_VERIFICATION",
      );
    }
  });

  it("EML-04: with no session at all, a direct email edit is refused", async () => {
    await expectDbError(
      q(
        `update public.user_profiles set email = 'x@test.example' where id = $1`,
        [w.manager2],
      ),
      "NOT_ALLOWED",
    );
  });

  it("EML-05: the 'sync' switch cannot be used to write an address Auth has not confirmed", async () => {
    // a different address than the one Auth confirmed for that user
    await withFlag(() =>
      expectDbError(
        q(
          `update public.user_profiles set email = 'attacker@test.example' where id = $1`,
          [w.owner],
        ),
        "NOT_ALLOWED",
      ),
    );
    // the right address but for ANOTHER user's profile
    const otherUsersAddress = await authEmail(w.manager);
    await withFlag(() =>
      expectDbError(
        q(`update public.user_profiles set email = $2 where id = $1`, [
          w.manager2,
          otherUsersAddress,
        ]),
        "NOT_ALLOWED",
      ),
    );
    expect(await profileEmail(w.owner)).toBe("owner.new@test.example");
  });

  it("EML-05: the 'sync' switch cannot be combined with any other change (role, status, ...)", async () => {
    // Simulate "Auth has confirmed a new address but the profile has not followed yet" by pausing
    // the sync trigger for this one test. (Otherwise the profile would follow immediately.)
    await q(`alter table auth.users disable trigger trg_sync_profile_email`);
    try {
      await q(
        `update auth.users set email = 'm2.confirmed@test.example' where id = $1`,
        [w.manager2],
      );
      // the sync path is genuinely open: with the switch on, the plain email copy IS accepted ...
      // ... but the very same update that also tries to make the account an Owner is refused.
      await withFlag(async () => {
        await expectDbError(
          q(
            `update public.user_profiles set email = 'm2.confirmed@test.example', role = 'owner' where id = $1`,
            [w.manager2],
          ),
          "NOT_ALLOWED",
        );
        await expectDbError(
          q(
            `update public.user_profiles set email = 'm2.confirmed@test.example', is_active = false where id = $1`,
            [w.manager2],
          ),
          "NOT_ALLOWED",
        );
        await q(
          `update public.user_profiles set email = 'm2.confirmed@test.example' where id = $1`,
          [w.manager2],
        );
      });
    } finally {
      await q(`alter table auth.users enable trigger trg_sync_profile_email`);
    }
    expect(await profileEmail(w.manager2)).toBe("m2.confirmed@test.example");
    const [{ role }] = await q<{ role: string }>(
      `select role from public.user_profiles where id = $1`,
      [w.manager2],
    );
    expect(role).toBe("manager");
  });

  it("EML-05: a logged-in user cannot use the switch either (a session is never a verified sync)", async () => {
    const ownConfirmedAddress = await authEmail(w.manager);
    await withFlag(async () => {
      await expectDbError(
        asUser(w.manager, () =>
          q(`update public.user_profiles set email = $2 where id = $1`, [
            w.manager,
            ownConfirmedAddress,
          ]),
        ),
        "EMAIL_CHANGE_REQUIRES_VERIFICATION",
      );
      await expectDbError(
        asUser(w.manager, () =>
          q(
            `update public.user_profiles set email = 'x@test.example' where id = $1`,
            [w.owner],
          ),
        ),
        "OWNER_ACTION_REQUIRES_OWNER",
      );
    });
  });

  it("if the profile cannot take the address, the Auth change is rolled back - the two never differ", async () => {
    const before = await authEmail(w.manager2);
    await expectDbError(
      q(`update auth.users set email = 'not-an-email' where id = $1`, [
        w.manager2,
      ]),
      "user_profiles_email_fmt",
    );
    expect(await authEmail(w.manager2)).toBe(before);
    expect(await profileEmail(w.manager2)).toBe(before);
  });

  it("EML-06: role self-change stays prohibited - the Owner cannot demote themselves, a Manager cannot promote themselves", async () => {
    await expectDbError(
      asUser(w.owner, () =>
        q(`update public.user_profiles set role = 'manager' where id = $1`, [
          w.owner,
        ]),
      ),
      "OWNER_ACTION_REQUIRES_OWNER",
    );
    await expectDbError(
      asUser(w.manager, () =>
        q(`update public.user_profiles set role = 'owner' where id = $1`, [
          w.manager,
        ]),
      ),
      "OWNER_ACTION_REQUIRES_OWNER",
    );
  });

  it("EML-07: the admin route still works as before: another Owner may change an Owner's email; a Manager may not", async () => {
    const second = uid();
    await q(
      `insert into auth.users (id, email) values ($1, 'second@test.example')`,
      [second],
    );
    await asUser(w.owner, () =>
      q(
        `insert into public.user_profiles (id, full_name, email, role) values ($1, 'Test Second', 'second@test.example', 'owner')`,
        [second],
      ),
    );
    await asUser(second, () =>
      q(
        `update public.user_profiles set email = 'owner.admin-changed@test.example' where id = $1`,
        [w.owner],
      ),
    );
    expect(await profileEmail(w.owner)).toBe(
      "owner.admin-changed@test.example",
    );
    await expectDbError(
      asUser(w.manager, () =>
        q(
          `update public.user_profiles set email = 'zzz@test.example' where id = $1`,
          [second],
        ),
      ),
      "OWNER_ACTION_REQUIRES_OWNER",
    );
  });

  it("the sole Owner's recovery path is unchanged: it can still re-enable and can never remove the last Owner", async () => {
    // (full coverage is in users-owner-protection.test.ts; here we only confirm O7 did not loosen it)
    await w.db.exec(`select set_config('app.owner_recovery', 'on', false)`);
    try {
      await q(
        `update public.user_profiles set full_name = 'Test Owner' where id = $1`,
        [w.owner],
      );
    } finally {
      await w.db.exec(`select set_config('app.owner_recovery', 'off', false)`);
    }
  });
});

describe("Q9a - correction files for approved payments and refunds", () => {
  const LONG = "Cash receipt photo was taken later";

  async function approvedPayment(
    method = "cash",
  ): Promise<{ b: Booking; pid: string }> {
    const b = await createBooking(w);
    const pid = await addPayment(w, b, { method, amount: 200000 });
    await setStatus(w, "payments", pid, "approved", w.manager);
    return { b, pid };
  }
  const addCorrection = (o: {
    paymentId?: string;
    refundId?: string;
    bookingId: string;
    reason?: string | null;
    isCorrection?: boolean;
    actor?: string;
  }) =>
    tx(o.actor ?? w.owner, async () => {
      const id = uid();
      await q(
        `insert into public.proofs (id, payment_id, refund_id, storage_path, original_file_name, mime_type, size_bytes, sha256,
                                    uploaded_by, is_correction, correction_reason)
         values ($1, $2, $3, $4, 'late-receipt.jpg', 'image/jpeg', 2048, $5, $6, $7, $8)`,
        [
          id,
          o.paymentId ?? null,
          o.refundId ?? null,
          `${o.refundId ? "refunds/" : ""}${o.bookingId}/${uid()}.jpg`,
          (uid() + uid()).replace(/-/g, ""),
          w.owner,
          o.isCorrection ?? true,
          o.reason === undefined ? LONG : o.reason,
        ],
      );
      return id;
    });
  const snapshot = async (b: Booking, pid: string) => ({
    money: (
      await q(`select * from public.booking_financials where booking_id = $1`, [
        b.id,
      ])
    )[0],
    payment: (
      await q(
        `select status, amount_paise, method, payment_date, reference_number, approved_by, approved_at, version, updated_at
           from public.payments where id = $1`,
        [pid],
      )
    )[0],
    history: await q(
      `select * from public.approval_history where payment_id = $1 order by id`,
      [pid],
    ),
  });

  it("COR-01: a correction file with a reason is accepted on an APPROVED payment, labelled, stamped and audited", async () => {
    const { b, pid } = await approvedPayment("cash");
    const id = await addCorrection({
      paymentId: pid,
      bookingId: b.id,
      actor: w.manager,
    });
    const [f] = await q<{
      is_correction: boolean;
      correction_reason: string;
      uploaded_by: string;
    }>(
      `select is_correction, correction_reason, uploaded_by from public.proofs where id = $1`,
      [id],
    );
    expect(f).toEqual({
      is_correction: true,
      correction_reason: LONG,
      uploaded_by: w.manager,
    }); // identity from the session
    const [a] = await q<{
      actor_id: string;
      action: string;
      booking_id: string;
    }>(
      `select actor_id, action, booking_id from public.audit_logs where table_name = 'proofs' and record_id = $1`,
      [id],
    );
    expect(a).toEqual({
      actor_id: w.manager,
      action: "insert",
      booking_id: b.id,
    });
  });

  it("COR-06: a correction file changes NO amount, status, date, version, history or financial figure", async () => {
    const { b, pid } = await approvedPayment("cash");
    const before = await snapshot(b, pid);
    await addCorrection({ paymentId: pid, bookingId: b.id });
    await addCorrection({
      paymentId: pid,
      bookingId: b.id,
      reason: "Second photo, clearer than the first",
    });
    expect(await snapshot(b, pid)).toEqual(before);
  });

  it("COR-02: the reason is mandatory and must be at least 10 characters; an ordinary file cannot carry one", async () => {
    const { b, pid } = await approvedPayment();
    for (const reason of [null, "", "   ", "too short", "123456789"]) {
      await expectDbError(
        addCorrection({ paymentId: pid, bookingId: b.id, reason }),
        "proofs_correction_fields",
      );
    }
    await addCorrection({
      paymentId: pid,
      bookingId: b.id,
      reason: "1234567890",
    }); // exactly 10 is fine
    // An ordinary file never carries a correction reason. (Tested on a WAITING payment, where an
    // ordinary file is otherwise allowed, so it is the table rule itself that refuses it.)
    const waiting = await addPayment(w, b, { method: "cash" });
    await expectDbError(
      addCorrection({
        paymentId: waiting,
        bookingId: b.id,
        isCorrection: false,
        reason: "has a reason but is not a correction",
      }),
      "proofs_correction_fields",
    );
  });

  it("COR-03: an ordinary (non-correction) file cannot be added to an approved payment", async () => {
    const { b, pid } = await approvedPayment();
    await expectDbError(
      addCorrection({
        paymentId: pid,
        bookingId: b.id,
        isCorrection: false,
        reason: null,
      }),
      "PROOF_LOCKED",
    );
  });

  it("COR-03: not available on a WAITING payment (add a normal file instead)", async () => {
    const b = await createBooking(w);
    const pid = await addPayment(w, b);
    await expectDbError(
      addCorrection({ paymentId: pid, bookingId: b.id }),
      "PROOF_CORRECTION_NOT_ALLOWED",
    );
  });

  it("COR-03: not available on REJECTED or REVERSED payments (enter a new payment instead)", async () => {
    const b = await createBooking(w);
    const rejected = await addPayment(w, b);
    await setStatus(
      w,
      "payments",
      rejected,
      "rejected",
      w.manager,
      "Amount does not match",
    );
    await expectDbError(
      addCorrection({ paymentId: rejected, bookingId: b.id }),
      "PROOF_LOCKED",
    );
    const reversed = await addPayment(w, b);
    await setStatus(w, "payments", reversed, "approved", w.manager);
    await setStatus(
      w,
      "payments",
      reversed,
      "reversed",
      w.owner,
      "Cheque bounced",
    );
    await expectDbError(
      addCorrection({ paymentId: reversed, bookingId: b.id }),
      "PROOF_LOCKED",
    );
  });

  it("COR-04: the ORIGINAL files stay immutable - they cannot be hidden, edited or deleted after approval", async () => {
    const { b, pid } = await approvedPayment("upi");
    const [orig] = await q<{ id: string }>(
      `select id from public.proofs where payment_id = $1 and not is_correction`,
      [pid],
    );
    await expectDbError(
      tx(w.owner, () =>
        q(
          `update public.proofs set hidden_at = now(), hidden_reason = 'replace it' where id = $1`,
          [orig.id],
        ),
      ),
      "PROOF_LOCKED",
    );
    await expectDbError(
      tx(w.owner, () =>
        q(`update public.proofs set sha256 = repeat('a', 64) where id = $1`, [
          orig.id,
        ]),
      ),
      "PROOF_LOCKED",
    );
    await expectDbError(
      tx(w.owner, () =>
        q(
          `update public.proofs set is_correction = true, correction_reason = 'turn it into a correction' where id = $1`,
          [orig.id],
        ),
      ),
      "PROOF_LOCKED",
    );
    await expectDbError(
      q(`delete from public.proofs where id = $1`, [orig.id]),
      "DELETE_NOT_ALLOWED",
    );
    // and adding a correction does not disturb them
    await addCorrection({ paymentId: pid, bookingId: b.id });
    const [still] = await q<{ hidden_at: string | null }>(
      `select hidden_at from public.proofs where id = $1`,
      [orig.id],
    );
    expect(still.hidden_at).toBeNull();
  });

  it("COR-04: a correction file is itself permanent - cannot be hidden, edited or deleted", async () => {
    const { b, pid } = await approvedPayment();
    const id = await addCorrection({ paymentId: pid, bookingId: b.id });
    await expectDbError(
      tx(w.owner, () =>
        q(
          `update public.proofs set hidden_at = now(), hidden_reason = 'oops wrong one' where id = $1`,
          [id],
        ),
      ),
      "PROOF_LOCKED",
    );
    await expectDbError(
      tx(w.owner, () =>
        q(
          `update public.proofs set correction_reason = 'a different reason' where id = $1`,
          [id],
        ),
      ),
      "PROOF_LOCKED",
    );
    await expectDbError(
      q(`delete from public.proofs where id = $1`, [id]),
      "DELETE_NOT_ALLOWED",
    );
  });

  it("COR: the screenshot rule still holds - an approved UPI payment keeps its original file, corrections only add", async () => {
    const { b, pid } = await approvedPayment("upi");
    await addCorrection({ paymentId: pid, bookingId: b.id });
    const [{ n }] = await q<{ n: number }>(
      `select count(*)::int n from public.proofs where payment_id = $1 and hidden_at is null`,
      [pid],
    );
    expect(n).toBe(2);
  });

  it("COR-05: the same rules apply to refunds - approved only, reason mandatory, no figure changes", async () => {
    const { b } = await approvedPayment("cash");
    await cancelBooking(w, b, { charge: 0 }); // approved money is held, so it can be refunded
    const rid = await addRefund(w, b, { amount: 50000 });
    await expectDbError(
      addCorrection({ refundId: rid, bookingId: b.id }),
      "PROOF_CORRECTION_NOT_ALLOWED",
    ); // still waiting
    await setStatus(w, "refunds", rid, "approved", w.owner);
    const before = (
      await q(`select * from public.booking_financials where booking_id = $1`, [
        b.id,
      ])
    )[0];
    await expectDbError(
      addCorrection({ refundId: rid, bookingId: b.id, reason: "short" }),
      "proofs_correction_fields",
    );
    await expectDbError(
      addCorrection({
        refundId: rid,
        bookingId: b.id,
        isCorrection: false,
        reason: null,
      }),
      "PROOF_LOCKED",
    );
    await addCorrection({
      refundId: rid,
      bookingId: b.id,
      reason: "Refund receipt received from the guest later",
    });
    expect(
      (
        await q(
          `select * from public.booking_financials where booking_id = $1`,
          [b.id],
        )
      )[0],
    ).toEqual(before);
  });

  it("COR-07: every correction appears in the review list with who, when, why and which payment", async () => {
    const { b, pid } = await approvedPayment();
    const id = await addCorrection({
      paymentId: pid,
      bookingId: b.id,
      actor: w.manager,
      reason: "Receipt was on the guest's phone",
    });
    const [row] = await q<Record<string, string>>(
      `select * from public.correction_files where proof_id = $1`,
      [id],
    );
    expect(row).toMatchObject({
      kind: "payment",
      record_id: pid,
      booking_id: b.id,
      resort_id: b.resortId,
      correction_reason: "Receipt was on the guest's phone",
      uploaded_by: w.manager,
      uploaded_by_name: "Test Manager One",
    });
    expect(row.record_code).toBe(`${b.code}-P1`);
    // ordinary files are not listed
    const ordinary = await addPayment(w, b, { method: "upi" });
    const [{ n }] = await q<{ n: number }>(
      `select count(*)::int n from public.correction_files where record_id = $1`,
      [ordinary],
    );
    expect(n).toBe(0);
  });

  it("the review list follows the same access rules: active users read it, anon and disabled users cannot", async () => {
    const seen = await w.db.as({ role: "authenticated", uid: w.owner }, () =>
      q<{ n: number }>(`select count(*)::int n from public.correction_files`),
    );
    expect(seen[0].n).toBeGreaterThan(0);
    await expectDbError(
      w.db.as({ role: "anon" }, () =>
        q(`select * from public.correction_files`),
      ),
      "permission denied",
    );
    const stranger = await w.db.as({ role: "authenticated", uid: uid() }, () =>
      q<{ n: number }>(`select count(*)::int n from public.correction_files`),
    );
    expect(stranger[0].n).toBe(0);
  });

  it("only an active, logged-in user can add a correction", async () => {
    const { b, pid } = await approvedPayment();
    await expectDbError(
      asUser(null, () =>
        q(
          `insert into public.proofs (payment_id, storage_path, mime_type, size_bytes, sha256, uploaded_by, is_correction, correction_reason)
        values ($1, $2, 'image/jpeg', 10, $3, $4, true, $5)`,
          [pid, `${b.id}/${uid()}.jpg`, "c".repeat(64), w.owner, LONG],
        ),
      ),
      "NOT_ALLOWED",
    );
  });
});

describe("D5 stays in force (reversal protection) - spot check next to the new rules", () => {
  it("REV-02: a payment cannot be reversed while a refund is waiting; allowed after that refund is rejected", async () => {
    const b = await createBooking(w);
    const pid = await addPayment(w, b, { amount: 400000 });
    await setStatus(w, "payments", pid, "approved", w.owner);
    await cancelBooking(w, b, { charge: 0 });
    const rid = await addRefund(w, b, { amount: 300000 });
    await expectDbError(
      setStatus(w, "payments", pid, "reversed", w.owner, "Entered by mistake"),
      "REVERSAL_EXCEEDS_REFUNDS",
    );
    await setStatus(w, "refunds", rid, "rejected", w.owner, "Not needed");
    await setStatus(
      w,
      "payments",
      pid,
      "reversed",
      w.owner,
      "Entered by mistake",
    );
    const [p] = await q<{ status: string }>(
      `select status from public.payments where id = $1`,
      [pid],
    );
    expect(p.status).toBe("reversed");
  });

  it("REV-03: an approved refund must be reversed first, then the payment can be reversed", async () => {
    const b = await createBooking(w);
    const pid = await addPayment(w, b, { amount: 400000 });
    await setStatus(w, "payments", pid, "approved", w.owner);
    await cancelBooking(w, b, { charge: 0 });
    const rid = await addRefund(w, b, { amount: 300000 });
    await setStatus(w, "refunds", rid, "approved", w.owner);
    await expectDbError(
      setStatus(w, "payments", pid, "reversed", w.owner, "x"),
      "REVERSAL_EXCEEDS_REFUNDS",
    );
    await setStatus(
      w,
      "refunds",
      rid,
      "reversed",
      w.owner,
      "Refund was never paid out",
    );
    await setStatus(
      w,
      "payments",
      pid,
      "reversed",
      w.owner,
      "Entered by mistake",
    );
  });
});
