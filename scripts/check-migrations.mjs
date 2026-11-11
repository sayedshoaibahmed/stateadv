#!/usr/bin/env node
/**
 * Migration safety check (SECURITY.md §9 "Migration safety").
 *
 * Fails if any migration in supabase/migrations contains a destructive
 * statement without an explicit approval comment on the line(s) above:
 *
 *   -- DESTRUCTIVE-APPROVED: <reason>
 *
 * Usage: npm run check:migrations
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase/migrations";
const DESTRUCTIVE = [
  /\bdrop\s+(table|schema|column|database|view|materialized\s+view|function|type|trigger|policy|index|extension)\b/i,
  // a TRUNCATE statement - but not the words in "CREATE TRIGGER ... BEFORE TRUNCATE ON ..."
  /(?<!before\s+)(?<!after\s+)\btruncate\b/i,
  /\bdelete\s+from\b/i,
  /\balter\s+table\b[\s\S]*?\balter\s+column\b[\s\S]*?\btype\b/i,
  /\balter\s+table\b[\s\S]*?\bdrop\b/i,
];
const APPROVAL = /--\s*DESTRUCTIVE-APPROVED:\s*\S+/i;

function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

export function findViolations(fileName, content) {
  const violations = [];
  // Split into statements; keep the original text (with comments) of each.
  const statements = content.split(/;\s*(?:\r?\n|$)/);
  let lineNo = 1;
  for (const stmt of statements) {
    const code = stripComments(stmt);
    const hit = DESTRUCTIVE.find((re) => re.test(code));
    if (hit && !APPROVAL.test(stmt)) {
      const firstLine = code.trim().split(/\r?\n/)[0]?.slice(0, 80) ?? "";
      violations.push(`${fileName}:~${lineNo}: ${firstLine}`);
    }
    lineNo += (stmt.match(/\n/g) ?? []).length + 1;
  }
  return violations;
}

function main() {
  if (!existsSync(DIR)) {
    console.log(`✓ No ${DIR} directory yet — nothing to check.`);
    return 0;
  }
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const violations = files.flatMap((f) =>
    findViolations(f, readFileSync(join(DIR, f), "utf8")),
  );
  if (violations.length) {
    console.error(
      "✗ Destructive SQL without '-- DESTRUCTIVE-APPROVED: <reason>':",
    );
    for (const v of violations) console.error(`  ${v}`);
    return 1;
  }
  console.log(
    `✓ ${files.length} migration file(s) checked — no unapproved destructive statements.`,
  );
  return 0;
}

if (
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` ||
  process.argv[1]?.endsWith("check-migrations.mjs")
) {
  process.exit(main());
}
