import type { ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { logout } from "@/lib/auth/actions";
import { requireUser } from "@/lib/auth/session";

/**
 * Everything inside this folder needs a signed-in, active user who has
 * already chosen their own password. The check runs on the server for every
 * request; nothing here relies on the browser.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <nav aria-label="Main" className="flex items-center gap-4">
          <Link href="/" className="font-semibold">
            Resort Management
          </Link>
          <Link
            href="/users"
            className="text-sm underline-offset-4 hover:underline"
          >
            People
          </Link>
          <Link
            href="/settings"
            className="text-sm underline-offset-4 hover:underline"
          >
            Settings
          </Link>
          <Link
            href="/account"
            className="text-sm underline-offset-4 hover:underline"
          >
            My Account
          </Link>
        </nav>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm sm:inline">{user.fullName}</span>
          <Badge variant="secondary">
            {user.role === "owner" ? "Owner" : "Manager"}
          </Badge>
          <form action={logout}>
            <Button type="submit" variant="outline" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}
