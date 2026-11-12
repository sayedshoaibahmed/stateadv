/**
 * The payment and refund screens and the database agree (M5). The payload the Add Payment / Add Refund forms build
 * (src/lib/payments/form.ts) is sent to the REAL database functions; every balance is read back from the trusted view
 * and compared with figures calculated BY HAND (D1). Also the approval life-cycle, self-approval, reversal protection (D5),
 * proofs and correction files (Q9a). PFC-01..
 */
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { expectDbError } from "./harness";
import {
  cancelBooking,
  createBooking,
  dateOffset,
  setupWorld,
  uid,
  type Booking,
  type World,
} from "./fixtures";
import {
  WARNING_TEXT,
  buildMoneyPayload,
  emptyMoneyForm,
  validateMoney,
  type MoneyFormValues,
  type ProviderChoice,
} from "@/lib/payments/form";

let w: World;
const R = (rupees: number) => rupees * 100;
type Row = Record<string, unknown>;
const q = <T = Row>(sql: string, p?: unknown[]) => w.db.q<T>(sql, p);
const as = <T>(id: string, fn: () => Promise<T>) =>
  w.db.as({ role: "authenticated", uid: id }, fn);
let today: string;
let upi: ProviderChoice, upiOther: ProviderChoice, card: ProviderChoice;
let providers: ProviderChoice[];

function form(
  bookingId: string,
  over: Partial<MoneyFormValues> = {},
): MoneyFormValues {
  return {
    ...emptyMoneyForm(bookingId, today),
    amount: "1500",
    method: "cash",
    ...over,
  };
}

/** a file as the server would have confirmed it after upload (a stored object with the size and type storage recorded) */
async function stored(booking: string, kind: "payment" | "refund" = "payment") {
  const path = `${kind === "refund" ? "refunds/" : ""}${booking}/${uid()}.png`;
  await q(
    `insert into storage.objects (bucket_id, name, metadata) values ('payment-proofs', $1, $2::jsonb)`,
    [path, JSON.stringify({ size: 1234, mimetype: "image/png" })],
  );
  return {
    storage_path: path,
    original_file_name: "receipt.png",
    mime_type: "image/png",
    size_bytes: 1234,
    sha256: randomBytes(32).toString("hex"),
  };
}

async function addPay(
  v: MoneyFormValues,
  files: unknown[] = [],
  actor = w.manager,
  key = uid(),
) {
  const { payload } = buildMoneyPayload(v, "payment");
  const [{ r }] = await as(actor, () =>
    q<{ r: Row }>(
      `select public.add_payment($1::jsonb, $2::jsonb, $3::uuid) as r`,
      [JSON.stringify(payload), JSON.stringify(files), key],
    ),
  );
  return r as {
    id: string;
    payment_code: string;
    duplicate: boolean;
    warnings: { code: string }[];
  };
}
async function addRef(
  v: MoneyFormValues,
  files: unknown[] = [],
  actor = w.manager,
  key = uid(),
) {
  const { payload } = buildMoneyPayload(v, "refund");
  const [{ r }] = await as(actor, () =>
    q<{ r: Row }>(
      `select public.add_refund($1::jsonb, $2::jsonb, $3::uuid) as r`,
      [JSON.stringify(payload), JSON.stringify(files), key],
    ),
  );
  return r as {
    id: string;
    refund_code: string;
    duplicate: boolean;
    warnings: { code: string }[];
  };
}
const decide = (
  kind: "payment" | "refund",
  id: string,
  version: number,
  d: "approve" | "reject" | "reverse",
  actor: string,
  reason: string | null = null,
) =>
  as(actor, () =>
    q(
      d === "approve"
        ? `select public.approve_${kind}($1, $2)`
        : `select public.${d}_${kind}($1, $2, $3)`,
      d === "approve" ? [id, version] : [id, version, reason],
    ),
  );
const version = async (kind: "payment" | "refund", id: string) =>
  Number(
    (await q(`select version from public.${kind}s where id = $1`, [id]))[0]
      .version,
  );
const fin = async (booking: string) => {
  const [f] = await q(
    `select * from public.booking_financials where booking_id = $1`,
    [booking],
  );
  const n = (k: string) => Number(f[k]);
  return {
    due: n("due_paise"),
    a: n("approved_paise"),
    w: n("waiting_paise"),
    ra: n("refunds_approved_paise"),
    rw: n("refunds_waiting_paise"),
    pending: n("pending_paise"),
    verified: n("verified_remaining_paise"),
    net: n("net_collection_paise"),
    extra: n("extra_paise"),
    refundDue: n("refund_due_paise"),
    limit: n("refundable_limit_paise"),
    total: n("total_collection_paise"),
  };
};
/** a fresh booking of Rs 10,000 (2 people x Rs 5,000) */
const fresh = (
  over: Parameters<typeof createBooking>[1] = {},
): Promise<Booking> =>
  createBooking(w, {
    resort: "A",
    pax: 2,
    tariff: R(5000),
    bookingDateOffset: -1,
    checkInOffset: 3,
    plan: "auto",
    ...over,
  });

beforeAll(async () => {
  w = await setupWorld();
  today = await dateOffset(w.db, 0);
  const rows = await q<{ id: number; name: string; method: "upi" | "card" }>(
    `select id, name, method from public.payment_providers where is_active order by id`,
  );
  providers = rows.map((r) => ({
    id: r.id,
    name: r.name,
    method: r.method,
    active: true,
  }));
  upi = providers.find((p) => p.method === "upi" && p.name !== "Other")!;
  upiOther = providers.find((p) => p.method === "upi" && p.name === "Other")!;
  card = providers.find((p) => p.method === "card" && p.name !== "Other")!;
});

describe("adding a payment (PFC-01..)", () => {
  it("PFC-01: a cash payment of Rs 1,500 from the screen's payload waits for approval and already lowers Pending but not Verified Remaining or Net (D1)", async () => {
    const b = await fresh();
    expect(
      validateMoney(form(b.id), {
        kind: "payment",
        today,
        files: 0,
        providers,
      }),
    ).toEqual({});
    const r = await addPay(form(b.id));
    expect(r.duplicate).toBe(false);
    expect(r.payment_code).toBe(`${b.code}-P1`);
    expect(
      await q(
        `select status::text s, amount_paise, recorded_by, is_self_approved from public.payments where id = $1`,
        [r.id],
      ),
    ).toEqual([
      expect.objectContaining({
        s: "waiting",
        amount_paise: R(1500),
        recorded_by: w.manager,
      }),
    ]);
    // D = 10,000; A = 0; W = 1,500; RA = 0:  Pending = 10,000 - (0 + 1,500 - 0) = 8,500;  Verified = 10,000;  Net = 0
    expect(await fin(b.id)).toMatchObject({
      due: R(10000),
      a: 0,
      w: R(1500),
      pending: R(8500),
      verified: R(10000),
      net: 0,
      total: 0,
    });
  });

  it("PFC-02: UPI and Card need the app and a file (D3), Other needs its typed name, Cash takes neither app; the screen and the database agree", async () => {
    const b = await fresh();
    const file = await stored(b.id);
    // UPI without a file
    const noFile = form(b.id, { method: "upi", providerId: String(upi.id) });
    expect(
      validateMoney(noFile, { kind: "payment", today, files: 0, providers })
        .files,
    ).toBeTruthy();
    await expectDbError(addPay(noFile, []), "PROOF_REQUIRED");
    // UPI without an app
    const noApp = form(b.id, { method: "upi" });
    expect(
      validateMoney(noApp, { kind: "payment", today, files: 1, providers })
        .providerId,
    ).toBeTruthy();
    await expectDbError(addPay(noApp, [file]), "INVALID_INPUT");
    // UPI with the app and a file
    const good = form(b.id, {
      method: "upi",
      providerId: String(upi.id),
      reference: "UTR-1",
    });
    expect(
      validateMoney(good, { kind: "payment", today, files: 1, providers }),
    ).toEqual({});
    const ok = await addPay(good, [file]);
    expect(
      (
        await q(
          `select count(*)::int n from public.proofs where payment_id = $1`,
          [ok.id],
        )
      )[0].n,
    ).toBe(1);
    // the app called Other needs its typed name
    const other = form(b.id, {
      method: "upi",
      providerId: String(upiOther.id),
    });
    expect(
      validateMoney(other, { kind: "payment", today, files: 1, providers })
        .providerOther,
    ).toBeTruthy();
    await expectDbError(addPay(other, [await stored(b.id)]), "INVALID_INPUT");
    await addPay({ ...other, providerOther: "BharatPe" }, [await stored(b.id)]);
    // a card type chosen for UPI, and an app chosen for cash, are refused by the database too
    await expectDbError(
      addPay(form(b.id, { method: "upi", providerId: String(card.id) }), [
        await stored(b.id),
      ]),
      "INVALID_INPUT",
    );
    const cashWithApp = buildMoneyPayload(form(b.id), "payment").payload;
    await expectDbError(
      as(w.manager, () =>
        q(`select public.add_payment($1::jsonb, '[]'::jsonb, $2::uuid)`, [
          JSON.stringify({ ...cashWithApp, provider_id: upi.id }),
          uid(),
        ]),
      ),
      "INVALID_INPUT",
    );
    // Cheque needs a file, Other does not
    await expectDbError(
      addPay(form(b.id, { method: "cheque" }), []),
      "PROOF_REQUIRED",
    );
    await addPay(form(b.id, { method: "other" }), []);
  });

  it("PFC-03: warnings never block saving and every warning code has a plain-English text on the screen", async () => {
    const b = await fresh();
    await addPay(form(b.id, { reference: "SAME-REF", amount: "1000" }));
    const dup = await addPay(
      form(b.id, { reference: "SAME-REF", amount: "1000" }),
    );
    expect(dup.warnings.map((x) => x.code)).toContain("DUPLICATE_REFERENCE");
    const over = await addPay(form(b.id, { amount: "9000" })); // 1,000 + 1,000 + 9,000 > 10,000
    expect(over.warnings.map((x) => x.code)).toContain("ABOVE_AMOUNT_DUE");
    const f1 = await stored(b.id);
    const first = await addPay(form(b.id, { method: "cheque" }), [f1]);
    const again = await addPay(
      form(b.id, { method: "cheque", amount: "100" }),
      [{ ...(await stored(b.id)), sha256: f1.sha256 }],
    );
    expect(again.warnings.map((x) => x.code)).toContain("DUPLICATE_FILE");
    for (const r of [dup, over, again, first])
      for (const x of r.warnings)
        expect(WARNING_TEXT[x.code], x.code).toBeTruthy();
    // all four were saved
    expect(
      (
        await q(
          `select count(*)::int n from public.payments where booking_id = $1`,
          [b.id],
        )
      )[0].n,
    ).toBe(5);
  });

  it("PFC-04: pressing Add twice with the same key saves one payment", async () => {
    const b = await fresh();
    const key = uid();
    const a = await addPay(form(b.id), [], w.manager, key);
    const c = await addPay(form(b.id), [], w.manager, key);
    expect(c).toMatchObject({
      id: a.id,
      payment_code: a.payment_code,
      duplicate: true,
    });
    expect(
      (
        await q(
          `select count(*)::int n from public.payments where idempotency_key = $1`,
          [key],
        )
      )[0].n,
    ).toBe(1);
  });

  it("PFC-05: a future date, a zero amount and an unknown booking are refused", async () => {
    const b = await fresh();
    const future = await dateOffset(w.db, 1);
    expect(
      validateMoney(form(b.id, { date: future }), {
        kind: "payment",
        today,
        files: 0,
        providers,
      }).date,
    ).toBeTruthy();
    await expectDbError(
      addPay(form(b.id, { date: future })),
      "PAYMENT_DATE_IN_FUTURE",
    );
    const zero = {
      ...buildMoneyPayload(form(b.id), "payment").payload,
      amount_paise: 0,
    };
    await expectDbError(
      as(w.manager, () =>
        q(`select public.add_payment($1::jsonb, '[]'::jsonb, $2::uuid)`, [
          JSON.stringify(zero),
          uid(),
        ]),
      ),
      "INVALID_INPUT",
    );
    await expectDbError(addPay(form(uid())), "NOT_FOUND");
  });

  it("PFC-06: money on a cancelled booking is only for the unpaid cancellation charge (FR-PAY-11)", async () => {
    const b = await fresh();
    await cancelBooking(w, b, {
      charge: R(500),
      newRows: [{ dueOffset: 1, amount: R(500) }],
    });
    // charge 500, nothing paid: Pending 500
    expect(await fin(b.id)).toMatchObject({ due: R(500), pending: R(500) });
    await addPay(form(b.id, { amount: "500" }));
    expect((await fin(b.id)).pending).toBe(0); // the waiting 500 already covers it
    await expectDbError(
      addPay(form(b.id, { amount: "100" })),
      "PAYMENT_ON_CANCELLED",
    );
  });
});

describe("approval life-cycle and self-approval (PFC-07..)", () => {
  it("PFC-07: approve: Collection, Verified Remaining and Net move only now (A = 1,500); the person who recorded it may approve it and it is flagged (Q8)", async () => {
    const b = await fresh();
    const mine = await addPay(form(b.id));
    const theirs = await addPay(form(b.id, { amount: "500" }), [], w.manager2);
    await decide(
      "payment",
      mine.id,
      await version("payment", mine.id),
      "approve",
      w.manager,
    ); // own entry
    await decide(
      "payment",
      theirs.id,
      await version("payment", theirs.id),
      "approve",
      w.owner,
    ); // someone else's
    const rows = await q(
      `select id, is_self_approved from public.payments where booking_id = $1`,
      [b.id],
    );
    // (an entry that waits has no flag yet; the flag is set when it is approved)
    expect(rows.find((r) => r.id === mine.id)!.is_self_approved).toBe(true);
    expect(rows.find((r) => r.id === theirs.id)!.is_self_approved).toBe(false);
    const hist = await q(
      `select payment_id, is_self_action, to_status::text s from public.approval_history where payment_id = any($1) and to_status = 'approved'`,
      [[mine.id, theirs.id]],
    );
    expect(hist.find((h) => h.payment_id === mine.id)).toMatchObject({
      is_self_action: true,
      s: "approved",
    });
    expect(hist.find((h) => h.payment_id === theirs.id)).toMatchObject({
      is_self_action: false,
    });
    // D = 10,000; A = 2,000; W = 0 -> Pending 8,000; Verified 8,000; Net 2,000; Total Collection 2,000
    expect(await fin(b.id)).toMatchObject({
      a: R(2000),
      w: 0,
      pending: R(8000),
      verified: R(8000),
      net: R(2000),
      total: R(2000),
    });
  });

  it("PFC-08: reject (reason of 5 letters) and reverse (reason) leave the money exactly as if they never counted (A = 0)", async () => {
    const b = await fresh();
    const p1 = await addPay(form(b.id));
    const p2 = await addPay(form(b.id, { amount: "700" }));
    await expectDbError(
      decide(
        "payment",
        p1.id,
        await version("payment", p1.id),
        "reject",
        w.owner,
        "no",
      ),
      "REASON_REQUIRED",
    );
    await decide(
      "payment",
      p1.id,
      await version("payment", p1.id),
      "reject",
      w.owner,
      "Wrong booking",
    );
    await decide(
      "payment",
      p2.id,
      await version("payment", p2.id),
      "approve",
      w.owner,
    );
    expect((await fin(b.id)).a).toBe(R(700));
    await expectDbError(
      decide(
        "payment",
        p2.id,
        await version("payment", p2.id),
        "reverse",
        w.owner,
        "",
      ),
      "REASON_REQUIRED",
    );
    await decide(
      "payment",
      p2.id,
      await version("payment", p2.id),
      "reverse",
      w.owner,
      "Entered twice",
    );
    expect(await fin(b.id)).toMatchObject({
      a: 0,
      w: 0,
      pending: R(10000),
      verified: R(10000),
      net: 0,
      total: 0,
    });
    const s = await q(
      `select status::text s, rejection_reason, reversal_reason from public.payments where booking_id = $1 order by payment_code`,
      [b.id],
    );
    expect(s.map((x) => x.s)).toEqual(["rejected", "reversed"]);
    expect(s[0].rejection_reason).toBe("Wrong booking");
    expect(s[1].reversal_reason).toBe("Entered twice");
  });

  it("PFC-09: a decided payment cannot be decided or changed again; the second person is told who acted first", async () => {
    const b = await fresh();
    const p = await addPay(form(b.id));
    const v = await version("payment", p.id);
    await decide("payment", p.id, v, "approve", w.owner);
    await expectDbError(
      decide("payment", p.id, v, "approve", w.manager2),
      "ALREADY_DECIDED",
    );
    await expectDbError(
      decide("payment", p.id, v, "reject", w.manager2, "Wrong booking"),
      "ALREADY_DECIDED",
    );
    const { payload } = buildMoneyPayload(
      form(b.id, { amount: "1600" }),
      "payment",
    );
    await expectDbError(
      as(w.manager, () =>
        q(
          `select public.update_waiting_payment($1, $2, $3::jsonb, 'Typed wrongly')`,
          [p.id, v, JSON.stringify(payload)],
        ),
      ),
      "ALREADY_DECIDED",
    );
    // a stale version on a waiting payment
    const p2 = await addPay(form(b.id));
    await expectDbError(
      decide("payment", p2.id, 99, "approve", w.owner),
      "STALE_RECORD",
    );
  });

  it("PFC-10: changing a waiting payment needs a reason and keeps the history", async () => {
    const b = await fresh();
    const p = await addPay(form(b.id));
    const v = await version("payment", p.id);
    const { payload } = buildMoneyPayload(
      form(b.id, { amount: "1700", reference: "NEW-REF" }),
      "payment",
    );
    await expectDbError(
      as(w.manager, () =>
        q(`select public.update_waiting_payment($1, $2, $3::jsonb, 'no')`, [
          p.id,
          v,
          JSON.stringify(payload),
        ]),
      ),
      "REASON_REQUIRED",
    );
    await as(w.manager, () =>
      q(
        `select public.update_waiting_payment($1, $2, $3::jsonb, 'Typed the wrong amount')`,
        [p.id, v, JSON.stringify(payload)],
      ),
    );
    expect(
      await q(
        `select amount_paise, reference_number from public.payments where id = $1`,
        [p.id],
      ),
    ).toEqual([
      expect.objectContaining({
        amount_paise: R(1700),
        reference_number: "NEW-REF",
      }),
    ]);
    const audit = await q(
      `select reason from public.audit_logs where table_name = 'payments' and record_id = $1 and action = 'update' order by id desc limit 1`,
      [p.id],
    );
    expect(audit[0].reason).toBe("Typed the wrong amount");
  });
});

describe("refunds (PFC-11..)", () => {
  async function overpaid(paid = 11000) {
    const b = await fresh();
    const p = await addPay(form(b.id, { amount: String(paid) }));
    await decide(
      "payment",
      p.id,
      await version("payment", p.id),
      "approve",
      w.owner,
    );
    return { b, p };
  }
  it("PFC-11: a running booking that is not overpaid cannot be refunded (Q12)", async () => {
    const b = await fresh();
    const p = await addPay(form(b.id, { amount: "4000" }));
    await decide(
      "payment",
      p.id,
      await version("payment", p.id),
      "approve",
      w.owner,
    );
    await expectDbError(
      addRef(form(b.id, { amount: "100", reason: "Guest paid extra" })),
      "REFUND_NOT_ALLOWED",
    );
  });

  it("PFC-12: D1 by hand: paid 11,000 on 10,000 due. Waiting refund of 1,000 changes NO balance; approved refund does. The limit is A - RA - RW", async () => {
    const { b } = await overpaid();
    // before: A = 11,000, D = 10,000 -> Pending 0, Verified 0, Extra 1,000, Refund due 1,000, Net 11,000, limit 11,000
    expect(await fin(b.id)).toMatchObject({
      pending: 0,
      verified: 0,
      extra: R(1000),
      refundDue: R(1000),
      net: R(11000),
      limit: R(11000),
      rw: 0,
    });
    const v = form(b.id, { amount: "1000", reason: "Guest paid extra" });
    expect(
      validateMoney(v, { kind: "refund", today, files: 0, providers }),
    ).toEqual({});
    const r = await addRef(v);
    expect(r.refund_code).toBe(`${b.code}-R1`);
    // waiting refund: balances untouched, only "refund waiting" and the limit move (D1)
    expect(await fin(b.id)).toMatchObject({
      pending: 0,
      verified: 0,
      extra: R(1000),
      refundDue: R(1000),
      net: R(11000),
      ra: 0,
      rw: R(1000),
      limit: R(10000),
    });
    await decide(
      "refund",
      r.id,
      await version("refund", r.id),
      "approve",
      w.owner,
    );
    // approved: A = 11,000, RA = 1,000 -> Pending = max(10,000 - 10,000, 0) = 0, Extra 0, Refund due 0, Net 10,000, limit 10,000
    expect(await fin(b.id)).toMatchObject({
      a: R(11000),
      ra: R(1000),
      rw: 0,
      pending: 0,
      verified: 0,
      extra: 0,
      refundDue: 0,
      net: R(10000),
      limit: R(10000),
    });
  });

  it("PFC-13: a refund above the room is refused; a rejected refund frees the room; a refund needs its reason (5 letters)", async () => {
    const { b } = await overpaid();
    await expectDbError(
      addRef(form(b.id, { amount: "1000" })),
      "REASON_REQUIRED",
    );
    await expectDbError(
      addRef(form(b.id, { amount: "1001", reason: "Guest paid extra" })),
      "REFUND_TOO_LARGE",
    );
    const r1 = await addRef(
      form(b.id, { amount: "1000", reason: "Guest paid extra" }),
    );
    await expectDbError(
      addRef(form(b.id, { amount: "1", reason: "Guest paid extra" })),
      "REFUND_TOO_LARGE",
    ); // the room is held by the waiting one
    await decide(
      "refund",
      r1.id,
      await version("refund", r1.id),
      "reject",
      w.owner,
      "Wrong amount",
    );
    const r2 = await addRef(
      form(b.id, { amount: "600", reason: "Guest paid extra" }),
    );
    expect(r2.duplicate).toBe(false);
    expect(await fin(b.id)).toMatchObject({ rw: R(600), ra: 0, net: R(11000) }); // rejected 1,000 never counted; waiting 600 changes no balance
  });

  it("PFC-14: refunds follow the same proof rule as payments (UPI, Card, Cheque need a file)", async () => {
    const { b } = await overpaid();
    const v = form(b.id, {
      amount: "100",
      method: "cheque",
      reason: "Guest paid extra",
    });
    expect(
      validateMoney(v, { kind: "refund", today, files: 0, providers }).files,
    ).toBeTruthy();
    await expectDbError(addRef(v, []), "PROOF_REQUIRED");
    const ok = await addRef(v, [await stored(b.id, "refund")]);
    expect(ok.duplicate).toBe(false);
    // a payment-style path (no refunds/ prefix) is not accepted for a refund
    await expectDbError(
      addRef({ ...v, amount: "50" }, [await stored(b.id, "payment")]),
      "INVALID_FILE",
    );
  });

  it("PFC-15: a cancelled booking can be refunded the approved money beyond the charge (cancel charge 1,000, paid 3,000: refund up to 2,000)", async () => {
    const b = await fresh();
    const p = await addPay(form(b.id, { amount: "3000" }));
    await decide(
      "payment",
      p.id,
      await version("payment", p.id),
      "approve",
      w.owner,
    );
    await cancelBooking(w, b, {
      charge: R(1000),
      lockedPast: 0,
      newRows: [{ dueOffset: 1, amount: R(1000) }],
    });
    expect(await fin(b.id)).toMatchObject({
      due: R(1000),
      a: R(3000),
      extra: R(2000),
      refundDue: R(2000),
      pending: 0,
    });
    await expectDbError(
      addRef(form(b.id, { amount: "3001", reason: "Booking cancelled" })),
      "REFUND_TOO_LARGE",
    );
    const r = await addRef(
      form(b.id, { amount: "2000", reason: "Booking cancelled" }),
    );
    await decide(
      "refund",
      r.id,
      await version("refund", r.id),
      "approve",
      w.owner,
    );
    expect(await fin(b.id)).toMatchObject({
      net: R(1000),
      refundDue: 0,
      extra: 0,
      pending: 0,
    });
  });
});

describe("reversal protection D5 and proofs Q9a (PFC-16..)", () => {
  it("PFC-16: a payment cannot be reversed while refunds depend on it; once they are rejected or reversed it can", async () => {
    const b = await fresh();
    const p = await addPay(form(b.id, { amount: "11000" }));
    await decide(
      "payment",
      p.id,
      await version("payment", p.id),
      "approve",
      w.owner,
    );
    const r = await addRef(
      form(b.id, { amount: "1000", reason: "Guest paid extra" }),
    );
    // with the refund waiting
    await expectDbError(
      decide(
        "payment",
        p.id,
        await version("payment", p.id),
        "reverse",
        w.owner,
        "Entered twice",
      ),
      "REVERSAL_EXCEEDS_REFUNDS",
    );
    await decide(
      "refund",
      r.id,
      await version("refund", r.id),
      "approve",
      w.owner,
    );
    // with the refund approved
    await expectDbError(
      decide(
        "payment",
        p.id,
        await version("payment", p.id),
        "reverse",
        w.owner,
        "Entered twice",
      ),
      "REVERSAL_EXCEEDS_REFUNDS",
    );
    await decide(
      "refund",
      r.id,
      await version("refund", r.id),
      "reverse",
      w.owner,
      "Sent back by mistake",
    );
    await decide(
      "payment",
      p.id,
      await version("payment", p.id),
      "reverse",
      w.owner,
      "Entered twice",
    );
    expect(await fin(b.id)).toMatchObject({ a: 0, ra: 0, net: 0 });
  });

  it("PFC-17: files: more files and hiding only while waiting; the last file of a UPI payment cannot be hidden", async () => {
    const b = await fresh();
    const f1 = await stored(b.id);
    const p = await addPay(
      form(b.id, { method: "upi", providerId: String(upi.id) }),
      [f1],
    );
    const f2 = await stored(b.id);
    await as(w.manager, () =>
      q(`select public.add_proofs('payment', $1, $2::jsonb)`, [
        p.id,
        JSON.stringify([f2]),
      ]),
    );
    const proofs = await q<{ id: string }>(
      `select id from public.proofs where payment_id = $1 order by uploaded_at, id`,
      [p.id],
    );
    expect(proofs).toHaveLength(2);
    await as(w.manager, () =>
      q(`select public.hide_proof($1, 'Wrong picture chosen')`, [proofs[0].id]),
    );
    await expectDbError(
      as(w.manager, () =>
        q(`select public.hide_proof($1, 'Wrong picture chosen')`, [
          proofs[1].id,
        ]),
      ),
      "PROOF_REQUIRED",
    );
    await decide(
      "payment",
      p.id,
      await version("payment", p.id),
      "approve",
      w.owner,
    );
    const f3 = await stored(b.id);
    await expectDbError(
      as(w.manager, () =>
        q(`select public.add_proofs('payment', $1, $2::jsonb)`, [
          p.id,
          JSON.stringify([f3]),
        ]),
      ),
      "PROOF_LOCKED",
    );
  });

  it("PFC-18: Q9a: a correction file needs an APPROVED item and a reason of 10 letters; originals and money do not change; it shows in the correction view", async () => {
    const b = await fresh();
    const f1 = await stored(b.id);
    const p = await addPay(
      form(b.id, { method: "upi", providerId: String(upi.id) }),
      [f1],
    );
    const corr = async (reason: string) => {
      const f = await stored(b.id);
      return as(w.manager, () =>
        q(`select public.add_correction_files('payment', $1, $2, $3::jsonb)`, [
          p.id,
          reason,
          JSON.stringify([f]),
        ]),
      );
    };
    await expectDbError(
      corr("Receipt found later"),
      "PROOF_CORRECTION_NOT_ALLOWED",
    ); // still waiting
    await decide(
      "payment",
      p.id,
      await version("payment", p.id),
      "approve",
      w.owner,
    );
    const before = {
      fin: await fin(b.id),
      proofs: await q(
        `select id, hidden_at from public.proofs where payment_id = $1`,
        [p.id],
      ),
      pay: await q(
        `select amount_paise, status::text from public.payments where id = $1`,
        [p.id],
      ),
    };
    await expectDbError(corr("123456789"), "REASON_REQUIRED"); // 9 letters
    await corr("Receipt found later");
    expect(await fin(b.id)).toEqual(before.fin);
    expect(
      await q(
        `select amount_paise, status::text from public.payments where id = $1`,
        [p.id],
      ),
    ).toEqual(before.pay);
    const all = await q(
      `select id, is_correction, correction_reason, hidden_at from public.proofs where payment_id = $1 order by is_correction`,
      [p.id],
    );
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({
      id: (before.proofs[0] as Row).id,
      is_correction: false,
      hidden_at: null,
    }); // the original, untouched
    expect(all[1]).toMatchObject({
      is_correction: true,
      correction_reason: "Receipt found later",
    });
    const view = await as(w.manager, () =>
      q(
        `select record_code, correction_reason, uploaded_by_name from public.correction_files where record_id = $1`,
        [p.id],
      ),
    );
    expect(view).toEqual([
      expect.objectContaining({
        record_code: `${b.code}-P1`,
        correction_reason: "Receipt found later",
        uploaded_by_name: "Test Manager One",
      }),
    ]);
    // an original cannot be hidden once decided, and rejected / reversed items take no correction
    await expectDbError(
      as(w.manager, () =>
        q(`select public.hide_proof($1, 'Wrong picture chosen')`, [
          (before.proofs[0] as Row).id,
        ]),
      ),
      "PROOF_LOCKED",
    );
    await decide(
      "payment",
      p.id,
      await version("payment", p.id),
      "reverse",
      w.owner,
      "Entered twice",
    );
    await expectDbError(
      corr("Receipt found later"),
      "PROOF_CORRECTION_NOT_ALLOWED",
    );
  });

  it("PFC-19: the audit log keeps who did what, with the reasons, for payments and refunds", async () => {
    const b = await fresh();
    const p = await addPay(form(b.id));
    await decide(
      "payment",
      p.id,
      await version("payment", p.id),
      "reject",
      w.owner,
      "Wrong booking",
    );
    const rows = await q(
      `select actor_name, action, reason from public.audit_logs where table_name = 'payments' and record_id = $1 order by id`,
      [p.id],
    );
    expect(rows.map((r) => [r.actor_name, r.action])).toEqual([
      ["Test Manager One", "insert"],
      ["Test Owner", "update"],
    ]);
    expect(rows[1].reason).toBe("Wrong booking");
  });
});
