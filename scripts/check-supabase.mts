/**
 * Verifies the Supabase connection using .env.local.
 * Prints only pass/fail — never keys or URLs.
 *
 *   npm run check:supabase
 */
import { existsSync } from "node:fs";
import { checkSupabase } from "../src/lib/supabase/health";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  console.error(
    "✗ NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY missing (see .env.example)",
  );
  process.exit(1);
}
if (key.startsWith("sb_secret_")) {
  console.error("✗ A SECRET key is in a public variable. Fix .env.local.");
  process.exit(1);
}

const result = await checkSupabase(url, key);
console.log(
  `Supabase auth service : ${result.auth === "ok" ? "✓ ok" : "✗ error"}`,
);
console.log(
  `Supabase database API : ${result.database === "ok" ? "✓ ok" : "✗ error"}`,
);
if (result.detail) console.log(`Detail: ${result.detail}`);
process.exit(result.ok ? 0 : 1);
