/**
 * Supabase connectivity check (used by /api/health and scripts/check-supabase.ts).
 * Never returns or logs keys or URLs.
 */
export interface SupabaseHealth {
  ok: boolean;
  auth: "ok" | "error";
  database: "ok" | "error";
  detail?: string;
}

export async function checkSupabase(
  url: string,
  publishableKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SupabaseHealth> {
  const headers = { apikey: publishableKey };
  const signal = AbortSignal.timeout(8000);

  // 1. Auth service reachable and key accepted.
  let auth: SupabaseHealth["auth"] = "error";
  let detail: string | undefined;
  try {
    const res = await fetchImpl(`${url}/auth/v1/health`, { headers, signal });
    auth = res.ok ? "ok" : "error";
    if (!res.ok) detail = `auth status ${res.status}`;
  } catch {
    detail = "auth unreachable";
  }

  // 2. Database API (PostgREST) reachable and key accepted.
  //    M1 has no tables yet: querying a non-existent table must return a
  //    PostgREST "relation not found" error (PGRST205 / 42P01), which proves
  //    the request reached the database API with a valid key.
  //    401/403 would mean the key was rejected.
  let database: SupabaseHealth["database"] = "error";
  try {
    const res = await fetchImpl(
      `${url}/rest/v1/__connection_check__?select=*&limit=1`,
      { headers, signal },
    );
    if (res.ok) {
      database = "ok";
    } else if (res.status === 401 || res.status === 403) {
      detail = `database key rejected (status ${res.status})`;
    } else {
      const body = (await res.json().catch(() => ({}))) as { code?: string };
      if (body.code === "PGRST205" || body.code === "42P01") {
        database = "ok";
      } else {
        detail = `database status ${res.status}${body.code ? ` (${body.code})` : ""}`;
      }
    }
  } catch {
    detail = detail ?? "database unreachable";
  }

  return { ok: auth === "ok" && database === "ok", auth, database, detail };
}
