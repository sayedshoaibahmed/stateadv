import type { ReactNode } from "react";
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
        <span className="font-semibold">Resort Management</span>
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
