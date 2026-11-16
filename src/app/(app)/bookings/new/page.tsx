import type { Metadata } from "next";
import Link from "next/link";
import { BookingForm } from "@/components/app/bookings/booking-form";
import { ErrorState } from "@/components/app/states";
import { requireUser } from "@/lib/auth/session";
import { loadFormOptions } from "@/lib/bookings/data";
import { emptyForm } from "@/lib/bookings/form";
import { isIsoDate, todayIst } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Add booking" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function NewBookingPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireUser();
  const sp = await searchParams;
  const options = await loadFormOptions();
  const initial = emptyForm(todayIst());
  // The pricing-method choice was removed from the form: every new booking is priced
  // flat (tariff x people), with no automatic per-night multiplier.
  initial.pricingMethod = "per_person_per_stay";
  // "New booking for this guest" from a guest page
  const guestParam = Array.isArray(sp.guest) ? sp.guest[0] : sp.guest;
  if (
    guestParam &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      guestParam,
    )
  ) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("guests")
      .select("id, full_name, mobile, email")
      .eq("id", guestParam)
      .maybeSingle();
    if (data)
      Object.assign(initial, {
        guestId: data.id,
        guestName: data.full_name,
        guestMobile: data.mobile,
        guestEmail: data.email ?? "",
      });
  }
  // "Add Booking for this date" from the calendar: the check-in date (and the resort) are filled in
  const checkinParam = Array.isArray(sp.checkin) ? sp.checkin[0] : sp.checkin;
  if (checkinParam && isIsoDate(checkinParam))
    initial.checkInDate = checkinParam;
  const resortParam = Array.isArray(sp.resort) ? sp.resort[0] : sp.resort;
  if (
    resortParam &&
    options.ok &&
    options.data.resorts.some((r) => r.id === resortParam && r.active)
  )
    initial.resortId = resortParam;
  return (
    <main className="flex flex-1 flex-col gap-4 p-3 sm:p-4">
      <div>
        <Link href="/bookings" className="text-sm underline underline-offset-4">
          All bookings
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Add Booking</h1>
      </div>
      {options.ok ? (
        <BookingForm mode="create" options={options.data} initial={initial} />
      ) : (
        <ErrorState
          title="The form could not be loaded"
          retryHref="/bookings/new"
        />
      )}
    </main>
  );
}
