import { timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { getServerEnv } from "@/lib/env.server";
import { processBookingPdf, type PipelineClient } from "@/lib/pdf/pipeline";
import { renderBookingPdf } from "@/lib/pdf/render";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/cron/pdf-retry: the retry job (TRD 5.6, every 10 minutes from vercel.json). It picks up PDF jobs that are still
 * open (a failed attempt, or one that never ran) and makes the PDFs. It is the only place besides user management that
 * uses the secret key (SECURITY.md section 4), and it is closed to everybody who does not send the CRON_SECRET: with no
 * secret configured it refuses everyone. The answer holds counts only, never booking data.
 */
export async function GET(request: Request) {
  await connection();
  const secret = getServerEnv().CRON_SECRET;
  if (!secret)
    return Response.json(
      { status: "not_configured" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  const sent = request.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  const a = Buffer.from(sent);
  const b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return Response.json(
      { status: "unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const admin = createAdminClient();
  const claimed = await admin.rpc("claim_pdf_jobs", { p_max: 10 });
  if (claimed.error)
    return Response.json(
      { status: "error" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  const bookings = [...new Set((claimed.data ?? []).map((j) => j.booking_id))];
  let created = 0;
  let unchanged = 0;
  let failed = 0;
  for (const id of bookings) {
    const out = await processBookingPdf(
      admin as unknown as PipelineClient,
      id,
      { render: renderBookingPdf, system: true },
    );
    if (out.status === "created") created++;
    else if (out.status === "unchanged") unchanged++;
    else failed++;
  }
  return Response.json(
    {
      status: "ok",
      jobs: claimed.data?.length ?? 0,
      bookings: bookings.length,
      created,
      unchanged,
      failed,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
