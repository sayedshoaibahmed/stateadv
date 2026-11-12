import type { ReactNode } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { DateText } from "@/components/app/date-text";
import { Money, type MoneyTone } from "@/components/app/money";
import { EmptyState, ErrorState } from "@/components/app/states";
import { SelfApprovedTag, StatusBadge } from "@/components/app/status-badge";
import { ItemActions, FileAdder } from "@/components/app/payments/item-actions";
import {
  ProofViewer,
  type ProofItem,
} from "@/components/app/payments/proof-viewer";
import type { Loaded, MoneyDetail, MoneyRow } from "@/lib/payments/data";
import { METHODS, METHOD_LABELS, warningText } from "@/lib/payments/form";
import {
  STATUSES,
  activeFilterCount,
  moneyHref,
  pageCount,
  type MoneyFilter,
} from "@/lib/payments/list";
import { STATUS_WORDS, type Kind, type Status } from "@/lib/payments/rules";
import { formatPaise } from "@/lib/money";
import { cn } from "@/lib/utils";

const input =
  "min-h-11 w-full rounded-lg border bg-background px-2 text-base sm:text-sm";
const base = (kind: Kind) => (kind === "payment" ? "/payments" : "/refunds");

export const tone = (kind: Kind, status: Status): MoneyTone =>
  status === "reversed"
    ? "reversed"
    : kind === "refund"
      ? "refund"
      : status === "approved"
        ? "approved"
        : status === "waiting"
          ? "waiting"
          : status === "rejected"
            ? "rejected"
            : "neutral";

export function methodText(
  r: Pick<MoneyRow, "method" | "providerName" | "providerOther">,
): string {
  const m = METHOD_LABELS[r.method];
  if (!r.providerName) return m;
  return `${m} · ${r.providerName === "Other" && r.providerOther ? r.providerOther : r.providerName}`;
}

// ---------------------------------------------------------------- the list
export function MoneyFilterForm({
  f,
  resorts,
  people,
  providers,
  action,
  showStatus = true,
}: {
  f: MoneyFilter;
  resorts: { id: string; name: string }[];
  people: { id: string; name: string }[];
  providers: { id: number; name: string; method: string }[];
  action: string;
  showStatus?: boolean;
}) {
  const n = activeFilterCount(f);
  return (
    <form
      action={action}
      method="get"
      className="grid gap-3"
      aria-label="Find records"
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
            maxLength={100}
            placeholder={`${f.kind === "payment" ? "Payment" : "Refund"} no., Booking ID, guest or reference`}
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
          {showStatus ? (
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
                    {STATUS_WORDS[s]}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="grid gap-1">
            <label htmlFor="method" className="text-sm font-medium">
              Method
            </label>
            <select
              id="method"
              name="method"
              defaultValue={f.method ?? "all"}
              className={input}
            >
              <option value="all">All methods</option>
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1">
            <label htmlFor="provider" className="text-sm font-medium">
              Payment app
            </label>
            <select
              id="provider"
              name="provider"
              defaultValue={f.provider === null ? "all" : String(f.provider)}
              className={input}
            >
              <option value="all">All</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.method === "upi" ? "UPI" : "Card"})
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
          <div className="grid gap-1">
            <label htmlFor="by" className="text-sm font-medium">
              Recorded by
            </label>
            <select
              id="by"
              name="by"
              defaultValue={f.recordedBy ?? "all"}
              className={input}
            >
              <option value="all">Anyone</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
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
              <option value="record">
                {f.kind === "payment" ? "Payment date" : "Refund date"}
              </option>
              <option value="entry">Date entered</option>
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
            name="self"
            value="1"
            defaultChecked={f.selfApproved}
            className="size-5"
          />
          Only Self-approved
        </label>
        {f.booking ? (
          <input type="hidden" name="booking" value={f.booking} />
        ) : null}
        <div className="mt-2 flex gap-2">
          <button
            type="submit"
            className="min-h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Show
          </button>
          <Link
            href={action}
            className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}
          >
            Clear
          </Link>
        </div>
      </details>
    </form>
  );
}

export function MoneyTable({
  kind,
  rows,
  resortNames,
  hrefBase,
  selectedId,
}: {
  kind: Kind;
  rows: MoneyRow[];
  resortNames: Map<string, string>;
  hrefBase?: (r: MoneyRow) => string;
  selectedId?: string | null;
}) {
  const link = hrefBase ?? ((r: MoneyRow) => `${base(kind)}/${r.id}`);
  return (
    <>
      <div
        className="hidden overflow-x-auto md:block"
        data-testid="money-table"
      >
        <table className="w-full text-right">
          <thead>
            <tr className="border-b text-sm text-muted-foreground">
              <th scope="col" className="py-2 text-left font-medium">
                {kind === "payment" ? "Payment" : "Refund"}
              </th>
              <th scope="col" className="text-left font-medium">
                Booking
              </th>
              <th scope="col" className="text-left font-medium">
                Guest
              </th>
              <th scope="col" className="text-left font-medium">
                Resort
              </th>
              <th scope="col" className="font-medium">
                Amount
              </th>
              <th scope="col" className="text-left font-medium">
                Method
              </th>
              <th scope="col" className="text-left font-medium">
                Date
              </th>
              <th scope="col" className="text-left font-medium">
                Recorded by
              </th>
              <th scope="col" className="text-left font-medium">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className={cn("border-b", selectedId === r.id && "bg-muted")}
              >
                <th scope="row" className="py-2 text-left font-medium">
                  <Link href={link(r)} className="underline underline-offset-4">
                    {r.code}
                  </Link>
                </th>
                <td className="text-left">
                  <Link
                    href={`/bookings/${r.bookingId}`}
                    className="underline underline-offset-4"
                  >
                    {r.bookingCode}
                  </Link>
                </td>
                <td className="text-left">{r.guestName}</td>
                <td className="text-left">
                  {resortNames.get(r.resortId) ?? "—"}
                </td>
                <td>
                  <Money paise={r.amountP} tone={tone(kind, r.status)} />
                </td>
                <td className="text-left">{methodText(r)}</td>
                <td className="text-left">
                  <DateText value={r.date} />
                </td>
                <td className="text-left">{r.recordedByName ?? "—"}</td>
                <td className="text-left">
                  <span className="flex flex-wrap items-center gap-1">
                    <StatusBadge status={r.status} />
                    {r.selfApproved ? <SelfApprovedTag /> : null}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="grid gap-3 md:hidden" data-testid="money-cards">
        {rows.map((r) => (
          <li
            key={r.id}
            className={cn(
              "rounded-xl border p-3",
              selectedId === r.id && "bg-muted",
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link
                href={link(r)}
                className="font-semibold underline underline-offset-4"
              >
                {r.code}
              </Link>
              <span className="flex flex-wrap items-center gap-1">
                <StatusBadge status={r.status} />
                {r.selfApproved ? <SelfApprovedTag /> : null}
              </span>
            </div>
            <p className="mt-1 text-lg font-semibold">
              <Money paise={r.amountP} tone={tone(kind, r.status)} />
            </p>
            <p className="text-sm">
              <Link
                href={`/bookings/${r.bookingId}`}
                className="underline underline-offset-4"
              >
                {r.bookingCode}
              </Link>{" "}
              · {r.guestName}
            </p>
            <p className="text-sm text-muted-foreground">
              {methodText(r)} · <DateText value={r.date} /> ·{" "}
              {resortNames.get(r.resortId) ?? "—"} · by{" "}
              {r.recordedByName ?? "—"}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}

export function MoneyPager({
  f,
  total,
  path,
}: {
  f: MoneyFilter;
  total: number;
  path: string;
}) {
  const pages = pageCount(total);
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-3">
      {f.page > 1 ? (
        <Link
          href={moneyHref(path, f, { page: f.page - 1 })}
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
          href={moneyHref(path, f, { page: f.page + 1 })}
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

export function MoneyListView({
  f,
  list,
  resortNames,
  people,
  providers,
}: {
  f: MoneyFilter;
  list: Loaded<{ rows: MoneyRow[]; total: number }>;
  resortNames: Map<string, string>;
  people: { id: string; name: string }[];
  providers: { id: number; name: string; method: string }[];
}) {
  const path = base(f.kind);
  const word = f.kind === "payment" ? "payment" : "refund";
  return (
    <main className="flex flex-1 flex-col gap-4 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">
          {f.kind === "payment" ? "Payments" : "Refunds"}
        </h1>
        <Link
          href="/bookings"
          className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}
        >
          Find a booking to add a {word}
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
      <MoneyFilterForm
        f={f}
        resorts={[...resortNames].map(([id, name]) => ({ id, name }))}
        people={people}
        providers={providers}
        action={path}
      />
      {!list.ok ? (
        <ErrorState
          title={`The ${word}s could not be loaded`}
          retryHref={moneyHref(path, f)}
        />
      ) : list.data.rows.length === 0 ? (
        activeFilterCount(f) > 0 || f.q ? (
          <EmptyState
            title={`No ${word}s match`}
            action={
              <Link
                href={path}
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
          <EmptyState title={`No ${word}s yet`}>
            {f.kind === "payment"
              ? "Payments are added from a booking."
              : "Refunds are added from a booking that has money to give back."}
          </EmptyState>
        )
      ) : (
        <>
          <p className="text-sm text-muted-foreground" data-testid="count">
            {list.data.total} {list.data.total === 1 ? word : word + "s"}
          </p>
          <MoneyTable
            kind={f.kind}
            rows={list.data.rows}
            resortNames={resortNames}
          />
          <MoneyPager f={f} total={list.data.total} path={path} />
        </>
      )}
    </main>
  );
}

// ---------------------------------------------------------------- one item
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

export function BookingMoneyBox({ d }: { d: MoneyDetail }) {
  const f = d.financials;
  const n = (x: number | null | undefined) => Number(x ?? 0);
  const cells: [string, ReactNode][] = [
    ["Amount Due", <Money key="a" paise={n(f?.due_paise)} />],
    [
      "Total Collection (Approved)",
      <Money key="b" paise={n(f?.total_collection_paise)} tone="approved" />,
    ],
    [
      "Waiting for Approval",
      <Money key="c" paise={n(f?.waiting_paise)} tone="waiting" />,
    ],
    [
      "Refunds (Approved)",
      <Money key="d" paise={n(f?.refunds_approved_paise)} tone="refund" />,
    ],
    [
      "Pending Amount",
      <Money key="e" paise={n(f?.pending_paise)} tone="pending" />,
    ],
    [
      "Verified Remaining",
      <Money key="g" paise={n(f?.verified_remaining_paise)} tone="pending" />,
    ],
  ];
  return (
    <section aria-label="Booking money" className="grid gap-2">
      <h2 className="text-lg font-semibold">The booking</h2>
      <div
        className="grid grid-cols-2 gap-2 sm:grid-cols-3"
        data-testid="booking-money"
      >
        {cells.map(([l, node]) => (
          <div key={l} className="rounded-lg border p-2">
            <p className="text-xs text-muted-foreground">{l}</p>
            <p className="font-semibold">{node}</p>
          </div>
        ))}
      </div>
      {n(f?.refund_due_paise) > 0 ? (
        <p className="text-sm">
          Refund due <Money paise={n(f?.refund_due_paise)} tone="refund" />.
          Most still refundable{" "}
          <Money paise={Math.max(n(f?.refundable_limit_paise), 0)} />.
        </p>
      ) : null}
      {n(f?.refunds_waiting_paise) > 0 ? (
        <p className="text-sm text-muted-foreground">
          Refunds waiting for approval{" "}
          {formatPaise(n(f?.refunds_waiting_paise))}. They do not change the
          numbers above.
        </p>
      ) : null}
    </section>
  );
}

export function toProofItems(d: MoneyDetail): ProofItem[] {
  return d.proofs.map((p) => ({
    id: p.id,
    name: p.original_file_name,
    mime: p.mime_type,
    sizeBytes: p.size_bytes,
    uploadedAt: p.uploaded_at,
    uploadedByName: p.uploadedByName,
    isCorrection: p.is_correction,
    correctionReason: p.correction_reason,
    hidden: !!p.hidden_at,
    hiddenReason: p.hidden_reason,
  }));
}

export function MoneyDetailBody({
  d,
  me,
  nextHref,
  compact = false,
}: {
  d: MoneyDetail;
  me: string;
  nextHref?: string | null;
  compact?: boolean;
}) {
  const r = d.item;
  const kind = d.kind;
  const visible = d.proofs.filter((p) => !p.hidden_at).length;
  const waiting = r.status === "waiting";
  return (
    <div className="grid gap-5">
      <dl className="grid gap-4 sm:grid-cols-2">
        <Fact label="Amount">
          <Money paise={r.amountP} tone={tone(kind, r.status)} />
        </Fact>
        <Fact label="Status">
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={r.status} />
            {r.selfApproved ? <SelfApprovedTag /> : null}
          </span>
        </Fact>
        <Fact label="Method">{methodText(r)}</Fact>
        <Fact label={kind === "payment" ? "Payment date" : "Refund date"}>
          <DateText value={r.date} />
          {r.time ? ` · ${r.time.slice(0, 5)}` : ""}
        </Fact>
        <Fact label="Reference number">{r.reference ?? "—"}</Fact>
        <Fact label="Booking">
          <Link
            href={`/bookings/${r.bookingId}`}
            className="underline underline-offset-4"
          >
            {d.booking.code}
          </Link>{" "}
          · {r.guestName}
          {d.booking.resortName ? ` · ${d.booking.resortName}` : ""}
        </Fact>
        {kind === "refund" ? (
          <Fact label="Reason">{r.reason ?? "—"}</Fact>
        ) : null}
        {d.remarks ? <Fact label="Remarks">{d.remarks}</Fact> : null}
        <Fact label="Recorded by">
          {r.recordedByName ?? "—"} on{" "}
          <DateText value={r.recordedAt} withTime />
        </Fact>
        {r.decidedByName ? (
          <Fact
            label={
              r.status === "rejected"
                ? "Rejected by"
                : r.status === "reversed"
                  ? "Reversed by"
                  : "Approved by"
            }
          >
            {r.decidedByName}
          </Fact>
        ) : null}
        {r.rejectionReason ? (
          <Fact label="Reason for rejecting">{r.rejectionReason}</Fact>
        ) : null}
        {r.reversalReason ? (
          <Fact label="Reason for reversing">{r.reversalReason}</Fact>
        ) : null}
      </dl>

      <ItemActions
        kind={kind}
        id={r.id}
        version={r.version}
        status={r.status}
        recordedBy={r.recordedBy}
        me={me}
        amountP={r.amountP}
        code={r.code}
        nextHref={nextHref}
        reverseBlockedLinks={
          kind === "payment"
            ? d.otherRefunds
                .filter(
                  (x) => x.status === "waiting" || x.status === "approved",
                )
                .map((x) => ({ id: x.id, code: x.code }))
            : []
        }
      />
      {kind === "payment" &&
      d.otherRefunds.some(
        (x) => x.status === "waiting" || x.status === "approved",
      ) &&
      r.status === "approved" ? (
        <p className="text-sm text-muted-foreground">
          Note: this payment cannot be reversed while refunds depend on it.
          Reject or reverse the refunds first.
        </p>
      ) : null}

      <section className="grid gap-2" aria-label="Files">
        <h2 className="text-lg font-semibold">
          {kind === "payment" ? "Payment proof" : "Refund proof"}
        </h2>
        <ProofViewer
          proofs={toProofItems(d)}
          itemKind={kind}
          itemId={r.id}
          canHide={waiting}
        />
        <FileAdder
          kind={kind}
          id={r.id}
          bookingId={r.bookingId}
          status={r.status}
          visibleCount={visible}
        />
      </section>

      {compact ? null : <BookingMoneyBox d={d} />}

      <section className="grid gap-2" aria-label="History">
        <h2 className="text-lg font-semibold">History</h2>
        {d.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No decision has been made yet.
          </p>
        ) : (
          <ul className="grid gap-2">
            {d.history.map((h) => (
              <li key={h.id} className="rounded-lg border p-3 text-sm">
                {h.by ?? "Someone"}{" "}
                {h.to === "approved"
                  ? "approved"
                  : h.to === "rejected"
                    ? "rejected"
                    : h.to === "reversed"
                      ? "reversed"
                      : "changed"}{" "}
                it
                {h.self ? " (Self-approved)" : ""}.
                {h.reason ? ` Reason: ${h.reason}` : ""}{" "}
                <span className="text-muted-foreground">
                  · <DateText value={h.at} withTime />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function MoneyDetailView({
  d,
  me,
  saved,
  warnings,
}: {
  d: MoneyDetail;
  me: string;
  saved: boolean;
  warnings: string[];
}) {
  const kind = d.kind;
  return (
    <main className="flex flex-1 flex-col gap-5 p-3 sm:p-4">
      <div className="grid gap-2">
        <Link
          href={base(kind)}
          className="text-sm underline underline-offset-4"
        >
          All {kind === "payment" ? "payments" : "refunds"}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold" data-testid="item-code">
            {d.item.code}
          </h1>
          <StatusBadge status={d.item.status} />
        </div>
      </div>
      {saved ? (
        <p
          role="status"
          className="rounded-lg border border-approved/40 bg-approved-soft px-3 py-2 font-medium text-approved"
        >
          {kind === "payment" ? "Payment" : "Refund"} {d.item.code} saved. It is
          waiting for approval.
        </p>
      ) : null}
      {warnings.length > 0 ? (
        <ul
          role="status"
          className="grid gap-1 rounded-lg border border-waiting/40 bg-waiting-soft px-3 py-2 text-sm"
          aria-label="Warnings"
        >
          {warnings.map((w) => (
            <li key={w}>{warningText(w)}</li>
          ))}
        </ul>
      ) : null}
      <MoneyDetailBody d={d} me={me} />
    </main>
  );
}
