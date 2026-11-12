import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireUser: vi.fn(),
  addPayment: vi.fn(),
  addRefund: vi.fn(),
  updateWaitingPayment: vi.fn(),
  updateWaitingRefund: vi.fn(),
  decidePayment: vi.fn(),
  decideRefund: vi.fn(),
  addProofs: vi.fn(),
  hideProof: vi.fn(),
  addCorrectionFiles: vi.fn(),
  loadProviderChoices: vi.fn(),
  schedulePdf: vi.fn(),
  schedulePdfForItem: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/pdf/schedule", () => ({
  schedulePdf: m.schedulePdf,
  schedulePdfForItem: m.schedulePdfForItem,
}));
vi.mock("@/lib/auth/session", () => ({ requireUser: m.requireUser }));
vi.mock("@/lib/db/actions", () => ({
  addPayment: m.addPayment,
  addRefund: m.addRefund,
  updateWaitingPayment: m.updateWaitingPayment,
  updateWaitingRefund: m.updateWaitingRefund,
  decidePayment: m.decidePayment,
  decideRefund: m.decideRefund,
  addProofs: m.addProofs,
  hideProof: m.hideProof,
  addCorrectionFiles: m.addCorrectionFiles,
}));
vi.mock("@/lib/payments/data", () => ({
  loadProviderChoices: m.loadProviderChoices,
}));

import {
  addCorrectionAction,
  addFilesAction,
  addMoneyAction,
  decideAction,
  hideFileAction,
  updateWaitingAction,
} from "@/lib/payments/actions";
import { emptyMoneyForm, type MoneyFormValues } from "@/lib/payments/form";

const BOOKING = "11111111-1111-4111-8111-111111111111";
const ID = "44444444-4444-4444-8444-444444444444";
const KEY = "55555555-5555-4555-8555-555555555555";
const PROOF = "66666666-6666-4666-8666-666666666666";
const R = (rupees: number) => rupees * 100;
const TODAY = new Date().toISOString().slice(0, 10);
const file = (n = 1) => ({
  storage_path: `${BOOKING}/77777777-7777-4777-8777-77777777777${n}.png`,
  original_file_name: "s.png",
  mime_type: "image/png",
  size_bytes: 1234,
  sha256: "a".repeat(64),
});
const values = (over: Partial<MoneyFormValues> = {}): MoneyFormValues => ({
  ...emptyMoneyForm(BOOKING, TODAY),
  amount: "1500",
  method: "cash",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.requireUser.mockResolvedValue({ id: "u1" });
  m.loadProviderChoices.mockResolvedValue([
    { id: 1, name: "PhonePe", method: "upi", active: true },
    { id: 4, name: "Visa", method: "card", active: true },
  ]);
  m.addPayment.mockResolvedValue({
    ok: true,
    data: {
      id: ID,
      payment_code: "AAA-2026-000001-P1",
      duplicate: false,
      warnings: [],
    },
  });
  m.addRefund.mockResolvedValue({
    ok: true,
    data: {
      id: ID,
      refund_code: "AAA-2026-000001-R1",
      duplicate: false,
      warnings: [],
    },
  });
  for (const f of [m.updateWaitingPayment, m.updateWaitingRefund])
    f.mockResolvedValue({ ok: true, data: { version: 3 } });
  for (const f of [
    m.decidePayment,
    m.decideRefund,
    m.addProofs,
    m.hideProof,
    m.addCorrectionFiles,
  ])
    f.mockResolvedValue({ ok: true, data: {} });
});

const dbCalls = () =>
  Object.entries(m)
    .filter(
      ([k]) =>
        ![
          "requireUser",
          "loadProviderChoices",
          "schedulePdf",
          "schedulePdfForItem",
        ].includes(k),
    )
    .reduce((n, [, f]) => n + f.mock.calls.length, 0);

describe("every action checks the signed-in user first (PA-01)", () => {
  it("PA-01: when nobody is signed in nothing reaches the database", async () => {
    m.requireUser.mockRejectedValue(new Error("NEXT_REDIRECT"));
    const calls: (() => Promise<unknown>)[] = [
      () =>
        addMoneyAction({
          kind: "payment",
          values: values(),
          files: [],
          idempotencyKey: KEY,
        }),
      () =>
        updateWaitingAction({
          kind: "payment",
          id: ID,
          expectedVersion: 2,
          values: values(),
          reason: "Wrong amount",
        }),
      () =>
        decideAction({
          kind: "payment",
          id: ID,
          expectedVersion: 2,
          decision: "approve",
        }),
      () => addFilesAction({ kind: "payment", parentId: ID, files: [file()] }),
      () =>
        hideFileAction({
          proofId: PROOF,
          reason: "Wrong picture",
          itemKind: "payment",
          itemId: ID,
        }),
      () =>
        addCorrectionAction({
          kind: "payment",
          parentId: ID,
          reason: "Receipt found later",
          files: [file()],
        }),
    ];
    for (const c of calls) await expect(c()).rejects.toThrow("NEXT_REDIRECT");
    expect(dbCalls()).toBe(0);
  });
});

describe("add (PA-02..)", () => {
  it("PA-02: a cash payment is saved with INPUTS only and the form's save key; the message is the documented one", async () => {
    const r = await addMoneyAction({
      kind: "payment",
      values: values(),
      files: [],
      idempotencyKey: KEY,
    });
    expect(r).toMatchObject({
      ok: true,
      id: ID,
      code: "AAA-2026-000001-P1",
      duplicate: false,
      warnings: [],
      message: "Payment of ₹1,500 added. Waiting for approval.",
    });
    const [payload, files, key] = m.addPayment.mock.calls[0];
    expect(key).toBe(KEY);
    expect(files).toEqual([]);
    expect(payload).toMatchObject({
      booking_id: BOOKING,
      amount_paise: R(1500),
      method: "cash",
      payment_date: TODAY,
    });
    for (const k of [
      "status",
      "pending_paise",
      "is_self_approved",
      "recorded_by",
    ])
      expect(payload).not.toHaveProperty(k);
  });
  it("PA-03: UPI without a file never reaches the database (D3); with a file it does", async () => {
    const v = values({ method: "upi", providerId: "1" });
    expect(
      await addMoneyAction({
        kind: "payment",
        values: v,
        files: [],
        idempotencyKey: KEY,
      }),
    ).toMatchObject({
      ok: false,
      errors: { files: expect.stringContaining("required") },
    });
    expect(m.addPayment).not.toHaveBeenCalled();
    expect(
      (
        await addMoneyAction({
          kind: "payment",
          values: v,
          files: [file()],
          idempotencyKey: KEY,
        })
      ).ok,
    ).toBe(true);
    expect(m.addPayment.mock.calls[0][1]).toHaveLength(1);
  });
  it("PA-04: a refund needs its reason and uses the refund function; the message says recorded", async () => {
    expect(
      await addMoneyAction({
        kind: "refund",
        values: values(),
        files: [],
        idempotencyKey: KEY,
      }),
    ).toMatchObject({ ok: false, errors: { reason: expect.any(String) } });
    const r = await addMoneyAction({
      kind: "refund",
      values: values({ reason: "Booking cancelled", amount: "2000" }),
      files: [],
      idempotencyKey: KEY,
    });
    expect(r).toMatchObject({
      ok: true,
      code: "AAA-2026-000001-R1",
      message: "Refund of ₹2,000 recorded. Waiting for approval.",
    });
    expect(m.addPayment).not.toHaveBeenCalled();
    expect(m.addRefund.mock.calls[0][0]).toMatchObject({
      reason: "Booking cancelled",
      refund_date: TODAY,
    });
  });
  it("PA-05: warnings from the database are passed on and never block (the item is saved)", async () => {
    m.addPayment.mockResolvedValue({
      ok: true,
      data: {
        id: ID,
        payment_code: "P1",
        duplicate: false,
        warnings: [
          { code: "DUPLICATE_REFERENCE" },
          { code: "ABOVE_AMOUNT_DUE" },
        ],
      },
    });
    const r = await addMoneyAction({
      kind: "payment",
      values: values(),
      files: [],
      idempotencyKey: KEY,
    });
    expect(r).toMatchObject({
      ok: true,
      warnings: ["DUPLICATE_REFERENCE", "ABOVE_AMOUNT_DUE"],
    });
    expect((r as { message: string }).message).toContain(
      "Waiting for approval.",
    );
  });
  it("PA-06: pressing Add twice: the database's 'duplicate' answer is passed on", async () => {
    m.addPayment.mockResolvedValue({
      ok: true,
      data: { id: ID, payment_code: "P1", duplicate: true, warnings: [] },
    });
    expect(
      await addMoneyAction({
        kind: "payment",
        values: values(),
        files: [],
        idempotencyKey: KEY,
      }),
    ).toMatchObject({ ok: true, duplicate: true });
  });
  it("PA-07: a database refusal comes back as the plain message and nothing technical", async () => {
    m.addRefund.mockResolvedValue({
      ok: false,
      message: "You cannot refund more than the approved money held.",
    });
    expect(
      await addMoneyAction({
        kind: "refund",
        values: values({ reason: "Booking cancelled" }),
        files: [],
        idempotencyKey: KEY,
      }),
    ).toEqual({
      ok: false,
      message: "You cannot refund more than the approved money held.",
      errors: undefined,
    });
  });
  it("PA-08: nonsense from the browser is refused: no key, wrong types, bad files, over-long text, a made-up method, more than 5 files", async () => {
    const good = {
      kind: "payment",
      values: values(),
      files: [],
      idempotencyKey: KEY,
    };
    for (const bad of [
      { ...good, idempotencyKey: "nope" },
      { ...good, kind: "gift" },
      { ...good, values: { ...values(), amount: 1500 } },
      { ...good, values: { ...values(), method: "barter" } },
      { ...good, values: values({ remarks: "x".repeat(501) }) },
      { ...good, values: { ...values(), bookingId: "not-an-id" } },
      { ...good, files: [{ ...file(), sha256: "short" }] },
      { ...good, files: [{ ...file(), size_bytes: 11 * 1024 * 1024 }] },
      { ...good, files: [1, 2, 3, 4, 5, 6].map((n) => file(n % 9)) },
      null,
      "text",
    ]) {
      expect((await addMoneyAction(bad)).ok).toBe(false);
    }
    expect(m.addPayment).not.toHaveBeenCalled();
  });
  it("PA-09: a future date and a card type that belongs to UPI are refused on the server too", async () => {
    expect(
      await addMoneyAction({
        kind: "payment",
        values: values({ date: "2999-01-01" }),
        files: [],
        idempotencyKey: KEY,
      }),
    ).toMatchObject({ ok: false, errors: { date: expect.any(String) } });
    expect(
      await addMoneyAction({
        kind: "payment",
        values: values({ method: "upi", providerId: "4" }),
        files: [file()],
        idempotencyKey: KEY,
      }),
    ).toMatchObject({ ok: false, errors: { providerId: expect.any(String) } });
    expect(m.addPayment).not.toHaveBeenCalled();
  });
});

describe("change a waiting item (PA-10..)", () => {
  const edit = (over: Record<string, unknown> = {}) =>
    updateWaitingAction({
      kind: "payment",
      id: ID,
      expectedVersion: 2,
      values: values({ amount: "1700" }),
      reason: "Typed the wrong amount",
      ...over,
    });
  it("PA-10: needs a reason of 5 letters; sends the version for the conflict check", async () => {
    expect(await edit({ reason: "no" })).toMatchObject({
      ok: false,
      errors: { reason: expect.any(String) },
    });
    expect(m.updateWaitingPayment).not.toHaveBeenCalled();
    expect(await edit()).toMatchObject({
      ok: true,
      version: 3,
      message: "Saved.",
    });
    expect(m.updateWaitingPayment).toHaveBeenCalledWith(
      ID,
      2,
      expect.objectContaining({ amount_paise: R(1700) }),
      "Typed the wrong amount",
    );
  });
  it("PA-11: refunds use the refund function and keep their own reason", async () => {
    const r = await updateWaitingAction({
      kind: "refund",
      id: ID,
      expectedVersion: 2,
      values: values({ reason: "Booking cancelled" }),
      reason: "Corrected the amount",
    });
    expect(r.ok).toBe(true);
    expect(m.updateWaitingRefund).toHaveBeenCalled();
    expect(m.updateWaitingPayment).not.toHaveBeenCalled();
    expect(
      await updateWaitingAction({
        kind: "refund",
        id: ID,
        expectedVersion: 2,
        values: values({ reason: "" }),
        reason: "Corrected the amount",
      }),
    ).toMatchObject({ ok: false });
  });
  it("PA-12: someone else decided or changed it first: the plain message comes back", async () => {
    m.updateWaitingPayment.mockResolvedValue({
      ok: false,
      message: "Someone else changed this just now. Please reload the page.",
    });
    expect(await edit()).toMatchObject({
      ok: false,
      message: "Someone else changed this just now. Please reload the page.",
    });
  });
});

describe("approve, reject, reverse (PA-13..)", () => {
  const decide = (decision: string, reason?: string, kind = "payment") =>
    decideAction({ kind, id: ID, expectedVersion: 2, decision, reason });
  it("PA-13: approve needs no reason; reject and reverse need 5 letters", async () => {
    expect(await decide("approve")).toMatchObject({
      ok: true,
      nextStatus: "approved",
      message: "Approved.",
    });
    expect(m.decidePayment).toHaveBeenLastCalledWith(ID, 2, "approve", "");
    for (const d of ["reject", "reverse"]) {
      expect(await decide(d, "no")).toMatchObject({
        ok: false,
        errors: { reason: expect.any(String) },
      });
      expect(await decide(d, "   ")).toMatchObject({ ok: false });
    }
    expect(m.decidePayment).toHaveBeenCalledTimes(1);
    expect(await decide("reject", " Wrong booking ")).toMatchObject({
      ok: true,
      nextStatus: "rejected",
    });
    expect(m.decidePayment).toHaveBeenLastCalledWith(
      ID,
      2,
      "reject",
      "Wrong booking",
    );
    expect(await decide("reverse", "Entered twice")).toMatchObject({
      ok: true,
      nextStatus: "reversed",
    });
  });
  it("PA-14: refunds use the refund decision function", async () => {
    await decide("approve", undefined, "refund");
    expect(m.decideRefund).toHaveBeenCalledWith(ID, 2, "approve", "");
    expect(m.decidePayment).not.toHaveBeenCalled();
  });
  it("PA-15: only the three decisions exist; a version is required; no status can be sent", async () => {
    expect((await decide("delete")).ok).toBe(false);
    expect((await decide("waiting")).ok).toBe(false);
    expect(
      (
        await decideAction({
          kind: "payment",
          id: ID,
          expectedVersion: 0,
          decision: "approve",
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await decideAction({
          kind: "payment",
          id: "x",
          expectedVersion: 1,
          decision: "approve",
        })
      ).ok,
    ).toBe(false);
    expect(dbCalls()).toBe(0);
  });
  it("PA-16: the database's refusals reach the person in plain words: already decided, refunds depend on the payment (D5)", async () => {
    m.decidePayment.mockResolvedValue({
      ok: false,
      message: "This payment is already approved by Ramesh Kumar.",
    });
    expect(await decide("approve")).toMatchObject({
      ok: false,
      message: "This payment is already approved by Ramesh Kumar.",
    });
    m.decidePayment.mockResolvedValue({
      ok: false,
      message:
        "This payment cannot be reversed because refunds depend on it. Reject or reverse the refunds first.",
    });
    expect(await decide("reverse", "Entered twice")).toMatchObject({
      ok: false,
      message: expect.stringContaining("refunds depend on it"),
    });
  });
});

describe("files (PA-17..)", () => {
  it("PA-17: more files: at least one, at most 5", async () => {
    expect(
      (await addFilesAction({ kind: "payment", parentId: ID, files: [] })).ok,
    ).toBe(false);
    expect(
      await addFilesAction({ kind: "payment", parentId: ID, files: [file()] }),
    ).toMatchObject({ ok: true, message: "The file was added." });
    expect(m.addProofs).toHaveBeenCalledWith("payment", ID, [
      expect.objectContaining({ sha256: "a".repeat(64) }),
    ]);
  });
  it("PA-18: hiding a wrong file needs a reason; nothing is deleted", async () => {
    expect(
      await hideFileAction({
        proofId: PROOF,
        reason: "no",
        itemKind: "payment",
        itemId: ID,
      }),
    ).toMatchObject({ ok: false, errors: { reason: expect.any(String) } });
    expect(
      await hideFileAction({
        proofId: PROOF,
        reason: "Wrong picture",
        itemKind: "payment",
        itemId: ID,
      }),
    ).toMatchObject({ ok: true });
    expect(m.hideProof).toHaveBeenCalledWith(PROOF, "Wrong picture");
    m.hideProof.mockResolvedValue({
      ok: false,
      message: "A UPI, card or cheque payment needs at least one file.",
    });
    expect(
      await hideFileAction({
        proofId: PROOF,
        reason: "Wrong picture",
        itemKind: "payment",
        itemId: ID,
      }),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("needs at least one file"),
    });
  });
  it("PA-19: a correction file needs a reason of 10 letters (Q9a) and says the amounts will not change", async () => {
    const body = (reason: string) => ({
      kind: "refund",
      parentId: ID,
      reason,
      files: [file()],
    });
    const short = await addCorrectionAction(body("123456789"));
    expect(short).toMatchObject({
      ok: false,
      errors: { reason: expect.stringContaining("at least 10") },
    });
    expect(
      (short as unknown as { errors: { reason: string } }).errors.reason,
    ).toContain("will not change");
    expect(m.addCorrectionFiles).not.toHaveBeenCalled();
    const ok = await addCorrectionAction(body("Receipt found later"));
    expect(ok).toMatchObject({
      ok: true,
      message: expect.stringContaining("did not change"),
    });
    expect(m.addCorrectionFiles).toHaveBeenCalledWith(
      "refund",
      ID,
      "Receipt found later",
      [expect.any(Object)],
    );
    m.addCorrectionFiles.mockResolvedValue({
      ok: false,
      message: "Correction files are only for approved payments and refunds.",
    });
    expect(
      await addCorrectionAction(body("Receipt found later")),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("only for approved"),
    });
  });
});

describe("a PDF is queued for making only after a save (PA-PDF)", () => {
  it("PA-PDF-1: saved: add (booking known), change (booking known), decide, add files, hide and correction (item known) each queue the PDF", async () => {
    await addMoneyAction({
      kind: "payment",
      values: values(),
      files: [],
      idempotencyKey: KEY,
    });
    await updateWaitingAction({
      kind: "payment",
      id: ID,
      expectedVersion: 2,
      values: values({ amount: "1700" }),
      reason: "Typed the wrong amount",
    });
    expect(m.schedulePdf.mock.calls).toEqual([[BOOKING], [BOOKING]]);
    await decideAction({
      kind: "refund",
      id: ID,
      expectedVersion: 2,
      decision: "approve",
    });
    await addFilesAction({ kind: "payment", parentId: ID, files: [file()] });
    await hideFileAction({
      proofId: PROOF,
      reason: "Wrong picture",
      itemKind: "payment",
      itemId: ID,
    });
    await addCorrectionAction({
      kind: "refund",
      parentId: ID,
      reason: "Receipt found later",
      files: [file()],
    });
    expect(m.schedulePdfForItem.mock.calls).toEqual([
      ["refund", ID],
      ["payment", ID],
      ["payment", ID],
      ["refund", ID],
    ]);
  });
  it("PA-PDF-2: a refused action queues nothing", async () => {
    m.addPayment.mockResolvedValue({ ok: false, message: "No." });
    m.decidePayment.mockResolvedValue({ ok: false, message: "No." });
    m.addProofs.mockResolvedValue({ ok: false, message: "No." });
    await addMoneyAction({
      kind: "payment",
      values: values(),
      files: [],
      idempotencyKey: KEY,
    });
    await addMoneyAction({
      kind: "payment",
      values: values({ amount: "0" }),
      files: [],
      idempotencyKey: KEY,
    });
    await decideAction({
      kind: "payment",
      id: ID,
      expectedVersion: 2,
      decision: "approve",
    });
    await decideAction({
      kind: "payment",
      id: ID,
      expectedVersion: 2,
      decision: "reject",
    });
    await addFilesAction({ kind: "payment", parentId: ID, files: [file()] });
    expect(m.schedulePdf).not.toHaveBeenCalled();
    expect(m.schedulePdfForItem).not.toHaveBeenCalled();
  });
});
