import { describe, expect, it } from "vitest";
import {
  buildTimeline,
  describeBookingEvent,
  type AuditEvent,
} from "@/lib/bookings/history";
import {
  PAGE_SIZE,
  activeFilterCount,
  cleanSearch,
  listArgs,
  listHref,
  pageCount,
  parseBookingFilter,
} from "@/lib/bookings/list";

const RESORT = "123e4567-e89b-42d3-a456-426614174000";

describe("bookings list filter in the address (LST-U1..)", () => {
  it("LST-U1: nothing in the address = everything, newest first, page 1, no complaint", () => {
    const f = parseBookingFilter({});
    expect(f).toMatchObject({
      q: "",
      resort: null,
      status: null,
      dateType: "booking",
      from: null,
      to: null,
      coCategory: null,
      method: null,
      page: 1,
      problem: null,
    });
    expect(activeFilterCount(f)).toBe(0);
  });
  it("LST-U2: every filter is read", () => {
    const f = parseBookingFilter({
      q: "  asha   verma ",
      resort: RESORT.toUpperCase(),
      status: "cancelled",
      dateType: "check_in",
      from: "2026-11-01",
      to: "2026-11-30",
      co: "4",
      method: "per_person_per_night",
      pending: "1",
      waiting: "1",
      refund: "1",
      adjusted: "1",
      page: "3",
    });
    expect(f).toMatchObject({
      q: "asha verma",
      resort: RESORT,
      status: "cancelled",
      dateType: "check_in",
      from: "2026-11-01",
      to: "2026-11-30",
      coCategory: 4,
      method: "per_person_per_night",
      hasPending: true,
      hasWaiting: true,
      refundDue: true,
      adjusted: true,
      page: 3,
      problem: null,
    });
    expect(activeFilterCount(f)).toBe(9); // resort, status, dates, C/O, method and the four "show only" boxes
  });
  it("LST-U3: nonsense falls back to the default and says why, never throws", () => {
    expect(parseBookingFilter({ resort: "x'; drop table" })).toMatchObject({
      resort: null,
      problem: expect.stringContaining("resort"),
    });
    expect(parseBookingFilter({ status: "gone" })).toMatchObject({
      status: null,
      problem: expect.stringContaining("status"),
    });
    expect(parseBookingFilter({ dateType: "birthday" })).toMatchObject({
      dateType: "booking",
      problem: expect.stringContaining("date type"),
    });
    expect(parseBookingFilter({ from: "2026-02-30" })).toMatchObject({
      from: null,
      to: null,
      problem: expect.stringContaining("not valid"),
    });
    expect(
      parseBookingFilter({ from: "2026-11-10", to: "2026-11-01" }),
    ).toMatchObject({
      from: null,
      to: null,
      problem: expect.stringContaining("end date"),
    });
    expect(parseBookingFilter({ co: "abc" })).toMatchObject({
      coCategory: null,
      problem: expect.stringContaining("C/O"),
    });
    expect(parseBookingFilter({ method: "x" })).toMatchObject({
      method: null,
      problem: expect.stringContaining("pricing"),
    });
    for (const bad of ["0", "-1", "abc", "1e3", ""])
      expect(parseBookingFilter({ page: bad }).page).toBe(1);
  });
  it("LST-U4: the first value of a repeated parameter is used; 'all' means no filter", () => {
    expect(
      parseBookingFilter({ status: ["checked_in", "cancelled"] }).status,
    ).toBe("checked_in");
    expect(
      parseBookingFilter({
        resort: "all",
        status: "all",
        co: "all",
        method: "all",
      }),
    ).toMatchObject({
      resort: null,
      status: null,
      coCategory: null,
      method: null,
      problem: null,
    });
  });
  it("LST-U5: search text is trimmed, single-spaced and cut at 100 letters", () => {
    expect(cleanSearch("  a   b  ")).toBe("a b");
    expect(cleanSearch(undefined)).toBe("");
    expect(cleanSearch("x".repeat(500))).toHaveLength(100);
  });
  it("LST-U6: the database arguments: omitted = undefined, flags only when on, page size 25", () => {
    const none = listArgs(parseBookingFilter({}));
    expect(none).toMatchObject({
      p_date_type: "booking",
      p_limit: PAGE_SIZE,
      p_offset: 0,
    });
    for (const k of [
      "p_q",
      "p_resort",
      "p_status",
      "p_from",
      "p_to",
      "p_co_category",
      "p_method",
      "p_has_pending",
      "p_has_waiting",
      "p_refund_due",
      "p_adjusted",
    ]) {
      expect((none as Record<string, unknown>)[k]).toBeUndefined();
    }
    const some = listArgs(
      parseBookingFilter({
        q: "asha",
        pending: "1",
        page: "3",
        status: "no_show",
        co: "2",
      }),
    );
    expect(some).toMatchObject({
      p_q: "asha",
      p_has_pending: true,
      p_offset: 2 * PAGE_SIZE,
      p_status: "no_show",
      p_co_category: 2,
    });
    expect(some.p_has_waiting).toBeUndefined();
  });
  it("LST-U7: addresses keep the filter and write only what differs from the default", () => {
    expect(listHref(parseBookingFilter({}))).toBe("/bookings");
    const f = parseBookingFilter({ q: "asha", status: "cancelled", page: "2" });
    expect(listHref(f)).toBe("/bookings?q=asha&status=cancelled&page=2");
    expect(listHref(f, { page: 1 })).toBe("/bookings?q=asha&status=cancelled");
    // what the address gives back is what was put in
    expect(
      parseBookingFilter(
        Object.fromEntries(new URL("http://x" + listHref(f)).searchParams),
      ),
    ).toMatchObject({ q: "asha", status: "cancelled", page: 2 });
  });
  it("LST-U8: page count", () => {
    expect([
      pageCount(0),
      pageCount(1),
      pageCount(25),
      pageCount(26),
      pageCount(100),
    ]).toEqual([1, 1, 1, 2, 4]);
  });
});

let n = 0;
const ev = (over: Partial<AuditEvent>): AuditEvent => ({
  id: ++n,
  occurred_at: "2026-11-12T08:30:00Z",
  actor_name: "Ramesh Kumar",
  action: "update",
  table_name: "bookings",
  changed_fields: [],
  old_data: {},
  new_data: {},
  reason: null,
  ...over,
});
const say = (e: AuditEvent) => describeBookingEvent(e)?.text ?? null;

describe("booking history in plain English (HIS-U1..)", () => {
  it("HIS-U1: created", () => {
    expect(say(ev({ action: "insert" }))).toBe(
      "Ramesh Kumar created the booking.",
    );
    expect(say(ev({ action: "insert", actor_name: null }))).toBe(
      "The system created the booking.",
    );
  });
  it("HIS-U2: check-in, check-out and undoing a step with its reason", () => {
    expect(
      say(
        ev({
          changed_fields: ["status"],
          old_data: { status: "confirmed" },
          new_data: { status: "checked_in" },
        }),
      ),
    ).toBe("Ramesh Kumar changed the status from Confirmed to Checked-in.");
    expect(
      say(
        ev({
          changed_fields: ["status"],
          old_data: { status: "checked_in" },
          new_data: { status: "confirmed" },
          reason: "Marked by mistake",
        }),
      ),
    ).toBe(
      "Ramesh Kumar changed the status from Checked-in to Confirmed (undone). Reason: Marked by mistake",
    );
  });
  it("HIS-U3: cancelled and no-show with the charge and the reason", () => {
    const t = say(
      ev({
        changed_fields: ["status", "cancellation_charge_paise"],
        old_data: { status: "confirmed" },
        new_data: {
          status: "cancelled",
          cancellation_charge_paise: 100000,
          cancellation_reason: "Guest cancelled",
        },
      }),
    );
    expect(t).toBe(
      "Ramesh Kumar marked the booking as Cancelled. Cancellation charge ₹1,000. Reason: Guest cancelled",
    );
    expect(
      say(
        ev({
          changed_fields: ["status"],
          old_data: { status: "confirmed" },
          new_data: { status: "no_show", cancellation_charge_paise: 500000 },
        }),
      ),
    ).toContain("No-show");
  });
  it("HIS-U4: a charge correction", () => {
    expect(
      say(
        ev({
          changed_fields: ["cancellation_charge_paise", "charge_change_reason"],
          old_data: { cancellation_charge_paise: 100000 },
          new_data: {
            cancellation_charge_paise: 50000,
            charge_change_reason: "Goodwill",
          },
        }),
      ),
    ).toBe(
      "Ramesh Kumar changed the cancellation charge from ₹1,000 to ₹500. Reason: Goodwill",
    );
  });
  it("HIS-U5: edits list what changed in words, hide internal columns, show the new Amount Due", () => {
    const t = say(
      ev({
        changed_fields: [
          "pax",
          "discount_paise",
          "final_amount_paise",
          "amount_due_paise",
          "co_mode",
        ],
        old_data: { amount_due_paise: 500000 },
        new_data: { amount_due_paise: 450000 },
        reason: "Guest asked",
      }),
    );
    expect(t).toBe(
      "Ramesh Kumar changed the number of people and the discount. The Amount Due changed from ₹5,000 to ₹4,500. Reason: Guest asked",
    );
    expect(
      say(ev({ changed_fields: ["check_in_at", "check_out_at", "nights"] })),
    ).toBe("Ramesh Kumar changed the check-in, the check-out and the nights.");
    expect(
      say(ev({ changed_fields: ["base_amount_paise", "co_mode"] })),
    ).toBeNull(); // only internal columns
  });
  it("HIS-U6: plan versions and adjustments", () => {
    expect(
      say(
        ev({
          table_name: "payment_plan_revisions",
          action: "insert",
          new_data: { source: "created", revision_no: 1 },
        }),
      ),
    ).toBe("Ramesh Kumar set the first payment plan.");
    expect(
      say(
        ev({
          table_name: "payment_plan_revisions",
          action: "insert",
          new_data: {
            source: "amount_change",
            revision_no: 2,
            reason: "Discount",
          },
        }),
      ),
    ).toBe(
      "Ramesh Kumar updated the payment plan because the amount changed (plan version 2). Reason: Discount",
    );
    expect(
      say(
        ev({
          table_name: "payment_plan_revisions",
          action: "insert",
          new_data: { source: "move_overdue", revision_no: 3 },
        }),
      ),
    ).toContain("moved an overdue amount");
    expect(
      say(
        ev({
          table_name: "expected_adjustments",
          action: "insert",
          new_data: { amount_paise: -100000, reason: "Discount" },
        }),
      ),
    ).toBe(
      "The amount expected today was reduced by ₹1,000 (an adjustment). Reason: Discount",
    );
  });
  it("HIS-U7: payments and refunds", () => {
    expect(
      say(
        ev({
          table_name: "payments",
          action: "insert",
          new_data: { amount_paise: 200000 },
        }),
      ),
    ).toBe(
      "Ramesh Kumar added a payment of ₹2,000. It is waiting for approval.",
    );
    expect(
      say(
        ev({
          table_name: "payments",
          changed_fields: ["status"],
          new_data: { amount_paise: 200000, status: "approved" },
        }),
      ),
    ).toBe("Ramesh Kumar approved the payment of ₹2,000.");
    expect(
      say(
        ev({
          table_name: "refunds",
          changed_fields: ["status"],
          new_data: {
            amount_paise: 50000,
            status: "rejected",
            rejection_reason: "Wrong booking",
          },
        }),
      ),
    ).toBe("Ramesh Kumar rejected the refund of ₹500. Reason: Wrong booking");
  });
  it("HIS-U8: rows that only repeat others are left out", () => {
    for (const t of [
      "payment_schedules",
      "proofs",
      "booking_pdf_versions",
      "guests",
    ])
      expect(say(ev({ table_name: t, action: "insert" }))).toBeNull();
    expect(
      say(ev({ table_name: "payment_plan_revisions", action: "update" })),
    ).toBeNull();
    expect(say(ev({ action: "delete" }))).toBeNull();
  });
  it("HIS-U9: the timeline is newest first and skips hidden rows", () => {
    const rows = [
      ev({ id: 1, action: "insert" }),
      ev({ id: 2, table_name: "proofs", action: "insert" }),
      ev({ id: 3, changed_fields: ["pax"] }),
    ];
    expect(buildTimeline(rows).map((r) => r.id)).toEqual([3, 1]);
  });
});
