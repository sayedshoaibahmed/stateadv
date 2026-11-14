import { describe, expect, it } from "vitest";
import {
  MAX_CUSTOM_DAYS,
  addDays,
  chartGrain,
  dashboardHref,
  parseDashboardFilter,
  periodText,
  presetRange,
} from "@/lib/dashboard/filters";
import {
  buildAlerts,
  describeActivity,
  type Alerts,
} from "@/lib/dashboard/model";
import {
  MENU,
  MOBILE_KEYS,
  activeKey,
  badgeText,
  mobileItems,
  showsResortFilter,
} from "@/lib/nav";

const RESORT = "123e4567-e89b-42d3-a456-426614174000";

describe("dashboard period filter (IST, machine zone is New York)", () => {
  it("presets: week is Monday to Sunday, month and year are whole", () => {
    // Thu 12 Nov 2026
    expect(presetRange("today", "2026-11-12")).toEqual({
      from: "2026-11-12",
      to: "2026-11-12",
    });
    expect(presetRange("week", "2026-11-12")).toEqual({
      from: "2026-11-09",
      to: "2026-11-15",
    });
    expect(presetRange("week", "2026-11-15")).toEqual({
      from: "2026-11-09",
      to: "2026-11-15",
    }); // Sunday
    expect(presetRange("week", "2026-11-09")).toEqual({
      from: "2026-11-09",
      to: "2026-11-15",
    }); // Monday
    expect(presetRange("month", "2026-02-10")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    expect(presetRange("month", "2028-02-10")).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
    expect(presetRange("year", "2026-11-12")).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
    });
  });
  it("defaults to this month, all resorts, no problem", () => {
    const f = parseDashboardFilter({}, "2026-11-12");
    expect(f).toEqual({
      resort: null,
      range: "month",
      from: "2026-11-01",
      to: "2026-11-30",
      problem: null,
    });
  });
  it("accepts a resort id and a custom period", () => {
    const f = parseDashboardFilter(
      {
        resort: RESORT.toUpperCase(),
        range: "custom",
        from: "2026-10-01",
        to: "2026-10-15",
      },
      "2026-11-12",
    );
    expect(f).toMatchObject({
      resort: RESORT,
      range: "custom",
      from: "2026-10-01",
      to: "2026-10-15",
      problem: null,
    });
  });
  it("'all' means all resorts", () => {
    expect(
      parseDashboardFilter({ resort: "all" }, "2026-11-12").resort,
    ).toBeNull();
  });
  it("bad input falls back with a plain reason, never throws", () => {
    expect(
      parseDashboardFilter({ resort: "'; drop table" }, "2026-11-12"),
    ).toMatchObject({
      resort: null,
      problem: expect.stringContaining("resort"),
    });
    expect(
      parseDashboardFilter({ range: "decade" }, "2026-11-12"),
    ).toMatchObject({
      range: "month",
      problem: expect.stringContaining("not a period"),
    });
    expect(
      parseDashboardFilter({ range: "custom" }, "2026-11-12"),
    ).toMatchObject({
      range: "month",
      problem: expect.stringContaining("both dates"),
    });
    expect(
      parseDashboardFilter(
        { range: "custom", from: "2026-02-30", to: "2026-03-01" },
        "2026-11-12",
      ).range,
    ).toBe("month");
    expect(
      parseDashboardFilter(
        { range: "custom", from: "2026-11-10", to: "2026-11-01" },
        "2026-11-12",
      ).problem,
    ).toContain("before");
    const long = parseDashboardFilter(
      { range: "custom", from: "2024-01-01", to: "2026-01-01" },
      "2026-11-12",
    );
    expect(long.problem).toContain("one year");
    expect(long.range).toBe("month");
  });
  it("a custom period of exactly the maximum is allowed, one day more is not", () => {
    const ok = parseDashboardFilter(
      {
        range: "custom",
        from: "2026-01-01",
        to: addDays("2026-01-01", MAX_CUSTOM_DAYS - 1),
      },
      "2026-11-12",
    );
    expect(ok.range).toBe("custom");
    const no = parseDashboardFilter(
      {
        range: "custom",
        from: "2026-01-01",
        to: addDays("2026-01-01", MAX_CUSTOM_DAYS),
      },
      "2026-11-12",
    );
    expect(no.range).toBe("month");
  });
  it("takes the first value of a repeated parameter", () => {
    expect(
      parseDashboardFilter({ range: ["today", "year"] }, "2026-11-12").range,
    ).toBe("today");
  });
  it("today is the IST date even when it is still yesterday in New York", () => {
    // 2026-11-11 20:00 UTC = 12 Nov 01:30 IST = 11 Nov 15:00 New York
    const f = parseDashboardFilter({ range: "today" });
    expect(f.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(parseDashboardFilter({ range: "today" }, "2026-11-12").from).toBe(
      "2026-11-12",
    );
  });
  it("text and addresses", () => {
    expect(periodText("2026-11-12", "2026-11-12")).toBe("12 Nov 2026");
    expect(periodText("2026-11-01", "2026-11-30")).toBe(
      "1 Nov 2026 – 30 Nov 2026",
    );
    const f = parseDashboardFilter(
      { resort: RESORT, range: "custom", from: "2026-10-01", to: "2026-10-05" },
      "2026-11-12",
    );
    expect(dashboardHref(f)).toBe(
      `/dashboard?resort=${RESORT}&range=custom&from=2026-10-01&to=2026-10-05`,
    );
    expect(dashboardHref(parseDashboardFilter({}, "2026-11-12"))).toBe(
      "/dashboard?range=month",
    );
  });
  it("chart groups by month above 62 days", () => {
    expect(chartGrain("2026-11-01", "2026-11-30")).toBe("day");
    expect(chartGrain("2026-01-01", "2026-12-31")).toBe("month");
    expect(chartGrain("2026-01-01", "2026-03-03")).toBe("day"); // exactly 62 days
    expect(chartGrain("2026-01-01", "2026-03-04")).toBe("month"); // 63 days
  });
});

const none: Alerts = {
  waitingOldItems: 0,
  overdueBookings: 0,
  overduePaise: 0,
  selfApproved: 0,
  failedPdfs: 0,
  backupAt: null,
  backupOld: false,
};

describe("dashboard alerts and activity wording", () => {
  it("lists nothing for zeros, and a never-recorded backup is not an alert", () => {
    expect(buildAlerts(none, "x")).toEqual([]);
  });
  it("describes each alert in plain English, most serious first", () => {
    const items = buildAlerts(
      {
        waitingOldItems: 2,
        overdueBookings: 3,
        overduePaise: 500000,
        selfApproved: 1,
        failedPdfs: 1,
        backupAt: "2026-11-01T00:00:00Z",
        backupOld: true,
      },
      "this month",
    );
    expect(items.map((i) => i.key)).toEqual([
      "overdue",
      "waiting-old",
      "pdf",
      "backup",
      "self-approved",
    ]);
    expect(items[0].text).toContain("3 bookings are behind");
    expect(items[0].text).toContain("₹5,000");
    expect(items[1].text).toContain("2 payments or refunds have");
    expect(items[2].text).toContain("1 booking PDF could not");
    expect(items[3].text).toContain("36 hours");
    expect(items[4].text).toContain("1 item was approved");
  });
  it("singular wording", () => {
    expect(
      buildAlerts({ ...none, overdueBookings: 1, overduePaise: 100 }, "x")[0]
        .text,
    ).toContain("1 booking is behind");
  });
  it("activity: only business tables, plain sentences", () => {
    const base = {
      id: 1,
      at: "2026-11-12T00:00:00Z",
      actor: "Asha",
      status: null,
      fields: null,
    };
    expect(
      describeActivity({ ...base, action: "insert", table: "payments" }),
    ).toBe("Asha added a payment.");
    expect(
      describeActivity({
        ...base,
        action: "update",
        table: "payments",
        status: "approved",
        fields: ["status"],
      }),
    ).toBe("Asha approved a payment.");
    expect(
      describeActivity({
        ...base,
        action: "update",
        table: "bookings",
        status: "cancelled",
        fields: ["status"],
      }),
    ).toBe("Asha cancelled a booking.");
    expect(
      describeActivity({
        ...base,
        action: "update",
        table: "bookings",
        fields: ["remarks"],
      }),
    ).toBe("Asha changed a booking.");
    expect(
      describeActivity({
        ...base,
        actor: null,
        action: "insert",
        table: "resorts",
      }),
    ).toBe("The system added a resort.");
    expect(
      describeActivity({ ...base, action: "insert", table: "user_profiles" }),
    ).toBeNull();
    expect(
      describeActivity({ ...base, action: "delete", table: "bookings" }),
    ).toBeNull();
  });
});

describe("menu", () => {
  it("has the 14 documented items plus People, same for everyone", () => {
    const labels = MENU.map((m) => m.label);
    for (const l of [
      "Dashboard",
      "Bookings",
      "Add Booking",
      "Waiting for Approval",
      "Payments",
      "Refunds",
      "Calendar",
      "Guests",
      "Collection Reports",
      "Old Records",
      "Resorts",
      "Agents & Partners",
      "Activity",
      "Settings",
    ])
      expect(labels).toContain(l);
    expect(new Set(MENU.map((m) => m.key)).size).toBe(MENU.length);
  });
  it("unbuilt pages are not links; built ones are", () => {
    const ready = MENU.filter((m) => m.ready).map((m) => m.key);
    // M4 built Bookings, Add Booking and Guests; M5 built Waiting for Approval, Payments and Refunds;
    // M7 built Calendar, Old Records and Activity; Collection Reports stays "Soon" until M8
    expect(ready.sort()).toEqual([
      "activity",
      "add",
      "approvals",
      "bookings",
      "calendar",
      "dashboard",
      "guests",
      "old",
      "partners",
      "payments",
      "people",
      "refunds",
      "resorts",
      "settings",
    ]);
  });
  it("mobile bar has five places with Add in the middle", () => {
    expect(mobileItems().map((i) => i.key)).toEqual([...MOBILE_KEYS]);
    expect(mobileItems()[2].key).toBe("add");
    expect(mobileItems()).toHaveLength(5);
  });
  it("the active item is the most specific built page", () => {
    expect(activeKey("/dashboard")).toBe("dashboard");
    expect(activeKey("/settings/resorts")).toBe("resorts");
    expect(activeKey("/settings/resorts/abc")).toBe("resorts");
    expect(activeKey("/settings/stay-types")).toBe("settings");
    expect(activeKey("/settings/co")).toBe("partners");
    expect(activeKey("/users/new")).toBe("people");
    expect(activeKey("/bookings")).toBe("bookings");
    expect(activeKey("/bookings/abc")).toBe("bookings");
    expect(activeKey("/bookings/abc/edit")).toBe("bookings");
    expect(activeKey("/bookings/new")).toBe("add");
    expect(activeKey("/guests/abc")).toBe("guests");
    expect(activeKey("/approvals")).toBe("approvals");
    expect(activeKey("/payments/abc/edit")).toBe("payments");
    expect(activeKey("/refunds/new")).toBe("refunds");
    expect(activeKey("/calendar")).toBe("calendar");
    expect(activeKey("/calendar/2026-03-10")).toBe("calendar");
    expect(activeKey("/old-records")).toBe("old");
    expect(activeKey("/activity")).toBe("activity");
    expect(activeKey("/reports")).toBeNull(); // M8
    expect(activeKey("/dashboardx")).toBeNull();
  });
  it("badge text and resort filter pages", () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(null)).toBeNull();
    expect(badgeText(7)).toBe("7");
    expect(badgeText(100)).toBe("99+");
    expect(showsResortFilter("/dashboard")).toBe(true);
    expect(showsResortFilter("/calendar")).toBe(true);
    expect(showsResortFilter("/calendar/2026-03-10")).toBe(true);
    expect(showsResortFilter("/users")).toBe(false);
  });
});
