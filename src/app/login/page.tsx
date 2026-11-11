import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AuthShell } from "@/components/app/auth-shell";
import { LoginForm } from "@/components/app/login-form";
import { getSession } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/routes";

export const metadata: Metadata = { title: "Sign in" };

const REASONS: Record<string, string> = {
  "signed-out": "You have been signed out.",
  "no-access": "This account cannot be used right now. Please ask the owner.",
  expired: "Your sign-in has expired. Please sign in again.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? safeNext(params.next) : "/";
  const reason = typeof params.reason === "string" ? params.reason : "";

  // Already signed in with a working account: nothing to do here.
  const session = await getSession();
  if (session.state === "ok") redirect(next);

  return (
    <AuthShell
      title="Sign in"
      description="Use the email and password you were given."
    >
      {REASONS[reason] ? (
        <Alert className="mb-4" role="status">
          <AlertDescription>{REASONS[reason]}</AlertDescription>
        </Alert>
      ) : null}
      <LoginForm next={next === "/" ? undefined : next} />
    </AuthShell>
  );
}
