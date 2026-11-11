/**
 * Pure rules for where a visitor may go. Kept free of Next.js so they can be
 * tested directly. The proxy uses them for a quick first check; the real
 * checks happen on the server for every page and action (session.ts) and in
 * the database (row-level security).
 */

/** Pages that anyone may open without signing in. */
const PUBLIC_PATHS = ["/login", "/forgot-password"];
/** Routes that must stay reachable by link (password-reset email, sign-out). */
const PUBLIC_PREFIXES = ["/auth/"];

export function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.includes(pathname) ||
    PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))
  );
}

/**
 * Accept a "go here after sign-in" address only if it stays inside this app.
 * Blocks "https://evil.example", "//evil.example", "/\evil.example" and
 * anything with control characters.
 */
export function safeNext(next: unknown, fallback = "/"): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 500) {
    return fallback;
  }
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) {
    return fallback;
  }
  if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;
  if (isPublicPath(next.split("?")[0])) return fallback;
  return next;
}

/**
 * First check in the proxy. Returns the address to redirect to, or null to
 * let the request through.
 */
export function proxyRedirect(
  pathname: string,
  search: string,
  signedIn: boolean,
): string | null {
  if (signedIn || isPublicPath(pathname)) return null;
  const next =
    pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return `/login${next}`;
}

/** Simple English for the sign-in errors Supabase Auth can return. */
export function authErrorMessage(code: string | undefined | null): string {
  switch (code) {
    case "invalid_credentials":
    case "user_not_found":
      return "The email or password is not correct. Please try again.";
    case "user_banned":
      return "This account has been switched off. Please ask the owner.";
    case "email_not_confirmed":
      return "This account is not ready yet. Please ask the owner.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "Too many tries. Please wait a few minutes and try again.";
    case "same_password":
      return "Please choose a password you have not used before.";
    case "weak_password":
      return "That password is too easy to guess. Please choose a stronger one.";
    case "session_not_found":
    case "refresh_token_not_found":
    case "bad_jwt":
      return "Your sign-in has expired. Please sign in again.";
    default:
      return "Something went wrong. Please try again.";
  }
}
