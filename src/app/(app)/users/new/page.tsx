import type { Metadata } from "next";
import Link from "next/link";
import { AddUserForm } from "@/components/app/account-forms";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Add person" };

export default async function NewUserPage() {
  const me = await requireUser();
  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <div>
        <Link href="/users" className="text-sm underline underline-offset-4">
          Back to People
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Add a person</h1>
        <p className="text-muted-foreground">
          We will give you a temporary password to pass on. They must choose
          their own the first time they sign in.
        </p>
      </div>
      <AddUserForm actorIsOwner={me.role === "owner"} />
    </main>
  );
}
