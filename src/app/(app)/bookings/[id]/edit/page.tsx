import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BookingForm } from "@/components/app/bookings/booking-form";
import { ErrorState } from "@/components/app/states";
import { requireUser } from "@/lib/auth/session";
import { loadBookingDetail, loadFormOptions } from "@/lib/bookings/data";
import { valuesFromBooking } from "@/lib/bookings/form";
import { todayIst } from "@/lib/dates";

export const metadata: Metadata = { title: "Edit booking" };

type Params = Promise<{ id: string }>;

export default async function EditBookingPage({ params }: { params: Params }) {
  await requireUser();
  const { id } = await params;
  const [d, options] = await Promise.all([
    loadBookingDetail(id),
    loadFormOptions(),
  ]);
  if (!d.ok || !options.ok) {
    return (
      <main className="flex flex-1 flex-col gap-4 p-4">
        <ErrorState
          title="The booking could not be loaded"
          retryHref={`/bookings/${id}/edit`}
        />
      </main>
    );
  }
  if (!d.data) notFound();
  const { booking: b, guest, resort, schedules } = d.data;
  if (b.status === "cancelled" || b.status === "no_show")
    redirect(`/bookings/${b.id}`);
  const today = todayIst();
  const locked = schedules
    .filter(
      (s) =>
        s.superseded_at === null &&
        s.superseded_revision_id === null &&
        s.due_date < today,
    )
    .map((s) => ({
      label: s.label,
      dueDate: s.due_date,
      amountPaise: s.amount_paise,
    }));
  return (
    <main className="flex flex-1 flex-col gap-4 p-3 sm:p-4">
      <div>
        <Link
          href={`/bookings/${b.id}`}
          className="text-sm underline underline-offset-4"
        >
          Back to {b.booking_code}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Edit {b.booking_code}</h1>
      </div>
      <BookingForm
        mode="edit"
        options={options.data}
        initial={valuesFromBooking(b, guest?.email ?? null)}
        edit={{
          bookingId: b.id,
          version: b.version,
          code: b.booking_code,
          resortName: resort?.name ?? "Resort",
          bookingYear: b.booking_year,
          originalFinalPaise: b.final_amount_paise ?? 0,
          locked,
        }}
      />
    </main>
  );
}
