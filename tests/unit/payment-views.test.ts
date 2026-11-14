import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/payments",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/payments/actions", () => ({
  addMoneyAction: vi.fn(),
  updateWaitingAction: vi.fn(),
  decideAction: vi.fn(),
  addFilesAction: vi.fn(),
  hideFileAction: vi.fn(),
  addCorrectionAction: vi.fn(),
}));
vi.mock("@/lib/storage/actions", () => ({
  prepareProofUploads: vi.fn(),
  confirmProofUploads: vi.fn(),
  proofDownloadUrl: vi.fn(),
}));

import { MoneyForm } from "@/components/app/payments/money-form";
import {
  MoneyDetailBody,
  MoneyDetailView,
  MoneyListView,
  methodText,
  tone,
} from "@/components/app/payments/money-views";
import { FileAdder, ItemActions } from "@/components/app/payments/item-actions";
import { ProofViewer } from "@/components/app/payments/proof-viewer";
import { ProofUploader } from "@/components/app/payments/proof-uploader";
import type { MoneyDetail, MoneyRow } from "@/lib/payments/data";
import { emptyMoneyForm } from "@/lib/payments/form";
import { parseMoneyFilter } from "@/lib/payments/list";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(el);
const text = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");
const R = (rupees: number) => rupees * 100;
/** is there a button or link whose WHOLE text is this word (so "Approve" is not found inside "Approved")? */
const has = (out: string, label: string) =>
  new RegExp(`>\s*${label}\s*<`).test(out);

const row = (over: Partial<MoneyRow> = {}): MoneyRow => ({
  id: "p1",
  code: "AAA-2026-000001-P1",
  bookingId: "b1",
  bookingCode: "AAA-2026-000001",
  resortId: "r1",
  guestName: "Asha Verma",
  guestMobile: "98765 43210",
  amountP: R(2000),
  method: "upi",
  providerName: "PhonePe",
  providerOther: null,
  reference: "UTR1",
  date: "2026-11-10",
  time: null,
  reason: null,
  status: "waiting",
  selfApproved: false,
  recordedBy: "u2",
  recordedByName: "Ramesh Kumar",
  recordedAt: "2026-11-10T04:00:00Z",
  decidedByName: null,
  rejectionReason: null,
  reversalReason: null,
  proofCount: 1,
  version: 1,
  ...over,
});
const names = new Map([["r1", "Resort Alpha"]]);
const ok = <T>(data: T) => ({ ok: true as const, data });

describe("payments and refunds list screens (PV-01..)", () => {
  const f = parseMoneyFilter("payment", {});
  const list = (rows: MoneyRow[], filter = f) =>
    html(
      h(MoneyListView, {
        f: filter,
        list: ok({ rows, total: rows.length }),
        resortNames: names,
        people: [{ id: "u2", name: "Ramesh Kumar" }],
        providers: [{ id: 1, name: "PhonePe", method: "upi" }],
      }),
    );
  it("PV-01: a table for tablet and up, cards for phones, with status, self-approved tag and struck-through reversed amount", () => {
    const out = list([
      row(),
      row({
        id: "p2",
        code: "AAA-2026-000001-P2",
        status: "approved",
        selfApproved: true,
      }),
      row({ id: "p3", code: "AAA-2026-000001-P3", status: "reversed" }),
      row({ id: "p4", code: "AAA-2026-000001-P4", status: "rejected" }),
    ]);
    expect(out).toContain("hidden overflow-x-auto md:block");
    expect(out).toContain("grid gap-3 md:hidden");
    const t = text(out);
    for (const w of [
      "Waiting for Approval",
      "Approved",
      "Reversed",
      "Rejected",
      "Self-approved",
      "UPI · PhonePe",
      "Resort Alpha",
      "₹2,000",
      "Ramesh Kumar",
    ])
      expect(t).toContain(w);
    expect(out).toContain("line-through");
    expect(out).toContain('href="/payments/p1"');
    expect(out).toContain('href="/bookings/b1"');
    expect(t).toContain("4 payments");
  });
  it("PV-01b: a payment or refund dated before the day it was typed in carries the Backdated tag with the day it was entered, in the table and the cards; others do not", () => {
    const out = list([
      row({ date: "2026-11-05", recordedAt: "2026-11-10T04:00:00Z" }), // typed in on the 10th (IST), dated the 5th
      row({
        id: "p2",
        code: "AAA-2026-000001-P2",
        date: "2026-11-10",
        recordedAt: "2026-11-10T04:00:00Z",
      }),
    ]);
    expect(out.match(/Backdated/g)).toHaveLength(2); // once in the table, once in the card, for the first row only
    expect(text(out)).toContain("Backdated entered 10 Nov 2026");
    const none = list([
      row({ date: "2026-11-10", recordedAt: "2026-11-10T04:00:00Z" }),
    ]);
    expect(none).not.toContain("Backdated");
  });
  it("PV-01c: the IST day decides: typed in at 00:30 IST on the 11th (still the 10th in UTC) and dated the 10th is backdated; the same moment dated the 11th is not", () => {
    const at = "2026-11-10T19:00:00Z"; // 00:30 IST on 11 November
    expect(list([row({ date: "2026-11-10", recordedAt: at })])).toContain(
      "Backdated",
    );
    expect(list([row({ date: "2026-11-11", recordedAt: at })])).not.toContain(
      "Backdated",
    );
  });
  it("PV-02: filters are a plain form with every filter the spec lists", () => {
    const out = list([row()]);
    expect(out).toContain('action="/payments"');
    expect(out).toContain('method="get"');
    for (const name of [
      "q",
      "status",
      "method",
      "provider",
      "resort",
      "by",
      "dateType",
      "from",
      "to",
      "self",
    ])
      expect(out).toContain(`name="${name}"`);
  });
  it("PV-03: refunds say Refunds, Refund and use refund wording and green/teal tone, not payment wording", () => {
    const fr = parseMoneyFilter("refund", {});
    const out = html(
      h(MoneyListView, {
        f: fr,
        list: ok({
          rows: [
            row({
              id: "r9",
              code: "AAA-2026-000001-R1",
              status: "approved",
              reason: "Booking cancelled",
            }),
          ],
          total: 1,
        }),
        resortNames: names,
        people: [],
        providers: [],
      }),
    );
    const t = text(out);
    expect(t).toContain("Refunds");
    expect(t).toContain("AAA-2026-000001-R1");
    expect(out).toContain("text-refund");
    expect(out).toContain('href="/refunds/r9"');
    expect(t).toContain("1 refund");
  });
  it("PV-04: empty, no match and failed states; a bad address shows its plain reason", () => {
    expect(text(list([]))).toContain("No payments yet");
    expect(text(list([], parseMoneyFilter("payment", { q: "zzz" })))).toContain(
      "No payments match",
    );
    expect(
      text(list([row()], parseMoneyFilter("payment", { status: "gone" }))),
    ).toContain("status is not known");
    const failed = html(
      h(MoneyListView, {
        f,
        list: { ok: false },
        resortNames: names,
        people: [],
        providers: [],
      }),
    );
    expect(failed).toContain('role="alert"');
    expect(text(failed)).toContain("could not be loaded");
  });
  it("PV-05: method wording and tones", () => {
    expect(
      methodText({ method: "cash", providerName: null, providerOther: null }),
    ).toBe("Cash");
    expect(
      methodText({
        method: "upi",
        providerName: "Other",
        providerOther: "BharatPe",
      }),
    ).toBe("UPI · BharatPe");
    expect(tone("payment", "approved")).toBe("approved");
    expect(tone("payment", "waiting")).toBe("waiting");
    expect(tone("payment", "rejected")).toBe("rejected");
    expect(tone("payment", "reversed")).toBe("reversed");
    expect(tone("refund", "approved")).toBe("refund");
    expect(tone("refund", "reversed")).toBe("reversed");
  });
});

function detail(
  over: Partial<MoneyRow> = {},
  kind: "payment" | "refund" = "payment",
  fin: Record<string, number> = {},
): MoneyDetail {
  const item = row(over);
  return {
    kind,
    item,
    providerId: 1,
    booking: {
      id: "b1",
      code: "AAA-2026-000001",
      status: "confirmed",
      resortName: "Resort Alpha",
      checkIn: "2026-11-12T08:30:00Z",
      finalP: R(5000),
    },
    financials: {
      due_paise: R(5000),
      total_collection_paise: R(2000),
      waiting_paise: R(1000),
      refunds_approved_paise: 0,
      refunds_waiting_paise: 0,
      pending_paise: R(2000),
      verified_remaining_paise: R(3000),
      refund_due_paise: 0,
      refundable_limit_paise: R(2000),
      ...fin,
    } as never,
    proofs: [
      {
        id: "f1",
        payment_id: "p1",
        refund_id: null,
        storage_path: "b1/x.jpg",
        original_file_name: "screenshot.jpg",
        mime_type: "image/jpeg",
        size_bytes: 20480,
        sha256: "a".repeat(64),
        uploaded_by: "u2",
        uploaded_at: "2026-11-10T04:00:00Z",
        is_correction: false,
        correction_reason: null,
        hidden_at: null,
        hidden_by: null,
        hidden_reason: null,
        uploadedByName: "Ramesh Kumar",
      },
      {
        id: "f2",
        payment_id: "p1",
        refund_id: null,
        storage_path: "b1/y.jpg",
        original_file_name: "later.jpg",
        mime_type: "image/jpeg",
        size_bytes: 1024,
        sha256: "b".repeat(64),
        uploaded_by: "u2",
        uploaded_at: "2026-11-11T04:00:00Z",
        is_correction: true,
        correction_reason: "Receipt found later",
        hidden_at: null,
        hidden_by: null,
        hidden_reason: null,
        uploadedByName: "Ramesh Kumar",
      },
    ] as never,
    history: [
      {
        id: 1,
        at: "2026-11-11T05:00:00Z",
        by: "Test Owner",
        from: "waiting",
        to: "approved",
        reason: null,
        self: true,
      },
    ],
    remarks: "Paid at the desk",
    otherRefunds: [
      {
        id: "r1",
        code: "AAA-2026-000001-R1",
        status: "waiting",
        amountP: R(100),
      },
    ],
  };
}
const body = (d: MoneyDetail, me = "u1") =>
  html(h(MoneyDetailBody, { d, me, nextHref: undefined }));

describe("one payment or refund (PV-06..)", () => {
  it("PV-06: waiting: the facts, Approve, Reject, Change; no Reverse; files can be added and hidden", () => {
    const out = body(detail());
    const t = text(out);
    for (const w of [
      "₹2,000",
      "UPI · PhonePe",
      "UTR1",
      "10 Nov 2026",
      "Paid at the desk",
      "Recorded by Ramesh Kumar",
      "Add more files",
    ])
      expect(t).toContain(w);
    for (const b of ["Approve", "Reject", "Change", "Hide"])
      expect(has(out, b)).toBe(true);
    expect(has(out, "Reverse")).toBe(false);
    expect(t).not.toContain("Add correction file");
    expect(out).toContain('href="/payments/p1/edit"');
  });
  it("PV-06b: the detail page shows the Backdated tag next to the payment date when it was typed in later; a refund too", () => {
    const late = text(
      body(detail({ date: "2026-11-05", recordedAt: "2026-11-10T04:00:00Z" })),
    );
    expect(late).toContain("5 Nov 2026");
    expect(late).toContain("Backdated entered 10 Nov 2026");
    const refund = text(
      body(
        detail(
          {
            date: "2026-11-05",
            recordedAt: "2026-11-10T04:00:00Z",
            reason: "Guest left early",
          },
          "refund",
        ),
      ),
    );
    expect(refund).toContain("Backdated entered 10 Nov 2026");
    expect(text(body(detail()))).not.toContain("Backdated");
  });
  it("PV-07: approving your own entry shows the orange note first (Q8); someone else's does not", () => {
    expect(text(body(detail({ recordedBy: "u1" }), "u1"))).toContain(
      "You recorded this. It will be marked Self-approved.",
    );
    expect(text(body(detail({ recordedBy: "u2" }), "u1"))).not.toContain(
      "You recorded this",
    );
  });
  it("PV-08: approved: Reverse and a correction file; originals cannot be hidden or edited; corrections are tagged and show their reason", () => {
    const out = body(
      detail({
        status: "approved",
        selfApproved: true,
        decidedByName: "Test Owner",
      }),
    );
    const t = text(out);
    expect(has(out, "Reverse")).toBe(true);
    expect(t).toContain("Add correction file");
    expect(t).toContain("The original files and the amounts will not change");
    expect(t).toContain("Added after approval");
    expect(t).toContain("Receipt found later");
    expect(t).toContain("Self-approved");
    expect(t).toContain("Approved by Test Owner");
    expect(has(out, "Hide")).toBe(false);
    expect(has(out, "Approve")).toBe(false);
    expect(has(out, "Reject")).toBe(false);
    expect(has(out, "Change")).toBe(false);
    expect(out).not.toContain("/edit");
  });
  it("PV-09: rejected and reversed: no buttons at all, the reason is shown, nothing can be added", () => {
    for (const [status, extra] of [
      ["rejected", { rejectionReason: "Wrong booking" }],
      ["reversed", { reversalReason: "Entered twice" }],
    ] as const) {
      const out = body(
        detail({ status, decidedByName: "Test Owner", ...extra }),
      );
      const t = text(out);
      expect(t).toContain(
        status === "rejected" ? "Wrong booking" : "Entered twice",
      );
      for (const b of ["Approve", "Reject", "Reverse", "Change", "Hide"])
        expect(has(out, b)).toBe(false);
      for (const w of ["Add more files", "Add correction file"])
        expect(t).not.toContain(w);
    }
  });
  it("PV-10: the booking's money box comes from the database figures and keeps the documented labels; waiting refunds change nothing", () => {
    const t = text(
      body(detail({}, "payment", { refunds_waiting_paise: R(100) })),
    );
    for (const l of [
      "Amount Due",
      "Total Collection (Approved)",
      "Waiting for Approval",
      "Refunds (Approved)",
      "Pending Amount",
      "Verified Remaining",
    ])
      expect(t).toContain(l);
    expect(t).toContain("₹5,000");
    expect(t).toContain("Refunds waiting for approval ₹100");
    expect(t).toContain("They do not change the numbers above");
  });
  it("PV-11: history lists who decided, whether it was self-approved, and the reason", () => {
    const t = text(body(detail({ status: "approved" })));
    expect(t).toContain("Test Owner approved it (Self-approved).");
  });
  it("PV-12: a refund page shows its reason and refund wording", () => {
    const d = detail(
      {
        id: "r1",
        code: "AAA-2026-000001-R1",
        reason: "Booking cancelled",
        status: "approved",
      },
      "refund",
    );
    const t = text(body(d));
    expect(t).toContain("Booking cancelled");
    expect(t).toContain("Refund date");
    expect(t).toContain("Refund proof");
  });
  it("PV-13: the page: saved banner and plain warnings", () => {
    const out = html(
      h(MoneyDetailView, {
        d: detail(),
        me: "u1",
        saved: true,
        warnings: ["DUPLICATE_REFERENCE", "DUPLICATE_FILE"],
      }),
    );
    const t = text(out);
    expect(t).toContain(
      "Payment AAA-2026-000001-P1 saved. It is waiting for approval.",
    );
    expect(t).toContain(
      "Another payment or refund already uses this reference number",
    );
    expect(t).toContain("screenshot was already used");
    expect(
      text(
        html(
          h(MoneyDetailView, {
            d: detail(),
            me: "u1",
            saved: false,
            warnings: [],
          }),
        ),
      ),
    ).not.toContain("saved.");
  });
});

describe("the buttons and file tools (PV-14..)", () => {
  it("PV-14: ItemActions renders nothing for decided items", () => {
    for (const status of ["rejected", "reversed"] as const) {
      expect(
        html(
          h(ItemActions, {
            kind: "payment",
            id: "p1",
            version: 2,
            status,
            recordedBy: "u2",
            me: "u1",
            amountP: 100,
            code: "P1",
          }),
        ),
      ).toBe("");
    }
  });
  it("PV-15: FileAdder: nothing for rejected/reversed; correction wording for approved; limit message at five files", () => {
    for (const status of ["rejected", "reversed"] as const)
      expect(
        html(
          h(FileAdder, {
            kind: "payment",
            id: "p1",
            bookingId: "b1",
            status,
            visibleCount: 0,
          }),
        ),
      ).toBe("");
    expect(
      text(
        html(
          h(FileAdder, {
            kind: "payment",
            id: "p1",
            bookingId: "b1",
            status: "approved",
            visibleCount: 3,
          }),
        ),
      ),
    ).toContain("Reason (at least 10 letters)");
    expect(
      text(
        html(
          h(FileAdder, {
            kind: "payment",
            id: "p1",
            bookingId: "b1",
            status: "waiting",
            visibleCount: 5,
          }),
        ),
      ),
    ).toContain("already has 5 files");
    expect(
      text(
        html(
          h(FileAdder, {
            kind: "refund",
            id: "r1",
            bookingId: "b1",
            status: "waiting",
            visibleCount: 2,
          }),
        ),
      ),
    ).toContain("Add more files");
  });
  it("PV-16: ProofViewer: View for every file, Hide only on waiting items, hidden and correction tags; empty state", () => {
    const proofs = [
      {
        id: "f1",
        name: "a.jpg",
        mime: "image/jpeg",
        sizeBytes: 2048,
        uploadedAt: "2026-11-10T04:00:00Z",
        uploadedByName: "Ramesh Kumar",
        isCorrection: false,
        correctionReason: null,
        hidden: false,
        hiddenReason: null,
      },
      {
        id: "f2",
        name: "b.pdf",
        mime: "application/pdf",
        sizeBytes: 2048,
        uploadedAt: "2026-11-10T04:00:00Z",
        uploadedByName: null,
        isCorrection: true,
        correctionReason: "Found later on",
        hidden: false,
        hiddenReason: null,
      },
      {
        id: "f3",
        name: "c.jpg",
        mime: "image/jpeg",
        sizeBytes: 2048,
        uploadedAt: "2026-11-10T04:00:00Z",
        uploadedByName: "X",
        isCorrection: false,
        correctionReason: null,
        hidden: true,
        hiddenReason: "Wrong picture",
      },
    ];
    const waiting = text(
      html(
        h(ProofViewer, {
          proofs,
          itemKind: "payment",
          itemId: "p1",
          canHide: true,
        }),
      ),
    );
    expect(waiting.match(/View/g)!.length).toBe(3);
    expect(waiting.match(/Hide/g)!.length).toBe(1); // only the first (not hidden, not a correction)
    expect(waiting).toContain("Added after approval");
    expect(waiting).toContain("Hidden because: Wrong picture");
    const approved = text(
      html(
        h(ProofViewer, {
          proofs,
          itemKind: "payment",
          itemId: "p1",
          canHide: false,
        }),
      ),
    );
    expect(approved).not.toMatch(/\bHide\b(?! because)/);
    expect(
      text(
        html(
          h(ProofViewer, {
            proofs: [],
            itemKind: "payment",
            itemId: "p1",
            canHide: false,
          }),
        ),
      ),
    ).toContain("No files");
  });
  it("PV-17: ProofUploader: accepted types, limits and the label with Required/Optional", () => {
    const out = html(
      h(ProofUploader, {
        kind: "payment",
        bookingId: "b1",
        label: "Payment screenshot or receipt (required)",
        files: [],
        onChange: () => undefined,
      }),
    );
    expect(out).toContain(
      'accept="image/jpeg,image/png,image/webp,application/pdf"',
    );
    expect(text(out)).toContain("up to 10 MB each, at most 5 files");
    expect(text(out)).toContain("(required)");
    const withFiles = html(
      h(ProofUploader, {
        kind: "payment",
        bookingId: "b1",
        label: "x",
        files: [
          {
            key: "k",
            storage_path: "b1/x.png",
            original_file_name: "shot.png",
            mime_type: "image/png",
            size_bytes: 4096,
            sha256: "a".repeat(64),
          },
        ],
        onChange: () => undefined,
      }),
    );
    expect(text(withFiles)).toContain("shot.png");
    expect(withFiles).toContain('aria-label="Remove shot.png"');
  });
});

describe("Add / change forms (PV-18..)", () => {
  const info = {
    id: "b1",
    code: "AAA-2026-000001",
    guestName: "Asha Verma",
    resortName: "Resort Alpha",
    statusText: "Confirmed",
    pendingPaise: R(3500),
    refund: {
      approvedPaise: R(3000),
      refundsApprovedPaise: R(500),
      refundDuePaise: R(2000),
      mostPaise: R(2500),
    },
  };
  const providers = [
    { id: 1, name: "PhonePe", method: "upi" as const, active: true },
  ];
  const form = (
    kind: "payment" | "refund",
    mode: "create" | "edit" = "create",
  ) =>
    html(
      h(MoneyForm, {
        kind,
        mode,
        booking: info,
        providers,
        initial: emptyMoneyForm("b1", "2026-11-12"),
        today: "2026-11-12",
        edit: mode === "edit" ? { id: "p1", version: 2 } : undefined,
      }),
    );
  it("PV-18: Add Payment: the booking at the top, a 'Fill pending' helper, five method buttons, today as the date limit, proof Required/Optional label, 44 px fields", () => {
    const out = form("payment");
    const t = text(out);
    expect(t).toContain("AAA-2026-000001");
    expect(t).toContain("Pending Amount ₹3,500");
    expect(t).toContain("Fill pending ₹3,500");
    for (const m of ["Cash", "UPI", "Card", "Cheque", "Other"])
      expect(t).toContain(m);
    expect(out).toContain('max="2026-11-12"');
    expect(t).toContain("Payment screenshot or receipt (optional)"); // no method chosen yet
    expect(t).toContain("Add Payment");
    expect(out).toContain("min-h-11");
    expect(out).toContain("min-h-12");
  });
  it("PV-19: Add Refund: the four figures from the database, the most you can refund, quick reasons, the reason box", () => {
    const t = text(form("refund"));
    for (const w of [
      "Approved ₹3,000",
      "Refunds so far ₹500",
      "Refund due ₹2,000",
      "Most you can refund: ₹2,500",
      "Booking cancelled",
      "Guest paid extra",
      "Reason for the refund",
      "Add Refund",
    ])
      expect(t).toContain(w);
    expect(t).toContain("Fill the most you can refund ₹2,500");
    expect(t).not.toContain("Fill pending");
  });
  it("PV-20: change a waiting item: needs a reason, files are managed on the item page, button says Save changes", () => {
    const t = text(form("payment", "edit"));
    expect(t).toContain("Why are you changing it?");
    expect(t).toContain("Files are added or hidden on the payment page");
    expect(t).toContain("Save changes");
    expect(t).not.toContain("Fill pending");
  });
});
