"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ProofUploader,
  type UploadedFile,
} from "@/components/app/payments/proof-uploader";
import { addMoneyAction, updateWaitingAction } from "@/lib/payments/actions";
import {
  METHODS,
  METHOD_LABELS,
  REFUND_QUICK_REASONS,
  needsProvider,
  proofLabel,
  referenceLabel,
  validateMoney,
  type FormErrors,
  type Method,
  type MoneyFormValues,
  type ProviderChoice,
  type RefundFigures,
  refundHelp,
} from "@/lib/payments/form";
import { paiseText } from "@/lib/bookings/form";
import { formatPaise } from "@/lib/money";
import { cn } from "@/lib/utils";

const field = "min-h-11";
const toggle = (on: boolean) =>
  cn(
    "min-h-12 rounded-xl border-2 px-4 py-2 text-base font-medium transition-colors",
    on
      ? "border-primary bg-primary text-primary-foreground"
      : "border-input bg-background hover:bg-muted",
  );
const Err = ({ text }: { text?: string }) =>
  text ? (
    <p role="alert" className="text-sm text-destructive">
      {text}
    </p>
  ) : null;

export interface MoneyBookingInfo {
  id: string;
  code: string;
  guestName: string;
  resortName: string | null;
  statusText: string;
  /** straight from the database view; used only to word the helper buttons */
  pendingPaise: number;
  refund: RefundFigures;
}

/**
 * Add Payment / Add Refund / change a waiting one (UI spec 3.7, 3.8). The screen sends inputs only; the database
 * decides the limits and the rules and has the final say. Add stays disabled until the uploads finish and is protected
 * against double taps (one save key per form; pressing twice returns the same record).
 */
export function MoneyForm({
  kind,
  mode,
  booking,
  providers,
  initial,
  today,
  edit,
}: {
  kind: "payment" | "refund";
  mode: "create" | "edit";
  booking: MoneyBookingInfo;
  providers: ProviderChoice[];
  initial: MoneyFormValues;
  today: string;
  edit?: { id: string; version: number };
}) {
  const router = useRouter();
  const [v, setV] = useState<MoneyFormValues>(initial);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [editReason, setEditReason] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [idemKey] = useState(() => crypto.randomUUID());
  const set = (patch: Partial<MoneyFormValues>) =>
    setV((x) => ({ ...x, ...patch }));
  const word = kind === "payment" ? "payment" : "refund";
  const providerOptions = useMemo(
    () =>
      providers.filter(
        (p) =>
          p.method === v.method && (p.active || String(p.id) === v.providerId),
      ),
    [providers, v.method, v.providerId],
  );
  const chosenProvider = providers.find((p) => String(p.id) === v.providerId);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const errs = validateMoney(v, {
      kind,
      today,
      files: mode === "edit" ? 5 : files.length,
      providers,
    });
    if (mode === "edit" && editReason.trim().length < 5)
      errs.editReason =
        "Please write why you are changing it (at least 5 letters).";
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      setMessage("Please check the highlighted fields.");
      return;
    }
    startTransition(async () => {
      const res =
        mode === "create"
          ? await addMoneyAction({
              kind,
              values: v,
              files: files.map(({ key, ...f }) => (void key, f)),
              idempotencyKey: idemKey,
            })
          : await updateWaitingAction({
              kind,
              id: edit!.id,
              expectedVersion: edit!.version,
              values: v,
              reason: editReason,
            });
      if (!res.ok) {
        setMessage(res.message);
        if (res.errors) setErrors(res.errors);
        return;
      }
      if (mode === "create") {
        const r = res as { id: string; warnings: string[] };
        const q = new URLSearchParams({ saved: "1" });
        if (r.warnings.length > 0) q.set("warn", r.warnings.join(","));
        router.push(`/${kind}s/${r.id}?${q.toString()}`);
      } else {
        router.push(`/${kind}s/${edit!.id}?saved=1`);
      }
    });
  }

  return (
    <form
      onSubmit={submit}
      className="grid max-w-2xl gap-6"
      noValidate
      aria-label={mode === "create" ? `Add ${word}` : `Change ${word}`}
    >
      <section
        className="grid gap-1 rounded-xl border bg-card p-4"
        aria-label="Booking"
      >
        <p className="font-semibold">{booking.code}</p>
        <p className="text-sm text-muted-foreground">
          {booking.guestName}
          {booking.resortName ? ` · ${booking.resortName}` : ""} ·{" "}
          {booking.statusText}
        </p>
        {kind === "payment" ? (
          <p className="text-sm">
            Pending Amount {formatPaise(booking.pendingPaise)}
          </p>
        ) : (
          <ul className="grid gap-0.5 text-sm" aria-label="Refund figures">
            {refundHelp(booking.refund).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        )}
      </section>

      {message ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-rejected-soft px-3 py-2 text-sm font-medium"
        >
          {message}
        </p>
      ) : null}

      <div className="grid gap-1 sm:max-w-72">
        <Label htmlFor="amount">Amount (₹)</Label>
        <Input
          id="amount"
          inputMode="decimal"
          value={v.amount}
          onChange={(e) => set({ amount: e.target.value })}
          aria-invalid={errors.amount ? true : undefined}
          className={field}
        />
        {mode === "create" && kind === "payment" && booking.pendingPaise > 0 ? (
          <Button
            type="button"
            variant="outline"
            className={cn(field, "justify-self-start")}
            onClick={() => set({ amount: paiseText(booking.pendingPaise) })}
          >
            Fill pending {formatPaise(booking.pendingPaise)}
          </Button>
        ) : null}
        {mode === "create" &&
        kind === "refund" &&
        booking.refund.mostPaise > 0 ? (
          <Button
            type="button"
            variant="outline"
            className={cn(field, "justify-self-start")}
            onClick={() => set({ amount: paiseText(booking.refund.mostPaise) })}
          >
            Fill the most you can refund {formatPaise(booking.refund.mostPaise)}
          </Button>
        ) : null}
        <Err text={errors.amount} />
      </div>

      <div className="grid gap-2">
        <p className="font-medium">
          {kind === "payment" ? "Payment Method" : "Refund Method"}
        </p>
        <div
          className="grid grid-cols-2 gap-3 sm:grid-cols-5"
          role="group"
          aria-label="Method"
        >
          {METHODS.map((m: Method) => (
            <button
              key={m}
              type="button"
              aria-pressed={v.method === m}
              className={toggle(v.method === m)}
              onClick={() =>
                set({ method: m, providerId: "", providerOther: "" })
              }
            >
              {METHOD_LABELS[m]}
            </button>
          ))}
        </div>
        <Err text={errors.method} />
      </div>

      {needsProvider(v.method) ? (
        <div className="grid gap-1 sm:max-w-72">
          <Label htmlFor="providerId">
            {v.method === "upi" ? "Payment app" : "Card type"}
          </Label>
          <select
            id="providerId"
            value={v.providerId}
            onChange={(e) =>
              set({ providerId: e.target.value, providerOther: "" })
            }
            aria-invalid={errors.providerId ? true : undefined}
            className="min-h-11 rounded-lg border bg-background px-2 text-base sm:text-sm"
          >
            <option value="">Choose…</option>
            {providerOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <Err text={errors.providerId} />
          {chosenProvider?.name === "Other" ? (
            <>
              <Label htmlFor="providerOther">Name of the app</Label>
              <Input
                id="providerOther"
                value={v.providerOther}
                maxLength={60}
                onChange={(e) => set({ providerOther: e.target.value })}
                className={field}
              />
              <Err text={errors.providerOther} />
            </>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="date">
            {kind === "payment" ? "Payment date" : "Refund date"}
          </Label>
          <Input
            id="date"
            type="date"
            value={v.date}
            max={today}
            onChange={(e) => set({ date: e.target.value })}
            aria-invalid={errors.date ? true : undefined}
            className={field}
          />
          <Err text={errors.date} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="time">Time (optional)</Label>
          <Input
            id="time"
            type="time"
            value={v.time}
            onChange={(e) => set({ time: e.target.value })}
            aria-invalid={errors.time ? true : undefined}
            className={field}
          />
          <Err text={errors.time} />
        </div>
      </div>

      <div className="grid gap-1">
        <Label htmlFor="reference">{referenceLabel(v.method, kind)}</Label>
        <Input
          id="reference"
          value={v.reference}
          maxLength={100}
          onChange={(e) => set({ reference: e.target.value })}
          className={field}
        />
        <Err text={errors.reference} />
      </div>

      {kind === "refund" ? (
        <div className="grid gap-2">
          <Label htmlFor="reason">Reason for the refund</Label>
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Quick reasons"
          >
            {REFUND_QUICK_REASONS.map((r) => (
              <Button
                key={r}
                type="button"
                variant="outline"
                className={field}
                onClick={() => set({ reason: r })}
              >
                {r}
              </Button>
            ))}
          </div>
          <Input
            id="reason"
            value={v.reason}
            maxLength={500}
            onChange={(e) => set({ reason: e.target.value })}
            aria-invalid={errors.reason ? true : undefined}
            className={field}
          />
          <Err text={errors.reason} />
        </div>
      ) : null}

      {mode === "create" ? (
        <ProofUploader
          kind={kind}
          bookingId={booking.id}
          label={proofLabel(v.method, kind)}
          files={files}
          onChange={(f, busy) => (setFiles(f), setUploading(busy))}
          error={errors.files}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Files are added or hidden on the {word} page.
        </p>
      )}

      <div className="grid gap-1">
        <Label htmlFor="remarks">Remarks (optional)</Label>
        <Textarea
          id="remarks"
          value={v.remarks}
          maxLength={500}
          onChange={(e) => set({ remarks: e.target.value })}
        />
      </div>

      {mode === "edit" ? (
        <div className="grid gap-1">
          <Label htmlFor="editReason">Why are you changing it?</Label>
          <Input
            id="editReason"
            value={editReason}
            maxLength={500}
            onChange={(e) => setEditReason(e.target.value)}
            aria-invalid={errors.editReason ? true : undefined}
            className={field}
          />
          <Err text={errors.editReason} />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button
          type="submit"
          className="min-h-12 px-6 text-base"
          disabled={pending || uploading}
        >
          {pending
            ? "Saving…"
            : uploading
              ? "Uploading…"
              : mode === "create"
                ? kind === "payment"
                  ? "Add Payment"
                  : "Add Refund"
                : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-12 px-6 text-base"
          disabled={pending}
          onClick={() =>
            router.push(
              mode === "edit"
                ? `/${kind}s/${edit!.id}`
                : `/bookings/${booking.id}?tab=payments`,
            )
          }
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
