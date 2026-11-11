/**
 * Payment, refund, approval, proof and correction-file functions (migration 15).
 * PGlite stand-in only: single connection, so real simultaneous requests are NOT proven here
 * (they run on PostgreSQL 17 in CI). Everything is fictional.
 */
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { expectDbError } from "./harness";
import { dateOffset, setupWorld, uid, type World } from "./fixtures";

let w: World;
beforeAll(async () => {
  w = await setupWorld();
}, 120_000);

const q = <T = Record<string, unknown>>(sql: string, p?: unknown[]) =>
  w.db.q<T>(sql, p);
const call = <T = Record<string, unknown>>(
  sql: string,
  p?: unknown[],
  actor: string | null = w.manager,
) => w.db.as({ role: "authenticated", uid: actor }, () => q<T>(sql, p));
// Test helper: rows and JSON results are inspected loosely on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const j = (x: unknown) => JSON.stringify(x);

/** A booking with one plan row; final amount 500000 paise (Rs 5,000). */
async function newBooking(final = 500000, over: Json = {}) {
  const d = await dateOffset(w.db, 0);
  const in1 = await dateOffset(w.db, 2);
  const out1 = await dateOffset(w.db, 3);
  const p = {
    resort_id: w.resorts.A.id,
    guest_id: w.guestId,
    pax: 2,
    co_category_id: w.cat.direct,
    stay_type_id: w.stayTypeId,
    booking_date: d,
    check_in_at: `${in1}T14:00:00+05:30`,
    check_out_at: `${out1}T11:00:00+05:30`,
    pricing_method: "per_person_per_stay",
    tariff_paise: final / 2,
    ...over,
  };
  const r = await call<{ r: Json }>(
    `select public.create_booking($1::jsonb, $2::jsonb, $3::uuid) as r`,
    [
      j(p),
      j([{ label: "Balance", due_date: in1, amount_paise: final }]),
      uid(),
    ],
  );
  return r[0].r.id as string;
}

/** A stored file (as the browser would have uploaded it) and its description. */
async function file(
  booking: string,
  kind: "payment" | "refund" = "payment",
  o: {
    mime?: string;
    size?: number;
    sha?: string;
    metaSize?: number;
    metaMime?: string;
  } = {},
) {
  const mime = o.mime ?? "image/png";
  const ext =
    mime === "application/pdf"
      ? "pdf"
      : mime === "image/jpeg"
        ? "jpg"
        : mime === "image/webp"
          ? "webp"
          : "png";
  const size = o.size ?? 1234;
  const path = `${kind === "refund" ? "refunds/" : ""}${booking}/${uid()}.${ext}`;
  await q(
    `insert into storage.objects (bucket_id, name, metadata) values ('payment-proofs', $1, $2::jsonb)`,
    [path, j({ size: o.metaSize ?? size, mimetype: o.metaMime ?? mime })],
  );
  return {
    storage_path: path,
    original_file_name: "receipt.png",
    mime_type: mime,
    size_bytes: size,
    sha256: o.sha ?? randomBytes(32).toString("hex"),
  };
}

async function addPayment(
  b: string,
  over: Json = {},
  files: Json[] | null = null,
  actor: string | null = w.manager,
  idem = uid(),
) {
  const d = await dateOffset(w.db, 0);
  const payload = {
    booking_id: b,
    amount_paise: 100000,
    method: "cash",
    payment_date: d,
    ...over,
  };
  const out = await call<{ r: Json }>(
    `select public.add_payment($1::jsonb, $2::jsonb, $3::uuid) as r`,
    [j(payload), files ? j(files) : null, idem],
    actor,
  );
  return out[0].r;
}
async function addRefund(
  b: string,
  over: Json = {},
  files: Json[] | null = null,
  actor: string | null = w.manager,
  idem = uid(),
) {
  const d = await dateOffset(w.db, 0);
  const payload = {
    booking_id: b,
    amount_paise: 10000,
    method: "cash",
    refund_date: d,
    reason: "Guest overpaid",
    ...over,
  };
  const out = await call<{ r: Json }>(
    `select public.add_refund($1::jsonb, $2::jsonb, $3::uuid) as r`,
    [j(payload), files ? j(files) : null, idem],
    actor,
  );
  return out[0].r;
}
const payment = async (id: string) =>
  (await q<Json>(`select * from public.payments where id = $1`, [id]))[0];
const refund = async (id: string) =>
  (await q<Json>(`select * from public.refunds where id = $1`, [id]))[0];
const fin = async (b: string) =>
  (
    await q<Json>(
      `select * from public.booking_financials where booking_id = $1`,
      [b],
    )
  )[0];
const approvePay = (id: string, v = 1, actor: string | null = w.owner) =>
  call(`select public.approve_payment($1, $2)`, [id, v], actor);
const approveRef = (id: string, v = 1, actor: string | null = w.owner) =>
  call(`select public.approve_refund($1, $2)`, [id, v], actor);
/** cancel with a charge; the charge is planned as one future row */
async function cancel(b: string, charge: number) {
  const plan =
    charge > 0
      ? [
          {
            label: "Cancellation charge",
            due_date: await dateOffset(w.db, 1),
            amount_paise: charge,
          },
        ]
      : [];
  await call(
    `select public.cancel_booking($1, 1, 'cancelled', null, $2, 'Guest cancelled', null, $3::jsonb)`,
    [b, charge, j(plan)],
  );
}
/** a booking holding `held` paise of approved money */
async function funded(final = 500000, held = 500000) {
  const b = await newBooking(final);
  const p = await addPayment(b, { amount_paise: held });
  await approvePay(p.id);
  return { b, p: p.id as string };
}

describe("add_payment", () => {
  it("PAF-01: a cash payment is saved as 'waiting' with the logged-in user as the recorder, a number, history and a PDF job", async () => {
    const b = await newBooking();
    const r = await addPayment(b);
    expect(r.duplicate).toBe(false);
    expect(r.payment_code).toMatch(/-P1$/);
    const p = await payment(r.id);
    expect(p).toMatchObject({
      status: "waiting",
      recorded_by: w.manager,
      method: "cash",
      amount_paise: 100000,
    });
    expect(
      (
        await q(
          `select 1 from public.approval_history where payment_id = $1 and to_status = 'waiting'`,
          [r.id],
        )
      ).length,
    ).toBe(1);
    expect(
      (
        await q(
          `select 1 from public.pdf_jobs where booking_id = $1 and reason = 'payment added'`,
          [b],
        )
      ).length,
    ).toBe(1);
    expect((await addPayment(b)).payment_code).toMatch(/-P2$/);
  });

  it("PAF-02: values sent for the recorder, status or approval are ignored", async () => {
    const b = await newBooking();
    const r = await addPayment(b, {
      recorded_by: w.owner,
      status: "approved",
      approved_by: w.owner,
      payment_code: "X-P9",
      resort_id: w.resorts.B.id,
    });
    const p = await payment(r.id);
    expect([p.recorded_by, p.status, p.approved_by, p.resort_id]).toEqual([
      w.manager,
      "waiting",
      null,
      w.resorts.A.id,
    ]);
  });

  it("PAF-03: UPI, card and cheque need a stored proof; cash may have none (D3, FR-PAY-2)", async () => {
    const b = await newBooking();
    const upi = { method: "upi", provider_id: 1 };
    await expectDbError(addPayment(b, upi), "PROOF_REQUIRED");
    await expectDbError(
      addPayment(b, { method: "cheque" }, []),
      "PROOF_REQUIRED",
    );
    await addPayment(b, upi, [await file(b)]);
    await addPayment(b, { method: "cheque" }, [
      await file(b, "payment", { mime: "application/pdf" }),
    ]);
    await addPayment(b, { method: "other" });
  });

  it("PAF-04: payment app rules: required for UPI/card, must match the method, 'Other' needs a name", async () => {
    const b = await newBooking();
    const f = async () => [await file(b)];
    await expectDbError(
      addPayment(b, { method: "upi" }, await f()),
      "INVALID_INPUT",
    );
    await expectDbError(
      addPayment(b, { method: "upi", provider_id: 6 }, await f()),
      "INVALID_INPUT",
    ); // 6 is a card network
    await expectDbError(
      addPayment(b, { method: "cash", provider_id: 1 }),
      "INVALID_INPUT",
    );
    await expectDbError(
      addPayment(b, { method: "upi", provider_id: 5 }, await f()),
      "INVALID_INPUT",
    ); // 'Other' with no name
    await addPayment(
      b,
      { method: "upi", provider_id: 5, provider_other: "Test Wallet" },
      await f(),
    );
  });

  it("PAF-05: pressing Save twice records the payment once (FR-PAY-10)", async () => {
    const b = await newBooking();
    const idem = uid();
    const a = await addPayment(b, {}, null, w.manager, idem);
    const c = await addPayment(b, { amount_paise: 999 }, null, w.manager, idem);
    expect(c.duplicate).toBe(true);
    expect(c.id).toBe(a.id);
    expect(
      (await q(`select 1 from public.payments where booking_id = $1`, [b]))
        .length,
    ).toBe(1);
  });

  it("PAF-06: warnings do not block saving: same reference, same file, above the amount due (FR-PAY-6)", async () => {
    const b = await newBooking(100000);
    const sha = randomBytes(32).toString("hex");
    const first = await addPayment(
      b,
      {
        method: "upi",
        provider_id: 1,
        reference_number: "TESTREF1",
        amount_paise: 60000,
      },
      [await file(b, "payment", { sha })],
    );
    expect(first.warnings).toEqual([]);
    const second = await addPayment(
      b,
      {
        method: "upi",
        provider_id: 1,
        reference_number: "TESTREF1",
        amount_paise: 60000,
      },
      [await file(b, "payment", { sha })],
    );
    expect(second.warnings.map((x: Json) => x.code).sort()).toEqual([
      "ABOVE_AMOUNT_DUE",
      "DUPLICATE_FILE",
      "DUPLICATE_REFERENCE",
    ]);
    expect(
      (await q(`select 1 from public.payments where booking_id = $1`, [b]))
        .length,
    ).toBe(2);
  });

  it("PAF-07: invalid input is refused and nothing is saved", async () => {
    const b = await newBooking();
    const bad: Array<[string, Json]> = [
      ["INVALID_INPUT", { amount_paise: 0 }],
      ["INVALID_INPUT", { amount_paise: -5 }],
      ["INVALID_INPUT", { amount_paise: "lots" }],
      ["INVALID_INPUT", { method: "bitcoin" }],
      ["INVALID_INPUT", { payment_date: null }],
      ["INVALID_INPUT", { payment_date: "yesterday" }],
      ["PAYMENT_DATE_IN_FUTURE", { payment_date: await dateOffset(w.db, 1) }],
      ["NOT_FOUND", { booking_id: uid() }],
      ["INVALID_INPUT", { payment_time: "25:99" }],
    ];
    for (const [code, over] of bad)
      await expectDbError(addPayment(b, over), code);
    expect(
      (await q(`select 1 from public.payments where booking_id = $1`, [b]))
        .length,
    ).toBe(0);
    // a back-dated payment is fine (FR-PAY-4)
    await addPayment(b, { payment_date: await dateOffset(w.db, -30) });
  });

  it("PAF-08: proof files must be real stored files of THIS booking, as described, up to 5 (FR-PAY-3)", async () => {
    const b = await newBooking();
    const other = await newBooking();
    const up = { method: "upi", provider_id: 1 };
    const ghost = { ...(await file(b)), storage_path: `${b}/${uid()}.png` }; // never uploaded
    await expectDbError(addPayment(b, up, [ghost]), "INVALID_FILE");
    await expectDbError(addPayment(b, up, [await file(other)]), "INVALID_FILE"); // another booking's file
    await expectDbError(
      addPayment(b, up, [await file(b, "refund")]),
      "INVALID_FILE",
    ); // refund folder
    await expectDbError(
      addPayment(b, up, [
        await file(b, "payment", { size: 2000, metaSize: 999 }),
      ]),
      "INVALID_FILE",
    );
    await expectDbError(
      addPayment(b, up, [await file(b, "payment", { metaMime: "text/html" })]),
      "INVALID_FILE",
    );
    await expectDbError(
      addPayment(b, up, [{ ...(await file(b)), sha256: "abc" }]),
      "INVALID_FILE",
    );
    await expectDbError(
      addPayment(b, up, [await file(b, "payment", { size: 20_000_000 })]),
      "INVALID_FILE",
    );
    await expectDbError(
      addPayment(b, up, [await file(b, "payment", { mime: "image/gif" })]),
      "INVALID_FILE",
    );
    const six = [];
    for (let i = 0; i < 6; i++) six.push(await file(b));
    await expectDbError(addPayment(b, up, six), "TOO_MANY_FILES");
    expect(
      (await q(`select 1 from public.payments where booking_id = $1`, [b]))
        .length,
    ).toBe(0);
    const five = [];
    for (let i = 0; i < 5; i++) five.push(await file(b));
    await addPayment(b, up, five);
  });

  it("PAF-09: on a cancelled booking a payment is allowed only while a charge is unpaid (FR-PAY-11)", async () => {
    const b = await newBooking();
    await call(
      `select public.cancel_booking($1, 1, 'cancelled', null, 100000, 'Guest cancelled', null, $2::jsonb)`,
      [
        b,
        j([
          {
            label: "Cancellation charge",
            due_date: await dateOffset(w.db, 1),
            amount_paise: 100000,
          },
        ]),
      ],
    );
    const r = await addPayment(b, { amount_paise: 100000 });
    expect(r.warnings).toEqual([]);
    await expectDbError(
      addPayment(b, { amount_paise: 1000 }),
      "PAYMENT_ON_CANCELLED",
    ); // charge already covered by a waiting payment
    const free = await newBooking();
    await cancel(free, 0); // nothing to collect
    await expectDbError(
      addPayment(free, { amount_paise: 1000 }),
      "PAYMENT_ON_CANCELLED",
    );
  });

  it("PAF-10: nobody without an active account, and not the anonymous role, can record a payment", async () => {
    const b = await newBooking();
    await expectDbError(addPayment(b, {}, null, null), "NOT_ALLOWED");
    await expectDbError(addPayment(b, {}, null, uid()), "NOT_ALLOWED");
    await expectDbError(
      w.db.as({ role: "anon" }, () =>
        q(`select public.add_payment('{}'::jsonb, null, gen_random_uuid())`),
      ),
      "permission denied",
    );
  });
});

describe("approving payments", () => {
  it("PAF-20: approval stamps the decider from the session, shows self-approval, and writes history (Q8, FR-APR)", async () => {
    const b = await newBooking();
    const a = await addPayment(b, { amount_paise: 100000 });
    await approvePay(a.id, 1, w.owner);
    const p = await payment(a.id);
    expect(p).toMatchObject({
      status: "approved",
      approved_by: w.owner,
      is_self_approved: false,
      version: 2,
    });
    const c = await addPayment(b, { amount_paise: 50000 });
    await approvePay(c.id, 1, w.manager); // approving your own entry is allowed and flagged
    expect((await payment(c.id)).is_self_approved).toBe(true);
    const h = await q<{ is_self_action: boolean; to_status: string }>(
      `select to_status::text, is_self_action from public.approval_history where payment_id = $1 order by id`,
      [c.id],
    );
    expect(h.map((x) => [x.to_status, x.is_self_action])).toEqual([
      ["waiting", true],
      ["approved", true],
    ]);
    expect((await fin(b)).total_collection_paise).toBe(150000);
  });

  it("PAF-21: a second person acting at the same moment is told who already acted (FR-APR-6)", async () => {
    const b = await newBooking();
    const a = await addPayment(b);
    await approvePay(a.id, 1, w.owner);
    await expectDbError(approvePay(a.id, 1, w.manager2), "ALREADY_DECIDED");
    await expectDbError(
      call(`select public.reject_payment($1, 1, 'Too late now')`, [a.id]),
      "ALREADY_DECIDED",
    );
    const e = await call(`select public.approve_payment($1, 1)`, [a.id]).catch(
      (x: Error) => x.message,
    );
    expect(String(e)).toContain("ALREADY_DECIDED");
    const stale = await addPayment(b);
    await call(
      `select public.update_waiting_payment($1, 1, $2::jsonb, 'Fix amount')`,
      [stale.id, j({ remarks: "x" })],
    );
    await expectDbError(approvePay(stale.id, 1), "STALE_RECORD");
  });

  it("PAF-22: reject and reverse need a reason; rejected and reversed are final (FR-APR-3)", async () => {
    const b = await newBooking();
    const a = await addPayment(b);
    await expectDbError(
      call(`select public.reject_payment($1, 1, '  ')`, [a.id]),
      "REASON_REQUIRED",
    );
    await call(`select public.reject_payment($1, 1, 'Wrong booking')`, [a.id]);
    expect(await payment(a.id)).toMatchObject({
      status: "rejected",
      rejected_by: w.manager,
      rejection_reason: "Wrong booking",
    });
    await expectDbError(approvePay(a.id, 2), "ALREADY_DECIDED");
    await expectDbError(
      call(`select public.reverse_payment($1, 2, 'Test reason')`, [a.id]),
      "ALREADY_DECIDED",
    );
    const c = await addPayment(b);
    await approvePay(c.id);
    await expectDbError(
      call(`select public.reverse_payment($1, 2, '')`, [c.id]),
      "REASON_REQUIRED",
    );
    await call(`select public.reverse_payment($1, 2, 'Bounced')`, [c.id]);
    expect(await payment(c.id)).toMatchObject({
      status: "reversed",
      reversal_reason: "Bounced",
    });
    expect((await fin(b)).total_collection_paise).toBe(0);
  });

  it("PAF-23: only a waiting payment can be edited, with a reason; the history keeps the change", async () => {
    const b = await newBooking();
    const a = await addPayment(b, { amount_paise: 100000 });
    await expectDbError(
      call(`select public.update_waiting_payment($1, 1, $2::jsonb, '')`, [
        a.id,
        j({ amount_paise: 90000 }),
      ]),
      "REASON_REQUIRED",
    );
    await call(
      `select public.update_waiting_payment($1, 1, $2::jsonb, 'Typed wrong amount')`,
      [a.id, j({ amount_paise: 90000, reference_number: "TESTREF9" })],
    );
    expect(await payment(a.id)).toMatchObject({
      amount_paise: 90000,
      reference_number: "TESTREF9",
      version: 2,
    });
    const au = await q<{ reason: string }>(
      `select reason from public.audit_logs where table_name = 'payments' and record_id = $1 and action = 'update' order by id desc limit 1`,
      [a.id],
    );
    expect(au[0].reason).toBe("Typed wrong amount");
    await expectDbError(
      call(
        `select public.update_waiting_payment($1, 1, '{}'::jsonb, 'Test reason')`,
        [a.id],
      ),
      "STALE_RECORD",
    );
    await approvePay(a.id, 2);
    await expectDbError(
      call(
        `select public.update_waiting_payment($1, 3, $2::jsonb, 'Test reason')`,
        [a.id, j({ amount_paise: 1 })],
      ),
      "ALREADY_DECIDED",
    );
  });
});

describe("refunds", () => {
  it("PAF-30: a waiting refund changes no balance (D1); approval does; the limit counts waiting refunds", async () => {
    const { b } = await funded(500000, 500000);
    await cancel(b, 100000);
    const before = await fin(b);
    const r = await addRefund(b, { amount_paise: 200000 });
    const waiting = await fin(b);
    for (const k of [
      "total_collection_paise",
      "net_collection_paise",
      "pending_paise",
      "verified_remaining_paise",
      "extra_paise",
      "refund_due_paise",
    ]) {
      expect(waiting[k]).toBe(before[k]); // unchanged by a WAITING refund
    }
    expect(waiting.refund_waiting_paise).toBe(200000);
    await approveRef(r.id);
    expect((await fin(b)).net_collection_paise).toBe(
      before.net_collection_paise - 200000,
    );
  });

  it("PAF-31: a refund can never be more than the approved money still held, waiting refunds included (D1)", async () => {
    const { b } = await funded(500000, 500000);
    await cancel(b, 0);
    await addRefund(b, { amount_paise: 300000 });
    await expectDbError(
      addRefund(b, { amount_paise: 300000 }),
      "REFUND_TOO_LARGE",
    ); // 200000 left
    await addRefund(b, { amount_paise: 200000 });
    await expectDbError(addRefund(b, { amount_paise: 1 }), "REFUND_TOO_LARGE");
  });

  it("PAF-32: an active booking can be refunded only when it is overpaid (Q12); the warning shows when above the refund due", async () => {
    const { b } = await funded(500000, 500000);
    await expectDbError(addRefund(b), "REFUND_NOT_ALLOWED");
    const over = await newBooking(500000);
    const p = await addPayment(over, { amount_paise: 600000 });
    await approvePay(p.id);
    expect((await addRefund(over, { amount_paise: 100000 })).warnings).toEqual(
      [],
    );
    // Owner decision 2026-11-11: on a running booking the genuine overpayment (100000) is a HARD limit,
    // and the 100000 already waiting uses it all up. (Details: tests/db/owner-decisions.test.ts.)
    await expectDbError(
      addRefund(over, { amount_paise: 50000 }),
      "REFUND_TOO_LARGE",
    );
  });

  it("PAF-33: a refund needs a reason; UPI/card/cheque refunds need proof in the refunds folder (D3)", async () => {
    const over = await newBooking(500000);
    const p = await addPayment(over, { amount_paise: 700000 });
    await approvePay(p.id);
    await expectDbError(addRefund(over, { reason: "" }), "REASON_REQUIRED");
    await expectDbError(
      addRefund(over, { method: "upi", provider_id: 1 }),
      "PROOF_REQUIRED",
    );
    await expectDbError(
      addRefund(over, { method: "upi", provider_id: 1 }, [
        await file(over, "payment"),
      ]),
      "INVALID_FILE",
    ); // payment folder
    const ok = await addRefund(
      over,
      { method: "upi", provider_id: 1, amount_paise: 50000 },
      [await file(over, "refund")],
    );
    expect(ok.refund_code).toMatch(/-R1$/);
    expect((await refund(ok.id)).recorded_by).toBe(w.manager);
    await addRefund(over, { method: "cash", amount_paise: 50000 }); // cash: proof optional
  });

  it("PAF-34: refund numbers, idempotency and the future-date rule", async () => {
    const over = await newBooking(500000);
    const p = await addPayment(over, { amount_paise: 700000 });
    await approvePay(p.id);
    const idem = uid();
    const a = await addRefund(
      over,
      { amount_paise: 1000 },
      null,
      w.manager,
      idem,
    );
    const b2 = await addRefund(
      over,
      { amount_paise: 2000 },
      null,
      w.manager,
      idem,
    );
    expect(b2.duplicate).toBe(true);
    expect(b2.id).toBe(a.id);
    await expectDbError(
      addRefund(over, { refund_date: await dateOffset(w.db, 1) }),
      "REFUND_DATE_IN_FUTURE",
    );
    expect((await addRefund(over, { amount_paise: 1000 })).refund_code).toMatch(
      /-R2$/,
    );
  });

  it("PAF-35: refunds have their own approval flow with the same rules (Q7b)", async () => {
    const over = await newBooking(500000);
    const p = await addPayment(over, { amount_paise: 700000 });
    await approvePay(p.id);
    const r = await addRefund(over, { amount_paise: 100000 });
    await approveRef(r.id, 1, w.manager); // self-approval allowed and flagged
    expect(await refund(r.id)).toMatchObject({
      status: "approved",
      is_self_approved: true,
    });
    await expectDbError(approveRef(r.id, 1), "ALREADY_DECIDED");
    await call(`select public.reverse_refund($1, 2, 'Sent twice by mistake')`, [
      r.id,
    ]);
    expect((await refund(r.id)).status).toBe("reversed");
    const r2 = await addRefund(over, { amount_paise: 100000 });
    await expectDbError(
      call(`select public.reject_refund($1, 1, '')`, [r2.id]),
      "REASON_REQUIRED",
    );
    await call(`select public.reject_refund($1, 1, 'Not needed')`, [r2.id]);
    await expectDbError(approveRef(r2.id, 2), "ALREADY_DECIDED");
  });

  it("PAF-36: reversal protection: a payment cannot be reversed while refunds depend on it (D5)", async () => {
    const { b, p } = await funded(100000, 300000);
    await cancel(b, 0);
    const r = await addRefund(b, { amount_paise: 250000 });
    await expectDbError(
      call(`select public.reverse_payment($1, 2, 'Bounced')`, [p]),
      "REVERSAL_EXCEEDS_REFUNDS",
    ); // waiting refund depends on it
    await approveRef(r.id);
    await expectDbError(
      call(`select public.reverse_payment($1, 2, 'Bounced')`, [p]),
      "REVERSAL_EXCEEDS_REFUNDS",
    ); // approved refund depends on it
    await call(`select public.reverse_refund($1, 2, 'Reversed first')`, [r.id]);
    await call(`select public.reverse_payment($1, 2, 'Bounced')`, [p]);
    expect((await payment(p)).status).toBe("reversed");
  });

  it("PAF-37: editing a waiting refund re-checks the limit", async () => {
    const over = await newBooking(500000);
    const p = await addPayment(over, { amount_paise: 600000 });
    await approvePay(p.id);
    const r = await addRefund(over, { amount_paise: 50000 });
    await expectDbError(
      call(
        `select public.update_waiting_refund($1, 1, $2::jsonb, 'Fix amount')`,
        [r.id, j({ amount_paise: 700000 })],
      ),
      "REFUND_TOO_LARGE",
    );
    await call(
      `select public.update_waiting_refund($1, 1, $2::jsonb, 'Fix amount')`,
      [r.id, j({ amount_paise: 90000 })],
    );
    expect((await refund(r.id)).amount_paise).toBe(90000);
  });
});

describe("proof files", () => {
  it("PAF-40: extra files can be added while waiting, up to 5; a wrong file can be hidden but never the last required one", async () => {
    const b = await newBooking();
    const f1 = await file(b);
    const a = await addPayment(b, { method: "upi", provider_id: 1 }, [f1]);
    const added = await call<{ r: Json }>(
      `select public.add_proofs('payment', $1, $2::jsonb) as r`,
      [a.id, j([await file(b), await file(b)])],
    );
    expect(added[0].r.added).toBe(2);
    const proofs = await q<{ id: string }>(
      `select id from public.proofs where payment_id = $1 order by uploaded_at, id`,
      [a.id],
    );
    await expectDbError(
      call(`select public.add_proofs('payment', $1, $2::jsonb)`, [
        a.id,
        j([await file(b), await file(b), await file(b)]),
      ]),
      "TOO_MANY_FILES",
    );
    await expectDbError(
      call(`select public.hide_proof($1, '')`, [proofs[0].id]),
      "REASON_REQUIRED",
    );
    await call(`select public.hide_proof($1, 'Wrong screenshot')`, [
      proofs[0].id,
    ]);
    await call(`select public.hide_proof($1, 'Blurry')`, [proofs[1].id]);
    await expectDbError(
      call(`select public.hide_proof($1, 'Last one')`, [proofs[2].id]),
      "PROOF_REQUIRED",
    );
    expect(
      (
        await q(
          `select 1 from public.proofs where payment_id = $1 and hidden_at is null`,
          [a.id],
        )
      ).length,
    ).toBe(1);
    expect(
      (await q(`select 1 from public.proofs where id = $1`, [proofs[0].id]))
        .length,
    ).toBe(1); // hidden, never deleted
  });

  it("PAF-41: after a decision the originals are locked: no add, no hide (FR-PAY-8)", async () => {
    const b = await newBooking();
    const a = await addPayment(b, { method: "upi", provider_id: 1 }, [
      await file(b),
      await file(b),
    ]);
    await approvePay(a.id);
    const [pr] = await q<{ id: string }>(
      `select id from public.proofs where payment_id = $1 limit 1`,
      [a.id],
    );
    await expectDbError(
      call(`select public.add_proofs('payment', $1, $2::jsonb)`, [
        a.id,
        j([await file(b)]),
      ]),
      "PROOF_LOCKED",
    );
    await expectDbError(
      call(`select public.hide_proof($1, 'Test reason')`, [pr.id]),
      "PROOF_LOCKED",
    );
    const rej = await addPayment(b, {});
    await call(`select public.reject_payment($1, 1, 'Not valid')`, [rej.id]);
    await expectDbError(
      call(`select public.add_proofs('payment', $1, $2::jsonb)`, [
        rej.id,
        j([await file(b)]),
      ]),
      "PROOF_LOCKED",
    );
  });

  it("PAF-42: a correction file: approved only, reason of 10+ characters, originals untouched, no balance changes (Q9a)", async () => {
    const b = await newBooking();
    const a = await addPayment(b, { amount_paise: 100000 });
    const corr = async (id: string, reason: string, kind = "payment") =>
      call(`select public.add_correction_files($1, $2, $3, $4::jsonb)`, [
        kind,
        id,
        reason,
        j([await file(b, kind as "payment")]),
      ]);
    await expectDbError(
      corr(a.id, "Receipt photo was taken later"),
      "PROOF_CORRECTION_NOT_ALLOWED",
    ); // waiting
    await approvePay(a.id);
    const before = {
      fin: await fin(b),
      pay: await payment(a.id),
      files: await q(
        `select * from public.proofs where payment_id = $1 order by id`,
        [a.id],
      ),
    };
    await expectDbError(corr(a.id, "short"), "REASON_REQUIRED");
    await expectDbError(corr(a.id, "         "), "REASON_REQUIRED");
    await expectDbError(
      call(
        `select public.add_correction_files('payment', $1, 'Receipt photo was taken later', '[]'::jsonb)`,
        [a.id],
      ),
      "INVALID_INPUT",
    );
    const out = await corr(a.id, "Receipt photo was taken later");
    expect(
      (out[0] as { add_correction_files: Json }).add_correction_files.added,
    ).toBe(1);
    const c = await q<Json>(
      `select * from public.proofs where payment_id = $1 and is_correction`,
      [a.id],
    );
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({
      correction_reason: "Receipt photo was taken later",
      uploaded_by: w.manager,
    });
    const after = {
      fin: await fin(b),
      pay: await payment(a.id),
      files: await q(
        `select * from public.proofs where payment_id = $1 and not is_correction order by id`,
        [a.id],
      ),
    };
    expect(after.fin).toEqual(before.fin); // no financial figure moved
    expect(after.pay).toEqual(before.pay);
    expect(after.files).toEqual(before.files); // originals identical
    expect(
      (
        await q(
          `select 1 from public.correction_files where record_id = $1 and kind = 'payment'`,
          [a.id],
        )
      ).length,
    ).toBe(1);
    await expectDbError(
      call(`select public.hide_proof($1, 'remove it')`, [c[0].id]),
      "PROOF_LOCKED",
    );
    const au = await q<{ reason: string }>(
      `select reason from public.audit_logs where table_name = 'proofs' and record_id = $1`,
      [c[0].id],
    );
    expect(au[0].reason).toBe("Receipt photo was taken later");
  });

  it("PAF-43: corrections are refused on rejected and reversed items; allowed on approved refunds (Q9a)", async () => {
    const b = await newBooking();
    const rej = await addPayment(b);
    await call(`select public.reject_payment($1, 1, 'Not valid')`, [rej.id]);
    const rev = await addPayment(b);
    await approvePay(rev.id);
    await call(`select public.reverse_payment($1, 2, 'Bounced')`, [rev.id]);
    for (const id of [rej.id, rev.id]) {
      await expectDbError(
        call(
          `select public.add_correction_files('payment', $1, 'A long enough reason', $2::jsonb)`,
          [id, j([await file(b)])],
        ),
        "PROOF_CORRECTION_NOT_ALLOWED",
      );
    }
    const over = await newBooking(500000);
    const p = await addPayment(over, { amount_paise: 700000 });
    await approvePay(p.id);
    const r = await addRefund(over, { amount_paise: 100000 });
    await approveRef(r.id);
    await call(
      `select public.add_correction_files('refund', $1, 'Bank slip found later', $2::jsonb)`,
      [r.id, j([await file(over, "refund")])],
    );
    expect(
      (
        await q(
          `select 1 from public.proofs where refund_id = $1 and is_correction`,
          [r.id],
        )
      ).length,
    ).toBe(1);
  });
});

describe("privileges for migration 15", () => {
  it("PAF-50: internal helpers are closed to app users; every public function is open only to signed-in users", async () => {
    const internal = [
      "pl_time",
      "money_position",
      "parse_files",
      "check_provider",
      "insert_proofs",
      "decide_payment",
      "decide_refund",
      "proof_parent",
    ];
    const pub = [
      "add_payment",
      "update_waiting_payment",
      "approve_payment",
      "reject_payment",
      "reverse_payment",
      "add_refund",
      "update_waiting_refund",
      "approve_refund",
      "reject_refund",
      "reverse_refund",
      "add_proofs",
      "hide_proof",
      "add_correction_files",
    ];
    const rows = await q<{ proname: string; anon: boolean; auth: boolean }>(
      `select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') auth
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public' where p.proname = any($1)`,
      [[...internal, ...pub]],
    );
    for (const n of internal)
      expect(
        rows.find((r) => r.proname === n),
        n,
      ).toMatchObject({ anon: false, auth: false });
    for (const n of pub)
      expect(
        rows.find((r) => r.proname === n),
        n,
      ).toMatchObject({ anon: false, auth: true });
    await expectDbError(
      call(`select public.decide_payment($1, 1, 'waiting', 'approved', null)`, [
        uid(),
      ]),
      "permission denied",
    );
  });

  it("PAF-51: there is still no direct write to money tables", async () => {
    for (const sql of [
      `insert into public.payments (booking_id) values (gen_random_uuid())`,
      `update public.payments set status = 'approved'`,
      `update public.refunds set status = 'approved'`,
      `insert into public.proofs (storage_path) values ('x')`,
      `update public.proofs set hidden_at = now()`,
      `insert into public.approval_history (to_status) values ('approved')`,
    ]) {
      await expectDbError(call(sql), "permission denied");
    }
  });
});
