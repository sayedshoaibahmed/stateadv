import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { BookingStatusBadge } from "@/components/app/booking-status";
import { DateText } from "@/components/app/date-text";
import { Money } from "@/components/app/money";
import { EmptyState, ErrorState } from "@/components/app/states";
import { BackdatedTag, StatusBadge } from "@/components/app/status-badge";
import type { Loaded, RecordRow } from "@/lib/records/data";
import {
  BASES,
  BASIS_LABELS,
  BASIS_SHORT,
  PAGE_SIZE,
  TYPES,
  TYPE_LABELS,
  TYPE_SINGULAR,
  activeFilterCount,
  pageCount,
  recordHref,
  recordsHref,
  type Basis,
  type RecordFilter,
} from "@/lib/records/filters";
import type { BookingStatus } from "@/lib/bookings/list";
import { cn } from "@/lib/utils";

const input =
  "min-h-11 w-full rounded-lg border bg-background px-2 text-base sm:text-sm";

function Status({ r }: { r: RecordRow }) {
  return r.type === "booking" ? (
    <BookingStatusBadge status={r.status as BookingStatus} />
  ) : (
    <StatusBadge
      status={r.status as "approved" | "waiting" | "rejected" | "reversed"}
    />
  );
}

function Amount({ r }: { r: RecordRow }) {
  if (r.type === "booking") return <Money paise={r.amountPaise} />;
  if (r.type === "refund") return <Money paise={r.amountPaise} tone="refund" />;
  return (
    <Money
      paise={r.amountPaise}
      tone={
        r.status === "approved"
          ? "approved"
          : r.status === "waiting"
            ? "waiting"
            : r.status === "reversed"
              ? "reversed"
              : "neutral"
      }
    />
  );
}

/** What is attached: PDF versions to a booking, screenshots and receipts to a payment or refund. */
function Files({ r }: { r: RecordRow }) {
  if (r.type === "booking")
    return r.fileCount > 0 ? (
      <Link
        href={`/bookings/${r.id}?tab=pdfs`}
        className="underline underline-offset-4"
      >
        {r.fileCount} PDF {r.fileCount === 1 ? "version" : "versions"}
      </Link>
    ) : (
      <span className="text-muted-foreground">No PDF yet</span>
    );
  return r.fileCount > 0 ? (
    <Link
      href={recordHref(r.type, r.id)}
      className="underline underline-offset-4"
    >
      {r.fileCount} {r.fileCount === 1 ? "file" : "files"}
    </Link>
  ) : (
    <span className="text-muted-foreground">No files</span>
  );
}

function DateCell({ r, basis }: { r: RecordRow; basis: Basis }) {
  return (
    <>
      <DateText value={r.recordDate} />
      {basis !== "record" ? (
        <span className="block text-xs text-muted-foreground">
          {BASIS_SHORT[basis]} <DateText value={r.matchedDate} />
        </span>
      ) : null}
      {r.type !== "booking" && r.backdated ? (
        <span className="block text-xs text-muted-foreground">
          <BackdatedTag entered={r.enteredOn} />
          {basis !== "entry" ? (
            <>
              {" "}
              entered <DateText value={r.enteredOn} />
            </>
          ) : null}
        </span>
      ) : null}
    </>
  );
}

export function RecordFilterForm({
  f,
  resorts,
}: {
  f: RecordFilter;
  resorts: { id: string; name: string }[];
}) {
  const n = activeFilterCount(f);
  return (
    <form
      action="/old-records"
      method="get"
      className="grid gap-3"
      aria-label="Find old records"
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
            placeholder="Booking ID, guest, mobile, payment or refund number"
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
      <details className="rounded-lg border p-3" open>
        <summary className="min-h-11 cursor-pointer py-2 font-medium">
          Dates and filters{n > 0 ? ` (${n} on)` : ""}
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
              {resorts.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1 sm:col-span-2 lg:col-span-1">
            <label htmlFor="basis" className="text-sm font-medium">
              Dates are
            </label>
            <select
              id="basis"
              name="basis"
              defaultValue={f.basis}
              className={input}
            >
              {BASES.map((b) => (
                <option key={b} value={b}>
                  {BASIS_LABELS[b]}
                </option>
              ))}
            </select>
            <p id="basis-help" className="text-xs text-muted-foreground">
              Check-in, check-out and cancellation are dates of the booking: its
              payments and refunds are listed with it.
            </p>
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
          <legend className="text-sm font-medium">Look in</legend>
          {TYPES.map((t) => (
            <label key={t} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="types"
                value={t}
                defaultChecked={f.types.includes(t)}
                className="size-5"
              />
              {TYPE_LABELS[t]}
            </label>
          ))}
          <span className="self-center text-sm text-muted-foreground">
            (none ticked = all three)
          </span>
        </fieldset>
        <div className="mt-2 flex gap-2">
          <button
            type="submit"
            className="min-h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Show
          </button>
          <Link
            href="/old-records"
            className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}
          >
            Clear
          </Link>
        </div>
      </details>
    </form>
  );
}

export function RecordTable({
  rows,
  resortNames,
  basis = "record",
}: {
  rows: RecordRow[];
  resortNames: Map<string, string>;
  basis?: Basis;
}) {
  return (
    <>
      <div
        className="hidden overflow-x-auto md:block"
        data-testid="record-table"
      >
        <table className="w-full text-right">
          <thead>
            <tr className="border-b text-sm text-muted-foreground">
              <th scope="col" className="py-2 text-left font-medium">
                Record
              </th>
              <th scope="col" className="text-left font-medium">
                Booking ID
              </th>
              <th scope="col" className="text-left font-medium">
                Resort
              </th>
              <th scope="col" className="text-left font-medium">
                Guest
              </th>
              <th scope="col" className="text-left font-medium">
                Date
              </th>
              <th scope="col" className="font-medium">
                Amount
              </th>
              <th scope="col" className="text-left font-medium">
                Status
              </th>
              <th scope="col" className="text-left font-medium">
                Files
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.type}-${r.id}`} className="border-b align-top">
                <th scope="row" className="py-2 text-left font-medium">
                  <span className="block text-xs font-normal text-muted-foreground">
                    {TYPE_SINGULAR[r.type]}
                  </span>
                  <Link
                    href={recordHref(r.type, r.id)}
                    className="underline underline-offset-4"
                  >
                    {r.code}
                  </Link>
                </th>
                <td className="text-left">
                  {r.type === "booking" ? (
                    "—"
                  ) : (
                    <Link
                      href={`/bookings/${r.bookingId}`}
                      className="underline underline-offset-4"
                    >
                      {r.bookingCode}
                    </Link>
                  )}
                </td>
                <td className="text-left">
                  {resortNames.get(r.resortId) ?? "—"}
                </td>
                <td className="text-left">
                  {r.guestName}
                  <span className="block text-xs text-muted-foreground">
                    {r.guestMobile}
                  </span>
                </td>
                <td className="text-left">
                  <DateCell r={r} basis={basis} />
                </td>
                <td>
                  <Amount r={r} />
                  {r.type === "booking" ? (
                    <span className="block text-xs text-muted-foreground">
                      Amount Due
                    </span>
                  ) : null}
                </td>
                <td className="text-left">
                  <Status r={r} />
                </td>
                <td className="text-left">
                  <Files r={r} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="grid gap-3 md:hidden" data-testid="record-cards">
        {rows.map((r) => (
          <li key={`${r.type}-${r.id}`} className="rounded-xl border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link
                href={recordHref(r.type, r.id)}
                className="font-semibold underline underline-offset-4"
              >
                <span className="font-normal text-muted-foreground">
                  {TYPE_SINGULAR[r.type]}{" "}
                </span>
                {r.code}
              </Link>
              <Status r={r} />
            </div>
            <p className="mt-1 text-sm">
              {r.guestName} · {r.guestMobile}
            </p>
            <p className="text-sm text-muted-foreground">
              {resortNames.get(r.resortId) ?? "—"}
              {r.type !== "booking" ? (
                <>
                  {" "}
                  ·{" "}
                  <Link
                    href={`/bookings/${r.bookingId}`}
                    className="underline underline-offset-4"
                  >
                    {r.bookingCode}
                  </Link>
                </>
              ) : null}
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Date</dt>
              <dd className="text-right">
                <DateCell r={r} basis={basis} />
              </dd>
              <dt className="text-muted-foreground">
                {r.type === "booking" ? "Amount Due" : "Amount"}
              </dt>
              <dd className="text-right">
                <Amount r={r} />
              </dd>
              <dt className="text-muted-foreground">Files</dt>
              <dd className="text-right">
                <Files r={r} />
              </dd>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

function Pager({ f, total }: { f: RecordFilter; total: number }) {
  const pages = pageCount(total);
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-3">
      {f.page > 1 ? (
        <Link
          href={recordsHref(f, { page: f.page - 1 })}
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
          href={recordsHref(f, { page: f.page + 1 })}
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

export function OldRecordsView({
  f,
  list,
  resorts,
  resortNames,
}: {
  f: RecordFilter;
  list: Loaded<{ rows: RecordRow[]; total: number }>;
  resorts: { id: string; name: string }[];
  resortNames: Map<string, string>;
}) {
  const filtered = activeFilterCount(f) > 0 || f.q !== "";
  return (
    <main className="flex flex-1 flex-col gap-4 p-3 sm:p-4">
      <div>
        <h1 className="text-2xl font-semibold">Old Records</h1>
        <p className="text-sm text-muted-foreground">
          Bookings, payments and refunds from any date, with their files and
          PDFs. Nothing is ever removed, so everything can be found here.
        </p>
      </div>
      {f.problem ? (
        <p
          role="status"
          className="rounded-lg border border-waiting/40 bg-waiting-soft p-3 text-sm"
        >
          {f.problem}
        </p>
      ) : null}
      <RecordFilterForm f={f} resorts={resorts} />
      {!list.ok ? (
        <ErrorState
          title="The records could not be loaded"
          retryHref={recordsHref(f)}
        />
      ) : list.data.rows.length === 0 ? (
        filtered ? (
          <EmptyState
            title="No records match"
            action={
              <Link
                href="/old-records"
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "min-h-11",
                )}
              >
                Clear the search
              </Link>
            }
          >
            Try a shorter search, other dates or fewer filters.
          </EmptyState>
        ) : (
          <EmptyState title="No records yet">
            Bookings, payments and refunds will appear here once they are added.
          </EmptyState>
        )
      ) : (
        <>
          <p className="text-sm text-muted-foreground" role="status">
            {list.data.total} {list.data.total === 1 ? "record" : "records"}
            {list.data.total > PAGE_SIZE
              ? ` · showing ${(f.page - 1) * PAGE_SIZE + 1} to ${Math.min(
                  f.page * PAGE_SIZE,
                  list.data.total,
                )}`
              : ""}
            . Newest first.
          </p>
          <RecordTable
            rows={list.data.rows}
            resortNames={resortNames}
            basis={f.basis}
          />
          <Pager f={f} total={list.data.total} />
        </>
      )}
    </main>
  );
}
