/**
 * Logic of the last-resort "recover an Owner account" script (PRD FR-AUTH-13.2, O4).
 * Free of network code so it can be tested with fakes. It can only act on an EXISTING Owner:
 * it cannot create accounts, change anyone else, or lower the "at least one active Owner" rule.
 */
import { z } from "zod";

export interface RecoverDeps {
  findOwnerByEmail(
    email: string,
  ): Promise<{ id: string; fullName: string } | null>;
  /** database function recover_owner_account: re-enables, forces a password change, writes the audit entry */
  recoverInDatabase(id: string, reason: string): Promise<void>;
  /** unban the login, set a temporary password, optionally remove two-step login devices */
  restoreLogin(
    id: string,
    tempPassword: string,
    resetMfa: boolean,
  ): Promise<void>;
  log(message: string): void;
}

export const recoverInput = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("That is not an email address.")),
  reason: z
    .string()
    .trim()
    .min(10, "Please write a reason of at least 10 characters.")
    .max(500),
  resetMfa: z.boolean(),
});
export type RecoverInput = z.infer<typeof recoverInput>;

export type RecoverResult =
  | { status: "recovered"; tempPassword: string }
  | { status: "dry-run" }
  | { status: "refused"; reason: string };

export async function recoverOwner(
  deps: RecoverDeps,
  input: RecoverInput,
  options: { dryRun: boolean; makePassword: () => string },
): Promise<RecoverResult> {
  const parsed = recoverInput.safeParse(input);
  if (!parsed.success) {
    return {
      status: "refused",
      reason: parsed.error.issues.map((i) => i.message).join(" "),
    };
  }
  const owner = await deps.findOwnerByEmail(parsed.data.email);
  if (!owner) {
    return {
      status: "refused",
      reason: "No Owner account has this email. Nothing was changed.",
    };
  }
  deps.log(
    `Will recover Owner account: ${owner.fullName} <${parsed.data.email}>${parsed.data.resetMfa ? " and remove their two-step login devices" : ""}.`,
  );
  if (options.dryRun) {
    deps.log("Dry run: nothing was changed.");
    return { status: "dry-run" };
  }
  const tempPassword = options.makePassword();
  // database first (rules + audit "owner_recovered"), then the login
  await deps.recoverInDatabase(owner.id, parsed.data.reason);
  await deps.restoreLogin(owner.id, tempPassword, parsed.data.resetMfa);
  deps.log(
    "Done. The account is switched on and must choose a new password at the next sign-in.",
  );
  return { status: "recovered", tempPassword };
}
