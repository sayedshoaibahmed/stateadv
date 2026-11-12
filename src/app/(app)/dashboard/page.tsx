import { Suspense } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import CollectionChartLoader from "@/components/app/dashboard/collection-chart-loader";
import { DashboardView } from "@/components/app/dashboard/dashboard-view";
import { EmptyState, ErrorState } from "@/components/app/states";
import { describeOwnerEvent, type AuditRow } from "@/lib/accounts/rules";
import { requireUser } from "@/lib/auth/session";
import {
  loadActivity,
  loadAlerts,
  loadChart,
  loadRecentBookings,
  loadRecentMoney,
  loadResortChoices,
  loadResorts,
  loadSummary,
} from "@/lib/dashboard/data";
import { dashboardHref, parseDashboardFilter } from "@/lib/dashboard/filters";
import { DateText } from "@/components/app/date-text";
import { createClient } from "@/lib/supabase/server";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await requireUser();
  const filter = parseDashboardFilter(await searchParams);

  const [summary, resorts, alerts, bookings, money, activity, chart, choices] =
    await Promise.all([
      loadSummary(filter),
      loadResorts(filter),
      loadAlerts(filter),
      loadRecentBookings(filter),
      loadRecentMoney(filter),
      loadActivity(filter),
      loadChart(filter),
      loadResortChoices(),
    ]);

  // A resort id in the address that is not a real resort falls back to all resorts, with a plain explanation.
  const names = new Map(choices.map((c) => [c.id, c.name]));
  const effective =
    filter.resort && !names.has(filter.resort) && choices.length > 0
      ? {
          ...filter,
          resort: null,
          problem:
            filter.problem ??
            "That resort was not found, so all resorts are shown.",
        }
      : filter;
  const href = dashboardHref(effective);

  const chartNode = !chart.ok ? (
    <ErrorState title="The chart could not be loaded" retryHref={href} />
  ) : chart.data.points.every(
      (p) => p.totalCollectionPaise + p.waitingPaise + p.expectedPaise === 0,
    ) ? (
    <EmptyState title="Nothing to chart yet">
      No payments or payment plans fall in this period.
    </EmptyState>
  ) : (
    <CollectionChartLoader
      points={chart.data.points}
      grain={chart.data.grain}
    />
  );

  return (
    <DashboardView
      filter={effective}
      summary={summary}
      resorts={resorts}
      alerts={alerts}
      bookings={bookings}
      money={money}
      activity={activity}
      resortNames={names}
      chart={chartNode}
      notices={
        <Suspense fallback={null}>
          <OwnerNotices isOwner={user.role === "owner"} />
        </Suspense>
      }
    />
  );
}

/** Sensitive actions on Owner accounts in the last 30 days, shown to every user (FR-AUTH-12, FR-AUTH-14). */
async function loadNotices() {
  const supabase = await createClient();
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const [{ data }, { data: owners }] = await Promise.all([
    supabase
      .from("audit_logs")
      .select(
        "action, actor_name, occurred_at, reason, changed_fields, old_data, new_data",
      )
      .eq("table_name", "user_profiles")
      .gte("occurred_at", since)
      .order("id", { ascending: false })
      .limit(60),
    supabase.rpc("active_owner_count"),
  ]);
  const lines = ((data ?? []) as AuditRow[])
    .map((r) => ({ at: r.occurred_at, text: describeOwnerEvent(r) }))
    .filter((x): x is { at: string; text: string } => x.text !== null)
    .slice(0, 8);
  return { lines, owners: owners as number | null };
}

async function OwnerNotices({ isOwner }: { isOwner: boolean }) {
  const { lines, owners } = await loadNotices();
  return (
    <>
      {isOwner && owners === 1 ? (
        <Alert role="status">
          <AlertTitle>Only one Owner account exists</AlertTitle>
          <AlertDescription>
            Add a second Owner (People → Add person) so access can be recovered.
          </AlertDescription>
        </Alert>
      ) : null}
      {lines.length > 0 ? (
        <section aria-labelledby="notices" className="grid gap-2">
          <h2 id="notices" className="text-lg font-semibold">
            Owner account notices
          </h2>
          <ul className="grid gap-2">
            {lines.map((l, i) => (
              <li key={i} className="rounded border p-3 text-sm">
                {l.text}{" "}
                <span className="text-muted-foreground">
                  · <DateText value={l.at} withTime />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
