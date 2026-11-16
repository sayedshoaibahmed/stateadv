import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BottomNav, Sidebar } from "@/components/app/shell/nav-links";
import {
  GlobalSearch,
  ResortFilter,
} from "@/components/app/shell/top-controls";
import { logout } from "@/lib/auth/actions";
import { requireUser } from "@/lib/auth/session";
import { loadResortChoices, loadWaitingCount } from "@/lib/dashboard/data";

/** Streamed in behind Suspense so a slow count never blocks the page's own content from rendering. */
async function WaitingSidebar({ promise }: { promise: Promise<number | null> }) {
  return <Sidebar waiting={await promise} />;
}
async function WaitingBottomNav({ promise }: { promise: Promise<number | null> }) {
  return <BottomNav waiting={await promise} />;
}
async function ResortFilterAsync({
  promise,
}: {
  promise: Promise<{ id: string; name: string }[]>;
}) {
  return <ResortFilter resorts={await promise} />;
}

/**
 * Everything inside this folder needs a signed-in, active user who has
 * already chosen their own password. The check runs on the server for every
 * request; nothing here relies on the browser.
 *
 * The frame: top bar (name, search, resort filter, sign out), side menu from tablet width up, bottom bar on phones.
 * Owners and Managers see the same menu (Q10).
 *
 * The waiting-count badge and resort dropdown are "nice to have" chrome, not the page's own content, so their
 * queries are started here but not awaited: they stream in behind Suspense once ready, instead of making every
 * navigation wait on them before the actual page can even start loading its own data.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const waiting = loadWaitingCount();
  const resorts = loadResortChoices();
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2 sm:flex-nowrap sm:gap-3 sm:px-4">
        <Link href="/dashboard" className="hidden font-semibold sm:block">
          Resort Management
        </Link>
        <GlobalSearch />
        <Suspense fallback={null}>
          <ResortFilterAsync promise={resorts} />
        </Suspense>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/account"
            className="hidden text-sm underline-offset-4 hover:underline sm:inline"
          >
            {user.fullName}
          </Link>
          <Badge variant="secondary">
            {user.role === "owner" ? "Owner" : "Manager"}
          </Badge>
          <form action={logout}>
            <Button type="submit" variant="outline" className="min-h-11">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <div className="flex flex-1">
        <Suspense fallback={<Sidebar waiting={null} />}>
          <WaitingSidebar promise={waiting} />
        </Suspense>
        <div className="flex min-w-0 flex-1 flex-col pb-20 sm:pb-0">
          {children}
        </div>
      </div>
      <Suspense fallback={<BottomNav waiting={null} />}>
        <WaitingBottomNav promise={waiting} />
      </Suspense>
    </div>
  );
}
