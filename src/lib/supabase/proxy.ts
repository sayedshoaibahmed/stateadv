import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getPublicEnv } from "@/lib/env";

/**
 * Refreshes the Supabase auth session cookies on each request.
 *
 * M1: refresh only. Route protection (redirect to /login, forced password
 * change) is added in M2. The proxy is an optimistic check; real
 * authorisation is always enforced in the database (RLS + RPC checks).
 */
export async function updateSession(request: NextRequest) {
  const env = getPublicEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          // Cache-control headers supplied by @supabase/ssr prevent a
          // refreshed session from being cached by a CDN.
          for (const [key, value] of Object.entries(headers ?? {})) {
            response.headers.set(key, value);
          }
        },
      },
    },
  );

  // Do not add code between client creation and getClaims(): it validates
  // the JWT and triggers the cookie refresh when needed.
  await supabase.auth.getClaims();

  return response;
}
