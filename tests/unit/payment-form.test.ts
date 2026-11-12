import { describe, expect, it } from "vitest";
import {
  METHODS,
  buildMoneyPayload,
  emptyMoneyForm,
  needsProof,
  needsProvider,
  proofLabel,
  referenceLabel,
  refundHelp,
  savedMessage,
  validateMoney,
  warningText,
  type MoneyFormValues,
  type ProviderChoice,
} from "@/lib/payments/form";
import {
  abilities,
  reasonProblem,
  REVERSAL_BLOCKED_TEXT,
  MIN_CORRECTION_REASON,
} from "@/lib/payments/rules";
import {
  PAGE_SIZE,
  activeFilterCount,
  moneyArgs,
  moneyHref,
  pageCount,
  parseMoneyFilter,
} from "@/lib/payments/list";
import {
  COMPRESS_OVER_BYTES,
  MAX_EDGE,
  fitWithin,
  pickSmaller,
  shouldCompress,
} from "@/lib/storage/compress";
import { checkClaim } from "@/lib/storage/claims";

const R = (rupees: number) => rupees * 100;
const TODAY = "2026-11-12";
const BOOKING = "11111111-1111-4111-8111-111111111111";
const providers: ProviderChoice[] = [
  { id: 1, name: "PhonePe", method: "upi", active: true },
  { id: 2, name: "Other", method: "upi", active: true },
  { id: 3, name: "Old App", method: "upi", active: false },
  { id: 4, name: "Visa", method: "card", active: true },
];
const form = (over: Partial<MoneyFormValues> = {}): MoneyFormValues => ({
  ...emptyMoneyForm(BOOKING, TODAY),
  amount: "1,500",
  method: "cash",
  ...over,
});
const check = (
  v: MoneyFormValues,
  kind: "payment" | "refund" = "payment",
  files = 0,
) => validateMoney(v, { kind, today: TODAY, files, providers });

describe("proof rules (D3) (PF-01..)", () => {
  it("PF-01: UPI, Card and Cheque need a file; Cash and Other do not", () => {
    for (const m of ["upi", "card", "cheque"] as const)
      expect(needsProof(m)).toBe(true);
    for (const m of ["cash", "other", ""] as const)
      expect(needsProof(m)).toBe(false);
    expect(check(form({ method: "cheque" }))).toMatchObject({
      files: expect.stringContaining("required for Cheque"),
    });
    expect(
      check(form({ method: "cheque" }), "payment", 1).files,
    ).toBeUndefined();
    expect(check(form({ method: "cash" })).files).toBeUndefined();
    expect(check(form({ method: "other" })).files).toBeUndefined();
    expect(
      check(form({ method: "upi", providerId: "1" }), "payment", 0).files,
    ).toBeTruthy();
  });
  it("PF-02: labels say Required or Optional and change with the method", () => {
    expect(proofLabel("upi")).toBe("Payment screenshot or receipt (required)");
    expect(proofLabel("cash")).toBe("Payment screenshot or receipt (optional)");
    expect(proofLabel("card", "refund")).toBe(
      "Refund screenshot or receipt (required)",
    );
    expect(referenceLabel("upi")).toContain("UPI");
    expect(referenceLabel("cheque")).toContain("Cheque number");
    expect(referenceLabel("cash")).toContain("optional");
    expect(referenceLabel("cash", "refund")).toContain("Voucher");
    expect(referenceLabel("")).toContain("optional");
  });
  it("PF-03: at most five files", () => {
    expect(check(form(), "payment", 6).files).toContain("at most 5");
    expect(check(form(), "payment", 5).files).toBeUndefined();
  });
});

describe("provider rules (PF-04..)", () => {
  it("PF-04: UPI and Card need an app/card type that is switched on and belongs to the method", () => {
    expect(needsProvider("upi") && needsProvider("card")).toBe(true);
    expect(needsProvider("cash")).toBe(false);
    expect(check(form({ method: "upi" }), "payment", 1).providerId).toBe(
      "Please choose the payment app.",
    );
    expect(check(form({ method: "card" }), "payment", 1).providerId).toBe(
      "Please choose the card type.",
    );
    expect(
      check(form({ method: "upi", providerId: "4" }), "payment", 1).providerId,
    ).toBeTruthy(); // a card type for UPI
    expect(
      check(form({ method: "upi", providerId: "3" }), "payment", 1).providerId,
    ).toBeTruthy(); // switched off
    expect(
      check(form({ method: "upi", providerId: "99" }), "payment", 1).providerId,
    ).toBeTruthy(); // unknown
    expect(
      check(form({ method: "upi", providerId: "1" }), "payment", 1).providerId,
    ).toBeUndefined();
    expect(
      check(form({ method: "card", providerId: "4" }), "payment", 1).providerId,
    ).toBeUndefined();
  });
  it("PF-05: the app called Other needs a typed name", () => {
    expect(
      check(form({ method: "upi", providerId: "2" }), "payment", 1)
        .providerOther,
    ).toBe("Please write the name.");
    expect(
      check(
        form({ method: "upi", providerId: "2", providerOther: "  " }),
        "payment",
        1,
      ).providerOther,
    ).toBeTruthy();
    expect(
      check(
        form({ method: "upi", providerId: "2", providerOther: "BharatPe" }),
        "payment",
        1,
      ).providerOther,
    ).toBeUndefined();
    expect(
      check(
        form({ method: "upi", providerId: "2", providerOther: "x".repeat(61) }),
        "payment",
        1,
      ).providerOther,
    ).toBeTruthy();
    expect(
      check(
        form({ method: "upi", providerId: "1", providerOther: "ignored" }),
        "payment",
        1,
      ).providerOther,
    ).toBeUndefined();
  });
});

describe("validation, in plain English (PF-06..)", () => {
  it("PF-06: a valid cash payment has no errors; an empty form lists what is missing", () => {
    expect(check(form())).toEqual({});
    const e = check(emptyMoneyForm(BOOKING, TODAY));
    expect(e.amount).toBe("Please enter the amount.");
    expect(e.method).toBe("Please choose how the money was paid.");
    for (const m of Object.values(e))
      expect(m).not.toMatch(/undefined|null|\[object/);
    expect(check(emptyMoneyForm(BOOKING, TODAY), "refund").method).toBe(
      "Please choose how the money was sent back.",
    );
  });
  it("PF-07: amounts: zero, negative, text, too many decimals", () => {
    expect(check(form({ amount: "0" })).amount).toBe(
      "The amount must be more than zero.",
    );
    for (const bad of ["-5", "abc", "1.234", "1e3"])
      expect(check(form({ amount: bad })).amount).toBeTruthy();
    expect(check(form({ amount: "₹ 2,500.50" })).amount).toBeUndefined();
  });
  it("PF-08: the date cannot be in the future; times are 24-hour", () => {
    expect(check(form({ date: "2026-11-13" })).date).toBe(
      "The payment date cannot be in the future.",
    );
    expect(check(form({ date: "2026-11-13" }), "refund").date).toBe(
      "The refund date cannot be in the future.",
    );
    expect(check(form({ date: TODAY })).date).toBeUndefined();
    expect(check(form({ date: "" })).date).toBeTruthy();
    expect(check(form({ date: "2026-02-30" })).date).toBeTruthy();
    expect(check(form({ time: "25:00" })).time).toBeTruthy();
    expect(check(form({ time: "14:30" })).time).toBeUndefined();
    expect(check(form({ time: "" })).time).toBeUndefined();
  });
  it("PF-09: refund needs a reason of 5 letters; text lengths", () => {
    expect(check(form(), "refund").reason).toContain("at least 5");
    expect(check(form({ reason: "abcd" }), "refund").reason).toBeTruthy();
    expect(
      check(form({ reason: "Booking cancelled" }), "refund").reason,
    ).toBeUndefined();
    expect(check(form(), "payment").reason).toBeUndefined();
    expect(check(form({ reference: "x".repeat(101) })).reference).toBeTruthy();
    expect(check(form({ remarks: "x".repeat(501) })).remarks).toBeTruthy();
  });
});

describe("what is sent to the database (PF-10..)", () => {
  it("PF-10: a payment: inputs only, in paise, no balance or status", () => {
    const { payload } = buildMoneyPayload(
      form({
        amount: "2,500.50",
        method: "upi",
        providerId: "1",
        reference: " UTR123 ",
        remarks: " ok ",
        time: "09:05",
      }),
      "payment",
    );
    expect(payload).toEqual({
      booking_id: BOOKING,
      amount_paise: 250050,
      method: "upi",
      provider_id: 1,
      provider_other: null,
      reference_number: "UTR123",
      remarks: "ok",
      payment_date: TODAY,
      payment_time: "09:05",
    });
    for (const k of [
      "status",
      "pending_paise",
      "is_self_approved",
      "recorded_by",
      "approved_by",
    ])
      expect(payload).not.toHaveProperty(k);
  });
  it("PF-11: a refund adds the reason and refund_ dates; a cash payment sends no app", () => {
    const { payload } = buildMoneyPayload(
      form({
        amount: "100",
        reason: " Booking cancelled ",
        providerId: "1",
        providerOther: "x",
      }),
      "refund",
    );
    expect(payload).toMatchObject({
      amount_paise: R(100),
      refund_date: TODAY,
      refund_time: null,
      reason: "Booking cancelled",
      provider_id: null,
      provider_other: null,
    });
    expect(payload).not.toHaveProperty("payment_date");
  });
  it("PF-12: the typed app name is sent only for UPI/Card", () => {
    expect(
      buildMoneyPayload(
        form({ method: "upi", providerId: "2", providerOther: " BharatPe " }),
        "payment",
      ).payload,
    ).toMatchObject({ provider_id: 2, provider_other: "BharatPe" });
  });
  it("PF-13: an incomplete form refuses instead of sending nonsense", () => {
    expect(() =>
      buildMoneyPayload(emptyMoneyForm(BOOKING), "payment"),
    ).toThrow();
    expect(() => buildMoneyPayload(form({ amount: "0" }), "payment")).toThrow();
  });
  it("PF-14: all five methods are known", () => {
    expect([...METHODS]).toEqual(["cash", "upi", "card", "cheque", "other"]);
  });
});

describe("messages (PF-15..)", () => {
  it("PF-15: saved message, with warnings in plain words, never blocking", () => {
    expect(savedMessage("payment", R(1500), [])).toBe(
      "Payment of ₹1,500 added. Waiting for approval.",
    );
    expect(savedMessage("refund", R(2000), [])).toBe(
      "Refund of ₹2,000 recorded. Waiting for approval.",
    );
    const m = savedMessage("payment", R(1500), [
      "DUPLICATE_REFERENCE",
      "ABOVE_AMOUNT_DUE",
    ]);
    expect(m).toContain("Waiting for approval.");
    expect(m).toContain("reference number");
    expect(m).toContain("more than the amount still pending");
    expect(warningText("SOMETHING_NEW")).toBe(
      "Please check the details of this entry.",
    );
    expect(warningText("DUPLICATE_FILE")).toContain("screenshot");
    expect(warningText("ABOVE_REFUND_DUE")).toContain("refund due");
  });
  it("PF-16: refund figures come from the database view and the most refundable is never shown negative", () => {
    expect(
      refundHelp({
        approvedPaise: R(3000),
        refundsApprovedPaise: R(500),
        refundDuePaise: R(2000),
        mostPaise: R(2500),
      }),
    ).toEqual([
      "Approved ₹3,000",
      "Refunds so far ₹500",
      "Refund due ₹2,000",
      "Most you can refund: ₹2,500",
    ]);
    expect(
      refundHelp({
        approvedPaise: 0,
        refundsApprovedPaise: 0,
        refundDuePaise: 0,
        mostPaise: -5,
      })[3],
    ).toBe("Most you can refund: ₹0");
  });
});

describe("what a person may do by status (PF-17..)", () => {
  const me = "u1";
  it("PF-17: waiting: approve, reject, edit, add and hide files; no reverse, no correction", () => {
    expect(
      abilities({ status: "waiting", recordedBy: "u2", me }),
    ).toMatchObject({
      approve: true,
      reject: true,
      reverse: false,
      edit: true,
      addFiles: true,
      hideFile: true,
      correction: false,
      selfNote: null,
    });
  });
  it("PF-18: approved: only reverse and a correction file; originals stay (no hide, no edit)", () => {
    expect(
      abilities({ status: "approved", recordedBy: "u2", me }),
    ).toMatchObject({
      approve: false,
      reject: false,
      reverse: true,
      edit: false,
      addFiles: false,
      hideFile: false,
      correction: true,
    });
  });
  it("PF-19: rejected and reversed are final: nothing can be done", () => {
    for (const status of ["rejected", "reversed"] as const) {
      const a = abilities({ status, recordedBy: "u2", me });
      expect(
        Object.entries(a).filter(([k, v]) => k !== "selfNote" && v === true),
      ).toEqual([]);
    }
  });
  it("PF-20: approving your own entry is allowed and the screen says so first (Q8)", () => {
    const a = abilities({ status: "waiting", recordedBy: me, me });
    expect(a.approve).toBe(true);
    expect(a.selfNote).toBe(
      "You recorded this. It will be marked Self-approved.",
    );
    expect(
      abilities({ status: "approved", recordedBy: me, me }).selfNote,
    ).toBeNull();
  });
  it("PF-21: reasons: 5 letters, 10 for correction files; the blocked-reversal wording", () => {
    expect(reasonProblem("abcd")).toContain("at least 5");
    expect(reasonProblem("abcde")).toBeNull();
    expect(reasonProblem("123456789", MIN_CORRECTION_REASON)).toContain(
      "at least 10",
    );
    expect(reasonProblem("1234567890", MIN_CORRECTION_REASON)).toBeNull();
    expect(reasonProblem("     ")).toBeTruthy();
    expect(REVERSAL_BLOCKED_TEXT).toBe(
      "This payment cannot be reversed because refunds depend on it. Reject or reverse the refunds first.",
    );
  });
});

describe("list filters in the address (PF-22..)", () => {
  const U = "123e4567-e89b-42d3-a456-426614174000";
  it("PF-22: nothing in the address = everything, newest first, page 1", () => {
    const f = parseMoneyFilter("payment", {});
    expect(f).toMatchObject({
      kind: "payment",
      q: "",
      status: null,
      method: null,
      provider: null,
      resort: null,
      booking: null,
      dateType: "record",
      from: null,
      to: null,
      recordedBy: null,
      selfApproved: false,
      oldestFirst: false,
      page: 1,
      problem: null,
    });
    expect(activeFilterCount(f)).toBe(0);
  });
  it("PF-23: every filter is read; the queue is always Waiting and oldest first", () => {
    const f = parseMoneyFilter("refund", {
      q: "  asha  ",
      status: "approved",
      method: "upi",
      provider: "3",
      resort: U.toUpperCase(),
      booking: U,
      by: U,
      dateType: "entry",
      from: "2026-11-01",
      to: "2026-11-30",
      self: "1",
      page: "2",
    });
    expect(f).toMatchObject({
      q: "asha",
      status: "approved",
      method: "upi",
      provider: 3,
      resort: U,
      booking: U,
      recordedBy: U,
      dateType: "entry",
      from: "2026-11-01",
      to: "2026-11-30",
      selfApproved: true,
      page: 2,
      problem: null,
    });
    expect(activeFilterCount(f)).toBe(8);
    const q = parseMoneyFilter(
      "payment",
      { status: "approved" },
      { queue: true },
    );
    expect(q).toMatchObject({ status: "waiting", oldestFirst: true });
  });
  it("PF-24: nonsense falls back and says why, never throws", () => {
    expect(parseMoneyFilter("payment", { status: "gone" })).toMatchObject({
      status: null,
      problem: expect.stringContaining("status"),
    });
    expect(parseMoneyFilter("payment", { method: "barter" })).toMatchObject({
      method: null,
      problem: expect.stringContaining("method"),
    });
    expect(parseMoneyFilter("payment", { provider: "x" })).toMatchObject({
      provider: null,
      problem: expect.stringContaining("app"),
    });
    expect(parseMoneyFilter("payment", { resort: "'; drop" })).toMatchObject({
      resort: null,
      problem: expect.stringContaining("resort"),
    });
    expect(parseMoneyFilter("payment", { from: "2026-02-30" })).toMatchObject({
      from: null,
      to: null,
    });
    expect(
      parseMoneyFilter("payment", { from: "2026-11-10", to: "2026-11-01" })
        .problem,
    ).toContain("end date");
    expect(parseMoneyFilter("payment", { dateType: "x" }).problem).toContain(
      "date type",
    );
    for (const bad of ["0", "-1", "abc", ""])
      expect(parseMoneyFilter("payment", { page: bad }).page).toBe(1);
  });
  it("PF-25: the database arguments: omitted = undefined; refund lists use refund dates; page size", () => {
    const none = moneyArgs(parseMoneyFilter("payment", {}));
    expect(none).toMatchObject({
      p_date_type: "payment",
      p_oldest_first: false,
      p_limit: PAGE_SIZE,
      p_offset: 0,
    });
    for (const k of [
      "p_q",
      "p_status",
      "p_method",
      "p_provider",
      "p_resort",
      "p_booking",
      "p_from",
      "p_to",
      "p_recorded_by",
      "p_self_approved",
    ])
      expect((none as Record<string, unknown>)[k]).toBeUndefined();
    expect(moneyArgs(parseMoneyFilter("refund", {}))).toMatchObject({
      p_date_type: "refund",
    });
    expect(
      moneyArgs(
        parseMoneyFilter("refund", { dateType: "entry", page: "3", self: "1" }),
      ),
    ).toMatchObject({
      p_date_type: "entry",
      p_offset: 2 * PAGE_SIZE,
      p_self_approved: true,
    });
    expect(
      moneyArgs(parseMoneyFilter("payment", {}, { size: 500 })),
    ).toMatchObject({ p_limit: 100 });
    expect(
      moneyArgs(parseMoneyFilter("payment", {}, { size: 0 })),
    ).toMatchObject({ p_limit: 1 });
  });
  it("PF-26: addresses keep the filter and round-trip", () => {
    expect(moneyHref("/payments", parseMoneyFilter("payment", {}))).toBe(
      "/payments",
    );
    const f = parseMoneyFilter("payment", {
      q: "asha",
      status: "waiting",
      page: "2",
    });
    expect(moneyHref("/payments", f)).toBe(
      "/payments?q=asha&status=waiting&page=2",
    );
    expect(moneyHref("/payments", f, { page: 1 })).toBe(
      "/payments?q=asha&status=waiting",
    );
    expect(
      parseMoneyFilter(
        "payment",
        Object.fromEntries(
          new URL("http://x" + moneyHref("/payments", f)).searchParams,
        ),
      ),
    ).toMatchObject({ q: "asha", status: "waiting", page: 2 });
    expect([pageCount(0), pageCount(25), pageCount(26)]).toEqual([1, 1, 2]);
  });
});

describe("shrinking photos and file checks (PF-27..)", () => {
  it("PF-27: only big pictures are shrunk; PDFs and small files never", () => {
    expect(
      shouldCompress({ type: "image/jpeg", size: COMPRESS_OVER_BYTES + 1 }),
    ).toBe(true);
    expect(shouldCompress({ type: "image/png", size: 5 * 1024 * 1024 })).toBe(
      true,
    );
    expect(
      shouldCompress({ type: "image/jpeg", size: COMPRESS_OVER_BYTES }),
    ).toBe(false);
    expect(
      shouldCompress({ type: "application/pdf", size: 9 * 1024 * 1024 }),
    ).toBe(false);
    expect(shouldCompress({ type: "image/gif", size: 9 * 1024 * 1024 })).toBe(
      false,
    );
  });
  it("PF-28: the longest side becomes 1,600 pixels, the shape stays, nothing is enlarged", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: MAX_EDGE, height: 1200 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1200, height: MAX_EDGE });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1600, 1600)).toEqual({ width: 1600, height: 1600 });
    expect(fitWithin(10000, 1)).toEqual({ width: 1600, height: 1 });
    expect(fitWithin(0, 100)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(NaN, 100)).toEqual({ width: 0, height: 0 });
  });
  it("PF-29: the shrunk file is used only if it is really smaller; the original is never lost", () => {
    const o = { size: 100 };
    expect(pickSmaller(o, { size: 60 })).toEqual({ size: 60 });
    expect(pickSmaller(o, { size: 100 })).toBe(o);
    expect(pickSmaller(o, { size: 150 })).toBe(o);
    expect(pickSmaller(o, { size: 0 })).toBe(o);
    expect(pickSmaller(o, null)).toBe(o);
  });
  it("PF-30: what the browser says about a file is checked before upload (type, empty, 10 MB)", () => {
    expect(
      checkClaim({ name: "a.png", size: 100, type: "image/png" }),
    ).toMatchObject({ ok: true });
    expect(
      checkClaim({
        name: "a.exe",
        size: 100,
        type: "application/x-msdownload",
      }),
    ).toMatchObject({
      ok: false,
      message: "Use a JPG, PNG, WEBP or PDF file.",
    });
    expect(
      checkClaim({ name: "a.pdf", size: 0, type: "application/pdf" }),
    ).toMatchObject({ ok: false, message: "That file is empty." });
    expect(
      checkClaim({
        name: "a.pdf",
        size: 10 * 1024 * 1024 + 1,
        type: "application/pdf",
      }),
    ).toMatchObject({ ok: false, message: expect.stringContaining("10 MB") });
    expect(
      checkClaim({
        name: "a.pdf",
        size: 10 * 1024 * 1024,
        type: "application/pdf",
      }),
    ).toMatchObject({ ok: true });
  });
});
