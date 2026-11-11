/**
 * ONE-TIME script: creates the very first Owner account.
 *
 *   npx tsx scripts/create-first-user.ts --dry-run     (checks everything, creates NOTHING)
 *   npx tsx scripts/create-first-user.ts --dry-run --name="Test Owner" --email=test@example.com   (no prompts; dry run only)
 *   npx tsx scripts/create-first-user.ts               (creates the account)
 *
 * It reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from .env.local (never from the command line),
 * asks for the Owner's name and email, and asks for the temporary password through a hidden prompt.
 * The password is never printed, logged or saved. It refuses to run if any account already exists.
 *
 * Before the REAL run: the Secret Key that was once pasted into a chat must be replaced (Supabase dashboard →
 * Project Settings → API Keys), the new key put into .env.local, and the project owner must have approved.
 */
import { createClient } from "@supabase/supabase-js";
import { ask, askHidden } from "./lib/prompt";
import { createFirstOwner, type FirstOwnerDeps } from "./lib/first-owner";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* .env.local missing: the check below explains */
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
const dryRun = process.argv.includes("--dry-run");
const argValue = (flag: string) =>
  process.argv.find((a) => a.startsWith(`${flag}=`))?.slice(flag.length + 1);
const argName = argValue("--name");
const argEmail = argValue("--email");
if ((argName !== undefined || argEmail !== undefined) && !dryRun) {
  console.error(
    "--name and --email are only accepted together with --dry-run. A real run asks for them interactively.",
  );
  process.exit(1);
}

if (!url || !key) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local.",
  );
  process.exit(1);
}

const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const host = new URL(url).hostname;

const deps: FirstOwnerDeps = {
  async countProfiles() {
    const { count, error } = await admin
      .from("user_profiles")
      .select("id", { count: "exact", head: true });
    if (error) throw new Error("Could not check existing accounts.");
    return count ?? 0;
  },
  async authUserExists(email) {
    // Auth admin API has no lookup by email; page through (a new project has a handful of users at most).
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await admin.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (error) throw new Error("Could not check existing logins.");
      if (data.users.some((u) => u.email?.toLowerCase() === email)) return true;
      if (data.users.length < 200) return false;
    }
    return true; // too many users: do not guess
  },
  async createAuthUser(email, password) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error("The login could not be created.");
    return data.user.id;
  },
  async insertOwnerProfile({ id, fullName, email }) {
    const { error } = await admin
      .from("user_profiles")
      .insert({ id, full_name: fullName, email, role: "owner" });
    if (error) throw new Error(error.message);
  },
  async deleteAuthUser(id) {
    await admin.auth.admin.deleteUser(id);
  },
  log: (m) => console.log(m),
};

async function main() {
  console.log(
    `Project: ${host}${dryRun ? "   (DRY RUN: nothing will be created)" : ""}`,
  );
  if (!dryRun) {
    const rotated = await ask(
      "Has the Secret Key that was once shared in chat been replaced, and has the project owner approved this run? (yes/no) ",
    );
    if (rotated.toLowerCase() !== "yes") {
      console.log("Stopped. Replace the key and get approval first.");
      return;
    }
  }
  // Dry run only: the name and email may be given as --name=... and --email=... (never a password). A real run
  // always asks interactively, and refuses these arguments.
  const fullName = argName ?? (await ask("Owner's full name: "));
  const email = argEmail ?? (await ask("Owner's email: "));
  let password = "";
  if (!dryRun) {
    password = await askHidden(
      "Temporary password (hidden, at least 12 characters): ",
    );
    const again = await askHidden("Type it again: ");
    if (password !== again) {
      console.error("The two passwords are not the same. Nothing was created.");
      process.exit(1);
    }
  } else {
    password = "dry-run-placeholder-not-used"; // never sent anywhere in a dry run
  }
  if (!dryRun) {
    const confirm = await ask(
      `Type CREATE OWNER to create ${email} as the first Owner of ${host}: `,
    );
    if (confirm !== "CREATE OWNER") {
      console.log("Stopped. Nothing was created.");
      return;
    }
  }
  const result = await createFirstOwner(
    deps,
    { fullName, email, password },
    { dryRun },
  );
  if (result.status === "refused") {
    console.error(result.reason);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(
    e instanceof Error
      ? e.message
      : "Something went wrong. Nothing was created.",
  );
  process.exit(1);
});
