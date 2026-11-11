import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";

/**
 * Checks a person's password WITHOUT touching the current login session (O3, FR-AUTH-16):
 * a separate client that keeps nothing (no cookies, no storage). The password is used for this
 * one call and never stored or logged.
 */
export async function verifyPassword(
  email: string,
  password: string,
): Promise<boolean> {
  if (!email || !password) return false;
  const env = getPublicEnv();
  const client = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (error || !data.session) return false;
  // The throw-away session is discarded; nothing was saved anywhere.
  return true;
}
