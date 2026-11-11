import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/app/auth-shell";
import { NewPasswordForm } from "@/components/app/new-password-form";
import { getSession, requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage() {
  // Reached from the link in the email, which signs the person in for this one job.
  const session = await getSession();
  if (session.state === "anonymous") redirect("/forgot-password?error=link");
  await requireUser({ allowPasswordChange: true });

  return (
    <AuthShell
      title="Choose a new password"
      description="You will be signed in with it straight away."
    >
      <NewPasswordForm />
    </AuthShell>
  );
}
