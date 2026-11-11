import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * A person whose password is right but whose account is switched off (or has
 * no profile) is sent here by the server. It ends their login session and
 * shows the sign-in page with an explanation.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(
    new URL("/login?reason=no-access", new URL(request.url).origin),
  );
}
