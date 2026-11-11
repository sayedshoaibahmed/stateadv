/**
 * Re-authentication for protected Owner actions (owner decision O3), the application side.
 *
 * The database refuses a protected account action unless it finds a short-lived, single-use "grant" that
 * only the server can create (migration 19). The server creates a grant ONLY after Supabase Auth has accepted the
 * acting Owner's own password, and only for the exact operation being done. This file holds the decisions and the
 * order of steps as pure functions with injected dependencies, so they are tested without a network:
 *
 *   1. reserve an attempt (reauth_begin): at most 5 per 15 minutes, even for simultaneous requests.
 *      Locked -> refuse BEFORE trying the password. Any other error -> fail closed (the password is never tried).
 *   2. verify the password with Supabase Auth                      -> wrong: audit the failure, refuse
 *   3. issue a grant for (actor, action, target, operation)         -> nothing is returned: no grant id exists to leak
 *
 * The password never goes to PostgreSQL: it is only given to `verifyPassword` (Supabase Auth). Every database call
 * here throws on error: nothing is ignored, so a failing database can never turn into "allowed".
 */
import { isProtectedAction, type ProtectedCheck } from "@/lib/accounts/rules";

export type GrantAction =
  | "add_owner"
  | "change_role"
  | "set_active"
  | "reset_password"
  | "change_email";

/**
 * Which grant the database will ask for, or null when the action is not protected. It must agree with
 * `isProtectedAction` for every input (a unit test checks that), and with the SQL in migration 19.
 */
export function grantActionFor(c: ProtectedCheck): GrantAction | null {
  if (!isProtectedAction(c)) return null;
  switch (c.action) {
    case "add_user":
      return "add_owner";
    case "change_role":
      return "change_role";
    case "switch_off":
    case "switch_on":
      return "set_active";
    case "reset_password":
      return "reset_password";
    case "change_email":
      return "change_email";
    default:
      return null; // edit_details is never protected
  }
}

/**
 * The exact operation a grant is for, in the form the database compares:
 *  set_active -> "true" | "false" (the account's NEW state), change_role -> the NEW role,
 *  change_email / add_owner -> the lower-cased email, reset_password -> null.
 * It throws for a value that is missing or malformed, so a grant can never be issued for "anything".
 */
export function grantDetail(
  action: GrantAction,
  value?: string | boolean | null,
): string | null {
  switch (action) {
    case "reset_password":
      return null;
    case "set_active":
      if (typeof value !== "boolean")
        throw new Error("set_active needs true or false");
      return value ? "true" : "false";
    case "change_role": {
      const r = typeof value === "string" ? value.trim().toLowerCase() : "";
      if (r !== "owner" && r !== "manager")
        throw new Error("change_role needs owner or manager");
      return r;
    }
    case "change_email":
    case "add_owner": {
      const e = typeof value === "string" ? value.trim().toLowerCase() : "";
      if (e.length < 3 || e.length > 320 || !e.includes("@"))
        throw new Error(`${action} needs an email address`);
      return e;
    }
  }
}

export interface ReauthDeps {
  /** service-role call reauth_begin: reserves one attempt; throws {message:"REAUTH_LOCKED"} when used up, or any error */
  begin(actorId: string, action: GrantAction, targetId: string): Promise<void>;
  /** Supabase Auth sign-in with a throw-away client; the password stays inside this call */
  verifyPassword(email: string, password: string): Promise<boolean>;
  /** service-role call record_reauth_failure (never receives the password); throws on error */
  recordFailure(
    actorId: string,
    action: GrantAction,
    targetId: string,
  ): Promise<void>;
  /** service-role call issue_reauth (never receives the password; returns nothing); throws on error */
  issue(
    actorId: string,
    action: GrantAction,
    targetId: string,
    detail: string | null,
  ): Promise<void>;
}

export type ConfirmResult = "ok" | "wrong_password" | "locked";

/** True for the error the database raises when the 5 attempts are used up. */
export function isLockedError(e: unknown): boolean {
  const m =
    typeof e === "object" && e !== null && "message" in e
      ? String((e as { message: unknown }).message)
      : String(e);
  return m.includes("REAUTH_LOCKED");
}

/**
 * Steps 1 and 2: reserve an attempt, then check the password. No grant is issued here.
 * A locked actor never reaches the password. An error from the database (including while recording a wrong
 * password) is thrown to the caller, which must treat it as "not confirmed".
 */
export async function confirmPassword(
  deps: ReauthDeps,
  who: { actorId: string; actorEmail: string; password: string },
  action: GrantAction,
  targetId: string,
): Promise<ConfirmResult> {
  try {
    await deps.begin(who.actorId, action, targetId);
  } catch (e) {
    if (isLockedError(e)) return "locked";
    throw e;
  }
  const good = await deps.verifyPassword(who.actorEmail, who.password);
  if (!good) {
    await deps.recordFailure(who.actorId, action, targetId);
    return "wrong_password";
  }
  return "ok";
}

/**
 * Step 3: one grant for exactly one operation on exactly one account. Throws if the database refuses or fails.
 * `value` is the operation's value (see grantDetail).
 */
export async function issueGrant(
  deps: ReauthDeps,
  actorId: string,
  action: GrantAction,
  targetId: string,
  value?: string | boolean | null,
): Promise<void> {
  await deps.issue(actorId, action, targetId, grantDetail(action, value));
}
