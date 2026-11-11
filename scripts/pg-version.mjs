// Prints the version of the PostgreSQL server named by STATEADV_PG_URL (never the URL itself).
import pg from "pg";

const url = process.env.STATEADV_PG_URL;
if (!url) {
  console.error("STATEADV_PG_URL is not set.");
  process.exit(1);
}
if (/supabase\.(co|com)/i.test(url)) {
  console.error("Refusing to run against a Supabase host.");
  process.exit(1);
}
const c = new pg.Client({ connectionString: url });
await c.connect();
const { rows } = await c.query(
  "select version() as v, current_setting('server_version_num')::int as n",
);
await c.end();
console.log(rows[0].v);
if (Math.floor(rows[0].n / 10000) !== 17) {
  console.error("Expected PostgreSQL 17.");
  process.exit(1);
}
