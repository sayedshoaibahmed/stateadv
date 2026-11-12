import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { DateText } from "@/components/app/date-text";
import { Money } from "@/components/app/money";
import { EmptyState, ErrorState } from "@/components/app/states";
import { BookingTable } from "@/components/app/bookings/booking-list-view";
import { GuestForm } from "@/components/app/bookings/guest-form";
import type {
  BookingRow,
  GuestDetail,
  GuestRow,
  Loaded,
} from "@/lib/bookings/data";
import { PAGE_SIZE, cleanSearch } from "@/lib/bookings/list";
import { cn } from "@/lib/utils";

export const guestsHref = (q: string, page = 1) => {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (page > 1) p.set("page", String(page));
  const s = p.toString();
  return s ? `/guests?${s}` : "/guests";
};

export function parseGuestQuery(
  params: Record<string, string | string[] | undefined>,
) {
  const one = (v: string | string[] | undefined) =>
    Array.isArray(v) ? v[0] : v;
  const pageRaw = one(params.page);
  return {
    q: cleanSearch(one(params.q)),
    page:
      pageRaw && /^\d{1,6}$/.test(pageRaw) && Number(pageRaw) >= 1
        ? Number(pageRaw)
        : 1,
  };
}

export function GuestListView({
  q,
  page,
  list,
}: {
  q: string;
  page: number;
  list: Loaded<{ rows: GuestRow[]; total: number }>;
}) {
  const pages = list.ok
    ? Math.max(1, Math.ceil(list.data.total / PAGE_SIZE))
    : 1;
  return (
    <main className="flex flex-1 flex-col gap-4 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Guests</h1>
        <Link href="/bookings/new" className={cn(buttonVariants(), "min-h-11")}>
          Add Booking
        </Link>
      </div>
      <form
        action="/guests"
        method="get"
        className="flex flex-wrap items-end gap-2"
        aria-label="Find guests"
      >
        <div className="grid min-w-0 flex-1 gap-1">
          <label htmlFor="q" className="text-sm font-medium">
            Search
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q}
            maxLength={100}
            placeholder="Name, mobile number or email"
            className="min-h-11 w-full rounded-lg border bg-background px-2 text-base sm:text-sm"
          />
        </div>
        <button
          type="submit"
          className="min-h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Search
        </button>
      </form>
      {!list.ok ? (
        <ErrorState
          title="The guests could not be loaded"
          retryHref={guestsHref(q, page)}
        />
      ) : list.data.rows.length === 0 ? (
        <EmptyState title={q ? "No guests match" : "No guests yet"}>
          {q
            ? "Try a shorter search."
            : "Guests are added when you add a booking."}
        </EmptyState>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {list.data.total} {list.data.total === 1 ? "guest" : "guests"}
          </p>
          <div
            className="hidden overflow-x-auto md:block"
            data-testid="guest-table"
          >
            <table className="w-full text-right">
              <thead>
                <tr className="border-b text-sm text-muted-foreground">
                  <th scope="col" className="py-2 text-left font-medium">
                    Guest
                  </th>
                  <th scope="col" className="text-left font-medium">
                    Mobile
                  </th>
                  <th scope="col" className="font-medium">
                    Bookings
                  </th>
                  <th scope="col" className="font-medium">
                    Last check-in
                  </th>
                  <th scope="col" className="font-medium">
                    Net Collection
                  </th>
                  <th scope="col" className="font-medium">
                    Pending
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.data.rows.map((g) => (
                  <tr key={g.id} className="border-b">
                    <th scope="row" className="py-2 text-left font-medium">
                      <Link
                        href={"/guests/" + g.id}
                        className="underline underline-offset-4"
                      >
                        {g.fullName}
                      </Link>
                    </th>
                    <td className="text-left">{g.mobile}</td>
                    <td className="tabular-nums">{g.bookings}</td>
                    <td>
                      <DateText value={g.lastCheckIn} />
                    </td>
                    <td>
                      <Money paise={g.netCollectionP} />
                    </td>
                    <td>
                      <Money paise={g.pendingP} tone="pending" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="grid gap-3 md:hidden" data-testid="guest-cards">
            {list.data.rows.map((g) => (
              <li key={g.id} className="rounded-xl border p-3">
                <Link
                  href={"/guests/" + g.id}
                  className="font-semibold underline underline-offset-4"
                >
                  {g.fullName}
                </Link>
                <p className="text-sm text-muted-foreground">{g.mobile}</p>
                <p className="mt-1 text-sm">
                  {g.bookings} {g.bookings === 1 ? "booking" : "bookings"} ·
                  last check-in <DateText value={g.lastCheckIn} />
                </p>
                <p className="text-sm">
                  Net Collection <Money paise={g.netCollectionP} /> · Pending{" "}
                  <Money paise={g.pendingP} tone="pending" />
                </p>
              </li>
            ))}
          </ul>
          {pages > 1 ? (
            <nav
              aria-label="Pages"
              className="flex items-center justify-between gap-3"
            >
              {page > 1 ? (
                <Link
                  href={guestsHref(q, page - 1)}
                  className={cn(
                    buttonVariants({ variant: "outline" }),
                    "min-h-11",
                  )}
                >
                  Previous
                </Link>
              ) : (
                <span />
              )}
              <span className="text-sm text-muted-foreground">
                Page {page} of {pages}
              </span>
              {page < pages ? (
                <Link
                  href={guestsHref(q, page + 1)}
                  className={cn(
                    buttonVariants({ variant: "outline" }),
                    "min-h-11",
                  )}
                >
                  Next
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </>
      )}
    </main>
  );
}

/** Totals over ALL of a guest's bookings. Pending follows rule D1 for every booking; an unpaid cancellation or no-show charge is pending too. */
export function guestTotals(rows: readonly BookingRow[]) {
  return {
    bookings: rows.length,
    approvedP: rows.reduce((s, r) => s + r.approvedP, 0),
    pendingP: rows.reduce((s, r) => s + r.pendingP, 0),
  };
}

export function GuestDetailView({ d }: { d: GuestDetail }) {
  const t = guestTotals(d.bookings);
  return (
    <main className="flex flex-1 flex-col gap-5 p-3 sm:p-4">
      <div className="grid gap-2">
        <Link href="/guests" className="text-sm underline underline-offset-4">
          All guests
        </Link>
        <h1 className="text-2xl font-semibold">{d.guest.full_name}</h1>
        <p className="text-muted-foreground">
          {d.guest.mobile}
          {d.guest.email ? " · " + d.guest.email : ""}
        </p>
        <div>
          <Link
            href={"/bookings/new?guest=" + d.guest.id}
            className={cn(buttonVariants(), "min-h-11")}
          >
            New booking for this guest
          </Link>
        </div>
      </div>
      <section aria-label="Totals" className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border p-3">
          <p className="text-sm text-muted-foreground">Bookings</p>
          <p className="text-xl font-semibold">{t.bookings}</p>
        </div>
        <div className="rounded-xl border p-3">
          <p className="text-sm text-muted-foreground">
            Total Collection (Approved)
          </p>
          <p className="text-xl font-semibold">
            <Money paise={t.approvedP} tone="approved" />
          </p>
        </div>
        <div className="rounded-xl border p-3">
          <p className="text-sm text-muted-foreground">Pending Amount</p>
          <p className="text-xl font-semibold">
            <Money paise={t.pendingP} tone="pending" />
          </p>
        </div>
      </section>
      <section className="grid gap-2" aria-label="Booking history">
        <h2 className="text-lg font-semibold">Booking history</h2>
        {d.bookings.length === 0 ? (
          <EmptyState title="No bookings yet">
            This guest has no bookings.
          </EmptyState>
        ) : (
          <BookingTable rows={d.bookings} resortNames={d.resortNames} />
        )}
      </section>
      <section className="grid gap-2" aria-label="Guest details">
        <h2 className="text-lg font-semibold">Guest details</h2>
        <p className="text-sm text-muted-foreground">
          Changing these details does not change the name or number printed on
          old bookings.
        </p>
        <GuestForm guest={d.guest} />
      </section>
    </main>
  );
}
