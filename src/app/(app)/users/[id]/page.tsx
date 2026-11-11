import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  ChangeRoleForm,
  ChangeUserEmailForm,
  EditDetailsForm,
  ResetPasswordForm,
  Section,
  SwitchForm,
} from "@/components/app/account-forms";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Person" };

interface Profile {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: "owner" | "manager";
  is_active: boolean;
  disabled_at: string | null;
}
interface History {
  id: number;
  action: string;
  actor_name: string | null;
  occurred_at: string;
  reason: string | null;
  changed_fields: string[] | null;
}

const FIELD_NAMES: Record<string, string> = {
  full_name: "name",
  phone: "phone",
  role: "role",
  is_active: "on/off status",
  email: "email",
  must_change_password: "password",
};

function describe(h: History): string {
  const by = h.actor_name ?? "the system";
  if (h.action === "insert") return `Added by ${by}`;
  if (h.action === "password_reset") return `Password reset by ${by}`;
  if (h.action === "owner_recovered") return "Recovered by the server script";
  const fields = (h.changed_fields ?? [])
    .map((f) => FIELD_NAMES[f] ?? "details")
    .join(", ");
  return `${fields ? `Changed ${fields}` : "Changed"} by ${by}`;
}

export default async function UserPage({ params }: PageProps<"/users/[id]">) {
  const { id } = await params;
  const me = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const supabase = await createClient();
  const { data } = await supabase
    .from("user_profiles")
    .select("id, full_name, email, phone, role, is_active, disabled_at")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const p = data as Profile;
  const { data: hist } = await supabase
    .from("audit_logs")
    .select("id, action, actor_name, occurred_at, reason, changed_fields")
    .eq("table_name", "user_profiles")
    .eq("target_user_id", id)
    .order("id", { ascending: false })
    .limit(15);
  const history = (hist ?? []) as History[];

  const isMe = p.id === me.id;
  const targetIsOwner = p.role === "owner";
  const actorIsOwner = me.role === "owner";
  const locked = targetIsOwner && !actorIsOwner; // a Manager may view, not change, an Owner account
  const canProtect = !locked && !isMe;

  return (
    <main className="flex max-w-3xl flex-1 flex-col gap-4 p-4">
      <div>
        <Link href="/users" className="text-sm underline underline-offset-4">
          Back to People
        </Link>
        <h1 className="mt-2 flex flex-wrap items-center gap-2 text-2xl font-semibold">
          {p.full_name}
          <Badge variant={targetIsOwner ? "default" : "secondary"}>
            {targetIsOwner ? "Owner" : "Manager"}
          </Badge>
          <Badge variant={p.is_active ? "outline" : "destructive"}>
            {p.is_active ? "Active" : "Switched off"}
          </Badge>
        </h1>
        <p className="text-muted-foreground">{p.email}</p>
      </div>

      {isMe ? (
        <Alert role="status">
          <AlertDescription>
            This is your own account. Change your password or email in{" "}
            <Link href="/account" className="underline underline-offset-4">
              My Account
            </Link>
            .
          </AlertDescription>
        </Alert>
      ) : null}
      {locked ? (
        <Alert role="status">
          <AlertDescription>
            Only an Owner can change an Owner account. You can look at it here.
          </AlertDescription>
        </Alert>
      ) : null}

      {!locked ? (
        <Section title="Change name or phone">
          <EditDetailsForm id={p.id} fullName={p.full_name} phone={p.phone} />
        </Section>
      ) : null}
      {canProtect ? (
        <>
          <Section title="Change role">
            <ChangeRoleForm
              id={p.id}
              role={p.role}
              targetIsOwner={targetIsOwner}
              actorIsOwner={actorIsOwner}
            />
          </Section>
          <Section title="Change email">
            <ChangeUserEmailForm id={p.id} targetIsOwner={targetIsOwner} />
          </Section>
          {p.is_active ? (
            <Section title="Reset password" danger>
              <ResetPasswordForm id={p.id} targetIsOwner={targetIsOwner} />
            </Section>
          ) : null}
          <Section
            title={
              p.is_active ? "Switch off this account" : "Switch on this account"
            }
            danger={p.is_active}
          >
            <SwitchForm
              id={p.id}
              active={p.is_active}
              targetIsOwner={targetIsOwner}
            />
          </Section>
        </>
      ) : null}

      <section aria-labelledby="hist" className="grid gap-2">
        <h2 id="hist" className="text-lg font-semibold">
          History
        </h2>
        {history.length === 0 ? (
          <p className="text-muted-foreground">Nothing recorded yet.</p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {history.map((h) => (
              <li key={h.id} className="rounded border p-2">
                <span className="font-medium">{describe(h)}</span>{" "}
                <span className="text-muted-foreground">
                  ·{" "}
                  {new Date(h.occurred_at).toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </span>
                {h.reason ? <div>Reason: {h.reason}</div> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
