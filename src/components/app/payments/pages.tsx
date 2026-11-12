import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/app/states";
import {
  MoneyForm,
  type MoneyBookingInfo,
} from "@/components/app/payments/money-form";
import {
  MoneyDetailBody,
  MoneyDetailView,
  MoneyListView,
  MoneyPager,
  MoneyTable,
} from "@/components/app/payments/money-views";
import { requireUser } from "@/lib/auth/session";
import { loadResortNames } from "@/lib/bookings/data";
import { todayIst } from "@/lib/dates";
import {
  type BookingForMoney,
  loadBookingForMoney,
  loadMoneyDetail,
  loadMoneyList,
  loadPeople,
  loadProviderChoices,
  loadWaitingCounts,
} from "@/lib/payments/data";
import { emptyMoneyForm, type MoneyFormValues } from "@/lib/payments/form";
import { parseMoneyFilter } from "@/lib/payments/list";
import type { Kind } from "@/lib/payments/rules";
import { paiseText } from "@/lib/bookings/form";
import { cn } from "@/lib/utils";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) =>
  Array.isArray(v) ? v[0] : v;
const path = (kind: Kind) => (kind === "payment" ? "/payments" : "/refunds");
const word = (kind: Kind) => (kind === "payment" ? "payment" : "refund");

export async function ListPage({ kind, sp }: { kind: Kind; sp: SP }) {
  await requireUser();
  const f = parseMoneyFilter(kind, sp);
  const [list, resorts, people, providers] = await Promise.all([
    loadMoneyList(f),
    loadResortNames(),
    loadPeople(),
    loadProviderChoices(),
  ]);
  return (
    <MoneyListView
      f={f}
      list={list}
      resortNames={resorts}
      people={people}
      providers={providers}
    />
  );
}

function bookingInfo(b: BookingForMoney): MoneyBookingInfo {
  const f = b.financials;
  const n = (x: number | null | undefined) => Number(x ?? 0);
  return {
    id: b.id,
    code: b.code,
    guestName: b.guestName,
    resortName: b.resortName,
    statusText:
      b.status === "no_show"
        ? "No-show"
        : b.status.charAt(0).toUpperCase() +
          b.status.slice(1).replace("_", "-"),
    pendingPaise: n(f?.pending_paise),
    refund: {
      approvedPaise: n(f?.total_collection_paise),
      refundsApprovedPaise: n(f?.refunds_approved_paise),
      refundDuePaise: n(f?.refund_due_paise),
      mostPaise: n(f?.refundable_limit_paise),
    },
  };
}

export async function NewPage({ kind, sp }: { kind: Kind; sp: SP }) {
  await requireUser();
  const bookingId = first(sp.booking);
  const shell = (body: React.ReactNode) => (
    <main className="flex flex-1 flex-col gap-4 p-3 sm:p-4">
      <div>
        <Link
          href={path(kind)}
          className="text-sm underline underline-offset-4"
        >
          All {kind === "payment" ? "payments" : "refunds"}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">
          {kind === "payment" ? "Add Payment" : "Add Refund"}
        </h1>
      </div>
      {body}
    </main>
  );
  if (!bookingId) {
    return shell(
      <EmptyState
        title="Choose a booking first"
        action={
          <Link href="/bookings" className={cn(buttonVariants(), "min-h-11")}>
            Open the bookings
          </Link>
        }
      >
        Open a booking and use its Add{" "}
        {kind === "payment" ? "Payment" : "Refund"} button.
      </EmptyState>,
    );
  }
  const [b, providers] = await Promise.all([
    loadBookingForMoney(bookingId),
    loadProviderChoices(),
  ]);
  if (!b.ok)
    return shell(
      <ErrorState
        title="The booking could not be loaded"
        retryHref={`${path(kind)}/new?booking=${bookingId}`}
      />,
    );
  if (!b.data) notFound();
  return shell(
    <MoneyForm
      kind={kind}
      mode="create"
      booking={bookingInfo(b.data)}
      providers={providers}
      initial={emptyMoneyForm(b.data.id)}
      today={todayIst()}
    />,
  );
}

export async function DetailPage({
  kind,
  id,
  sp,
}: {
  kind: Kind;
  id: string;
  sp: SP;
}) {
  const user = await requireUser();
  const d = await loadMoneyDetail(kind, id);
  if (!d.ok)
    return (
      <main className="flex flex-1 flex-col gap-4 p-4">
        <ErrorState
          title={`The ${word(kind)} could not be loaded`}
          retryHref={`${path(kind)}/${id}`}
        />
      </main>
    );
  if (!d.data) notFound();
  const warn = (first(sp.warn) ?? "")
    .split(",")
    .filter((w) => /^[A-Z_]{3,40}$/.test(w));
  return (
    <MoneyDetailView
      d={d.data}
      me={user.id}
      saved={first(sp.saved) === "1"}
      warnings={warn}
    />
  );
}

export async function EditPage({ kind, id }: { kind: Kind; id: string }) {
  await requireUser();
  const [d, providers] = await Promise.all([
    loadMoneyDetail(kind, id),
    loadProviderChoices(),
  ]);
  if (!d.ok)
    return (
      <main className="flex flex-1 flex-col gap-4 p-4">
        <ErrorState
          title={`The ${word(kind)} could not be loaded`}
          retryHref={`${path(kind)}/${id}/edit`}
        />
      </main>
    );
  if (!d.data) notFound();
  const { item, booking, financials } = d.data;
  if (item.status !== "waiting") redirect(`${path(kind)}/${id}`);
  const n = (x: number | null | undefined) => Number(x ?? 0);
  const initial: MoneyFormValues = {
    bookingId: item.bookingId,
    amount: paiseText(item.amountP),
    method: item.method,
    providerId: d.data.providerId === null ? "" : String(d.data.providerId),
    providerOther: item.providerOther ?? "",
    date: item.date,
    time: item.time ? item.time.slice(0, 5) : "",
    reference: item.reference ?? "",
    remarks: d.data.remarks ?? "",
    reason: item.reason ?? "",
  };
  return (
    <main className="flex flex-1 flex-col gap-4 p-3 sm:p-4">
      <div>
        <Link
          href={`${path(kind)}/${id}`}
          className="text-sm underline underline-offset-4"
        >
          Back to {item.code}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Change {item.code}</h1>
        <p className="text-muted-foreground">
          You can change it only while it is waiting for approval. Your reason
          is kept in the history.
        </p>
      </div>
      <MoneyForm
        kind={kind}
        mode="edit"
        booking={{
          id: booking.id,
          code: booking.code,
          guestName: item.guestName,
          resortName: booking.resortName,
          statusText: booking.status,
          pendingPaise: n(financials?.pending_paise),
          refund: {
            approvedPaise: n(financials?.total_collection_paise),
            refundsApprovedPaise: n(financials?.refunds_approved_paise),
            refundDuePaise: n(financials?.refund_due_paise),
            mostPaise: n(financials?.refundable_limit_paise),
          },
        }}
        providers={providers}
        initial={initial}
        today={todayIst()}
        edit={{ id: item.id, version: item.version }}
      />
    </main>
  );
}

/** Waiting for Approval: Payments | Refunds, oldest first, with the review panel beside the list (UI spec 3.9). */
export async function ApprovalsPage({ sp }: { sp: SP }) {
  const user = await requireUser();
  const kind: Kind = first(sp.tab) === "refunds" ? "refund" : "payment";
  const f = parseMoneyFilter(kind, sp, { queue: true });
  const [list, counts, resorts] = await Promise.all([
    loadMoneyList(f),
    loadWaitingCounts(),
    loadResortNames(),
  ]);
  const tabHref = (k: Kind, id?: string) =>
    `/approvals?tab=${k === "payment" ? "payments" : "refunds"}${id ? `&id=${id}` : ""}`;
  const rows = list.ok ? list.data.rows : [];
  const wanted = first(sp.id);
  const selected = rows.find((r) => r.id === wanted) ?? rows[0] ?? null;
  const detail = selected ? await loadMoneyDetail(kind, selected.id) : null;
  const idx = selected ? rows.findIndex((r) => r.id === selected.id) : -1;
  const next = idx >= 0 ? (rows[idx + 1] ?? rows[idx - 1] ?? null) : null;
  const nextHref = next ? tabHref(kind, next.id) : tabHref(kind);
  const tab = (k: Kind, label: string, n: number | undefined) => (
    <Link
      key={k}
      href={tabHref(k)}
      aria-current={k === kind ? "page" : undefined}
      className={cn(
        "min-h-11 shrink-0 border-b-2 px-3 py-2 text-sm font-medium",
        k === kind
          ? "border-primary"
          : "border-transparent text-muted-foreground",
      )}
    >
      {label}
      {n !== undefined ? ` (${n})` : ""}
    </Link>
  );
  return (
    <main className="flex flex-1 flex-col gap-4 p-3 sm:p-4">
      <h1 className="text-2xl font-semibold">Waiting for Approval</h1>
      <nav
        aria-label="Waiting lists"
        className="flex gap-1 overflow-x-auto border-b"
      >
        {tab("payment", "Payments", counts?.payments)}
        {tab("refund", "Refunds", counts?.refunds)}
      </nav>
      {f.problem ? (
        <p
          role="status"
          className="rounded-lg border border-waiting/40 bg-waiting-soft p-3 text-sm"
        >
          {f.problem}
        </p>
      ) : null}
      {!list.ok ? (
        <ErrorState
          title="The waiting list could not be loaded"
          retryHref={tabHref(kind)}
        />
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing is waiting">
          Everything has been decided. New{" "}
          {kind === "payment" ? "payments" : "refunds"} will appear here, oldest
          first.
        </EmptyState>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <section
            aria-label="Waiting list"
            className="grid content-start gap-3"
          >
            <p className="text-sm text-muted-foreground">
              {list.ok ? list.data.total : 0} waiting, oldest first
            </p>
            <MoneyTable
              kind={kind}
              rows={rows}
              resortNames={resorts}
              hrefBase={(r) => tabHref(kind, r.id)}
              selectedId={selected?.id}
            />
            <MoneyPager
              f={f}
              total={list.ok ? list.data.total : 0}
              path="/approvals"
            />
          </section>
          <section
            aria-label="Review"
            className="grid content-start gap-3 rounded-xl border p-3"
          >
            {detail && detail.ok && detail.data ? (
              <>
                <h2 className="text-lg font-semibold">
                  Review {detail.data.item.code}
                </h2>
                <MoneyDetailBody
                  d={detail.data}
                  me={user.id}
                  nextHref={nextHref}
                />
              </>
            ) : (
              <ErrorState
                title="This item could not be loaded"
                retryHref={tabHref(kind, selected?.id)}
              />
            )}
          </section>
        </div>
      )}
    </main>
  );
}
