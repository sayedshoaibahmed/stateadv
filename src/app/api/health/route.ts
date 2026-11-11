import { connection } from "next/server";
import { getPublicEnv } from "@/lib/env";
import { checkSupabase } from "@/lib/supabase/health";

/**
 * GET /api/health — app + Supabase connectivity.
 * Public, returns no secrets, never cached.
 */
export async function GET() {
  await connection(); // always run at request time (never prerendered)

  let env;
  try {
    env = getPublicEnv();
  } catch {
    return Response.json(
      { status: "error", app: "ok", supabase: "not_configured" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const s = await checkSupabase(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  return Response.json(
    {
      status: s.ok ? "ok" : "error",
      app: "ok",
      supabase: { auth: s.auth, database: s.database },
      time: new Date().toISOString(),
    },
    { status: s.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
