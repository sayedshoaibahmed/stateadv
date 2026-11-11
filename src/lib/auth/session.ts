import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * The real "who is this and may they be here?" check, run on the server for
 * every protected page and every action. It never trusts the proxy's quick
 * check or anything the browser says about itself.
 *
 * 1. `auth.getUser()` asks Supabase Auth to confirm the session is genuine.
 * 2. The profile is read WITH THE USER'S OWN LOGIN. Row-level security only
 *    shows a profile to an active user, so a switched-off account (or a login
 *    that has no profile) gets no row back and is treated as blocked.
 */

export type Role = "owner" | "manager";

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  mustChangePassword: boolean;
}

export type SessionState =
  | { state: "anonymous" }
  | { state: "blocked" }
  | { state: "ok"; user: SessionUser };

export const getSession = cache(async (): Promise<SessionState> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { state: "anonymous" };

  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("id, email, full_name, role, is_active, must_change_password")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profileError || !profile || !profile.is_active) {
    return { state: "blocked" };
  }
  return {
    state: "ok",
    user: {
      id: profile.id,
      email: profile.email,
      fullName: profile.full_name,
      role: profile.role as Role,
      mustChangePassword: profile.must_change_password,
    },
  };
});

interface RequireOptions {
  /** Let a user who still has a temporary password through (the change-password pages). */
  allowPasswordChange?: boolean;
  /** Only this role may open the page. Others are sent to the home page. */
  role?: Role;
}

/** Use at the top of every protected page, layout and action. */
export async function requireUser(
  options: RequireOptions = {},
): Promise<SessionUser> {
  const session = await getSession();
  if (session.state === "anonymous") redirect("/login");
  if (session.state === "blocked") redirect("/auth/blocked");

  const { user } = session;
  if (user.mustChangePassword && !options.allowPasswordChange) {
    redirect("/change-password");
  }
  if (options.role && user.role !== options.role) redirect("/");
  return user;
}
