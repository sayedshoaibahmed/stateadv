import { requireUser } from "@/lib/auth/session";

/**
 * Temporary home page for signed-in users. The real dashboard arrives with
 * the dashboard work; this only proves that sign-in works.
 */
export default async function Home() {
  const user = await requireUser();
  return (
    <main className="flex flex-1 flex-col gap-2 p-4">
      <h1 className="text-2xl font-semibold">Welcome, {user.fullName}</h1>
      <p className="text-muted-foreground">
        You are signed in. The dashboard and bookings will appear here as they
        are built.
      </p>
    </main>
  );
}
