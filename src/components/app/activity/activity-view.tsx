import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { DateText } from "@/components/app/date-text";
import { EmptyState, ErrorState } from "@/components/app/states";
import {
  describeEntry,
  diffRows,
  type ActivityEntry,
} from "@/lib/activity/diff";
import type { Loaded } from "@/lib/activity/data";
import {
  ACTIONS,
  ACTION_LABELS,
  PAGE_SIZE,
  RECORD_LABELS,
  RECORD_TYPES,
  activeFilterCount,
  activityHref,
  pageCount,
  type ActivityFilter,
} from "@/lib/activity/filters";
import { cn } from "@/lib/utils";

const input =
  "min-h-11 w-full rounded-lg border bg-background px-2 text-base sm:text-sm";

/** The address of the record an entry is about, when it has a page of its own. */
function recordLink(e: ActivityEntry): { href: string; text: string } | null {
  if (e.recordType === "booking" && e.recordCode)
    return { href: `/bookings/${e.recordId}`, text: e.recordCode };
  if (e.recordType === "payment" && e.recordCode)
    return { href: `/payments/${e.recordId}`, text: e.recordCode };
  if (e.recordType === "refund" && e.recordCode)
    return { href: `/refunds/${e.recordId}`, text: e.recordCode };
  if (e.bookingId && e.bookingCode)
    return { href: `/bookings/${e.bookingId}`, text: e.bookingCode };
  return null;
}

export function ActivityFilterForm({
  f,
  people,
  resorts,
}: {
  f: ActivityFilter;
  people: { id: string; name: string }[];
  resorts: { id: string; name: string }[];
}) {
  const n = activeFilterCount(f);
  return (
    <form
      action="/activity"
      method="get"
      className="grid gap-3"
      aria-label="Filter the activity"
    >
      {f.booking ? (
        <input type="hidden" name="booking" value={f.booking} />
      ) : null}
      <details className="rounded-lg border p-3" open={n > 0}>
        <summary className="min-h-11 cursor-pointer py-2 font-medium">
          Filters{n > 0 ? ` (${n} on)` : ""}
        </summary>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="grid gap-1">
            <label htmlFor="actor" className="text-sm font-medium">
              Who did it
            </label>
            <select
              id="actor"
              name="actor"
              defaultValue={f.actor ?? "all"}
              className={input}
            >
              <option value="all">Everybody</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <label htmlFor="action" className="text-sm font-medium">
              What happened
            </label>
            <select
              id="action"
              name="action"
              defaultValue={f.action ?? "all"}
              className={input}
            >
              <option value="all">Anything</option>
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {ACTION_LABELS[a]}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <label htmlFor="type" className="text-sm font-medium">
              Kind of record
            </label>
            <select
              id="type"
              name="type"
              defaultValue={f.type ?? "all"}
              className={input}
            >
              <option value="all">All records</option>
              {RECORD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {RECORD_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
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
          <div className="grid grid-cols-2 gap-2 sm:col-span-2 lg:col-span-1">
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
        <label className="mt-3 flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="corrections"
            value="1"
            defaultChecked={f.corrections}
            className="size-5"
          />
          Only files added after approval
        </label>
        <div className="mt-2 flex gap-2">
          <button
            type="submit"
            className="min-h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Show
          </button>
          <Link
            href="/activity"
            className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}
          >
            Clear
          </Link>
        </div>
      </details>
    </form>
  );
}

function Entry({
  e,
  resortNames,
}: {
  e: ActivityEntry;
  resortNames: Map<string, string>;
}) {
  const rows = diffRows(e);
  const link = recordLink(e);
  return (
    <li className="rounded-xl border p-3" data-action={e.action}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-medium">{describeEntry(e)}</p>
        <DateText
          value={e.at}
          withTime
          className="text-sm text-muted-foreground"
        />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        {link ? (
          <>
            <Link href={link.href} className="underline underline-offset-4">
              {link.text}
            </Link>
            {" · "}
          </>
        ) : null}
        {e.resortId ? `${resortNames.get(e.resortId) ?? "—"} · ` : ""}
        {e.recordType === "booking" || !e.bookingCode
          ? ""
          : `Booking ${e.bookingCode} · `}
        Activity no. {e.id}
      </p>
      {e.reason ? (
        <p className="mt-1 text-sm">
          <span className="text-muted-foreground">Reason:</span> {e.reason}
        </p>
      ) : null}
      {rows.length > 0 ? (
        <details className="mt-2">
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">
            What changed ({rows.length})
          </summary>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th scope="col" className="py-1 pr-3 font-medium">
                    What
                  </th>
                  <th scope="col" className="pr-3 font-medium">
                    {e.action === "update" ? "Before" : "Filled in"}
                  </th>
                  {e.action === "update" ? (
                    <th scope="col" className="font-medium">
                      After
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-b align-top">
                    <th scope="row" className="py-1 pr-3 font-medium">
                      {r.label}
                    </th>
                    {e.action === "update" ? (
                      <>
                        <td className="pr-3 break-words text-muted-foreground line-through decoration-1">
                          {r.before}
                        </td>
                        <td className="break-words">{r.after}</td>
                      </>
                    ) : (
                      <td className="break-words">{r.after}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </li>
  );
}

function Pager({ f, total }: { f: ActivityFilter; total: number }) {
  const pages = pageCount(total);
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-3">
      {f.page > 1 ? (
        <Link
          href={activityHref(f, { page: f.page - 1 })}
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
          href={activityHref(f, { page: f.page + 1 })}
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

export function ActivityView({
  f,
  list,
  people,
  resorts,
  resortNames,
}: {
  f: ActivityFilter;
  list: Loaded<{ rows: ActivityEntry[]; total: number }>;
  people: { id: string; name: string }[];
  resorts: { id: string; name: string }[];
  resortNames: Map<string, string>;
}) {
  return (
    <main className="flex flex-1 flex-col gap-4 p-3 sm:p-4">
      <div>
        <h1 className="text-2xl font-semibold">Activity</h1>
        <p className="text-sm text-muted-foreground">
          Everything that was added or changed, and by whom. This list can only
          grow: nobody can edit or delete it. Times are India time (IST).
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
      <ActivityFilterForm f={f} people={people} resorts={resorts} />
      {!list.ok ? (
        <ErrorState
          title="The activity could not be loaded"
          retryHref={activityHref(f)}
        />
      ) : list.data.rows.length === 0 ? (
        activeFilterCount(f) > 0 ? (
          <EmptyState
            title="Nothing matches"
            action={
              <Link
                href="/activity"
                className={cn(
                  buttonVariants({ variant: "outline" }),
                  "min-h-11",
                )}
              >
                Clear the filters
              </Link>
            }
          >
            Try other dates or fewer filters.
          </EmptyState>
        ) : (
          <EmptyState title="No activity yet">
            Every change will be listed here as it happens.
          </EmptyState>
        )
      ) : (
        <>
          <p className="text-sm text-muted-foreground" role="status">
            {list.data.total} {list.data.total === 1 ? "entry" : "entries"}
            {list.data.total > PAGE_SIZE
              ? ` · showing ${(f.page - 1) * PAGE_SIZE + 1} to ${Math.min(
                  f.page * PAGE_SIZE,
                  list.data.total,
                )}`
              : ""}
            . Newest first.
          </p>
          <ol className="grid gap-3" aria-label="Activity">
            {list.data.rows.map((e) => (
              <Entry key={e.id} e={e} resortNames={resortNames} />
            ))}
          </ol>
          <Pager f={f} total={list.data.total} />
        </>
      )}
    </main>
  );
}
