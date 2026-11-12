import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BookingView, parseTab } from "@/components/app/bookings/booking-view";
import { ErrorState } from "@/components/app/states";
import { requireUser } from "@/lib/auth/session";
import { loadBookingDetail } from "@/lib/bookings/data";
import { loadMoneyList, type MoneyRow } from "@/lib/payments/data";
import { parseMoneyFilter } from "@/lib/payments/list";
import { todayIst } from "@/lib/dates";

export const metadata: Metadata = { title: "Booking" };

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function BookingPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const d = await loadBookingDetail(id);
  if (!d.ok) {
    return (
      <main className="flex flex-1 flex-col gap-4 p-4">
        <ErrorState
          title="The booking could not be loaded"
          retryHref={`/bookings/${id}`}
        />
      </main>
    );
  }
  if (!d.data) notFound();
  const first = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;
  const tab = parseTab(sp.tab);
  let money: { payments: MoneyRow[]; refunds: MoneyRow[] } | null = null;
  if (tab === "payments") {
    const [p, r] = await Promise.all([
      loadMoneyList(
        parseMoneyFilter("payment", { booking: id }, { size: 100 }),
      ),
      loadMoneyList(parseMoneyFilter("refund", { booking: id }, { size: 100 })),
    ]);
    money =
      p.ok && r.ok ? { payments: p.data.rows, refunds: r.data.rows } : null;
  }
  return (
    <BookingView
      d={d.data}
      money={money}
      tab={tab}
      today={todayIst()}
      saved={first(sp.saved) === "1"}
      showReplaced={first(sp.replaced) === "1"}
    />
  );
}
