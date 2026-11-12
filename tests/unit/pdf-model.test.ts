import { describe, expect, it } from "vitest";
import { sample } from "../shared/pdf-sample";
import {
  DISCLAIMER,
  PdfDataError,
  buildModel,
  downloadName,
  generatedText,
  istText,
  parsePdfData,
  type PdfData,
} from "@/lib/pdf/model";

const R = (rupees: number) => rupees * 100;

const AT = new Date("2026-11-12T10:35:00Z"); // 4:05 PM in India
const model = (d: PdfData = sample(), version = 1) =>
  buildModel(d, { version, generatedAt: AT });
const pairs = (rows: { label: string; value: string }[]) =>
  Object.fromEntries(rows.map((r) => [r.label, r.value]));

describe("what the data must look like (PM-01..)", () => {
  it("PM-01: the database's JSON is accepted, and anything else is refused without echoing booking data", () => {
    expect(parsePdfData(sample()).booking.code).toBe("AAA-2026-000001");
    for (const bad of [
      null,
      "text",
      {},
      { ...sample(), booking: { ...sample().booking, final_paise: 1.5 } },
      { ...sample(), payments: [{ code: "x" }] },
      { ...sample(), totals: undefined },
      { ...sample(), booking: { ...sample().booking, status: "gone" } },
    ]) {
      expect(() => parsePdfData(bad)).toThrow(PdfDataError);
    }
    try {
      parsePdfData({
        ...sample(),
        guest: { name: 42, mobile: "SECRET-NUMBER" },
      });
    } catch (e) {
      expect(String((e as Error).message)).not.toMatch(/SECRET|Asha|9876/);
    }
  });
});

describe("the page content (PM-02..)", () => {
  it("PM-02: header: resort, Booking ID, status, version and the generation time in India time, whatever the computer's zone", () => {
    const m = model();
    expect(m).toMatchObject({
      resortName: "Test Resort Alpha",
      code: "AAA-2026-000001",
      statusLabel: "Confirmed",
      version: 1,
      cancelled: false,
    });
    expect(m.generatedLine).toBe(
      "Version 1 · Generated 12 Nov 2026, 4:05 PM IST",
    );
    expect(model(sample(), 7).generatedLine).toContain("Version 7");
    expect(generatedText(new Date("2026-11-11T20:00:00Z"))).toBe(
      "12 Nov 2026, 1:30 AM IST",
    ); // across midnight in India
    expect(generatedText(new Date("2026-03-01T18:29:00Z"))).toBe(
      "1 Mar 2026, 11:59 PM IST",
    );
  });
  it("PM-03: guest, C/O, stay: PAX, nights, IST dates and times (12-hour)", () => {
    const m = model();
    expect(pairs(m.guestBlock)).toEqual({
      Guest: "Asha Verma",
      Mobile: "9876543210",
      "People (PAX)": "2",
      "C/O": "Direct",
    });
    expect(pairs(m.stayBlock)).toEqual({
      "Stay type": "Resort Stay",
      "Booking date": "4 Nov 2026",
      "Check-in": "15 Nov 2026, 2:00 PM",
      "Check-out": "16 Nov 2026, 11:00 AM",
      Nights: "1",
    });
    expect(
      pairs(
        model(
          sample({
            booking: {
              ...sample().booking,
              co_category: "Agent",
              co_name: "Test Agent",
            },
          }),
        ).guestBlock,
      )["C/O"],
    ).toBe("Agent – Test Agent");
  });
  it("PM-04: times at the edges of the day", () => {
    expect(istText("2026-11-15T00:30")).toBe("15 Nov 2026, 12:30 AM");
    expect(istText("2026-11-15T12:00")).toBe("15 Nov 2026, 12:00 PM");
    expect(istText("2026-11-15T23:59")).toBe("15 Nov 2026, 11:59 PM");
    expect(istText("2026-11-15")).toBe("15 Nov 2026");
    expect(istText("nonsense")).toBe("—");
    expect(istText("")).toBe("—");
  });
  it("PM-05: the amount block: pricing method, tariff, base with its sum, extra with its note, total, discount, the hand change with its reason, and the final amount", () => {
    const m = model();
    expect(pairs(m.amountBlock)).toEqual({
      "Pricing method": "Per person per stay",
      "Tariff per person": "₹2,500",
      "Base amount (2 × ₹2,500)": "₹5,000",
      "Extra charges (Bonfire)": "₹500",
      "Total Amount": "₹5,500",
      Discount: "₹300",
      "Final amount changed by hand (Regular guest)": "−₹200",
    });
    expect(m.finalLine).toEqual({
      label: "Final Booking Amount",
      value: "₹5,000",
    });
    expect(m.remarks).toBe("Late arrival");
  });
  it("PM-06: per-night wording, no hand change when it is zero, no extra note, no remarks", () => {
    const b = {
      ...sample().booking,
      pricing_method: "per_person_per_night" as const,
      nights: 3,
      adjustment_paise: 0,
      adjustment_reason: null,
      extra_note: null,
      remarks: null,
    };
    const m = model(sample({ booking: b }));
    const p = pairs(m.amountBlock);
    expect(p["Base amount (2 × ₹2,500 × 3 nights)"]).toBe("₹5,000");
    expect(p["Extra charges"]).toBe("₹500");
    expect(
      Object.keys(p).some((k) => k.startsWith("Final amount changed")),
    ).toBe(false);
    expect(m.remarks).toBeNull();
    expect(
      pairs(model(sample({ booking: { ...b, nights: 1 } })).amountBlock)[
        "Base amount (2 × ₹2,500 × 1 night)"
      ],
    ).toBe("₹5,000");
    expect(
      pairs(
        model(
          sample({
            booking: { ...b, adjustment_paise: 5000, adjustment_reason: null },
          }),
        ).amountBlock,
      )["Final amount changed by hand"],
    ).toBe("₹50"); // a rise has no minus
  });
  it("PM-07: Indian grouping and exact paise, never a rounded or recalculated figure", () => {
    const d = sample();
    d.booking.final_paise = 15000000;
    d.totals.amount_due_paise = 15000000;
    d.totals.pending_paise = 250050;
    const m = model(d);
    expect(m.finalLine.value).toBe("₹1,50,000");
    expect(pairs(m.totals)["Pending Amount"]).toBe("₹2,500.50");
  });
});

describe("plan, payments, refunds (PM-08..)", () => {
  it("PM-08: the plan lists the active rows including rows already due; Expected Adjustments only when there are some", () => {
    const m = model();
    expect(m.plan.rows).toEqual([
      ["Advance", "5 Nov 2026", "₹2,000"],
      ["Balance", "15 Nov 2026", "₹3,000"],
    ]);
    expect(m.adjustments).toBeNull();
    const a = model(
      sample({
        adjustments: [
          { date: "2026-11-09", amount_paise: -R(1000), reason: "Discount" },
        ],
      }),
    );
    expect(a.adjustments?.rows).toEqual([
      ["9 Nov 2026", "−₹1,000", "Discount"],
    ]);
    expect(model(sample({ plan: [] })).plan.rows).toEqual([]);
    expect(model().plan.empty).toBe("No payment plan rows.");
  });
  it("PM-09: payments: amount, method and app, date, status in words, the Self-approved mark only on approved items", () => {
    const rows = model().payments.rows;
    expect(rows).toEqual([
      ["AAA-2026-000001-P1", "₹1,000", "Cash", "6 Nov 2026", "Approved"],
      [
        "AAA-2026-000001-P2",
        "₹2,000",
        "UPI · PhonePe",
        "7 Nov 2026",
        "Waiting for Approval",
      ],
      ["AAA-2026-000001-P3", "₹500", "Cash", "8 Nov 2026", "Rejected"],
      [
        "AAA-2026-000001-P4",
        "₹300",
        "Cash",
        "9 Nov 2026",
        "Approved · Self-approved",
      ],
    ]);
    const d = sample();
    d.payments = [
      { ...d.payments[2], self_approved: true },
      { ...d.payments[1], status: "reversed", self_approved: true },
    ];
    expect(model(d).payments.rows.map((r) => r[4])).toEqual([
      "Rejected",
      "Reversed",
    ]);
  });
  it("PM-10: refunds: a separate table; none = a plain sentence", () => {
    expect(model().refunds.rows).toEqual([]);
    expect(model().refunds.empty).toBe("No refunds.");
    const d = sample();
    d.refunds = [
      {
        code: "AAA-2026-000001-R1",
        amount_paise: R(100),
        method: "cheque",
        provider: null,
        date: "2026-11-11",
        status: "approved",
        self_approved: false,
        reason: "Booking cancelled",
      },
    ];
    expect(model(d).refunds.rows).toEqual([
      ["AAA-2026-000001-R1", "₹100", "Cheque", "11 Nov 2026", "Approved"],
    ]);
    expect(model().payments.empty).toBe("No payments yet.");
  });
  it("PM-11: correction files: 'Added after approval', the date, the person, the record and the reason (Q9a)", () => {
    expect(model().corrections).toEqual([
      "Added after approval on 10 Nov 2026 by Test Manager Two (AAA-2026-000001-P1): Receipt found later",
    ]);
    const d = sample();
    d.corrections = [
      {
        record_code: null,
        kind: "refund",
        file_name: null,
        date: "2026-11-10",
        by: null,
        reason: null,
      },
    ];
    expect(model(d).corrections[0]).toBe(
      "Added after approval on 10 Nov 2026 by —: —",
    );
    expect(model(sample({ corrections: [] })).corrections).toEqual([]);
  });
});

describe("cancelled bookings and totals (PM-12..)", () => {
  const cancelled = (): PdfData => {
    const d = sample();
    d.booking.status = "cancelled";
    d.cancellation = {
      kind: "cancelled",
      date: "2026-11-11",
      reason: "Guest cancelled",
      charge_paise: R(1000),
      original_final_paise: R(5000),
      charge_change_reason: null,
    };
    d.totals = {
      ...d.totals,
      amount_due_paise: R(1000),
      pending_paise: 0,
      extra_paise: 0,
      refund_due_paise: R(300),
    };
    return d;
  };
  it("PM-12: the cancellation block shows the charge as the Amount Due with the original amount separately; the final line is relabelled", () => {
    const m = model(cancelled());
    expect(m.cancelled).toBe(true);
    expect(m.statusLabel).toBe("Cancelled");
    expect(pairs(m.cancellationBlock!)).toEqual({
      "Cancelled on": "11 Nov 2026",
      Reason: "Guest cancelled",
      "Cancellation Charge (Amount Due)": "₹1,000",
      "Original Booking Amount": "₹5,000",
    });
    expect(m.finalLine).toEqual({
      label: "Original Booking Amount",
      value: "₹5,000",
    });
    expect(pairs(m.totals)["Amount Due (Cancellation Charge)"]).toBe("₹1,000");
  });
  it("PM-13: no-show wording and a changed charge with its reason", () => {
    const d = cancelled();
    d.booking.status = "no_show";
    d.cancellation = {
      ...d.cancellation!,
      kind: "no_show",
      charge_change_reason: "Guest was ill",
    };
    const m = model(d);
    expect(m.statusLabel).toBe("No-show");
    expect(pairs(m.cancellationBlock!)["Marked as No-show on"]).toBe(
      "11 Nov 2026",
    );
    expect(pairs(m.cancellationBlock!)["Why the charge was changed"]).toBe(
      "Guest was ill",
    );
  });
  it("PM-14: totals are the database's figures, in the documented order and words; Extra Payment, Refund due and waiting refunds only when there are some", () => {
    expect(model().totals.map((t) => t.label)).toEqual([
      "Amount Due",
      "Total Collection (Approved)",
      "Waiting for Approval",
      "Refunds (Approved)",
      "Net Collection",
      "Pending Amount",
    ]);
    expect(pairs(model().totals)).toMatchObject({
      "Amount Due": "₹5,000",
      "Total Collection (Approved)": "₹1,300",
      "Waiting for Approval": "₹2,000",
      "Refunds (Approved)": "₹0",
      "Net Collection": "₹1,300",
      "Pending Amount": "₹1,700",
    });
    const d = sample();
    d.totals = {
      ...d.totals,
      extra_paise: R(200),
      refund_due_paise: R(200),
      refunds_waiting_paise: R(150),
    };
    const labels = model(d).totals.map((t) => t.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        "Extra Payment",
        "Refund due",
        "Refunds waiting for approval (not counted above)",
      ]),
    );
    expect(pairs(model(d).totals)["Extra Payment"]).toBe("₹200");
  });
  it("PM-15: the footer is the documented disclaimer, word for word", () => {
    expect(model().footer).toBe(
      "Internal booking and payment statement. This is not a tax invoice. Amounts marked 'Waiting for Approval' are not yet verified.",
    );
    expect(DISCLAIMER).toBe(model().footer);
  });
});

describe("missing and long values (PM-16..)", () => {
  it("PM-16: missing optional values are left out or shown as a dash, never 'null' or 'undefined'", () => {
    const d = sample();
    d.booking = {
      ...d.booking,
      co_name: null,
      extra_note: null,
      adjustment_reason: null,
      remarks: "   ",
      stay_type: "",
    };
    d.guest = { name: "", mobile: "" };
    const m = model(d);
    const strings: string[] = [];
    JSON.stringify(m, (_k, v) => (typeof v === "string" && strings.push(v), v)); // every printed string
    expect(
      strings.filter((t) => /null|undefined|NaN|\[object/.test(t)),
    ).toEqual([]);
    expect(pairs(m.guestBlock).Guest).toBe("—");
    expect(pairs(m.stayBlock)["Stay type"]).toBe("—");
    expect(m.remarks).toBeNull();
  });
  it("PM-17: long text is kept whole (the page wraps it)", () => {
    const name = "Ramachandra ".repeat(30).trim();
    const d = sample();
    d.guest.name = name;
    d.booking.remarks = "x".repeat(900);
    d.booking.extra_note = "y".repeat(200);
    const m = model(d);
    expect(pairs(m.guestBlock).Guest).toBe(name);
    expect(m.remarks).toHaveLength(900);
    expect(
      m.amountBlock.find((r) => r.label.startsWith("Extra charges"))!.label,
    ).toContain("y".repeat(200));
  });
  it("PM-18: download names contain only safe characters", () => {
    expect(downloadName("AAA-2026-000001", 2)).toBe("AAA-2026-000001-v2.pdf");
    expect(downloadName("../../etc/passwd", 1)).toBe("..-..-etc-passwd-v1.pdf");
    expect(downloadName('a b\\c"d', 3)).toBe("a-b-c-d-v3.pdf");
    expect(downloadName("", 0)).toBe("booking-v1.pdf");
    expect(downloadName("x".repeat(100), 1)).toHaveLength(
      60 + "-v1.pdf".length,
    );
    expect(downloadName("AAA", 1.9)).toBe("AAA-v1.pdf");
  });
});
