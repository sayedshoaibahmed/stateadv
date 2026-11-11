/**
 * Payments, refunds, proof files, approvals, history and audit
 * (TEST_PLAN PAY-*, APR-*, REF-*, AUD-*). Fictional data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { expectDbError } from "./harness";
import {
  addPayment,
  addProof,
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
const as = <T>(uidv: string | null, fn: () => Promise<T>) =>
  w.db.as({ role: "postgres", uid: uidv }, fn);
const tx = <T>(uidv: string, fn: () => Promise<T>) =>
  w.db.tx({ role: "postgres", uid: uidv }, fn);

const row = async (table: "payments" | "refunds", id: string) =>
  (await q(`select * from public.${table} where id = $1`, [id]))[0] as Record<
    string,
    never
  >;
const history = (col: "payment_id" | "refund_id", id: string) =>
  q<{
    from_status: string | null;
    to_status: string;
    reason: string | null;
    is_self_action: boolean;
    acted_by: string;
  }>(
    `select from_status, to_status, reason, is_self_action, acted_by from public.approval_history where ${col} = $1 order by id`,
    [id],
  );

describe("recording a payment (PAY-*, Q9)", () => {
  it("PAY-01: starts as Waiting for Approval; code, resort and recorder come from the database", async () => {
    const b = await createBooking(w);
    const p1 = await addPayment(w, b, { actor: w.manager, amount: 150000 });
    const p2 = await addPayment(w, b, { actor: w.owner, amount: 350000 });
    const r1 = await row("payments", p1);
    expect(r1.status).toBe("waiting");
    expect(r1.payment_code).toBe(`${b.code}-P1`);
    expect(r1.resort_id).toBe(b.resortId);
    expect(r1.recorded_by).toBe(w.manager);
    expect(r1.version).toBe(1);
    expect((await row("payments", p2)).payment_code).toBe(`${b.code}-P2`);
    expect(await history("payment_id", p1)).toEqual([
      {
        from_status: null,
        to_status: "waiting",
        reason: null,
        is_self_action: true,
        acted_by: w.manager,
      },
    ]);
  });

  it("who recorded it cannot be faked", async () => {
    const b = await createBooking(w);
    const id = uid();
    await tx(w.manager, () =>
      q(
        `insert into public.payments (id, booking_id, amount_paise, method, payment_date, recorded_by, recorded_at, payment_code, resort_id, idempotency_key)
         values ($1, $2, 1000, 'cash', public.today_ist(), $3, now() - interval '3 days', 'FAKE-P9', $4, $5)`,
        [id, b.id, w.owner, w.resorts.B.id, uid()],
      ),
    );
    const r = await row("payments", id);
    expect(r.recorded_by).toBe(w.manager); //   not the owner
    expect(r.payment_code).toBe(`${b.code}-P1`); // not FAKE-P9
    expect(r.resort_id).toBe(b.resortId); //   not resort B
    const [{ age }] = await q<{ age: number }>(
      `select extract(epoch from (now() - recorded_at))::int as age from public.payments where id = $1`,
      [id],
    );
    expect(age).toBeLessThan(60); //            entry time is real, not backdated
  });

  it("only an active, logged-in user can record; direct app-user inserts are impossible", async () => {
    const b = await createBooking(w);
    const ins = () =>
      q(
        `insert into public.payments (booking_id, amount_paise, method, payment_date, idempotency_key) values ($1, 1000, 'cash', public.today_ist(), $2)`,
        [b.id, uid()],
      );
    await expectDbError(as(null, ins), "NOT_ALLOWED");
    await expectDbError(as(uid(), ins), "NOT_ALLOWED");
    await expectDbError(
      w.db.as({ role: "authenticated", uid: w.owner }, ins),
      "permission denied",
    );
  });

  it("PAY-03/06: a future payment date is refused; backdating is allowed and the entry time stays real", async () => {
    const b = await createBooking(w);
    await expectDbError(
      addPayment(w, b, { dateOffset: 1 }),
      "PAYMENT_DATE_IN_FUTURE",
    );
    const id = await addPayment(w, b, { dateOffset: -730 });
    const r = await row("payments", id);
    const [{ days }] = await q<{ days: number }>(
      `select (public.today_ist() - payment_date) as days from public.payments where id = $1`,
      [id],
    );
    expect(Number(days)).toBe(730);
    expect(new Date(r.recorded_at).getTime()).toBeGreaterThan(
      Date.now() - 60_000,
    );
  });

  it("PAY-02: amount must be positive; PAY-10: provider must belong to the method", async () => {
    const b = await createBooking(w);
    await expectDbError(addPayment(w, b, { amount: 0 }), "payments_amount");
    const [{ id: phonepe }] = await q<{ id: number }>(
      `select id from public.payment_providers where name = 'PhonePe'`,
    );
    await expectDbError(
      addPayment(w, b, { method: "cash", providerId: phonepe }),
      "payments_provider_fk",
    );
    await addPayment(w, b, { method: "upi", providerId: phonepe });
  });

  it("the idempotency key makes a double submit harmless", async () => {
    const b = await createBooking(w);
    const key = uid();
    const ins = () =>
      tx(w.owner, () =>
        q(
          `insert into public.payments (booking_id, amount_paise, method, payment_date, idempotency_key) values ($1, 1000, 'cash', public.today_ist(), $2)`,
          [b.id, key],
        ),
      );
    await ins();
    await expectDbError(ins(), "payments_idem_key");
  });
});

describe("proof rule: UPI / Card / Cheque need a screenshot, Cash / Other do not (Q9, D3)", () => {
  const bare = (b: Booking, method: string, uidv = w.owner) =>
    tx(uidv, () =>
      q(
        `insert into public.payments (booking_id, amount_paise, method, payment_date, idempotency_key) values ($1, 1000, $2::public.payment_method, public.today_ist(), $3)`,
        [b.id, method, uid()],
      ),
    );

  it("PAY-01/02/03: UPI, card and cheque without a file are refused at commit; cash and other are fine", async () => {
    const b = await createBooking(w);
    for (const m of ["upi", "card", "cheque"])
      await expectDbError(bare(b, m), "PROOF_REQUIRED");
    for (const m of ["cash", "other"]) await bare(b, m);
  });

  it("with a file it is accepted", async () => {
    const b = await createBooking(w);
    await addPayment(w, b, { method: "upi", withProof: true });
  });

  it("PAY-04: the only file of a UPI payment cannot be hidden; one of two can", async () => {
    const b = await createBooking(w);
    const id = await addPayment(w, b, { method: "upi", withProof: true });
    const [{ pid }] = await q<{ pid: string }>(
      `select id as pid from public.proofs where payment_id = $1`,
      [id],
    );
    await expectDbError(
      tx(w.owner, () =>
        q(
          `update public.proofs set hidden_at = now(), hidden_reason = 'duplicate' where id = $1`,
          [pid],
        ),
      ),
      "PROOF_REQUIRED",
    );
    await tx(w.owner, () => addProof(w, { paymentId: id, bookingId: b.id }));
    await tx(w.owner, () =>
      q(
        `update public.proofs set hidden_at = now(), hidden_reason = 'duplicate' where id = $1`,
        [pid],
      ),
    );
    const [h] = await q<{ hidden_by: string }>(
      `select hidden_by from public.proofs where id = $1`,
      [pid],
    );
    expect(h.hidden_by).toBe(w.owner); // stamped by the database
  });

  it("files are never edited or removed; a file can be hidden only once; none can be added after a decision", async () => {
    const b = await createBooking(w);
    const id = await addPayment(w, b, { method: "cash" });
    const pr = await tx(w.owner, () =>
      addProof(w, { paymentId: id, bookingId: b.id }),
    );
    await expectDbError(
      tx(w.owner, () =>
        q(`update public.proofs set sha256 = repeat('a', 64) where id = $1`, [
          pr,
        ]),
      ),
      "PROOF_LOCKED",
    );
    await expectDbError(
      q(`delete from public.proofs where id = $1`, [pr]),
      "DELETE_NOT_ALLOWED",
    );
    await tx(w.owner, () =>
      q(
        `update public.proofs set hidden_at = now(), hidden_reason = 'wrong picture' where id = $1`,
        [pr],
      ),
    );
    await expectDbError(
      tx(w.owner, () =>
        q(
          `update public.proofs set hidden_at = now(), hidden_reason = 'again' where id = $1`,
          [pr],
        ),
      ),
      "PROOF_LOCKED",
    );
    await setStatus(w, "payments", id, "approved", w.manager);
    await expectDbError(
      tx(w.owner, () => addProof(w, { paymentId: id, bookingId: b.id })),
      "PROOF_LOCKED",
    );
  });

  it("file records are validated: path, type, size, fingerprint", async () => {
    const b = await createBooking(w);
    const id = await addPayment(w, b);
    const ins = (path: string, mime: string, size: number, sha: string) =>
      tx(w.owner, () =>
        q(
          `insert into public.proofs (payment_id, storage_path, mime_type, size_bytes, sha256, uploaded_by) values ($1, $2, $3, $4, $5, $6)`,
          [id, path, mime, size, sha, w.owner],
        ),
      );
    const ok = `${b.id}/${uid()}.jpg`;
    const sha = "b".repeat(64);
    await expectDbError(
      ins("../../etc/passwd", "image/jpeg", 10, sha),
      "proofs_path_fmt",
    );
    await expectDbError(
      ins(`${b.id}/${uid()}.exe`, "image/jpeg", 10, sha),
      "proofs_path_fmt",
    );
    await expectDbError(ins(ok, "text/html", 10, sha), "proofs_mime");
    await expectDbError(ins(ok, "image/jpeg", 10485761, sha), "proofs_size");
    await expectDbError(ins(ok, "image/jpeg", 10, "xyz"), "proofs_sha256_fmt");
    await ins(ok, "image/jpeg", 10, sha);
  });
});

describe("approving, rejecting, reversing (APR-*, Q8)", () => {
  it("APR-01: approve - the approver and time come from the session; history is written by the database", async () => {
    const b = await createBooking(w);
    const id = await addPayment(w, b, { actor: w.manager });
    await tx(w.owner, () =>
      q(
        `update public.payments set status = 'approved', approved_by = $2 where id = $1`,
        [id, w.manager2],
      ),
    ); // lying
    const r = await row("payments", id);
    expect(r.status).toBe("approved");
    expect(r.approved_by).toBe(w.owner); // overwritten with the real actor
    expect(r.is_self_approved).toBe(false);
    expect(r.version).toBe(2);
    expect(await history("payment_id", id)).toEqual([
      {
        from_status: null,
        to_status: "waiting",
        reason: null,
        is_self_action: true,
        acted_by: w.manager,
      },
      {
        from_status: "waiting",
        to_status: "approved",
        reason: null,
        is_self_action: false,
        acted_by: w.owner,
      },
    ]);
  });

  it("APR-06: self-approval is allowed and is clearly flagged (Q8)", async () => {
    const b = await createBooking(w);
    const id = await addPayment(w, b, { actor: w.owner });
    await setStatus(w, "payments", id, "approved", w.owner);
    expect((await row("payments", id)).is_self_approved).toBe(true);
    const h = await history("payment_id", id);
    expect(h[1].is_self_action).toBe(true);
  });

  it("APR-02/03: rejecting needs a reason; a rejected payment is final and keeps its reason", async () => {
    const b = await createBooking(w);
    const id = await addPayment(w, b);
    await expectDbError(
      tx(w.manager, () =>
        q(`update public.payments set status = 'rejected' where id = $1`, [id]),
      ),
      "payments_rejected_fields",
    );
    await setStatus(
      w,
      "payments",
      id,
      "rejected",
      w.manager,
      "Amount does not match the screenshot",
    );
    const r = await row("payments", id);
    expect(r.rejected_by).toBe(w.manager);
    expect(r.rejection_reason).toBe("Amount does not match the screenshot");
    expect((await history("payment_id", id))[1]).toMatchObject({
      to_status: "rejected",
      reason: "Amount does not match the screenshot",
    });
    await expectDbError(
      setStatus(w, "payments", id, "approved", w.owner),
      "PAYMENT_LOCKED",
    );
    await expectDbError(
      tx(w.owner, () =>
        q(`update public.payments set remarks = 'x' where id = $1`, [id]),
      ),
      "PAYMENT_LOCKED",
    );
  });

  it("APR-04: only waiting->approved, waiting->rejected, approved->reversed are possible", async () => {
    const b = await createBooking(w);
    const waiting = await addPayment(w, b);
    await expectDbError(
      setStatus(w, "payments", waiting, "reversed", w.owner, "x"),
      "INVALID_STATUS_CHANGE",
    );
    const approved = await addPayment(w, b);
    await setStatus(w, "payments", approved, "approved", w.owner);
    await expectDbError(
      tx(w.owner, () =>
        q(`update public.payments set status = 'waiting' where id = $1`, [
          approved,
        ]),
      ),
      "PAYMENT_LOCKED",
    );
    await expectDbError(
      setStatus(w, "payments", approved, "rejected", w.owner, "x"),
      "PAYMENT_LOCKED",
    );
  });

  it("APR-07: an approved payment cannot be edited; a decision cannot also change the amount", async () => {
    const b = await createBooking(w);
    const id = await addPayment(w, b, { amount: 100000 });
    await expectDbError(
      tx(w.owner, () =>
        q(
          `update public.payments set status = 'approved', amount_paise = 999999 where id = $1`,
          [id],
        ),
      ),
      "PAYMENT_CHANGED_DURING_DECISION",
    );
    await setStatus(w, "payments", id, "approved", w.owner);
    for (const sql of [
      `update public.payments set amount_paise = 1 where id = $1`,
      `update public.payments set method = 'cash' where id = $1`,
      `update public.payments set payment_date = payment_date - 1 where id = $1`,
      `update public.payments set reference_number = 'x' where id = $1`,
    ]) {
      await expectDbError(
        tx(w.owner, () => q(sql, [id])),
        "PAYMENT_LOCKED",
      );
    }
    // identity columns can never be rewritten (checked before anything else)
    const other = await createBooking(w);
    for (const [col, val] of [
      ["recorded_by", w.manager],
      ["payment_code", "X-P1"],
      ["booking_id", other.id],
    ]) {
      await expectDbError(
        tx(w.owner, () =>
          q(`update public.payments set ${col} = $2 where id = $1`, [id, val]),
        ),
        "IMMUTABLE_FIELD",
      );
    }
  });

  it("reversing an approved payment needs a reason and is final", async () => {
    const b = await createBooking(w);
    const id = await addPayment(w, b);
    await setStatus(w, "payments", id, "approved", w.manager);
    await expectDbError(
      tx(w.owner, () =>
        q(`update public.payments set status = 'reversed' where id = $1`, [id]),
      ),
      "payments_reversed_fields",
    );
    await setStatus(w, "payments", id, "reversed", w.owner, "Cheque bounced");
    const r = await row("payments", id);
    expect(r.status).toBe("reversed");
    expect(r.reversed_by).toBe(w.owner);
    expect(r.approved_by).toBe(w.manager); // the approval is kept - nothing is overwritten
    expect((await history("payment_id", id)).map((h) => h.to_status)).toEqual([
      "waiting",
      "approved",
      "reversed",
    ]);
    await expectDbError(
      setStatus(w, "payments", id, "approved", w.owner),
      "PAYMENT_LOCKED",
    );
  });

  it("a waiting payment can still be edited (with the version bumped and the change audited)", async () => {
    const b = await createBooking(w);
    const id = await addPayment(w, b, { amount: 100000 });
    await tx(w.manager, () =>
      q(
        `update public.payments set amount_paise = 120000, remarks = 'typo fixed' where id = $1`,
        [id],
      ),
    );
    const r = await row("payments", id);
    expect(Number(r.amount_paise)).toBe(120000);
    expect(r.version).toBe(2);
    expect(r.updated_by).toBe(w.manager);
    const [a] = await q<{
      actor_id: string;
      changed_fields: string[];
      old_data: Record<string, never>;
      new_data: Record<string, never>;
    }>(
      `select actor_id, changed_fields, old_data, new_data from public.audit_logs where table_name = 'payments' and record_id = $1 and action = 'update'`,
      [id],
    );
    expect(a.actor_id).toBe(w.manager);
    expect(a.changed_fields).toEqual(["amount_paise", "remarks"]);
    expect(Number(a.old_data.amount_paise)).toBe(100000);
    expect(Number(a.new_data.amount_paise)).toBe(120000);
  });

  it("APR-08: approval history and payments can never be deleted or rewritten", async () => {
    const b = await createBooking(w);
    const id = await addPayment(w, b);
    await expectDbError(
      q(
        `update public.approval_history set reason = 'x' where payment_id = $1`,
        [id],
      ),
      "RECORD_IS_APPEND_ONLY",
    );
    await expectDbError(
      q(`delete from public.approval_history where payment_id = $1`, [id]),
      "DELETE_NOT_ALLOWED",
    );
    await expectDbError(
      q(`delete from public.payments where id = $1`, [id]),
      "DELETE_NOT_ALLOWED",
    );
  });

  it("a disabled user can no longer decide anything", async () => {
    const b = await createBooking(w);
    const id = await addPayment(w, b);
    const gone = uid();
    await q(
      `insert into auth.users (id, email) values ($1, 'gone@test.example')`,
      [gone],
    );
    await as(w.owner, () =>
      q(
        `insert into public.user_profiles (id, full_name, email) values ($1, 'Test Gone', 'gone@test.example')`,
        [gone],
      ),
    );
    await as(w.owner, () =>
      q(`update public.user_profiles set is_active = false where id = $1`, [
        gone,
      ]),
    );
    await expectDbError(
      setStatus(w, "payments", id, "approved", gone),
      "NOT_ALLOWED",
    );
  });
});

describe("refunds (REF-*, Q7, Q7b, Q12, D1)", () => {
  async function bookingWithApproved(amount = 500000) {
    const b = await createBooking(w);
    const p = await addPayment(w, b, { amount });
    await setStatus(w, "payments", p, "approved", w.owner);
    // Cancelled with a zero charge, so the approved money is "held" and refundable up to A - RA - RW.
    // (A RUNNING booking can only refund genuine overpayment: see tests/db/refund-limits.test.ts.)
    await cancelBooking(w, b, { charge: 0 });
    return b;
  }

  it("REF-01: a refund starts waiting, gets code -R1, and its own history", async () => {
    const b = await bookingWithApproved();
    const id = await addRefund(w, b, { actor: w.manager, amount: 100000 });
    const r = await row("refunds", id);
    expect(r.status).toBe("waiting");
    expect(r.refund_code).toBe(`${b.code}-R1`);
    expect(r.recorded_by).toBe(w.manager);
    expect((await history("refund_id", id)).map((h) => h.to_status)).toEqual([
      "waiting",
    ]);
  });

  it("REF-03/04: a refund can never exceed the approved money still held; waiting refunds count against the limit", async () => {
    const b = await bookingWithApproved(500000);
    await addRefund(w, b, { amount: 300000 });
    await expectDbError(
      addRefund(w, b, { amount: 300000 }),
      "REFUND_TOO_LARGE",
    ); // only 200000 left
    const second = await addRefund(w, b, { amount: 200000 });
    await expectDbError(addRefund(w, b, { amount: 1 }), "REFUND_TOO_LARGE"); //       nothing left
    await setStatus(w, "refunds", second, "rejected", w.owner, "Wrong amount");
    await addRefund(w, b, { amount: 200000 }); // the rejected one no longer blocks it
  });

  it("a booking with no approved money cannot be refunded; waiting payments do not count", async () => {
    const b = await createBooking(w);
    await addPayment(w, b, { amount: 100000 }); // waiting
    await expectDbError(addRefund(w, b, { amount: 1000 }), "REFUND_TOO_LARGE");
  });

  it("REF-06: UPI / card / cheque refunds need a screenshot; cash does not (D3)", async () => {
    const b = await bookingWithApproved();
    await expectDbError(
      tx(w.owner, () =>
        q(
          `insert into public.refunds (booking_id, amount_paise, method, refund_date, reason, idempotency_key) values ($1, 1000, 'upi', public.today_ist(), 'x', $2)`,
          [b.id, uid()],
        ),
      ),
      "PROOF_REQUIRED",
    );
    await addRefund(w, b, { method: "upi", amount: 1000 });
    await addRefund(w, b, { method: "cash", amount: 1000 });
  });

  it("a refund date in the future is refused", async () => {
    const b = await bookingWithApproved();
    await expectDbError(
      tx(w.owner, () =>
        q(
          `insert into public.refunds (booking_id, amount_paise, method, refund_date, reason, idempotency_key) values ($1, 1000, 'cash', public.today_ist() + 1, 'x', $2)`,
          [b.id, uid()],
        ),
      ),
      "REFUND_DATE_IN_FUTURE",
    );
  });

  it("REF-07: refunds have their own approval flow, self-approval flag and permanence", async () => {
    const b = await bookingWithApproved();
    const id = await addRefund(w, b, { actor: w.owner, amount: 100000 });
    await setStatus(w, "refunds", id, "approved", w.owner);
    const r = await row("refunds", id);
    expect(r.is_self_approved).toBe(true);
    expect(
      (await history("refund_id", id)).map((h) => [
        h.to_status,
        h.is_self_action,
      ]),
    ).toEqual([
      ["waiting", true],
      ["approved", true],
    ]);
    await expectDbError(
      tx(w.owner, () =>
        q(`update public.refunds set amount_paise = 1 where id = $1`, [id]),
      ),
      "REFUND_LOCKED",
    );
    await expectDbError(
      q(`delete from public.refunds where id = $1`, [id]),
      "DELETE_NOT_ALLOWED",
    );
    await setStatus(
      w,
      "refunds",
      id,
      "reversed",
      w.manager,
      "Refund was not actually paid",
    );
    expect((await row("refunds", id)).status).toBe("reversed");
  });

  it("a waiting refund amount can be corrected, but not above the limit", async () => {
    const b = await bookingWithApproved(500000);
    const id = await addRefund(w, b, { amount: 100000 });
    await tx(w.owner, () =>
      q(`update public.refunds set amount_paise = 500000 where id = $1`, [id]),
    ); // exactly what is held
    await expectDbError(
      tx(w.owner, () =>
        q(`update public.refunds set amount_paise = 500001 where id = $1`, [
          id,
        ]),
      ),
      "REFUND_TOO_LARGE",
    );
  });

  it("REVERSAL: a payment cannot be reversed if refunds would then exceed the money held", async () => {
    const b = await createBooking(w);
    const p1 = await addPayment(w, b, { amount: 300000 });
    const p2 = await addPayment(w, b, { amount: 200000 });
    await setStatus(w, "payments", p1, "approved", w.owner);
    await setStatus(w, "payments", p2, "approved", w.owner);
    await cancelBooking(w, b, { charge: 0 }); // approved money is held, so it can be refunded
    const rf = await addRefund(w, b, { amount: 400000 });
    await setStatus(w, "refunds", rf, "approved", w.owner);
    await expectDbError(
      setStatus(w, "payments", p2, "reversed", w.owner, "x"),
      "REVERSAL_EXCEEDS_REFUNDS",
    ); // 500000-200000 < 400000
    await expectDbError(
      setStatus(w, "payments", p1, "reversed", w.owner, "x"),
      "REVERSAL_EXCEEDS_REFUNDS",
    );
  });
});

describe("audit trail (AUD-01, AUD-02)", () => {
  it("AUD-01: every change is logged with the real actor, the record, the booking and old/new values", async () => {
    const b = await createBooking(w);
    const id = await addPayment(w, b, { actor: w.manager });
    await setStatus(w, "payments", id, "approved", w.owner);
    const rows = await q<{
      action: string;
      actor_id: string;
      actor_name: string;
      booking_id: string;
      resort_id: string;
      changed_fields: string[] | null;
    }>(
      `select action, actor_id, actor_name, booking_id, resort_id, changed_fields from public.audit_logs
       where table_name = 'payments' and record_id = $1 order by id`,
      [id],
    );
    expect(rows.map((r) => r.action)).toEqual(["insert", "update"]);
    expect(rows[0]).toMatchObject({
      actor_id: w.manager,
      actor_name: "Test Manager One",
      booking_id: b.id,
      resort_id: b.resortId,
    });
    expect(rows[1]).toMatchObject({
      actor_id: w.owner,
      actor_name: "Test Owner",
    });
    expect(rows[1].changed_fields).toEqual(
      expect.arrayContaining(["status", "approved_by", "approved_at"]),
    );
  });

  it("AUD-02: the audit log cannot be edited or deleted by anyone", async () => {
    await expectDbError(
      q(`update public.audit_logs set actor_id = null`),
      "RECORD_IS_APPEND_ONLY",
    );
    await expectDbError(
      q(`delete from public.audit_logs`),
      "DELETE_NOT_ALLOWED",
    );
    await expectDbError(
      w.db.as({ role: "authenticated", uid: w.owner }, () =>
        q(`delete from public.audit_logs`),
      ),
      "permission denied",
    );
  });
});

describe("who can see money records (RLS)", () => {
  it("active users see payments, refunds and files; a disabled user sees none; anon cannot read", async () => {
    const b = await createBooking(w);
    const id = await addPayment(w, b, { method: "upi", withProof: true });
    const count = (role: "authenticated", uidv: string) =>
      w.db.as({ role, uid: uidv }, () =>
        q<{ p: number; f: number; h: number }>(
          `select (select count(*) from public.payments where id = $1)::int p, (select count(*) from public.proofs where payment_id = $1)::int f, (select count(*) from public.approval_history where payment_id = $1)::int h`,
          [id],
        ),
      );
    expect((await count("authenticated", w.manager))[0]).toEqual({
      p: 1,
      f: 1,
      h: 1,
    });
    const disabled = uid();
    await q(
      `insert into auth.users (id, email) values ($1, 'off@test.example')`,
      [disabled],
    );
    await as(w.owner, () =>
      q(
        `insert into public.user_profiles (id, full_name, email) values ($1, 'Test Off', 'off@test.example')`,
        [disabled],
      ),
    );
    await as(w.owner, () =>
      q(`update public.user_profiles set is_active = false where id = $1`, [
        disabled,
      ]),
    );
    expect((await count("authenticated", disabled))[0]).toEqual({
      p: 0,
      f: 0,
      h: 0,
    });
    await expectDbError(
      w.db.as({ role: "anon" }, () => q(`select * from public.payments`)),
      "permission denied",
    );
  });
});
