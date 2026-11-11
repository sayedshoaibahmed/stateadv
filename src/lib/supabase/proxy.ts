import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { getPublicEnv } from "@/lib/env";
import { proxyRedirect } from "@/lib/auth/routes";

/**
 * Runs on every page request. It (1) refreshes the Supabase session cookies
 * and (2) sends visitors who are not signed in to the login page.
 *
 * This is only the FIRST, quick check (the token is verified by signature,
 * with no database call). It cannot know whether the account was switched off
 * a minute ago or must change its password. Those checks, and the role check,
 * happen on the server for every page and action (src/lib/auth/session.ts),
 * and the database refuses data to anyone without an active profile.
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
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  const { pathname, search } = request.nextUrl;
  const target = proxyRedirect(pathname, search, signedIn);
  if (target) {
    const redirect = NextResponse.redirect(new URL(target, request.url));
    // Keep any refreshed session cookies and no-cache headers.
    for (const c of response.cookies.getAll()) redirect.cookies.set(c);
    response.headers.forEach((value, key) => {
      if (key.toLowerCase().startsWith("cache-control"))
        redirect.headers.set(key, value);
    });
    return redirect;
  }

  return response;
}
