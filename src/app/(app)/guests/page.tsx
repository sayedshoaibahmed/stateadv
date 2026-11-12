import type { Metadata } from "next";
import {
  GuestListView,
  parseGuestQuery,
} from "@/components/app/bookings/guest-views";
import { requireUser } from "@/lib/auth/session";
import { loadGuestList } from "@/lib/bookings/data";
import { PAGE_SIZE } from "@/lib/bookings/list";

export const metadata: Metadata = { title: "Guests" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function GuestsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireUser();
  const { q, page } = parseGuestQuery(await searchParams);
  const list = await loadGuestList(q, page, PAGE_SIZE);
  return <GuestListView q={q} page={page} list={list} />;
}
