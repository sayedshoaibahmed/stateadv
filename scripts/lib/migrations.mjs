/**
 * Pure helpers for reading the migration files and comparing them with the hosted history. No database, no network:
 * everything here is unit-tested (tests/unit/hosted-preflight.test.ts) and used by scripts/hosted-preflight.mjs.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const norm = (s) => s.replace(/\r\n/g, "\n");

/** Migration files in order: [{ version, name, file, sql }] (versions are 14 digits, names follow the underscore). */
export function listMigrations(dir) {
  return readdirSync(dir)
    .filter((f) => /^\d{14}_.+\.sql$/.test(f))
    .sort()
    .map((file) => ({
      version: file.slice(0, 14),
      name: file.slice(15, -4),
      file,
      sql: norm(readFileSync(join(dir, file), "utf8")),
    }));
}

/**
 * Compare the hosted history (rows of supabase_migrations.schema_migrations: { version, name }) with the files.
 * The hosted history must be exactly the FIRST N files, in order, with the same names. Whatever follows is pending.
 */
export function planPending(files, hosted) {
  const problems = [];
  const rows = [...hosted].sort((a, b) => (a.version < b.version ? -1 : 1));
  if (rows.length > files.length)
    problems.push(
      `hosted has ${rows.length} migrations but the repository has only ${files.length}`,
    );
  for (let i = 0; i < Math.min(rows.length, files.length); i++) {
    if (rows[i].version !== files[i].version || rows[i].name !== files[i].name)
      problems.push(
        `position ${i + 1}: hosted has ${rows[i].version} ${rows[i].name}, the repository has ${files[i].version} ${files[i].name}`,
      );
  }
  const pending = problems.length === 0 ? files.slice(rows.length) : [];
  // the pending versions must come after everything applied (guaranteed by order, checked for clarity)
  if (
    pending.length &&
    rows.length &&
    pending[0].version <= rows[rows.length - 1].version
  )
    problems.push("a pending migration is older than the latest applied one");
  return { problems, applied: files.slice(0, rows.length), pending };
}

// ---- destructive statements (same rule as scripts/check-migrations.mjs)
const DESTRUCTIVE = [
  /\bdrop\s+(table|schema|column|database|view|materialized\s+view|function|type|trigger|policy|index|extension)\b/i,
  /(?<!before\s+)(?<!after\s+)\btruncate\b/i,
  /\bdelete\s+from\b/i,
  /\balter\s+table\b[\s\S]*?\balter\s+column\b[\s\S]*?\btype\b/i,
  /\balter\s+table\b[\s\S]*?\bdrop\b/i,
];
const APPROVAL = /--\s*DESTRUCTIVE-APPROVED:\s*\S+/i;
export const stripComments = (sql) =>
  sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");

/** Every destructive statement of a migration, with whether it carries the approval comment. */
export function destructiveStatements(sql) {
  const out = [];
  for (const stmt of sql.split(/;\s*(?:\r?\n|$)/)) {
    const code = stripComments(stmt);
    if (DESTRUCTIVE.some((re) => re.test(code)))
      out.push({
        text: code.trim().split(/\r?\n/)[0].slice(0, 100),
        approved: APPROVAL.test(stmt),
      });
  }
  return out;
}

/**
 * Functions defined by a migration: [{ name, replace, body }]. `body` is the text between the dollar quotes,
 * exactly what PostgreSQL stores as the function's source (pg_proc.prosrc).
 */
export function definedFunctions(sql) {
  const out = [];
  const head = /^create\s+(or\s+replace\s+)?function\s+public\.(\w+)/gim;
  let m;
  while ((m = head.exec(sql))) {
    const rest = sql.slice(m.index + m[0].length);
    const open = /\bas\s+(\$[A-Za-z_]*\$)/i.exec(rest);
    if (!open) continue;
    const bodyStart = open.index + open[0].length;
    const close = rest.indexOf(open[1], bodyStart);
    if (close < 0) continue;
    out.push({
      name: m[2],
      replace: Boolean(m[1]),
      body: rest.slice(bodyStart, close),
    });
  }
  return out;
}

/** Tables created by a migration (public schema). */
export function createdTables(sql) {
  return [
    ...stripComments(sql).matchAll(
      /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)/gi,
    ),
  ].map((m) => m[1]);
}

/** Policies created by a migration: [{ name, table }] (quoted or plain names). */
export function createdPolicies(sql) {
  return [
    ...stripComments(sql).matchAll(
      /\bcreate\s+policy\s+(?:"([^"]+)"|(\w+))\s+on\s+(?:public|storage)\.(\w+)/gi,
    ),
  ].map((m) => ({ name: m[1] ?? m[2], table: m[3] }));
}

/**
 * The source each function should have on the hosted project RIGHT NOW: the LAST definition among the already applied
 * migrations (`applied`), for the given function names. Returns { name: body } (names without a definition are absent).
 */
export function baselineBodies(applied, names) {
  const out = {};
  for (const mig of applied)
    for (const f of definedFunctions(mig.sql))
      if (names.includes(f.name)) out[f.name] = f.body;
  return out;
}
