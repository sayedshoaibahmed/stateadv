import type { Metadata } from "next";
import { BookingListView } from "@/components/app/bookings/booking-list-view";
import { requireUser } from "@/lib/auth/session";
import {
  loadBookingList,
  loadFormOptions,
  loadResortNames,
} from "@/lib/bookings/data";
import { parseBookingFilter } from "@/lib/bookings/list";

export const metadata: Metadata = { title: "Bookings" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireUser();
  const f = parseBookingFilter(await searchParams);
  const [list, options, names] = await Promise.all([
    loadBookingList(f),
    loadFormOptions(),
    loadResortNames(),
  ]);
  return (
    <BookingListView
      f={f}
      list={list}
      options={options.ok ? options.data : null}
      resortNames={names}
    />
  );
}
