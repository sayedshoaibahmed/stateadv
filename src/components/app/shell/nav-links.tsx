"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  Banknote,
  BookOpen,
  CalendarDays,
  CheckSquare,
  Handshake,
  History,
  LayoutDashboard,
  Menu,
  PlusCircle,
  RotateCcw,
  Settings,
  Store,
  Users,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  MENU,
  activeKey,
  badgeText,
  mobileItems,
  type IconKey,
  type NavItem,
} from "@/lib/nav";
import { cn } from "@/lib/utils";

const ICONS: Record<IconKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  bookings: BookOpen,
  add: PlusCircle,
  approvals: CheckSquare,
  payments: Banknote,
  refunds: RotateCcw,
  calendar: CalendarDays,
  guests: UserRound,
  reports: BarChart3,
  old: History,
  resorts: Store,
  partners: Handshake,
  activity: Activity,
  settings: Settings,
  people: Users,
  more: Menu,
};

function Badge({ count }: { count: number | null }) {
  const text = badgeText(count);
  if (!text) return null;
  return (
    <span className="ml-auto rounded-full bg-waiting px-2 py-0.5 text-xs font-semibold text-white">
      {text}
      <span className="sr-only"> waiting</span>
    </span>
  );
}

function Item({
  item,
  active,
  waiting,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  waiting: number | null;
  onNavigate?: () => void;
}) {
  const Icon = ICONS[item.icon];
  const base =
    "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium";
  if (!item.ready) {
    return (
      <li>
        <span
          className={cn(
            base,
            "cursor-not-allowed text-muted-foreground opacity-60",
          )}
          aria-disabled="true"
        >
          <Icon className="size-5 shrink-0" aria-hidden="true" />
          {item.label}
          <span className="ml-auto text-xs">Soon</span>
        </span>
      </li>
    );
  }
  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          base,
          active ? "bg-primary text-primary-foreground" : "hover:bg-muted",
        )}
      >
        <Icon className="size-5 shrink-0" aria-hidden="true" />
        {item.label}
        {item.badge === "waiting" ? <Badge count={waiting} /> : null}
      </Link>
    </li>
  );
}

/** The side menu (tablet and desktop). Hidden on phones, where the bottom bar is used. */
export function Sidebar({ waiting }: { waiting: number | null }) {
  const pathname = usePathname();
  const current = activeKey(pathname);
  return (
    <nav
      aria-label="Main"
      className="hidden w-56 shrink-0 overflow-y-auto border-r p-3 sm:block"
      data-testid="sidebar"
    >
      <ul className="grid gap-1">
        {MENU.map((m) => (
          <Item
            key={m.key}
            item={m}
            active={current === m.key}
            waiting={waiting}
          />
        ))}
      </ul>
    </nav>
  );
}

/** The bottom bar on a phone: Dashboard, Bookings, Add, Approvals, More. */
export function BottomNav({ waiting }: { waiting: number | null }) {
  const pathname = usePathname();
  const current = activeKey(pathname);
  const [open, setOpen] = useState(false);
  return (
    <>
      <nav
        aria-label="Quick"
        data-testid="bottom-nav"
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background sm:hidden"
      >
        <ul className="grid grid-cols-5">
          {mobileItems().map((item) => {
            const Icon = ICONS[item.icon];
            const text = item.badge === "waiting" ? badgeText(waiting) : null;
            const cls =
              "relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium";
            if (item.key === "more") {
              return (
                <li key={item.key}>
                  <button
                    type="button"
                    className={cn(cls, "w-full")}
                    onClick={() => setOpen(true)}
                  >
                    <Icon className="size-5" aria-hidden="true" />
                    More
                  </button>
                </li>
              );
            }
            if (!item.ready) {
              return (
                <li key={item.key}>
                  <span
                    className={cn(cls, "text-muted-foreground opacity-60")}
                    aria-disabled="true"
                  >
                    <Icon className="size-5" aria-hidden="true" />
                    {item.key === "add"
                      ? "Add"
                      : item.label.replace("Waiting for ", "")}
                    <span className="sr-only"> (coming soon)</span>
                  </span>
                </li>
              );
            }
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  aria-current={current === item.key ? "page" : undefined}
                  className={cn(
                    cls,
                    current === item.key
                      ? "text-primary"
                      : "text-muted-foreground",
                  )}
                >
                  <Icon className="size-5" aria-hidden="true" />
                  {item.key === "add" ? "Add" : item.label}
                  {text ? (
                    <span className="absolute top-1 right-3 rounded-full bg-waiting px-1.5 text-[10px] text-white">
                      {text}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85vh] overflow-y-auto p-3"
        >
          <SheetHeader>
            <SheetTitle>Menu</SheetTitle>
          </SheetHeader>
          <ul className="grid gap-1">
            {MENU.map((m) => (
              <Item
                key={m.key}
                item={m}
                active={current === m.key}
                waiting={waiting}
                onNavigate={() => setOpen(false)}
              />
            ))}
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}
