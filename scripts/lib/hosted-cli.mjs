/**
 * Shared, READ-ONLY access to the hosted project for the preflight and the catalog comparison.
 * Every query goes through `supabase db query --read-only`; the connection string comes from SUPABASE_DB_URL
 * (.env.local, never the command line) and EVERY part of it is redacted from anything this module returns or prints.
 */
import { spawnSync } from "node:child_process";

export function connectHosted() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    /* reported below */
  }
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error(
      "SUPABASE_DB_URL is not set in .env.local (it is only for local developer tooling).",
    );
    process.exit(2);
  }

  const secrets = new Set([url]);
  try {
    const u = new URL(url);
    for (const x of [
      u.password,
      decodeURIComponent(u.password),
      u.username,
      u.hostname,
    ])
      if (x && x.length >= 4) secrets.add(x);
  } catch {
    /* an invalid URL fails the first query */
  }
  const redact = (t) =>
    [...secrets].reduce((s, x) => s.split(x).join("«redacted»"), String(t));

  const CLI = ["node_modules/supabase/dist/supabase.js"];
  function cli(args) {
    const r = spawnSync(
      process.execPath,
      [...CLI, ...args, `--remote=${url}`],
      {
        encoding: "utf8",
        timeout: 120000,
        maxBuffer: 256 * 1024 * 1024,
        env: { ...process.env, NO_COLOR: "1" },
      },
    );
    return { status: r.status, out: `${r.stdout ?? ""}\n${r.stderr ?? ""}` };
  }
  /** Rows of one read-only query. Retries a few times (the pooler occasionally drops a connection). */
  function query(sql) {
    let last = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      const r = cli(["db", "query", "--read-only", sql]);
      const text = r.out;
      const a = text.indexOf("{");
      try {
        const parsed = JSON.parse(text.slice(a, text.lastIndexOf("}") + 1));
        if (r.status === 0 && Array.isArray(parsed.rows)) return parsed.rows;
      } catch {
        /* fall through */
      }
      last = redact(text).slice(0, 300);
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        2000 * attempt,
      );
    }
    throw new Error("query failed: " + last);
  }
  return { redact, cli, query };
}
