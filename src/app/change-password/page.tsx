import type { Metadata } from "next";
import { AuthShell } from "@/components/app/auth-shell";
import { NewPasswordForm } from "@/components/app/new-password-form";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Change your password" };

export default async function ChangePasswordPage() {
  const user = await requireUser({ allowPasswordChange: true });
  return (
    <AuthShell
      title="Choose your own password"
      description={
        user.mustChangePassword
          ? "You are using a temporary password. Please choose your own before you continue."
          : "Choose a new password."
      }
    >
      <NewPasswordForm />
    </AuthShell>
  );
}
