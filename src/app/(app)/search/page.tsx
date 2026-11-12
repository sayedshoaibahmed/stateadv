import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Money } from "@/components/app/money";
import { EmptyState, ErrorState } from "@/components/app/states";
import { BookingTable } from "@/components/app/bookings/booking-list-view";
import { requireUser } from "@/lib/auth/session";
import { loadResortNames, loadSearch } from "@/lib/bookings/data";
import { cleanSearch } from "@/lib/bookings/list";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Search" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The search box in the top bar: bookings (Booking ID, name, mobile, C/O name) and guests (name, mobile, email). */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireUser();
  const sp = await searchParams;
  const raw = Array.isArray(sp.q) ? sp.q[0] : sp.q;
  const q = cleanSearch(raw);
  const [result, names] =
    q === ""
      ? [null, new Map<string, string>()]
      : await Promise.all([loadSearch(q), loadResortNames()]);
  return (
    <main className="flex flex-1 flex-col gap-5 p-3 sm:p-4">
      <h1 className="text-2xl font-semibold">Search</h1>
      <form
        action="/search"
        method="get"
        className="flex flex-wrap items-end gap-2"
        aria-label="Search"
      >
        <div className="grid min-w-0 flex-1 gap-1">
          <label htmlFor="q" className="text-sm font-medium">
            Booking ID, guest name, mobile number or C/O name
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q}
            maxLength={100}
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
      {result === null ? (
        <EmptyState title="Type something to search">
          Try a Booking ID, a guest&apos;s name or a mobile number.
        </EmptyState>
      ) : !result.ok ? (
        <ErrorState
          title="The search could not be done"
          retryHref={"/search?q=" + encodeURIComponent(q)}
        />
      ) : result.data.bookings.length === 0 &&
        result.data.guests.length === 0 ? (
        <EmptyState title="Nothing found">
          Check the spelling, or try fewer letters.
        </EmptyState>
      ) : (
        <>
          <section className="grid gap-2" aria-label="Bookings found">
            <h2 className="text-lg font-semibold">
              Bookings ({result.data.bookingTotal})
            </h2>
            {result.data.bookings.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No bookings match.
              </p>
            ) : (
              <>
                <BookingTable rows={result.data.bookings} resortNames={names} />
                {result.data.bookingTotal > result.data.bookings.length ? (
                  <Link
                    href={"/bookings?q=" + encodeURIComponent(q)}
                    className={cn(
                      buttonVariants({ variant: "outline" }),
                      "min-h-11 justify-self-start",
                    )}
                  >
                    See all {result.data.bookingTotal} bookings
                  </Link>
                ) : null}
              </>
            )}
          </section>
          <section className="grid gap-2" aria-label="Guests found">
            <h2 className="text-lg font-semibold">
              Guests ({result.data.guestTotal})
            </h2>
            {result.data.guests.length === 0 ? (
              <p className="text-sm text-muted-foreground">No guests match.</p>
            ) : (
              <ul className="grid gap-2">
                {result.data.guests.map((g) => (
                  <li key={g.id} className="rounded-lg border p-3 text-sm">
                    <Link
                      href={"/guests/" + g.id}
                      className="font-medium underline underline-offset-4"
                    >
                      {g.fullName}
                    </Link>{" "}
                    · {g.mobile} · {g.bookings}{" "}
                    {g.bookings === 1 ? "booking" : "bookings"} · Pending{" "}
                    <Money paise={g.pendingP} tone="pending" />
                  </li>
                ))}
              </ul>
            )}
            {result.data.guestTotal > result.data.guests.length ? (
              <Link
                href={"/guests?q=" + encodeURIComponent(q)}
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "min-h-11 justify-self-start",
                )}
              >
                See all {result.data.guestTotal} guests
              </Link>
            ) : null}
          </section>
        </>
      )}
    </main>
  );
}
