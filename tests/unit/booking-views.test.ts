import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/bookings",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/bookings/actions", () => ({
  cancelBookingAction: vi.fn(),
  changeChargeAction: vi.fn(),
  changePlanAction: vi.fn(),
  setStatusAction: vi.fn(),
  planPreviewAction: vi.fn(),
  createBookingAction: vi.fn(),
  updateBookingAction: vi.fn(),
  findGuestsAction: vi.fn(async () => []),
  quickAddCoEntryAction: vi.fn(),
  saveGuestAction: vi.fn(),
  saveProviderAction: vi.fn(),
}));

import { BookingListView } from "@/components/app/bookings/booking-list-view";
import { BookingView, parseTab } from "@/components/app/bookings/booking-view";
import { BookingForm } from "@/components/app/bookings/booking-form";
import {
  GuestDetailView,
  GuestListView,
  guestTotals,
  parseGuestQuery,
} from "@/components/app/bookings/guest-views";
import { ProviderForm } from "@/components/app/bookings/provider-form";
import { BookingStatusBadge } from "@/components/app/booking-status";
import type {
  BookingDetail,
  BookingRow,
  FormOptions,
} from "@/lib/bookings/data";
import { emptyForm } from "@/lib/bookings/form";
import { parseBookingFilter } from "@/lib/bookings/list";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(el);
const text = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");
const R = (rupees: number) => rupees * 100;

const row = (over: Partial<BookingRow> = {}): BookingRow => ({
  id: "b1",
  code: "AAA-2026-000001",
  resortId: "r1",
  guestId: "g1",
  guestName: "Asha Verma",
  guestMobile: "98765 43210",
  coCategory: "Direct",
  coName: null,
  status: "confirmed",
  bookingDate: "2026-11-10",
  checkInAt: "2026-11-12T08:30:00Z",
  checkOutAt: "2026-11-14T05:30:00Z",
  pax: 2,
  adjusted: false,
  dueP: R(5000),
  approvedP: R(2000),
  waitingP: R(1000),
  pendingP: R(2000),
  refundDueP: 0,
  ...over,
});
const options: FormOptions = {
  resorts: [{ id: "r1", name: "Resort Alpha", code: "AAA", active: true }],
  stayTypes: [{ id: 1, name: "Resort Stay", active: true }],
  categories: [
    {
      id: 1,
      name: "Agent",
      nameMode: "listed",
      active: true,
      entries: [{ id: "e1", name: "Test Agent", mobile: null, active: true }],
    },
    { id: 4, name: "Direct", nameMode: "none", active: true, entries: [] },
  ],
};
const names = new Map([["r1", "Resort Alpha"]]);

describe("bookings list screen (VW-01..)", () => {
  const f = parseBookingFilter({});
  it("VW-01: a table for tablet and up, cards for phones, both with the same rows and figures", () => {
    const out = html(
      h(BookingListView, {
        f,
        list: {
          ok: true,
          data: {
            rows: [
              row(),
              row({
                id: "b2",
                code: "AAA-2026-000002",
                status: "cancelled",
                adjusted: true,
              }),
            ],
            total: 2,
          },
        },
        options,
        resortNames: names,
      }),
    );
    expect(out).toContain("hidden overflow-x-auto md:block");
    expect(out).toContain("grid gap-3 md:hidden");
    expect(out.match(/AAA-2026-000001/g)!.length).toBe(2); // table + card
    const t = text(out);
    expect(t).toContain("₹5,000");
    expect(t).toContain("₹2,000");
    expect(t).toContain("2 bookings");
    expect(t).toContain("Resort Alpha");
    expect(t).toContain("Adjusted");
    expect(out).toContain('href="/bookings/b1"');
  });
  it("VW-02: every column the spec lists is there", () => {
    const t = text(
      html(
        h(BookingListView, {
          f,
          list: { ok: true, data: { rows: [row()], total: 1 } },
          options,
          resortNames: names,
        }),
      ),
    );
    for (const c of [
      "Booking ID",
      "Resort",
      "Guest",
      "Mobile",
      "Check-in",
      "PAX",
      "Amount Due",
      "Approved",
      "Waiting",
      "Pending",
      "Status",
    ])
      expect(t).toContain(c);
  });
  it("VW-03: filters and search are a plain form (works without scripts)", () => {
    const out = html(
      h(BookingListView, {
        f,
        list: { ok: true, data: { rows: [], total: 0 } },
        options,
        resortNames: names,
      }),
    );
    expect(out).toContain('action="/bookings"');
    expect(out).toContain('method="get"');
    for (const name of [
      "q",
      "resort",
      "status",
      "co",
      "method",
      "dateType",
      "from",
      "to",
      "pending",
      "waiting",
      "refund",
      "adjusted",
    ])
      expect(out).toContain(`name="${name}"`);
  });
  it("VW-04: empty, no match and failed states", () => {
    expect(
      text(
        html(
          h(BookingListView, {
            f,
            list: { ok: true, data: { rows: [], total: 0 } },
            options,
            resortNames: names,
          }),
        ),
      ),
    ).toContain("No bookings yet");
    const searched = parseBookingFilter({ q: "zzz" });
    expect(
      text(
        html(
          h(BookingListView, {
            f: searched,
            list: { ok: true, data: { rows: [], total: 0 } },
            options,
            resortNames: names,
          }),
        ),
      ),
    ).toContain("No bookings match");
    const failed = html(
      h(BookingListView, {
        f,
        list: { ok: false },
        options: null,
        resortNames: names,
      }),
    );
    expect(failed).toContain('role="alert"');
    expect(text(failed)).toContain("could not be loaded");
  });
  it("VW-05: a bad address shows its plain reason; paging links keep the filter", () => {
    const bad = parseBookingFilter({ status: "gone" });
    expect(
      text(
        html(
          h(BookingListView, {
            f: bad,
            list: { ok: true, data: { rows: [row()], total: 1 } },
            options,
            resortNames: names,
          }),
        ),
      ),
    ).toContain("status is not known");
    const p2 = parseBookingFilter({ q: "asha", page: "2" });
    const out = html(
      h(BookingListView, {
        f: p2,
        list: { ok: true, data: { rows: [row()], total: 60 } },
        options,
        resortNames: names,
      }),
    );
    expect(out).toContain("/bookings?q=asha");
    expect(text(out)).toContain("Page 2 of 3");
  });
  it("VW-06: every booking status has an icon, a word and a colour", () => {
    for (const [s, w] of [
      ["confirmed", "Confirmed"],
      ["checked_in", "Checked-in"],
      ["checked_out", "Checked-out"],
      ["cancelled", "Cancelled"],
      ["no_show", "No-show"],
    ] as const) {
      const out = html(h(BookingStatusBadge, { status: s }));
      expect(text(out)).toContain(w);
      expect(out).toContain("<svg");
    }
  });
});

function detail(
  over: Partial<BookingDetail["booking"]> = {},
  fin: Partial<NonNullable<BookingDetail["financials"]>> = {},
): BookingDetail {
  const booking = {
    id: "b1",
    booking_code: "AAA-2026-000001",
    resort_id: "r1",
    guest_id: "g1",
    guest_name: "Asha Verma",
    guest_mobile: "98765 43210",
    stay_type_name: "Resort Stay",
    booking_date: "2026-11-10",
    booking_year: 2026,
    check_in_at: "2026-11-12T08:30:00Z",
    check_out_at: "2026-11-14T05:30:00Z",
    nights: 2,
    pax: 2,
    co_category_name: "Direct",
    co_name: null,
    pricing_method: "per_person_per_stay",
    tariff_per_person_paise: R(2500),
    base_amount_paise: R(5000),
    extra_charges_paise: 0,
    extra_charges_note: null,
    discount_paise: 0,
    manual_adjustment_paise: 0,
    manual_adjustment_reason: null,
    final_amount_paise: R(5000),
    status: "confirmed",
    version: 2,
    remarks: "Late arrival",
    created_at: "2026-11-10T04:00:00Z",
    updated_at: "2026-11-10T04:00:00Z",
    cancellation_date: null,
    cancellation_charge_paise: null,
    cancellation_reason: null,
    charge_change_reason: null,
    ...over,
  } as unknown as BookingDetail["booking"];
  return {
    booking,
    financials: {
      due_paise: R(5000),
      total_collection_paise: R(2000),
      waiting_paise: R(1000),
      refunds_approved_paise: 0,
      net_collection_paise: R(2000),
      pending_paise: R(2000),
      verified_remaining_paise: R(3000),
      extra_paise: 0,
      refund_due_paise: 0,
      refunds_waiting_paise: 0,
      refund_still_to_record_paise: 0,
      rejected_paise: 0,
      reversed_paise: 0,
      ...fin,
    } as unknown as BookingDetail["financials"],
    resort: { id: "r1", name: "Resort Alpha", code: "AAA", logoPath: null },
    guest: {
      id: "g1",
      full_name: "Asha Verma",
      mobile: "98765 43210",
      email: null,
      address: null,
      notes: null,
    } as unknown as BookingDetail["guest"],
    schedules: [
      {
        id: "s1",
        booking_id: "b1",
        revision_id: "v1",
        kind: "booking",
        line_no: 1,
        label: "Advance",
        due_date: "2026-11-05",
        amount_paise: R(2000),
        superseded_at: null,
        superseded_revision_id: null,
      },
      {
        id: "s2",
        booking_id: "b1",
        revision_id: "v1",
        kind: "booking",
        line_no: 2,
        label: "Balance",
        due_date: "2026-11-12",
        amount_paise: R(3000),
        superseded_at: null,
        superseded_revision_id: null,
      },
      {
        id: "s3",
        booking_id: "b1",
        revision_id: "v0",
        kind: "booking",
        line_no: 1,
        label: "Old row",
        due_date: "2026-11-30",
        amount_paise: R(100),
        superseded_at: "2026-11-09T00:00:00Z",
        superseded_revision_id: "v1",
      },
    ] as unknown as BookingDetail["schedules"],
    revisions: [
      {
        id: "v1",
        booking_id: "b1",
        revision_no: 1,
        source: "created",
        reason: null,
        amount_due_before: null,
        amount_due_after: R(5000),
        locked_total_paise: 0,
        created_at: "2026-11-10T04:00:00Z",
        created_by: null,
      },
    ],
    adjustments: [],
    timeline: [
      {
        id: 2,
        text: "Ramesh Kumar created the booking.",
        at: "2026-11-10T04:00:00Z",
      },
    ],
    createdByName: "Ramesh Kumar",
    updatedByName: "Ramesh Kumar",
    cancelledByName: null,
  };
}
const view = (
  d: BookingDetail,
  tab: Parameters<typeof BookingView>[0]["tab"] = "details",
  extra: Partial<Parameters<typeof BookingView>[0]> = {},
) =>
  html(
    h(BookingView, {
      d,
      tab,
      today: "2026-11-11",
      saved: false,
      showReplaced: false,
      ...extra,
    }),
  );

describe("booking page (VW-07..)", () => {
  it("VW-07: header, status and the money box with the documented labels and figures", () => {
    const t = text(view(detail()));
    expect(t).toContain("AAA-2026-000001");
    expect(t).toContain("Confirmed");
    for (const l of [
      "Amount Due",
      "Total Collection (Approved)",
      "Waiting for Approval",
      "Refunds (Approved)",
      "Net Collection",
      "Pending Amount",
      "Verified Remaining",
    ])
      expect(t).toContain(l);
    expect(t).toContain("₹5,000");
    expect(t).toContain("₹2,000");
    expect(t).not.toContain("Paid and Approved");
  });
  it("VW-08: extra payment and refund due appear only when there is one; a waiting refund is a separate line that changes no figure", () => {
    expect(text(view(detail()))).not.toContain("Extra Payment");
    expect(text(view(detail()))).not.toContain("Refund due");
    const t = text(
      view(
        detail(
          {},
          {
            extra_paise: R(500),
            refund_due_paise: R(500),
            refunds_waiting_paise: R(200),
            refund_still_to_record_paise: R(300),
          },
        ),
      ),
    );
    expect(t).toContain("Extra Payment");
    expect(t).toContain("Refund due");
    expect(t).toContain(
      "Refund ₹200 waiting for approval · still to record ₹300",
    );
  });
  it("VW-09: a cancelled booking shows the red banner with the charge and the original amount; the charge is the Amount Due", () => {
    const d = detail(
      {
        status: "cancelled",
        cancellation_date: "2026-11-11",
        cancellation_charge_paise: R(1000),
        cancellation_reason: "Guest cancelled",
      },
      { due_paise: R(1000) },
    );
    d.cancelledByName = "Ramesh Kumar";
    const out = view(d);
    const t = text(out);
    expect(t).toContain(
      "Cancelled on 11 Nov 2026 by Ramesh Kumar. Reason: Guest cancelled. Cancellation charge ₹1,000 (Original Booking Amount ₹5,000).",
    );
    expect(out).toContain("cancel-banner");
    expect(t).not.toContain("Mark Checked-in");
    expect(t).toContain("Change cancellation charge");
  });
  it("VW-10: buttons follow the status", () => {
    expect(text(view(detail()))).toContain("Mark Checked-in");
    expect(text(view(detail()))).toContain("Cancel Booking");
    expect(text(view(detail()))).toContain("Mark No-show");
    const ci = text(view(detail({ status: "checked_in" })));
    expect(ci).toContain("Mark Checked-out");
    expect(ci).toContain("Undo check-in");
    expect(text(view(detail({ status: "checked_out" })))).toContain(
      "Undo check-out",
    );
    expect(
      text(
        view(detail({ status: "no_show", cancellation_charge_paise: R(5000) })),
      ),
    ).not.toContain("Edit");
  });
  it("VW-11: details tab: guest link, IST dates and times, nights, pricing breakdown, remarks, who entered it", () => {
    const out = view(detail());
    const t = text(out);
    expect(out).toContain('href="/guests/g1"');
    expect(t).toContain("12 Nov 2026, 2:00 PM");
    expect(t).toContain("14 Nov 2026, 11:00 AM");
    expect(t).toContain("2 nights");
    expect(t).toContain("Per person per stay");
    expect(t).toContain("Final Booking Amount");
    expect(t).toContain("Late arrival");
    expect(t).toContain("Entered by Ramesh Kumar");
    const adj = text(
      view(
        detail({
          manual_adjustment_paise: R(-500),
          manual_adjustment_reason: "Regular guest",
        } as never),
      ),
    );
    expect(adj).toContain("−₹500 – Regular guest");
  });
  it("VW-12: plan tab: both rows listed; nothing is overdue when the Advance (2,000, locked) is fully covered and the Balance is due tomorrow", () => {
    const out = view(detail(), "plan");
    const t = text(out);
    expect(t).toContain("Advance");
    expect(t).toContain("Balance");
    expect(t).toContain("Plan versions");
    expect(t).not.toContain("Overdue");
  });
  it("VW-13: tabs: five, the Payments and PDFs tabs are honest placeholders, History shows the timeline", () => {
    const base = detail();
    const t = text(view(base));
    for (const l of [
      "Details",
      "Payments & Refunds",
      "Payment Plan",
      "PDFs",
      "History",
    ])
      expect(t).toContain(l);
    expect(text(view(base, "payments"))).toContain(
      "Payments and refunds come next",
    );
    expect(text(view(base, "pdfs"))).toContain("Booking PDFs come later");
    expect(text(view(base, "history"))).toContain(
      "Ramesh Kumar created the booking.",
    );
    expect(text(view({ ...base, timeline: [] }, "history"))).toContain(
      "No history yet",
    );
    expect(parseTab("plan")).toBe("plan");
    expect(parseTab("nope")).toBe("details");
    expect(parseTab(undefined)).toBe("details");
    expect(parseTab(["history", "plan"])).toBe("history");
  });
  it("VW-14: the saved notice", () => {
    expect(text(view(detail(), "details", { saved: true }))).toContain(
      "Booking AAA-2026-000001 saved.",
    );
    expect(text(view(detail()))).not.toContain("saved.");
  });
});

describe("plan tab numbers, independently calculated (VW-15)", () => {
  it("VW-15: today 11 Nov: Advance 2,000 due 5 Nov (locked), Balance 3,000 due 12 Nov; net collected 1,500 -> Advance covered 1,500, outstanding 500, OVERDUE; Balance outstanding 3,000, not overdue", () => {
    const d = detail({}, { net_collection_paise: R(1500) });
    const out = view(d, "plan");
    const t = text(out);
    expect(t).toContain("Advance 5 Nov 2026 Overdue");
    expect(out).toContain("hidden overflow-x-auto sm:block");
    expect(t).toContain("₹1,500");
    expect(t).toContain("₹500");
    expect(t.match(/Overdue/g)!.length).toBe(2); // table row + phone card, only for the Advance row
    expect(t).not.toContain("Old row"); // replaced rows hidden
    expect(text(view(d, "plan", { showReplaced: true }))).toContain(
      "Replaced: Old row ₹100",
    );
  });
});

describe("guests screens (VW-16..)", () => {
  it("VW-16: guest list: table and cards, totals, empty and failed", () => {
    const g = {
      id: "g1",
      fullName: "Asha Verma",
      mobile: "98765 43210",
      email: null,
      bookings: 3,
      lastCheckIn: "2026-11-22",
      netCollectionP: R(2000),
      pendingP: R(9500),
    };
    const out = html(
      h(GuestListView, {
        q: "",
        page: 1,
        list: { ok: true, data: { rows: [g], total: 1 } },
      }),
    );
    expect(out).toContain("hidden overflow-x-auto md:block");
    expect(out).toContain("grid gap-3 md:hidden");
    expect(text(out)).toContain("3 bookings");
    expect(text(out)).toContain("22 Nov 2026");
    expect(text(out)).toContain("₹9,500");
    expect(out).toContain('href="/guests/g1"');
    expect(
      text(
        html(
          h(GuestListView, {
            q: "zz",
            page: 1,
            list: { ok: true, data: { rows: [], total: 0 } },
          }),
        ),
      ),
    ).toContain("No guests match");
    expect(
      text(
        html(
          h(GuestListView, {
            q: "",
            page: 1,
            list: { ok: true, data: { rows: [], total: 0 } },
          }),
        ),
      ),
    ).toContain("No guests yet");
    expect(
      html(h(GuestListView, { q: "", page: 1, list: { ok: false } })),
    ).toContain('role="alert"');
  });
  it("VW-17: guest page: history, totals (pending over ALL bookings, an unpaid cancellation charge included), new booking link, edit form", () => {
    const rows = [
      row({ approvedP: R(2000), pendingP: R(3000) }),
      row({
        id: "b2",
        code: "AAA-2026-000002",
        status: "cancelled",
        approvedP: R(500),
        pendingP: R(700),
      }),
    ];
    expect(guestTotals(rows)).toEqual({
      bookings: 2,
      approvedP: R(2500),
      pendingP: R(3700), // 3,000 + the 700 still unpaid on the cancelled booking (rule D1, same as the booking page)
    });
    // a cancelled or no-show booking with nothing pending adds nothing
    expect(
      guestTotals([row({ status: "no_show", pendingP: 0 })]).pendingP,
    ).toBe(0);
    expect(guestTotals([])).toEqual({ bookings: 0, approvedP: 0, pendingP: 0 });
    const out = html(
      h(GuestDetailView, {
        d: {
          guest: {
            id: "g1",
            full_name: "Asha Verma",
            mobile: "98765 43210",
            email: "asha@test.example",
            address: null,
            notes: null,
          } as never,
          bookings: rows,
          resortNames: names,
        },
      }),
    );
    const t = text(out);
    expect(t).toContain("Asha Verma");
    expect(t).toContain("asha@test.example");
    expect(t).toContain("₹2,500");
    expect(t).toContain("₹3,000");
    expect(t).toContain("Pending Amount ₹3,700");
    expect(out).toContain('href="/bookings/new?guest=g1"');
    expect(t).toContain(
      "does not change the name or number printed on old bookings",
    );
    expect(out).toContain('name="fullName"');
  });
  it("VW-18: search text in the address", () => {
    expect(parseGuestQuery({ q: "  asha  ", page: "2" })).toEqual({
      q: "asha",
      page: 2,
    });
    expect(parseGuestQuery({ page: "-3" })).toEqual({ q: "", page: 1 });
  });
});

describe("the booking form (VW-19..)", () => {
  it("VW-19: all sections, mobile first in the guest section, no nights field, plan amounts empty", () => {
    const out = html(
      h(BookingForm, {
        mode: "create",
        options,
        initial: emptyForm("2026-11-10"),
      }),
    );
    const t = text(out);
    for (const s of [
      "1. Resort",
      "2. Guest",
      "3. Stay",
      "4. Who brought this booking (C/O)",
      "5. Amount",
      "Payment plan",
      "Remarks",
      "Save Booking",
    ])
      expect(t).toContain(s);
    expect(out.indexOf("Mobile number")).toBeLessThan(
      out.indexOf("Guest name"),
    );
    expect(out).not.toMatch(/name="nights"|id="nights"/);
    expect(out).toContain('value="2026-11-10"'); // booking date defaults to today
    expect(out).toContain('id="plan-amount-0"');
    expect(out).not.toMatch(/id="plan-amount-\d"[^>]*value="[1-9]/); // nothing suggested
    expect(t).toContain("Per person per night");
    expect(t).toContain("Per person per stay");
    expect(t).toContain("Agent");
    expect(t).toContain("Direct");
  });
  it("VW-20: touch-friendly: every field and button is at least 44px tall", () => {
    const out = html(
      h(BookingForm, {
        mode: "create",
        options,
        initial: emptyForm("2026-11-10"),
      }),
    );
    expect(out).toContain("min-h-11");
    expect(out).toContain("min-h-12");
  });
  it("VW-21: edit: the resort is locked with the documented explanation; the year of the booking date is fixed; reason box present", () => {
    const initial = {
      ...emptyForm("2026-11-10"),
      resortId: "r1",
      guestId: "g1",
      guestName: "Asha Verma",
      guestMobile: "98765 43210",
    };
    const out = html(
      h(BookingForm, {
        mode: "edit",
        options,
        initial,
        edit: {
          bookingId: "b1",
          version: 2,
          code: "AAA-2026-000001",
          resortName: "Resort Alpha",
          bookingYear: 2026,
          originalFinalPaise: R(5000),
          locked: [],
        },
      }),
    );
    const t = text(out);
    expect(t).toContain("Resort Alpha");
    expect(t).toContain(
      "The resort cannot be changed after the Booking ID is issued. To fix it, cancel this booking and create a new one.",
    );
    expect(out).toContain('min="2026-01-01"');
    expect(out).toContain('max="2026-12-31"');
    expect(t).toContain("Reason for change");
    expect(t).toContain("Use a different guest");
  });
});

describe("payment apps form (VW-22)", () => {
  it("VW-22: add form chooses UPI or Card; an existing app keeps its type and has a switch", () => {
    const add = html(h(ProviderForm, {}));
    expect(add).toContain('value="upi"');
    expect(add).toContain('value="card"');
    const edit = html(
      h(ProviderForm, {
        provider: { id: 3, name: "PhonePe", method: "upi", is_active: false },
      }),
    );
    expect(edit).toContain('type="hidden" name="method" value="upi"');
    expect(edit).toContain('name="active"');
    expect(edit).not.toContain("checked");
  });
});
