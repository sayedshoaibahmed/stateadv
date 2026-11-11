/**
 * Logic of the one-time "create the first Owner" script, kept free of any network code so it can be
 * tested with fakes. The script (scripts/create-first-user.ts) supplies the real Supabase calls.
 *
 * Rules (PRD FR-AUTH-14, O5; TRD 5.7):
 *  - runs only when NO profile exists, so it can never create a second Owner or a hidden account;
 *  - creates exactly ONE Owner, the real person whose name and email you type;
 *  - the password is never printed, logged or returned; the person must change it at first sign-in
 *    (the database sets must_change_password = true on every new profile);
 *  - if the profile cannot be saved, the login that was just created is removed again;
 *  - the database writes the "account created" audit entry itself (trigger).
 */
import { z } from "zod";

export interface FirstOwnerDeps {
  countProfiles(): Promise<number>;
  authUserExists(email: string): Promise<boolean>;
  createAuthUser(email: string, password: string): Promise<string>;
  insertOwnerProfile(p: {
    id: string;
    fullName: string;
    email: string;
  }): Promise<void>;
  deleteAuthUser(id: string): Promise<void>;
  log(message: string): void;
}

export const firstOwnerInput = z.object({
  fullName: z.string().trim().min(1, "The name is required.").max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("That is not an email address.")),
  password: z
    .string()
    .min(12, "Use at least 12 characters.")
    .max(72, "Use at most 72 characters."),
});
export type FirstOwnerInput = z.infer<typeof firstOwnerInput>;

export type FirstOwnerResult =
  | { status: "created"; id: string }
  | { status: "dry-run" }
  | { status: "refused"; reason: string };

export async function createFirstOwner(
  deps: FirstOwnerDeps,
  input: FirstOwnerInput,
  options: { dryRun: boolean },
): Promise<FirstOwnerResult> {
  const parsed = firstOwnerInput.safeParse(input);
  if (!parsed.success) {
    return {
      status: "refused",
      reason: parsed.error.issues.map((i) => i.message).join(" "),
    };
  }
  const { fullName, email, password } = parsed.data;

  const profiles = await deps.countProfiles();
  if (profiles !== 0) {
    return {
      status: "refused",
      reason:
        "Accounts already exist. This script can only create the very first Owner. Use the People page to add anyone else.",
    };
  }
  if (await deps.authUserExists(email)) {
    return {
      status: "refused",
      reason:
        "A login with this email already exists in Supabase Auth. Nothing was created.",
    };
  }

  deps.log(
    `Will create ONE Owner: ${fullName} <${email}> (must choose a new password at first sign-in).`,
  );
  if (options.dryRun) {
    deps.log("Dry run: nothing was created.");
    return { status: "dry-run" };
  }

  const id = await deps.createAuthUser(email, password);
  try {
    await deps.insertOwnerProfile({ id, fullName, email });
  } catch (e) {
    await deps.deleteAuthUser(id).catch(() => undefined); // do not leave a login without a profile
    return {
      status: "refused",
      reason: `The profile could not be saved (${e instanceof Error ? e.message : "unknown"}). The new login was removed. Nothing was created.`,
    };
  }
  deps.log(
    "Done. The Owner account exists. The password was not shown or saved anywhere.",
  );
  return { status: "created", id };
}
