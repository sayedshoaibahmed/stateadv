import type { Metadata } from "next";
import {
  OwnEmailForm,
  OwnPasswordForm,
  Section,
} from "@/components/app/account-forms";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "My Account" };

export default async function AccountPage() {
  const me = await requireUser();
  return (
    <main className="flex max-w-3xl flex-1 flex-col gap-4 p-4">
      <div>
        <h1 className="text-2xl font-semibold">My Account</h1>
        <p className="text-muted-foreground">
          {me.fullName} · {me.role === "owner" ? "Owner" : "Manager"} ·{" "}
          {me.email}
        </p>
      </div>
      <Section title="Change my password">
        <OwnPasswordForm />
      </Section>
      <Section title="Change my email">
        <OwnEmailForm currentEmail={me.email} />
      </Section>
    </main>
  );
}
