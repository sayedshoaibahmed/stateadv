#!/usr/bin/env node
/**
 * Verifies that no secret leaks into the browser bundle (TEST_PLAN SEC-07).
 * Run after `npm run build`:  npm run check:bundle
 *
 * Checks .next/static (everything shipped to browsers) for:
 *  - Supabase secret keys (sb_secret_...)
 *  - legacy service_role JWTs
 *  - the literal value of any server-only env var present in the environment
 * Prints file names only, never the secret values.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const ROOT = ".next/static";
if (!existsSync(ROOT)) {
  console.error("✗ .next/static not found. Run `npm run build` first.");
  process.exit(1);
}

const patterns = [
  /sb_secret_[A-Za-z0-9_-]{10,}/,
  /"role"\s*:\s*"service_role"/,
];
const serverSecrets = ["SUPABASE_SECRET_KEY", "CRON_SECRET"]
  .map((k) => process.env[k])
  .filter((v) => typeof v === "string" && v.length >= 8);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

let files = 0;
const leaks = [];
for (const file of walk(ROOT)) {
  if (!/\.(js|mjs|css|html|json|map|txt)$/.test(file)) continue;
  files++;
  const text = readFileSync(file, "utf8");
  if (
    patterns.some((re) => re.test(text)) ||
    serverSecrets.some((s) => text.includes(s))
  ) {
    leaks.push(file);
  }
}

if (leaks.length) {
  console.error("✗ Possible secret found in browser files:");
  for (const f of leaks) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`✓ ${files} browser file(s) checked — no secrets found.`);
