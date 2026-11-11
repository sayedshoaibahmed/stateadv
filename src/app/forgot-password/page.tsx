import type { Metadata } from "next";
import { AuthShell } from "@/components/app/auth-shell";
import { ForgotPasswordForm } from "@/components/app/forgot-password-form";

export const metadata: Metadata = { title: "Forgot password" };

export default async function ForgotPasswordPage({
  searchParams,
}: PageProps<"/forgot-password">) {
  const params = await searchParams;
  return (
    <AuthShell
      title="Forgot your password?"
      description="Owners can get a link by email to choose a new password. Managers: please ask an Owner to reset it for you."
    >
      <ForgotPasswordForm linkProblem={params.error === "link"} />
    </AuthShell>
  );
}
