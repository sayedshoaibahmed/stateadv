import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, Info } from "lucide-react";
import { Money, type MoneyTone } from "@/components/app/money";
import { StatusBadge, SelfApprovedTag } from "@/components/app/status-badge";
import { DateText } from "@/components/app/date-text";
import { EmptyState, ErrorState } from "@/components/app/states";
import { cn } from "@/lib/utils";
import {
  RANGE_KEYS,
  RANGE_LABELS,
  dashboardHref,
  periodText,
  type DashboardFilter,
} from "@/lib/dashboard/filters";
import {
  buildAlerts,
  describeActivity,
  type ActivityRow,
  type Alerts,
  type ResortRow,
  type Summary,
} from "@/lib/dashboard/model";
import type { Part, RecentBooking, RecentMoney } from "@/lib/dashboard/data";

const failed = (href: string, what: string) => (
  <ErrorState title={`${what} could not be loaded`} retryHref={href} />
);

function Card({
  title,
  info,
  hint,
  children,
  className,
}: {
  title: string;
  info: string;
  hint: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      className={cn("rounded-xl border bg-card p-4", className)}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
        <details className="relative">
          <summary
            className="-m-3 flex size-11 cursor-pointer list-none items-center justify-center text-muted-foreground"
            aria-label={`About ${title}`}
          >
            <Info className="size-4" aria-hidden="true" />
          </summary>
          <p className="absolute right-0 z-10 mt-2 w-64 rounded-lg border bg-popover p-3 text-sm shadow-md">
            {info}
          </p>
        </details>
      </div>
      <div className="mt-1 text-2xl font-semibold">{children}</div>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </section>
  );
}

function Count({ n }: { n: number }) {
  return <span className="tabular-nums">{n.toLocaleString("en-IN")}</span>;
}

/** The numbers at the top. Exactly one card is "Total Collection (Approved)"; Waiting is its own card (FR-DSH-2). */
export function StatCards({ s, period }: { s: Summary; period: string }) {
  return (
    <div
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
      data-testid="stat-cards"
    >
      <Card
        title="Total Resorts"
        info="Resorts that are open for bookings."
        hint="Open resorts today"
      >
        <Count n={s.totalResorts} />
      </Card>
      <Card
        title="Total Bookings"
        info="Bookings made in the chosen period, including ones later cancelled."
        hint={`Booked ${period}`}
      >
        <Count n={s.totalBookings} />
      </Card>
      <Card
        title="Today's Check-ins"
        info="Guests arriving today. Cancelled and no-show bookings are not counted."
        hint="Today"
      >
        <Count n={s.checkinsToday} />
      </Card>
      <Card
        title="Today's Check-outs"
        info="Guests leaving today. Cancelled and no-show bookings are not counted."
        hint="Today"
      >
        <Count n={s.checkoutsToday} />
      </Card>
      <Card
        title="Expected Collection"
        info="Money the payment plans say should arrive in the chosen period."
        hint={`Due ${period}`}
      >
        <Money paise={s.expectedPaise} tone="pending" />
      </Card>
      <Card
        title="Total Collection (Approved)"
        info="Only payments a second person has approved, by payment date, with approved refunds taken off. Payments still waiting are not included."
        hint={`Paid ${period}`}
        className="border-approved/40"
      >
        <Money paise={s.totalCollectionPaise} tone="approved" />
        <p className="mt-1 text-sm font-normal">
          Refunds <Money paise={s.refundsPaise} tone="refund" /> · Net
          Collection <Money paise={s.netCollectionPaise} />
        </p>
      </Card>
      <Card
        title="Waiting for Approval"
        info="Payments entered in the chosen period that nobody has approved yet. They are not part of the Total Collection."
        hint={`Entered ${period}. ${s.waitingItems} ${s.waitingItems === 1 ? "item is" : "items are"} waiting in all`}
        className="border-waiting/40"
      >
        <Money paise={s.waitingPaise} tone="waiting" />
      </Card>
      <Card
        title="Pending Amount"
        info="The amount due less approved and waiting payments, plus approved refunds."
        hint="As of today"
      >
        <Money paise={s.pendingPaise} tone="pending" />
      </Card>
    </div>
  );
}

/** Period buttons and custom dates. A plain form (works without scripts); the resort is kept. */
export function PeriodForm({ f }: { f: DashboardFilter }) {
  return (
    <form
      action="/dashboard"
      method="get"
      className="flex flex-wrap items-end gap-3"
      aria-label="Choose period"
    >
      {f.resort ? <input type="hidden" name="resort" value={f.resort} /> : null}
      <div className="grid gap-1">
        <label htmlFor="range" className="text-sm font-medium">
          Period
        </label>
        <select
          id="range"
          name="range"
          defaultValue={f.range}
          className="h-11 rounded-lg border bg-background px-2 text-base sm:text-sm"
        >
          {RANGE_KEYS.map((k) => (
            <option key={k} value={k}>
              {RANGE_LABELS[k]}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1">
        <label htmlFor="from" className="text-sm font-medium">
          From (custom)
        </label>
        <input
          id="from"
          name="from"
          type="date"
          defaultValue={f.range === "custom" ? f.from : undefined}
          className="h-11 rounded-lg border bg-background px-2 text-base sm:text-sm"
        />
      </div>
      <div className="grid gap-1">
        <label htmlFor="to" className="text-sm font-medium">
          To (custom)
        </label>
        <input
          id="to"
          name="to"
          type="date"
          defaultValue={f.range === "custom" ? f.to : undefined}
          className="h-11 rounded-lg border bg-background px-2 text-base sm:text-sm"
        />
      </div>
      <button
        type="submit"
        className="h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
      >
        Show
      </button>
    </form>
  );
}

export function AlertsPanel({
  alerts,
  period,
}: {
  alerts: Alerts;
  period: string;
}) {
  const items = buildAlerts(alerts, period);
  if (items.length === 0)
    return (
      <p className="rounded-lg border p-3 text-sm" role="status">
        Nothing needs your attention right now.
      </p>
    );
  return (
    <ul className="grid gap-2" aria-label="Alerts">
      {items.map((a) => (
        <li
          key={a.key}
          className={cn(
            "flex items-start gap-2 rounded-lg border p-3 text-sm",
            a.tone === "danger" && "border-rejected/40 bg-rejected-soft",
            a.tone === "warning" && "border-waiting/40 bg-waiting-soft",
          )}
        >
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          {a.text}
        </li>
      ))}
    </ul>
  );
}

const money: [keyof ResortRow, string, MoneyTone][] = [
  ["expectedPaise", "Expected", "pending"],
  ["totalCollectionPaise", "Total Collection (Approved)", "approved"],
  ["waitingPaise", "Waiting", "waiting"],
  ["refundsPaise", "Refunds", "refund"],
  ["netCollectionPaise", "Net", "neutral"],
  ["pendingPaise", "Pending", "pending"],
];

/** A table from tablet width up; one card per resort on a phone (UI spec section 5). */
export function ResortTable({ rows }: { rows: ResortRow[] }) {
  if (rows.length === 0)
    return (
      <EmptyState title="No resorts yet">
        Add a resort under Resorts and it will appear here.
      </EmptyState>
    );
  return (
    <>
      <div
        className="hidden overflow-x-auto sm:block"
        data-testid="resort-table"
      >
        <table className="w-full text-right">
          <thead>
            <tr className="border-b text-sm text-muted-foreground">
              <th scope="col" className="py-2 text-left font-medium">
                Resort
              </th>
              <th scope="col" className="font-medium">
                Bookings
              </th>
              {money.map(([, l]) => (
                <th key={l} scope="col" className="px-2 font-medium">
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.resortId} className="border-b">
                <th scope="row" className="py-2 text-left font-medium">
                  {r.name}{" "}
                  {!r.isActive ? (
                    <span className="text-xs text-muted-foreground">
                      (closed)
                    </span>
                  ) : null}
                </th>
                <td className="tabular-nums">{r.bookings}</td>
                {money.map(([k, l, tone]) => (
                  <td key={l} className="px-2">
                    <Money paise={r[k] as number} tone={tone} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="grid gap-3 sm:hidden" data-testid="resort-cards">
        {rows.map((r) => (
          <li key={r.resortId} className="rounded-xl border p-3">
            <p className="font-medium">
              {r.name}{" "}
              {!r.isActive ? (
                <span className="text-xs text-muted-foreground">(closed)</span>
              ) : null}
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Bookings</dt>
              <dd className="text-right tabular-nums">{r.bookings}</dd>
              {money.map(([k, l, tone]) => (
                <div key={l} className="col-span-2 flex justify-between">
                  <dt className="text-muted-foreground">{l}</dt>
                  <dd>
                    <Money paise={r[k] as number} tone={tone} />
                  </dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

export function RecentBookings({
  rows,
  names,
}: {
  rows: RecentBooking[];
  names: Map<string, string>;
}) {
  if (rows.length === 0)
    return (
      <EmptyState title="No bookings yet">
        Bookings will appear here once they are added.
      </EmptyState>
    );
  return (
    <ul className="grid gap-2">
      {rows.map((b) => (
        <li
          key={b.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
        >
          <span>
            <span className="font-medium">{b.guest}</span> ·{" "}
            <Link
              href={"/bookings/" + b.id}
              className="underline underline-offset-4"
            >
              {b.code}
            </Link>{" "}
            · {names.get(b.resortId) ?? "Resort"}
          </span>
          <span className="flex items-center gap-2">
            <DateText value={b.checkIn} />
            {b.finalPaise !== null ? <Money paise={b.finalPaise} /> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function RecentPayments({
  rows,
  names,
}: {
  rows: RecentMoney[];
  names: Map<string, string>;
}) {
  if (rows.length === 0)
    return (
      <EmptyState title="No payments yet">
        Payments and refunds will appear here once they are recorded.
      </EmptyState>
    );
  return (
    <ul className="grid gap-2">
      {rows.map((p) => (
        <li
          key={p.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
        >
          <span>
            {p.kind === "refund" ? "Refund" : "Payment"} {p.code} ·{" "}
            {names.get(p.resortId) ?? "Resort"} · <DateText value={p.date} />
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <Money
              paise={p.amountPaise}
              tone={
                p.kind === "refund"
                  ? "refund"
                  : p.status === "reversed"
                    ? "reversed"
                    : "neutral"
              }
            />
            <StatusBadge status={p.status} />
            {p.selfApproved ? <SelfApprovedTag /> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function RecentActivity({
  rows,
}: {
  rows: (ActivityRow & { at: string })[];
}) {
  const lines = rows
    .map((r) => ({ at: r.at, id: r.id, text: describeActivity(r) }))
    .filter(
      (x): x is { at: string; id: number; text: string } => x.text !== null,
    )
    .slice(0, 8);
  if (lines.length === 0)
    return (
      <EmptyState title="No activity yet">
        What people do will be listed here.
      </EmptyState>
    );
  return (
    <ul className="grid gap-2">
      {lines.map((l) => (
        <li key={l.id} className="rounded-lg border p-3 text-sm">
          {l.text}{" "}
          <span className="text-muted-foreground">
            · <DateText value={l.at} withTime />
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface DashboardData {
  filter: DashboardFilter;
  summary: Part<Summary>;
  resorts: Part<ResortRow[]>;
  alerts: Part<Alerts>;
  bookings: Part<RecentBooking[]>;
  money: Part<RecentMoney[]>;
  activity: Part<(ActivityRow & { at: string })[]>;
  resortNames: Map<string, string>;
  /** the chart (a client component) and anything shown beside the alerts */
  chart: ReactNode;
  notices?: ReactNode;
}

/** The whole page, as plain markup from loaded data, so it can be tested without a browser or database. */
export function DashboardView(d: DashboardData) {
  const f = d.filter;
  const period = periodText(f.from, f.to);
  const href = dashboardHref(f);
  const section = (title: string, body: ReactNode) => (
    <section className="grid gap-2" aria-label={title}>
      <h2 className="text-lg font-semibold">{title}</h2>
      {body}
    </section>
  );
  const scope = f.resort
    ? (d.resortNames.get(f.resort) ?? "One resort")
    : "All resorts";
  return (
    <main className="flex flex-1 flex-col gap-5 p-3 sm:p-4">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-muted-foreground">
          {scope} · {RANGE_LABELS[f.range]}: {period}
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
      <PeriodForm f={f} />
      {d.notices}
      {d.summary.ok ? (
        <StatCards s={d.summary.data} period={period} />
      ) : (
        failed(href, "The numbers")
      )}
      {section(
        "Needs attention",
        d.alerts.ok ? (
          <AlertsPanel alerts={d.alerts.data} period={period} />
        ) : (
          failed(href, "The alerts")
        ),
      )}
      {section(
        "By resort",
        d.resorts.ok ? (
          <ResortTable rows={d.resorts.data} />
        ) : (
          failed(href, "The resort table")
        ),
      )}
      {section("Collection over time", d.chart)}
      <div className="grid gap-5 lg:grid-cols-3">
        {section(
          "Recent bookings",
          d.bookings.ok ? (
            <RecentBookings rows={d.bookings.data} names={d.resortNames} />
          ) : (
            failed(href, "Recent bookings")
          ),
        )}
        {section(
          "Recent payments and refunds",
          d.money.ok ? (
            <RecentPayments rows={d.money.data} names={d.resortNames} />
          ) : (
            failed(href, "Recent payments")
          ),
        )}
        {section(
          "Recent activity",
          d.activity.ok ? (
            <RecentActivity rows={d.activity.data} />
          ) : (
            failed(href, "Recent activity")
          ),
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        <Link href="/settings/resorts" className="underline">
          Manage resorts
        </Link>
      </p>
    </main>
  );
}
