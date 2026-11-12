import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Money } from "@/components/app/money";
import {
  AdjustedTag,
  SelfApprovedTag,
  StatusBadge,
} from "@/components/app/status-badge";
import { DateText } from "@/components/app/date-text";
import {
  EmptyState,
  ErrorState,
  CardGridSkeleton,
} from "@/components/app/states";
import {
  DashboardView,
  type DashboardData,
} from "@/components/app/dashboard/dashboard-view";
import { parseDashboardFilter } from "@/lib/dashboard/filters";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(el);
const text = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("shared components", () => {
  it("Money formats the Indian way, tones, refund minus, reversed strike", () => {
    expect(html(h(Money, { paise: 15000000 }))).toContain("₹1,50,000");
    expect(html(h(Money, { paise: 15000000, tone: "approved" }))).toContain(
      "text-approved",
    );
    const refund = html(h(Money, { paise: 200000, tone: "refund" }));
    expect(refund).toContain("−₹2,000");
    expect(refund).toContain("text-refund");
    const rev = html(h(Money, { paise: 100, tone: "reversed" }));
    expect(rev).toContain("line-through");
    expect(rev).toContain("reversed");
    expect(html(h(Money, { paise: 0, tone: "refund" }))).not.toContain("−");
    expect(html(h(Money, { paise: 1 }))).toContain("tabular-nums");
  });
  it("StatusBadge shows words and an icon, not just colour", () => {
    for (const [s, w] of [
      ["approved", "Approved"],
      ["waiting", "Waiting for Approval"],
      ["rejected", "Rejected"],
      ["reversed", "Reversed"],
    ] as const) {
      const out = html(h(StatusBadge, { status: s }));
      expect(text(out)).toContain(w);
      expect(out).toContain("<svg");
      expect(out).toContain(`data-status="${s}"`);
    }
  });
  it("tags", () => {
    expect(text(html(h(SelfApprovedTag)))).toContain("Self-approved");
    expect(text(html(h(AdjustedTag)))).toContain("Adjusted");
  });
  it("DateText shows IST dates and survives bad values", () => {
    expect(html(h(DateText, { value: "2026-11-12" }))).toContain("12 Nov 2026");
    const t = html(
      h(DateText, { value: "2026-11-11T20:00:00Z", withTime: true }),
    );
    expect(t).toContain("12 Nov 2026");
    expect(t).toContain("1:30 AM");
    expect(html(h(DateText, { value: null }))).toContain("—");
    expect(html(h(DateText, { value: "garbage" }))).toContain("—");
  });
  it("states", () => {
    expect(
      text(html(h(EmptyState, { title: "No bookings yet" }, "Add one."))),
    ).toContain("No bookings yet Add one.");
    const e = html(h(ErrorState, { retryHref: "/dashboard" }));
    expect(e).toContain('role="alert"');
    expect(e).toContain("Try again");
    expect(e).toContain('href="/dashboard"');
    expect(
      html(h(CardGridSkeleton, { count: 3 })).match(/animate-pulse/g),
    ).toHaveLength(3);
  });
});

const filter = parseDashboardFilter({}, "2026-11-12");
const ok = <T>(data: T) => ({ ok: true as const, data });
const summary = {
  totalResorts: 2,
  totalBookings: 5,
  checkinsToday: 1,
  checkoutsToday: 0,
  expectedPaise: 950000,
  totalCollectionPaise: 750000,
  waitingPaise: 100000,
  waitingItems: 3,
  refundsPaise: 200000,
  netCollectionPaise: 550000,
  pendingPaise: 700000,
};
const base = (over: Partial<DashboardData> = {}): DashboardData => ({
  filter,
  summary: ok(summary),
  resorts: ok([
    {
      resortId: "r1",
      code: "A",
      name: "Resort A",
      isActive: true,
      bookings: 3,
      expectedPaise: 250000,
      totalCollectionPaise: 300000,
      waitingPaise: 100000,
      refundsPaise: 0,
      netCollectionPaise: 300000,
      pendingPaise: 250000,
    },
    {
      resortId: "r2",
      code: "B",
      name: "Resort B",
      isActive: true,
      bookings: 2,
      expectedPaise: 700000,
      totalCollectionPaise: 450000,
      waitingPaise: 0,
      refundsPaise: 200000,
      netCollectionPaise: 250000,
      pendingPaise: 450000,
    },
  ]),
  alerts: ok({
    waitingOldItems: 0,
    overdueBookings: 0,
    overduePaise: 0,
    selfApproved: 0,
    failedPdfs: 0,
    backupAt: null,
    backupOld: false,
  }),
  bookings: ok([]),
  money: ok([]),
  activity: ok([]),
  resortNames: new Map([["r1", "Resort A"]]),
  chart: h("div", null, "chart"),
  ...over,
});

describe("dashboard view", () => {
  it("has exactly one Total Collection (Approved) card and a separate Waiting card", () => {
    const out = html(h(DashboardView, base()));
    expect(
      out.match(/aria-label="Total Collection \(Approved\)"/g),
    ).toHaveLength(1);
    expect(out.match(/aria-label="Waiting for Approval"/g)).toHaveLength(1);
    expect(out).not.toContain("Paid and Approved");
  });
  it("shows the golden figures and the refund/net line", () => {
    const t = text(html(h(DashboardView, base())));
    expect(t).toContain("₹7,500");
    expect(t).toContain("₹9,500");
    expect(t).toContain("₹1,000");
    expect(t).toContain("₹7,000");
    expect(t).toContain("Refunds −₹2,000 (refund) · Net Collection ₹5,500");
  });
  it("each card says which date it used", () => {
    const t = text(html(h(DashboardView, base())));
    expect(t).toContain("Paid 1 Nov 2026 – 30 Nov 2026");
    expect(t).toContain("Booked 1 Nov 2026 – 30 Nov 2026");
    expect(t).toContain("As of today");
    expect(t).toContain("3 items are waiting in all");
  });
  it("has all eight cards", () => {
    const out = html(h(DashboardView, base()));
    for (const l of [
      "Total Resorts",
      "Total Bookings",
      "Today&#x27;s Check-ins",
      "Today&#x27;s Check-outs",
      "Expected Collection",
      "Total Collection (Approved)",
      "Waiting for Approval",
      "Pending Amount",
    ])
      expect(out).toContain(`aria-label="${l}"`);
  });
  it("resorts: a table for tablet and up, cards for phones", () => {
    const out = html(h(DashboardView, base()));
    expect(out).toMatch(
      /data-testid="resort-table"[^>]*>|class="hidden overflow-x-auto sm:block"/,
    );
    expect(out).toContain("hidden overflow-x-auto sm:block");
    expect(out).toContain("grid gap-3 sm:hidden");
    expect(out).toContain("Resort B");
  });
  it("empty states and quiet alerts", () => {
    const t = text(html(h(DashboardView, base())));
    expect(t).toContain("Nothing needs your attention");
    expect(t).toContain("No bookings yet");
    expect(t).toContain("No payments yet");
    expect(t).toContain("No activity yet");
  });
  it("a failed part shows its own Try again, the rest still shows", () => {
    const out = html(
      h(
        DashboardView,
        base({ resorts: { ok: false }, summary: { ok: false } }),
      ),
    );
    expect(out.match(/Try again/g)!.length).toBe(2);
    expect(text(out)).toContain("The numbers could not be loaded");
    expect(text(out)).toContain("Nothing needs your attention");
  });
  it("shows a plain problem message for a bad address", () => {
    const bad = parseDashboardFilter({ range: "decade" }, "2026-11-12");
    expect(text(html(h(DashboardView, base({ filter: bad }))))).toContain(
      "not a period we know",
    );
  });
  it("recent lists show status words and the self-approved tag", () => {
    const out = html(
      h(
        DashboardView,
        base({
          money: ok([
            {
              id: "p1",
              code: "PAY-1",
              kind: "payment" as const,
              resortId: "r1",
              status: "approved" as const,
              amountPaise: 100000,
              date: "2026-11-10",
              selfApproved: true,
            },
          ]),
        }),
      ),
    );
    expect(text(out)).toContain("Approved");
    expect(text(out)).toContain("Self-approved");
    expect(text(out)).toContain("Resort A");
  });
  it("period form keeps the chosen resort", () => {
    const f = parseDashboardFilter(
      { resort: "123e4567-e89b-42d3-a456-426614174000" },
      "2026-11-12",
    );
    expect(html(h(DashboardView, base({ filter: f })))).toContain(
      'name="resort" value="123e4567-e89b-42d3-a456-426614174000"',
    );
  });
});
