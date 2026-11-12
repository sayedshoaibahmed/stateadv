/**
 * The menu (UI spec section 2). One list for everybody: Owners and Managers see the same menu (Q10).
 * Pure data and pure rules, so they are unit-tested without a browser.
 *
 * An item whose page has not been built yet is listed but cannot be opened (`ready: false`): the screen shows it
 * greyed with "Soon". That keeps the menu the owner asked for without a link that leads nowhere. When a later step
 * builds a page, only its `ready` flag changes.
 */
export type IconKey =
  | "dashboard"
  | "bookings"
  | "add"
  | "approvals"
  | "payments"
  | "refunds"
  | "calendar"
  | "guests"
  | "reports"
  | "old"
  | "resorts"
  | "partners"
  | "activity"
  | "settings"
  | "people"
  | "more";

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: IconKey;
  /** false = the page comes in a later step */
  ready: boolean;
  /** show the number of payments and refunds waiting for approval */
  badge?: "waiting";
}

export const MENU: readonly NavItem[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    icon: "dashboard",
    ready: true,
  },
  {
    key: "bookings",
    label: "Bookings",
    href: "/bookings",
    icon: "bookings",
    ready: false,
  },
  {
    key: "add",
    label: "Add Booking",
    href: "/bookings/new",
    icon: "add",
    ready: false,
  },
  {
    key: "approvals",
    label: "Waiting for Approval",
    href: "/approvals",
    icon: "approvals",
    ready: false,
    badge: "waiting",
  },
  {
    key: "payments",
    label: "Payments",
    href: "/payments",
    icon: "payments",
    ready: false,
  },
  {
    key: "refunds",
    label: "Refunds",
    href: "/refunds",
    icon: "refunds",
    ready: false,
  },
  {
    key: "calendar",
    label: "Calendar",
    href: "/calendar",
    icon: "calendar",
    ready: false,
  },
  {
    key: "guests",
    label: "Guests",
    href: "/guests",
    icon: "guests",
    ready: false,
  },
  {
    key: "reports",
    label: "Collection Reports",
    href: "/reports",
    icon: "reports",
    ready: false,
  },
  {
    key: "old",
    label: "Old Records",
    href: "/old-records",
    icon: "old",
    ready: false,
  },
  {
    key: "resorts",
    label: "Resorts",
    href: "/settings/resorts",
    icon: "resorts",
    ready: true,
  },
  {
    key: "partners",
    label: "Agents & Partners",
    href: "/settings/co",
    icon: "partners",
    ready: true,
  },
  {
    key: "activity",
    label: "Activity",
    href: "/activity",
    icon: "activity",
    ready: false,
  },
  {
    key: "settings",
    label: "Settings",
    href: "/settings",
    icon: "settings",
    ready: true,
  },
  {
    key: "people",
    label: "People",
    href: "/users",
    icon: "people",
    ready: true,
  },
];

/** The bottom bar on a phone: five places, with Add in the middle. "More" opens the whole menu. */
export const MOBILE_KEYS = [
  "dashboard",
  "bookings",
  "add",
  "approvals",
  "more",
] as const;

export const MORE_ITEM: NavItem = {
  key: "more",
  label: "More",
  href: "#more",
  icon: "more",
  ready: true,
};

export function mobileItems(): NavItem[] {
  return MOBILE_KEYS.map((k) =>
    k === "more" ? MORE_ITEM : MENU.find((m) => m.key === k)!,
  );
}

/** The pages where the resort filter in the top bar is used (more are added as pages learn to use it). */
export const RESORT_FILTER_PATHS: readonly string[] = ["/dashboard"];

export function showsResortFilter(pathname: string): boolean {
  return RESORT_FILTER_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/**
 * Which menu item is "where you are". The most specific built page whose address the current address starts with:
 * /settings/resorts lights up Resorts, not Settings; /settings/stay-types lights up Settings; /users/new lights up People.
 */
export function activeKey(pathname: string): string | null {
  let best: NavItem | null = null;
  for (const item of MENU) {
    if (!item.ready) continue;
    const hit = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (hit && (!best || item.href.length > best.href.length)) best = item;
  }
  return best?.key ?? null;
}

/** "9" or "99+" for the badge; nothing for zero or unknown. */
export function badgeText(count: number | null | undefined): string | null {
  if (!count || count < 1) return null;
  return count > 99 ? "99+" : String(count);
}
