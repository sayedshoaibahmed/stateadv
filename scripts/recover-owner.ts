/**
 * LAST-RESORT script: gets an existing Owner account working again (PRD FR-AUTH-13.2).
 * Use it only when no Owner can sign in and "Forgot password" cannot help.
 *
 *   npx tsx scripts/recover-owner.ts --dry-run         (checks only)
 *   npx tsx scripts/recover-owner.ts [--reset-mfa]     (switches the account on, sets a temporary password)
 *
 * It reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from .env.local. The database records
 * "owner_recovered" with your reason. The temporary password is shown once on your screen only.
 */
import { createClient } from "@supabase/supabase-js";
import { generateTempPassword } from "../src/lib/accounts/rules";
import { ask } from "./lib/prompt";
import { recoverOwner, type RecoverDeps } from "./lib/recover-owner";

try {
  process.loadEnvFile(".env.local");
} catch {
  /* explained below */
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
const dryRun = process.argv.includes("--dry-run");
const resetMfa = process.argv.includes("--reset-mfa");
if (!url || !key) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local.",
  );
  process.exit(1);
}
const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const deps: RecoverDeps = {
  async findOwnerByEmail(email) {
    const { data, error } = await admin
      .from("user_profiles")
      .select("id, full_name")
      .eq("email", email)
      .eq("role", "owner")
      .maybeSingle();
    if (error) throw new Error("Could not look up the account.");
    return data
      ? { id: data.id as string, fullName: data.full_name as string }
      : null;
  },
  async recoverInDatabase(id, reason) {
    const { error } = await admin.rpc("recover_owner_account", {
      p_target: id,
      p_reason: reason,
    });
    if (error) throw new Error(`The database refused: ${error.message}`);
  },
  async restoreLogin(id, tempPassword, mfa) {
    const res = await admin.auth.admin.updateUserById(id, {
      password: tempPassword,
      ban_duration: "none",
    });
    if (res.error) throw new Error("The login could not be updated.");
    if (mfa) {
      const { data } = await admin.auth.admin.mfa.listFactors({ userId: id });
      for (const f of data?.factors ?? [])
        await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: id });
    }
  },
  log: (m) => console.log(m),
};

async function main() {
  console.log(
    `Project: ${new URL(url!).hostname}${dryRun ? "   (DRY RUN)" : ""}`,
  );
  const email = await ask("Email of the Owner account to recover: ");
  const reason = await ask("Why is recovery needed? (at least 10 characters) ");
  if (!dryRun) {
    const ok = await ask("Type RECOVER to continue: ");
    if (ok !== "RECOVER") {
      console.log("Stopped. Nothing was changed.");
      return;
    }
  }
  const r = await recoverOwner(
    deps,
    { email, reason, resetMfa },
    { dryRun, makePassword: generateTempPassword },
  );
  if (r.status === "refused") {
    console.error(r.reason);
    process.exit(1);
  }
  if (r.status === "recovered") {
    console.log(
      `\nTemporary password (shown once, write it down privately): ${r.tempPassword}\n`,
    );
  }
}
main().catch((e) => {
  console.error(
    e instanceof Error
      ? e.message
      : "Something went wrong. Please check and try again.",
  );
  process.exit(1);
});
