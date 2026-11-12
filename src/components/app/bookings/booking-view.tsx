import type { ReactNode } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { BookingStatusBadge } from "@/components/app/booking-status";
import { DateText } from "@/components/app/date-text";
import { Money } from "@/components/app/money";
import { EmptyState } from "@/components/app/states";
import { BookingActions } from "@/components/app/bookings/booking-actions";
import { allocateCoverage } from "@/lib/bookings/coverage";
import type { BookingDetail } from "@/lib/bookings/data";
import { METHOD_LABELS, type BookingStatus } from "@/lib/bookings/list";
import { nightsText } from "@/lib/bookings/form";
import { formatPaise } from "@/lib/money";
import { cn } from "@/lib/utils";

export const TABS = [
  { key: "details", label: "Details" },
  { key: "payments", label: "Payments & Refunds" },
  { key: "plan", label: "Payment Plan" },
  { key: "pdfs", label: "PDFs" },
  { key: "history", label: "History" },
] as const;
export type TabKey = (typeof TABS)[number]["key"];

export function parseTab(v: string | string[] | undefined): TabKey {
  const x = Array.isArray(v) ? v[0] : v;
  return TABS.some((t) => t.key === x) ? (x as TabKey) : "details";
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function MoneyBox({ d }: { d: BookingDetail }) {
  const f = d.financials;
  const n = (x: number | null | undefined) => Number(x ?? 0);
  const cell = (label: string, node: ReactNode, hint?: string) => (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold">{node}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
  return (
    <section aria-label="Money" className="grid gap-3">
      <div
        className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4"
        data-testid="money-box"
      >
        {cell(
          "Amount Due",
          <Money paise={n(f?.due_paise)} />,
          d.booking.status === "cancelled" || d.booking.status === "no_show"
            ? "The cancellation charge"
            : undefined,
        )}
        {cell(
          "Total Collection (Approved)",
          <Money paise={n(f?.total_collection_paise)} tone="approved" />,
        )}
        {cell(
          "Waiting for Approval",
          <Money paise={n(f?.waiting_paise)} tone="waiting" />,
        )}
        {cell(
          "Refunds (Approved)",
          <Money paise={n(f?.refunds_approved_paise)} tone="refund" />,
        )}
        {cell("Net Collection", <Money paise={n(f?.net_collection_paise)} />)}
        {cell(
          "Pending Amount",
          <Money paise={n(f?.pending_paise)} tone="pending" />,
        )}
        {cell(
          "Verified Remaining",
          <Money paise={n(f?.verified_remaining_paise)} tone="pending" />,
        )}
        {n(f?.extra_paise) > 0
          ? cell(
              "Extra Payment",
              <Money paise={n(f?.extra_paise)} tone="extra" />,
            )
          : null}
        {n(f?.refund_due_paise) > 0
          ? cell(
              "Refund due",
              <Money paise={n(f?.refund_due_paise)} tone="refund" />,
            )
          : null}
      </div>
      {n(f?.refunds_waiting_paise) > 0 ? (
        <p className="rounded-lg border border-waiting/40 bg-waiting-soft px-3 py-2 text-sm">
          Refund {formatPaise(n(f?.refunds_waiting_paise))} waiting for approval
          · still to record {formatPaise(n(f?.refund_still_to_record_paise))}.
          This does not change the numbers above.
        </p>
      ) : null}
      {n(f?.rejected_paise) > 0 || n(f?.reversed_paise) > 0 ? (
        <p className="text-sm text-muted-foreground">
          {n(f?.rejected_paise) > 0 ? (
            <>Rejected {formatPaise(n(f?.rejected_paise))}. </>
          ) : null}
          {n(f?.reversed_paise) > 0 ? (
            <>Reversed {formatPaise(n(f?.reversed_paise))}. </>
          ) : null}
          These are not counted.
        </p>
      ) : null}
    </section>
  );
}

function DetailsTab({ d }: { d: BookingDetail }) {
  const b = d.booking;
  return (
    <div className="grid gap-6">
      <dl className="grid gap-4 sm:grid-cols-2">
        <Fact label="Guest">
          {d.guest ? (
            <Link
              href={`/guests/${d.guest.id}`}
              className="underline underline-offset-4"
            >
              {b.guest_name}
            </Link>
          ) : (
            b.guest_name
          )}{" "}
          · {b.guest_mobile}
        </Fact>
        <Fact label="Stay type">{b.stay_type_name}</Fact>
        <Fact label="Booking date">
          <DateText value={b.booking_date} />
        </Fact>
        <Fact label="People (PAX)">{b.pax}</Fact>
        <Fact label="Check-in">
          <DateText value={b.check_in_at} withTime />
        </Fact>
        <Fact label="Check-out">
          <DateText value={b.check_out_at} withTime />
        </Fact>
        <Fact label="Nights">{nightsText(b.nights)}</Fact>
        <Fact label="C/O">
          {b.co_category_name}
          {b.co_name ? ` – ${b.co_name}` : ""}
        </Fact>
      </dl>
      <section aria-label="Amount" className="grid gap-1 rounded-xl border p-4">
        <h3 className="font-semibold">Amount</h3>
        <dl className="grid gap-1 text-sm">
          {(
            [
              ["Pricing method", METHOD_LABELS[b.pricing_method]],
              [
                "Tariff per person",
                <Money key="t" paise={b.tariff_per_person_paise} />,
              ],
              ["Base amount", <Money key="b" paise={b.base_amount_paise} />],
              [
                "Extra charges",
                <span key="e">
                  <Money paise={b.extra_charges_paise} />
                  {b.extra_charges_note ? ` (${b.extra_charges_note})` : ""}
                </span>,
              ],
              ["Discount", <Money key="d" paise={b.discount_paise} />],
              [
                "Final amount changed by hand",
                b.manual_adjustment_paise === 0 ? (
                  "No"
                ) : (
                  <span key="a">
                    {b.manual_adjustment_paise < 0 ? "−" : "+"}
                    {formatPaise(Math.abs(b.manual_adjustment_paise))} –{" "}
                    {b.manual_adjustment_reason}
                  </span>
                ),
              ],
              [
                "Final Booking Amount",
                <strong key="f">
                  <Money paise={b.final_amount_paise ?? 0} />
                </strong>,
              ],
            ] as [string, ReactNode][]
          ).map(([k, val]) => (
            <div
              key={k}
              className="flex justify-between gap-4 border-b py-1 last:border-0"
            >
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-right">{val}</dd>
            </div>
          ))}
        </dl>
      </section>
      {b.remarks ? <Fact label="Remarks">{b.remarks}</Fact> : null}
      <p className="text-sm text-muted-foreground">
        Entered by {d.createdByName ?? "—"} on{" "}
        <DateText value={b.created_at} withTime />
        {b.updated_at !== b.created_at ? (
          <>
            {" "}
            · Last changed by {d.updatedByName ?? "—"} on{" "}
            <DateText value={b.updated_at} withTime />
          </>
        ) : null}
      </p>
    </div>
  );
}

function PlanTab({
  d,
  today,
  showReplaced,
}: {
  d: BookingDetail;
  today: string;
  showReplaced: boolean;
}) {
  const active = d.schedules.filter(
    (s) => s.superseded_at === null && s.superseded_revision_id === null,
  );
  const replaced = d.schedules.filter((s) => !active.includes(s));
  const lines = allocateCoverage(
    active.map((s) => ({
      id: s.id,
      label: s.label,
      dueDate: s.due_date,
      amountPaise: s.amount_paise,
    })),
    Number(d.financials?.net_collection_paise ?? 0),
    today,
  );
  return (
    <div className="grid gap-6">
      <section className="grid gap-2" aria-label="Plan rows">
        <h3 className="font-semibold">Payment plan</h3>
        {lines.length === 0 ? (
          <EmptyState title="No plan rows">
            This booking has no amount to plan.
          </EmptyState>
        ) : (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-right">
                <thead>
                  <tr className="border-b text-sm text-muted-foreground">
                    <th scope="col" className="py-2 text-left font-medium">
                      Row
                    </th>
                    <th scope="col" className="text-left font-medium">
                      Due
                    </th>
                    <th scope="col" className="font-medium">
                      Amount
                    </th>
                    <th scope="col" className="font-medium">
                      Covered
                    </th>
                    <th scope="col" className="font-medium">
                      Outstanding
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr
                      key={l.id}
                      className={cn(
                        "border-b",
                        l.locked && "text-muted-foreground",
                      )}
                    >
                      <th scope="row" className="py-2 text-left font-medium">
                        {l.locked ? (
                          <Lock
                            className="mr-1 inline size-4"
                            aria-label="locked (already due)"
                          />
                        ) : null}
                        {l.label}
                      </th>
                      <td className="text-left">
                        <DateText value={l.dueDate} />
                        {l.overdue ? (
                          <span className="ml-2 rounded bg-rejected-soft px-1.5 py-0.5 text-xs font-medium text-rejected">
                            Overdue
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <Money paise={l.amountPaise} />
                      </td>
                      <td>
                        <Money paise={l.coveredPaise} tone="approved" />
                      </td>
                      <td>
                        <Money
                          paise={l.outstandingPaise}
                          tone={l.outstandingPaise > 0 ? "pending" : "neutral"}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="grid gap-2 sm:hidden">
              {lines.map((l) => (
                <li key={l.id} className="rounded-xl border p-3 text-sm">
                  <p className="font-medium">
                    {l.locked ? (
                      <Lock
                        className="mr-1 inline size-4"
                        aria-label="locked (already due)"
                      />
                    ) : null}
                    {l.label} · <DateText value={l.dueDate} />
                    {l.overdue ? (
                      <span className="ml-2 rounded bg-rejected-soft px-1.5 py-0.5 text-xs font-medium text-rejected">
                        Overdue
                      </span>
                    ) : null}
                  </p>
                  <p>
                    Amount <Money paise={l.amountPaise} /> · Covered{" "}
                    <Money paise={l.coveredPaise} tone="approved" /> ·
                    Outstanding <Money paise={l.outstandingPaise} />
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
        <Link
          href={`?tab=plan${showReplaced ? "" : "&replaced=1"}`}
          className="min-h-11 py-2 text-sm underline underline-offset-4"
        >
          {showReplaced ? "Hide replaced rows" : "Show replaced rows"}
        </Link>
        {showReplaced ? (
          replaced.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No rows have been replaced.
            </p>
          ) : (
            <ul className="grid gap-1 text-sm text-muted-foreground">
              {replaced.map((s) => (
                <li key={s.id}>
                  Replaced: {s.label} {formatPaise(s.amount_paise)} – was due{" "}
                  <DateText value={s.due_date} />
                </li>
              ))}
            </ul>
          )
        ) : null}
      </section>
      <section className="grid gap-2" aria-label="Expected Adjustments">
        <h3 className="font-semibold">Expected Adjustments</h3>
        {d.adjustments.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="grid gap-2">
            {d.adjustments.map((a) => (
              <li key={a.id} className="rounded-lg border p-3 text-sm">
                <DateText value={a.adjustment_date} /> ·{" "}
                <Money paise={a.amount_paise} /> · {a.reason}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="grid gap-2" aria-label="Plan versions">
        <h3 className="font-semibold">Plan versions</h3>
        <ul className="grid gap-2">
          {[...d.revisions].reverse().map((r) => (
            <li key={r.id} className="rounded-lg border p-3 text-sm">
              <strong>v{r.revision_no}</strong> ·{" "}
              <DateText value={r.created_at} withTime /> · Amount Due{" "}
              <Money paise={r.amount_due_after} />
              {r.reason ? ` · ${r.reason}` : ""}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function BookingView({
  d,
  tab,
  today,
  saved,
  showReplaced,
}: {
  d: BookingDetail;
  tab: TabKey;
  today: string;
  saved: boolean;
  showReplaced: boolean;
}) {
  const b = d.booking;
  const status = b.status as BookingStatus;
  const f = d.financials;
  const locked = d.schedules
    .filter(
      (s) =>
        s.superseded_at === null &&
        s.superseded_revision_id === null &&
        s.due_date < today,
    )
    .map((s) => ({
      label: s.label,
      dueDate: s.due_date,
      amountPaise: s.amount_paise,
    }));
  return (
    <main className="flex flex-1 flex-col gap-5 p-3 sm:p-4">
      <div className="grid gap-2">
        <Link href="/bookings" className="text-sm underline underline-offset-4">
          All bookings
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold" data-testid="booking-code">
            {b.booking_code}
          </h1>
          <BookingStatusBadge status={status} />
        </div>
        <p className="text-muted-foreground">
          {d.resort ? d.resort.name : "Resort"} · {b.guest_name} ·{" "}
          <DateText value={b.check_in_at} /> to{" "}
          <DateText value={b.check_out_at} />
        </p>
      </div>
      {saved ? (
        <p
          role="status"
          className="rounded-lg border border-approved/40 bg-approved-soft px-3 py-2 font-medium text-approved"
        >
          Booking {b.booking_code} saved.
        </p>
      ) : null}
      {status === "cancelled" || status === "no_show" ? (
        <p
          role="status"
          className="rounded-lg border border-rejected/40 bg-rejected-soft px-3 py-2"
          data-testid="cancel-banner"
        >
          {status === "cancelled" ? "Cancelled" : "Marked as No-show"}
          {b.cancellation_date ? (
            <>
              {" "}
              on <DateText value={b.cancellation_date} />
            </>
          ) : null}
          {d.cancelledByName ? ` by ${d.cancelledByName}` : ""}. Reason:{" "}
          {b.cancellation_reason ?? "—"}. Cancellation charge{" "}
          {formatPaise(b.cancellation_charge_paise ?? 0)} (Original Booking
          Amount {formatPaise(b.final_amount_paise ?? 0)}).
          {b.charge_change_reason
            ? ` Charge changed: ${b.charge_change_reason}`
            : ""}
        </p>
      ) : null}
      <BookingActions
        booking={{
          id: b.id,
          code: b.booking_code,
          version: b.version,
          status,
          finalPaise: b.final_amount_paise ?? 0,
          chargePaise: b.cancellation_charge_paise,
          approvedPaise: Number(f?.total_collection_paise ?? 0),
          refundsApprovedPaise: Number(f?.refunds_approved_paise ?? 0),
        }}
        locked={locked}
        today={today}
      />
      <MoneyBox d={d} />
      <nav
        aria-label="Booking sections"
        className="flex gap-1 overflow-x-auto border-b"
      >
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/bookings/${b.id}?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={cn(
              "min-h-11 shrink-0 border-b-2 px-3 py-2 text-sm font-medium",
              tab === t.key
                ? "border-primary"
                : "border-transparent text-muted-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === "details" ? <DetailsTab d={d} /> : null}
      {tab === "payments" ? (
        <EmptyState title="Payments and refunds come next">
          Adding, approving and listing payments and refunds will be available
          in the next step. The numbers above already follow the rules.
        </EmptyState>
      ) : null}
      {tab === "plan" ? (
        <PlanTab d={d} today={today} showReplaced={showReplaced} />
      ) : null}
      {tab === "pdfs" ? (
        <EmptyState title="Booking PDFs come later">
          The booking PDF and its versions will appear here.
        </EmptyState>
      ) : null}
      {tab === "history" ? (
        d.timeline.length === 0 ? (
          <EmptyState title="No history yet">
            What happens to this booking will be listed here.
          </EmptyState>
        ) : (
          <ul className="grid gap-2" aria-label="History">
            {d.timeline.map((e) => (
              <li key={e.id} className="rounded-lg border p-3 text-sm">
                {e.text}{" "}
                <span className="text-muted-foreground">
                  · <DateText value={e.at} withTime />
                </span>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </main>
  );
}
