import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GuestDetailView } from "@/components/app/bookings/guest-views";
import { ErrorState } from "@/components/app/states";
import { requireUser } from "@/lib/auth/session";
import { loadGuestDetail } from "@/lib/bookings/data";

export const metadata: Metadata = { title: "Guest" };

type Params = Promise<{ id: string }>;

export default async function GuestPage({ params }: { params: Params }) {
  await requireUser();
  const { id } = await params;
  const d = await loadGuestDetail(id);
  if (!d.ok) {
    return (
      <main className="flex flex-1 flex-col gap-4 p-4">
        <ErrorState
          title="The guest could not be loaded"
          retryHref={"/guests/" + id}
        />
      </main>
    );
  }
  if (!d.data) notFound();
  return <GuestDetailView d={d.data} />;
}
