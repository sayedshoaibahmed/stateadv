import Link from "next/link";
import { Download } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { BookingStatusBadge } from "@/components/app/booking-status";
import { DateText } from "@/components/app/date-text";
import { Money, type MoneyTone } from "@/components/app/money";
import { EmptyState, ErrorState } from "@/components/app/states";
import { StatusBadge } from "@/components/app/status-badge";
import type { BookingStatus } from "@/lib/bookings/list";
import { periodText } from "@/lib/dashboard/filters";
import {
  APPROVAL_LABELS,
  APPROVAL_STATUSES,
  BOOKING_STATUSES,
  BOOKING_STATUS_LABELS,
  CANCEL_STATUSES,
  DATE_FIELDS,
  DATE_FIELD_LABELS,
  DATE_TYPES,
  DATE_TYPE_LABELS,
  GROUPS,
  GROUP_LABELS,
  KINDS,
  KIND_LABELS,
  METHODS,
  METHOD_LABELS,
  PAGE_SIZE,
  PDF_MAX_ROWS,
  SOURCES,
  SOURCE_LABELS,
  SPLITS,
  SPLIT_LABELS,
  exportHref,
  filterText,
  presetPeriods,
  reportHref,
  type Column,
  type ReportDef,
  type ReportFilter,
} from "@/lib/reports/definitions";
import { cellText, type Cell, type ReportRow } from "@/lib/reports/format";
import type { ReportPage } from "@/lib/reports/rows";
import { cn } from "@/lib/utils";

const input =
  "min-h-11 w-full rounded-lg border bg-background px-2 text-base sm:text-sm";
const TONE: Record<string, MoneyTone> = {
  approved: "approved",
  waiting: "waiting",
  pending: "pending",
  refund: "refund",
  neutral: "neutral",
};

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

function Select({
  id,
  value,
  all,
  options,
}: {
  id: string;
  value: string | null;
  all?: string;
  options: readonly (readonly [string, string])[];
}) {
  return (
    <select
      id={id}
      name={id}
      defaultValue={value ?? (all ? "all" : "")}
      className={input}
    >
      {all ? <option value="all">{all}</option> : null}
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

export function ReportFilterForm({
  def,
  f,
  resorts,
  today,
}: {
  def: ReportDef;
  f: ReportFilter;
  resorts: { id: string; name: string }[];
  today: string;
}) {
  const has = (name: ReportDef["uses"][number]) => def.uses.includes(name);
  const statusOptions: readonly (readonly [string, string])[] =
    def.key === "refunds"
      ? APPROVAL_STATUSES.map((s) => [s, APPROVAL_LABELS[s]] as const)
      : def.key === "cancellations"
        ? CANCEL_STATUSES.map((s) => [s, BOOKING_STATUS_LABELS[s]] as const)
        : BOOKING_STATUSES.map((s) => [s, BOOKING_STATUS_LABELS[s]] as const);
  return (
    <form
      action={`/reports/${def.key}`}
      method="get"
      className="grid gap-3 rounded-lg border p-3"
      aria-label={`Choose what the ${def.title} report shows`}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {has("resort") ? (
          <Field id="resort" label="Resort">
            <Select
              id="resort"
              value={f.resort}
              all="All resorts"
              options={resorts.map((r) => [r.id, r.name] as const)}
            />
          </Field>
        ) : null}
        {has("range") ? (
          <>
            <Field id="from" label="From">
              <input
                id="from"
                name="from"
                type="date"
                defaultValue={f.from ?? ""}
                className={input}
              />
            </Field>
            <Field id="to" label="To">
              <input
                id="to"
                name="to"
                type="date"
                defaultValue={f.to ?? ""}
                className={input}
              />
            </Field>
          </>
        ) : null}
        {has("asOf") ? (
          <Field id="asOf" label="Overdue as of">
            <input
              id="asOf"
              name="asOf"
              type="date"
              defaultValue={f.asOf ?? today}
              className={input}
            />
          </Field>
        ) : null}
        {has("group") ? (
          <Field id="group" label="Show by">
            <Select
              id="group"
              value={f.group}
              options={GROUPS.map((g) => [g, GROUP_LABELS[g]] as const)}
            />
          </Field>
        ) : null}
        {has("split") ? (
          <Field id="split" label="Split">
            <Select
              id="split"
              value={f.split}
              options={SPLITS.map((g) => [g, SPLIT_LABELS[g]] as const)}
            />
          </Field>
        ) : null}
        {has("dateField") ? (
          <Field id="dateField" label="Dates are">
            <Select
              id="dateField"
              value={f.dateField}
              options={DATE_FIELDS.map(
                (g) => [g, DATE_FIELD_LABELS[g]] as const,
              )}
            />
          </Field>
        ) : null}
        {has("dateType") ? (
          <Field id="dateType" label="Dates are">
            <Select
              id="dateType"
              value={f.dateType}
              options={DATE_TYPES.map((g) => [g, DATE_TYPE_LABELS[g]] as const)}
            />
          </Field>
        ) : null}
        {has("kind") ? (
          <Field id="kind" label="Show">
            <Select
              id="kind"
              value={f.kind}
              all="Payments and refunds"
              options={KINDS.map((g) => [g, KIND_LABELS[g]] as const)}
            />
          </Field>
        ) : null}
        {has("status") ? (
          <Field id="status" label="Status">
            <Select
              id="status"
              value={f.status}
              all="All statuses"
              options={statusOptions}
            />
          </Field>
        ) : null}
        {has("method") ? (
          <Field id="method" label="Paid by">
            <Select
              id="method"
              value={f.method}
              all="All methods"
              options={METHODS.map((g) => [g, METHOD_LABELS[g]] as const)}
            />
          </Field>
        ) : null}
        {has("source") ? (
          <Field id="source" label="Why">
            <Select
              id="source"
              value={f.source}
              all="Any reason"
              options={SOURCES.map((g) => [g, SOURCE_LABELS[g]] as const)}
            />
          </Field>
        ) : null}
      </div>
      {has("range") ? (
        <div
          className="flex flex-wrap items-center gap-2"
          aria-label="Ready-made periods"
        >
          <span className="text-sm text-muted-foreground">Quick choice:</span>
          {presetPeriods(today).map((p) => (
            <Link
              key={p.key}
              href={reportHref(def, f, { from: p.from, to: p.to, page: 1 })}
              className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}
            >
              {p.label}
            </Link>
          ))}
        </div>
      ) : null}
      <div className="flex gap-2">
        <button
          type="submit"
          className="min-h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Show report
        </button>
        <Link
          href={`/reports/${def.key}`}
          className={cn(buttonVariants({ variant: "outline" }), "min-h-11")}
        >
          Clear
        </Link>
      </div>
    </form>
  );
}

function CellView({ col, row }: { col: Column; row: ReportRow }) {
  const value: Cell = row[col.key] ?? null;
  const booking = typeof row._booking === "string" ? row._booking : null;
  const href =
    col.key === "booking" && booking
      ? `/bookings/${booking}`
      : col.key === "code"
        ? typeof row._href === "string"
          ? row._href
          : booking
            ? `/bookings/${booking}`
            : null
        : null;
  switch (col.kind) {
    case "money":
      return typeof value === "number" ? (
        <Money paise={value} tone={TONE[col.tone ?? "neutral"]} />
      ) : (
        <span>—</span>
      );
    case "date":
      return <DateText value={typeof value === "string" ? value : null} />;
    case "datetime":
      return (
        <DateText value={typeof value === "string" ? value : null} withTime />
      );
    case "approval":
      return typeof value === "string" ? (
        <StatusBadge
          status={value as "approved" | "waiting" | "rejected" | "reversed"}
        />
      ) : (
        <span>—</span>
      );
    case "booking-status":
      return typeof value === "string" ? (
        <BookingStatusBadge status={value as BookingStatus} />
      ) : (
        <span>—</span>
      );
    default: {
      const text = cellText(col.kind, value);
      return href && text !== "—" ? (
        <Link href={href} className="underline underline-offset-4">
          {text}
        </Link>
      ) : (
        <span>{text}</span>
      );
    }
  }
}

const right = (c: Column) => c.kind === "money" || c.kind === "int";

export function ReportTable({
  def,
  f,
  page,
}: {
  def: ReportDef;
  f: ReportFilter;
  page: ReportPage;
}) {
  const columns = def.columns(f);
  const totals = def.totals(f);
  // on a page of a long list the foot holds the totals of ALL rows
  const partial = def.paged && page.total > page.rows.length;
  const totalCell = (c: Column, i: number) => {
    const key = totals[c.key];
    if (key !== undefined && page.summary[key] !== undefined)
      return <CellView col={c} row={{ [c.key]: page.summary[key] }} />;
    return i === 0 && !(columns[0].key in totals) ? (
      <span>{partial ? "Total, all rows" : "Total"}</span>
    ) : null;
  };
  return (
    <>
      <div
        className="hidden overflow-x-auto md:block"
        data-testid="report-table"
      >
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{def.title} report</caption>
          <thead>
            <tr className="border-b text-muted-foreground">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={cn(
                    "py-2 pr-3 font-medium",
                    right(c) && "text-right",
                  )}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.rows.map((r, i) => (
              <tr key={i} className="border-b align-top">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn("py-2 pr-3", right(c) && "text-right")}
                  >
                    <CellView col={c} row={r} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 font-semibold">
              {columns.map((c, i) => (
                <td
                  key={c.key}
                  className={cn("py-2 pr-3", right(c) && "text-right")}
                >
                  {totalCell(c, i)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <ul className="grid gap-3 md:hidden" data-testid="report-cards">
        {page.rows.map((r, i) => (
          <li key={i} className="rounded-xl border p-3">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              {columns.map((c) => (
                <div key={c.key} className="contents">
                  <dt className="text-muted-foreground">{c.label}</dt>
                  <dd className="text-right">
                    <CellView col={c} row={r} />
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

function Pager({
  def,
  f,
  total,
}: {
  def: ReportDef;
  f: ReportFilter;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (!def.paged || pages <= 1) return null;
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-3">
      {f.page > 1 ? (
        <Link
          href={reportHref(def, f, { page: f.page - 1 })}
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
          href={reportHref(def, f, { page: f.page + 1 })}
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

export function ReportView({
  def,
  f,
  page,
  resorts,
  today,
}: {
  def: ReportDef;
  f: ReportFilter;
  page: ReportPage | null;
  resorts: { id: string; name: string }[];
  today: string;
}) {
  const resortName = f.resort
    ? (resorts.find((r) => r.id === f.resort)?.name ?? null)
    : null;
  const tooBigForPdf = !!page && page.total > PDF_MAX_ROWS;
  const dl = cn(buttonVariants({ variant: "outline" }), "min-h-11 gap-2");
  const range = f.from && f.to ? periodText(f.from, f.to) : null;
  return (
    <main className="flex flex-1 flex-col gap-4 p-3 sm:p-4">
      <div>
        <Link href="/reports" className="text-sm underline underline-offset-4">
          All reports
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{def.title}</h1>
        <div
          className="mt-1 grid gap-0.5 text-sm text-muted-foreground"
          data-testid="report-header"
        >
          <p>
            <strong className="font-medium text-foreground">Date used:</strong>{" "}
            {def.dateRule(f)}
          </p>
          <p>
            <strong className="font-medium text-foreground">Rule:</strong>{" "}
            {def.approvalRule(f)}
          </p>
          <p>
            <strong className="font-medium text-foreground">Showing:</strong>{" "}
            {filterText(def, f, resortName)} · Time zone: India (IST)
          </p>
        </div>
      </div>
      {f.problem ? (
        <p
          role="status"
          className="rounded-lg border border-waiting/40 bg-waiting-soft p-3 text-sm"
        >
          {f.problem}
        </p>
      ) : null}
      <ReportFilterForm def={def} f={f} resorts={resorts} today={today} />
      {page === null ? (
        <ErrorState
          title="The report could not be loaded"
          retryHref={reportHref(def, f)}
        />
      ) : (
        <>
          <section
            aria-label="Totals"
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            {def.summary(f).map((s) => (
              <div key={s.key} className="rounded-xl border bg-card p-3">
                <p className="text-sm text-muted-foreground">{s.label}</p>
                <p className="text-xl font-semibold">
                  {s.kind === "money" ? (
                    <Money
                      paise={page.summary[s.key] ?? 0}
                      tone={TONE[s.tone ?? "neutral"]}
                    />
                  ) : (
                    <span className="tabular-nums">
                      {page.summary[s.key] ?? 0}
                    </span>
                  )}
                </p>
              </div>
            ))}
          </section>
          <div
            className="flex flex-wrap items-center gap-2"
            aria-label="Download this report"
          >
            <a href={exportHref(def, f, "csv")} download className={dl}>
              <Download className="size-4" aria-hidden="true" />
              Download CSV
            </a>
            {tooBigForPdf ? (
              <span className="text-sm text-muted-foreground">
                This report has {page.total} rows, more than a PDF holds (
                {PDF_MAX_ROWS}). Download the CSV, or choose fewer dates.
              </span>
            ) : (
              <a href={exportHref(def, f, "pdf")} download className={dl}>
                <Download className="size-4" aria-hidden="true" />
                Download PDF
              </a>
            )}
          </div>
          {page.rows.length === 0 ? (
            <EmptyState title="Nothing to show">
              {range ? `There is nothing for ${range}` : "There is nothing"}{" "}
              with these choices. Try other dates or fewer filters.
            </EmptyState>
          ) : (
            <>
              <p className="text-sm text-muted-foreground" role="status">
                {page.total} {page.total === 1 ? "row" : "rows"}
                {def.paged && page.total > PAGE_SIZE
                  ? ` · showing ${(f.page - 1) * PAGE_SIZE + 1} to ${Math.min(f.page * PAGE_SIZE, page.total)}. The totals above and in the files cover all rows`
                  : ""}
                .
              </p>
              <ReportTable def={def} f={f} page={page} />
              {def.key === "collection" ? (
                <p className="text-sm text-muted-foreground">
                  Days, weeks, months or years with no payment and no refund are
                  not listed.
                </p>
              ) : null}
              <Pager def={def} f={f} total={page.total} />
            </>
          )}
        </>
      )}
    </main>
  );
}
