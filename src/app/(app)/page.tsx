import { Suspense } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { describeOwnerEvent, type AuditRow } from "@/lib/accounts/rules";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

/**
 * Temporary home page for signed-in users. The real dashboard arrives with the dashboard work;
 * for now it shows the notices that must be visible to everyone (FR-AUTH-12, FR-AUTH-14).
 */
export default async function Home() {
  const user = await requireUser();
  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      <div>
        <h1 className="text-2xl font-semibold">Welcome, {user.fullName}</h1>
        <p className="text-muted-foreground">
          You are signed in. The dashboard and bookings will appear here as they
          are built.
        </p>
      </div>
      <Suspense fallback={null}>
        <OwnerNotices isOwner={user.role === "owner"} />
      </Suspense>
    </main>
  );
}

/** Sensitive actions on Owner accounts in the last 30 days, shown to every user. */
async function loadNotices() {
  const supabase = await createClient();
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const [{ data }, { data: owners }] = await Promise.all([
    supabase
      .from("audit_logs")
      .select(
        "action, actor_name, occurred_at, reason, changed_fields, old_data, new_data",
      )
      .eq("table_name", "user_profiles")
      .gte("occurred_at", since)
      .order("id", { ascending: false })
      .limit(60),
    supabase.rpc("active_owner_count"),
  ]);
  const lines = ((data ?? []) as AuditRow[])
    .map((r) => ({ at: r.occurred_at, text: describeOwnerEvent(r) }))
    .filter((x): x is { at: string; text: string } => x.text !== null)
    .slice(0, 8);
  return { lines, owners: owners as number | null };
}

async function OwnerNotices({ isOwner }: { isOwner: boolean }) {
  const { lines, owners } = await loadNotices();
  return (
    <>
      {isOwner && owners === 1 ? (
        <Alert role="status">
          <AlertTitle>Only one Owner account exists</AlertTitle>
          <AlertDescription>
            Add a second Owner (People → Add person) so access can be recovered.
          </AlertDescription>
        </Alert>
      ) : null}
      {lines.length > 0 ? (
        <section aria-labelledby="notices" className="grid gap-2">
          <h2 id="notices" className="text-lg font-semibold">
            Owner account notices
          </h2>
          <ul className="grid gap-2">
            {lines.map((l, i) => (
              <li key={i} className="rounded border p-3 text-sm">
                {l.text}{" "}
                <span className="text-muted-foreground">
                  ·{" "}
                  {new Date(l.at).toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
