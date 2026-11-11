/**
 * Which account actions are "protected" (PRD FR-AUTH-10..12, O1-O3, O6).
 * Pure functions, so the rule can be tested without a browser or a database.
 * The DATABASE enforces who may do what (migrations 06 and 12); this decides when the app
 * must also ask for a written reason and the acting person's own password.
 */
import { randomInt } from "node:crypto";

export type Role = "owner" | "manager";

export type AccountAction =
  | "add_user"
  | "edit_details"
  | "change_role"
  | "switch_off"
  | "switch_on"
  | "reset_password"
  | "change_email";

export interface ProtectedCheck {
  action: AccountAction;
  /** Role of the account being acted on (for add_user: the role being given). */
  targetRole: Role;
  /** For change_role: the new role. */
  newRole?: Role;
}

/** Minimum length of the written reason for a protected action. */
export const PROTECTED_REASON_MIN = 10;

/**
 * True when the app must collect a reason (10+ characters) AND the acting person's own
 * password before doing it.
 *  - any change to an Owner account except editing the name/phone (O1, O3)
 *  - giving the Owner role: adding an Owner (O6) or promoting someone to Owner (O2)
 */
export function isProtectedAction(c: ProtectedCheck): boolean {
  if (c.action === "add_user") return c.targetRole === "owner";
  if (c.action === "change_role")
    return c.targetRole === "owner" || c.newRole === "owner";
  if (c.action === "edit_details") return false;
  return c.targetRole === "owner";
}

/** Only an Owner may give the Owner role or act on an Owner (the database enforces it too). */
export function mayAttempt(actorRole: Role, c: ProtectedCheck): boolean {
  if (actorRole === "owner") return true;
  return !isProtectedAction(c) || c.action === "edit_details";
}

// ---------------------------------------------------------------------------
// Temporary passwords (given to a new person or after a reset; they must change it at first sign-in)
// ---------------------------------------------------------------------------
// No look-alike characters (0 O 1 l I) so it can be read out or typed from a message.
const WORDS = "abcdefghjkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const ALL = WORDS + UPPER + DIGITS;

function pick(set: string): string {
  return set[randomInt(set.length)];
}

/** 16 characters from a cryptographically secure source, with at least one of each kind. */
export function generateTempPassword(length = 16): string {
  const chars = [pick(WORDS), pick(UPPER), pick(DIGITS)];
  while (chars.length < length) chars.push(pick(ALL));
  // Fisher-Yates shuffle with secure randomness
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

// ---------------------------------------------------------------------------
// Dashboard alerts for sensitive account events (FR-AUTH-12, FR-AUTH-16)
// ---------------------------------------------------------------------------
export interface AuditRow {
  action: string; // insert | update | password_reset | owner_recovered
  actor_name: string | null;
  occurred_at: string;
  reason: string | null;
  changed_fields: string[] | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
}

/**
 * A one-line sentence for an alert, or null when the event is not about an Owner account.
 * Example: "Owner account Ravi Kumar was switched off by Sunita Rao. Reason: …"
 */
export function describeOwnerEvent(r: AuditRow): string | null {
  const data = r.new_data ?? {};
  const name = typeof data.full_name === "string" ? data.full_name : "someone";
  const by = r.actor_name ?? "the system";
  const why = r.reason ? ` Reason: ${r.reason}` : "";
  const wasOwner = (r.old_data?.role ?? data.role) === "owner";
  const isOwner = data.role === "owner";

  if (r.action === "owner_recovered") {
    return `Owner account ${name} was recovered by the server script.${why}`;
  }
  if (r.action === "password_reset") {
    return isOwner
      ? `The password of Owner account ${name} was reset by ${by}.${why}`
      : null;
  }
  if (r.action === "insert") {
    return isOwner
      ? `A new Owner account, ${name}, was added by ${by}.${why}`
      : null;
  }
  if (r.action !== "update") return null;

  const fields = r.changed_fields ?? [];
  if (fields.includes("role") && (isOwner || wasOwner)) {
    return isOwner
      ? `${name} was made an Owner by ${by}.${why}`
      : `${name} is no longer an Owner (changed by ${by}).${why}`;
  }
  if (!isOwner) return null;
  if (fields.includes("is_active")) {
    return data.is_active
      ? `Owner account ${name} was switched on by ${by}.${why}`
      : `Owner account ${name} was switched off by ${by}.${why}`;
  }
  if (fields.includes("email")) {
    const verified = r.actor_name === null; // Supabase Auth made the change after the person confirmed the link
    return verified
      ? `Owner account ${name} changed its email after confirming the link.`
      : `The email of Owner account ${name} was changed by ${by}.${why}`;
  }
  return null;
}
