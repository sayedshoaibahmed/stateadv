import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { BookingStatusBadge } from "@/components/app/booking-status";
import { DateText } from "@/components/app/date-text";
import { Money } from "@/components/app/money";
import { EmptyState, ErrorState } from "@/components/app/states";
import { AdjustedTag } from "@/components/app/status-badge";
import type { BookingRow, FormOptions, Loaded } from "@/lib/bookings/data";
import {
  DATE_TYPES,
  DATE_TYPE_LABELS,
  METHODS,
  METHOD_LABELS,
  STATUSES,
  STATUS_LABELS,
  activeFilterCount,
  listHref,
  pageCount,
  type BookingFilter,
} from "@/lib/bookings/list";
import { cn } from "@/lib/utils";

const input =
  "min-h-11 w-full rounded-lg border bg-background px-2 text-base sm:text-sm";

export function FilterForm({
  f,
  options,
}: {
  f: BookingFilter;
  options: FormOptions | null;
}) {
  const n = activeFilterCount(f);
  return (
    <form
      action="/bookings"
      method="get"
      className="grid gap-3"
      aria-label="Find bookings"
    >
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid min-w-0 flex-1 gap-1">
          <label htmlFor="q" className="text-sm font-medium">
            Search
          </label>
          <input
            id="q"
            name="q"
            defaultValue={f.q}
            placeholder="Booking ID, name, mobile or C/O name"
            maxLength={100}
            className={input}
          />
        </div>
        <button
          type="submit"
          className="min-h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Search
        </button>
      </div>
      <details className="rounded-lg border p-3" open={n > 0}>
        <summary className="min-h-11 cursor-pointer py-2 font-medium">
          Filters{n > 0 ? ` (${n} on)` : ""}
        </summary>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="grid gap-1">
            <label htmlFor="resort" className="text-sm font-medium">
              Resort
            </label>
            <select
              id="resort"
              name="resort"
              defaultValue={f.resort ?? "all"}
              className={input}
            >
              <option value="all">All resorts</option>
              {(options?.resorts ?? []).map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <label htmlFor="status" className="text-sm font-medium">
              Status
            </label>
            <select
              id="status"
              name="status"
              defaultValue={f.status ?? "all"}
              className={input}
            >
              <option value="all">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <label htmlFor="co" className="text-sm font-medium">
              C/O
            </label>
            <select
              id="co"
              name="co"
              defaultValue={
                f.coCategory === null ? "all" : String(f.coCategory)
              }
              className={input}
            >
              <option value="all">All</option>
              {(options?.categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <label htmlFor="method" className="text-sm font-medium">
              Pricing method
            </label>
            <select
              id="method"
              name="method"
              defaultValue={f.method ?? "all"}
              className={input}
            >
              <option value="all">All</option>
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <label htmlFor="dateType" className="text-sm font-medium">
              Dates are
            </label>
            <select
              id="dateType"
              name="dateType"
              defaultValue={f.dateType}
              className={input}
            >
              {DATE_TYPES.map((d) => (
                <option key={d} value={d}>
                  {DATE_TYPE_LABELS[d]}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <label htmlFor="from" className="text-sm font-medium">
                From
              </label>
              <input
                id="from"
                name="from"
                type="date"
                defaultValue={f.from ?? ""}
                className={input}
              />
            </div>
            <div className="grid gap-1">
              <label htmlFor="to" className="text-sm font-medium">
                To
              </label>
              <input
                id="to"
                name="to"
                type="date"
                defaultValue={f.to ?? ""}
                className={input}
              />
            </div>
          </div>
        </div>
        <fieldset className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
          <legend className="sr-only">Show only</legend>
          {(
            [
              ["pending", "Has Pending", f.hasPending],
              ["waiting", "Has Waiting", f.hasWaiting],
              ["refund", "Refund due", f.refundDue],
              ["adjusted", "Adjusted", f.adjusted],
            ] as const
          ).map(([name, label, on]) => (
            <label
              key={name}
              className="flex min-h-11 items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                name={name}
                value="1"
                defaultChecked={on}
                className="size-5"
              />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="mt-2 flex gap-2">
          <button
            type="submit"
            className="min-h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Show
          </button>
          <Link
            href="/bookings"
            className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}
          >
            Clear
          </Link>
        </div>
      </details>
    </form>
  );
}

export function BookingTable({
  rows,
  resortNames,
}: {
  rows: BookingRow[];
  resortNames: Map<string, string>;
}) {
  return (
    <>
      <div
        className="hidden overflow-x-auto md:block"
        data-testid="booking-table"
      >
        <table className="w-full text-right">
          <thead>
            <tr className="border-b text-sm text-muted-foreground">
              <th scope="col" className="py-2 text-left font-medium">
                Booking ID
              </th>
              <th scope="col" className="text-left font-medium">
                Resort
              </th>
              <th scope="col" className="text-left font-medium">
                Guest
              </th>
              <th scope="col" className="text-left font-medium">
                Mobile
              </th>
              <th scope="col" className="text-left font-medium">
                Check-in
              </th>
              <th scope="col" className="font-medium">
                PAX
              </th>
              <th scope="col" className="font-medium">
                Amount Due
              </th>
              <th scope="col" className="font-medium">
                Approved
              </th>
              <th scope="col" className="font-medium">
                Waiting
              </th>
              <th scope="col" className="font-medium">
                Pending
              </th>
              <th scope="col" className="text-left font-medium">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b">
                <th scope="row" className="py-2 text-left font-medium">
                  <Link
                    href={`/bookings/${r.id}`}
                    className="underline underline-offset-4"
                  >
                    {r.code}
                  </Link>
                  {r.adjusted ? (
                    <>
                      {" "}
                      <AdjustedTag />
                    </>
                  ) : null}
                </th>
                <td className="text-left">
                  {resortNames.get(r.resortId) ?? "—"}
                </td>
                <td className="text-left">{r.guestName}</td>
                <td className="text-left">{r.guestMobile}</td>
                <td className="text-left">
                  <DateText value={r.checkInAt} />
                </td>
                <td className="tabular-nums">{r.pax}</td>
                <td>
                  <Money paise={r.dueP} />
                </td>
                <td>
                  <Money paise={r.approvedP} tone="approved" />
                </td>
                <td>
                  <Money paise={r.waitingP} tone="waiting" />
                </td>
                <td>
                  <Money paise={r.pendingP} tone="pending" />
                </td>
                <td className="text-left">
                  <BookingStatusBadge status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="grid gap-3 md:hidden" data-testid="booking-cards">
        {rows.map((r) => (
          <li key={r.id} className="rounded-xl border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link
                href={`/bookings/${r.id}`}
                className="font-semibold underline underline-offset-4"
              >
                {r.code}
              </Link>
              <BookingStatusBadge status={r.status} />
            </div>
            <p className="mt-1 text-sm">
              {r.guestName} · {r.guestMobile}
            </p>
            <p className="text-sm text-muted-foreground">
              {resortNames.get(r.resortId) ?? "—"} · Check-in{" "}
              <DateText value={r.checkInAt} /> · {r.pax}{" "}
              {r.pax === 1 ? "person" : "people"}
              {r.adjusted ? (
                <>
                  {" "}
                  · <AdjustedTag />
                </>
              ) : null}
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Amount Due</dt>
              <dd className="text-right">
                <Money paise={r.dueP} />
              </dd>
              <dt className="text-muted-foreground">Approved</dt>
              <dd className="text-right">
                <Money paise={r.approvedP} tone="approved" />
              </dd>
              <dt className="text-muted-foreground">Waiting</dt>
              <dd className="text-right">
                <Money paise={r.waitingP} tone="waiting" />
              </dd>
              <dt className="text-muted-foreground">Pending</dt>
              <dd className="text-right">
                <Money paise={r.pendingP} tone="pending" />
              </dd>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

export function Pager({ f, total }: { f: BookingFilter; total: number }) {
  const pages = pageCount(total);
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-3">
      {f.page > 1 ? (
        <Link
          href={listHref(f, { page: f.page - 1 })}
          className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}
        >
          Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-sm text-muted-foreground">
        Page {f.page} of {pages}
      </span>
      {f.page < pages ? (
        <Link
          href={listHref(f, { page: f.page + 1 })}
          className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}
        >
          Next
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

export function BookingListView({
  f,
  list,
  options,
  resortNames,
}: {
  f: BookingFilter;
  list: Loaded<{ rows: BookingRow[]; total: number }>;
  options: FormOptions | null;
  resortNames: Map<string, string>;
}) {
  return (
    <main className="flex flex-1 flex-col gap-4 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Bookings</h1>
        <Link href="/bookings/new" className={cn(buttonVariants(), "min-h-11")}>
          Add Booking
        </Link>
      </div>
      {f.problem ? (
        <p
          role="status"
          className="rounded-lg border border-waiting/40 bg-waiting-soft p-3 text-sm"
        >
          {f.problem}
        </p>
      ) : null}
      <FilterForm f={f} options={options} />
      {!list.ok ? (
        <ErrorState
          title="The bookings could not be loaded"
          retryHref={listHref(f)}
        />
      ) : list.data.rows.length === 0 ? (
        activeFilterCount(f) > 0 || f.q ? (
          <EmptyState
            title="No bookings match"
            action={
              <Link
                href="/bookings"
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "min-h-11",
                )}
              >
                Clear the search
              </Link>
            }
          >
            Try a shorter search or fewer filters.
          </EmptyState>
        ) : (
          <EmptyState
            title="No bookings yet"
            action={
              <Link
                href="/bookings/new"
                className={cn(buttonVariants(), "min-h-11")}
              >
                Add the first booking
              </Link>
            }
          >
            Bookings you add will be listed here.
          </EmptyState>
        )
      ) : (
        <>
          <p className="text-sm text-muted-foreground" data-testid="count">
            {list.data.total} {list.data.total === 1 ? "booking" : "bookings"}
          </p>
          <BookingTable rows={list.data.rows} resortNames={resortNames} />
          <Pager f={f} total={list.data.total} />
        </>
      )}
    </main>
  );
}
