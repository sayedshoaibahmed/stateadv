"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ProofUploader,
  type UploadedFile,
} from "@/components/app/payments/proof-uploader";
import {
  addCorrectionAction,
  addFilesAction,
  decideAction,
} from "@/lib/payments/actions";
import { REJECT_QUICK_REASONS } from "@/lib/payments/form";
import {
  MIN_CORRECTION_REASON,
  MIN_REASON,
  REVERSAL_BLOCKED_TEXT,
  abilities,
  reasonProblem,
  type Kind,
  type Status,
} from "@/lib/payments/rules";
import { formatPaise } from "@/lib/money";
import { cn } from "@/lib/utils";

type Which = null | "approve" | "reject" | "reverse";
const field = "min-h-11";

/**
 * The buttons on a payment or refund page and in the approvals review panel. What is shown follows the status
 * (rules.ts); the database enforces it anyway. Sensitive actions ask first. After an action in the approvals queue the
 * next waiting item opens (`nextHref`).
 */
export function ItemActions({
  kind,
  id,
  version,
  status,
  recordedBy,
  me,
  amountP,
  code,
  nextHref,
  reverseBlockedLinks = [],
}: {
  kind: Kind;
  id: string;
  version: number;
  status: Status;
  recordedBy: string | null;
  me: string;
  amountP: number;
  code: string;
  nextHref?: string | null;
  /** refunds of the same booking, shown when a reversal is refused because refunds depend on the payment */
  reverseBlockedLinks?: { id: string; code: string }[];
}) {
  const router = useRouter();
  const a = abilities({ status, recordedBy, me });
  const [which, setWhich] = useState<Which>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [pending, startTransition] = useTransition();
  const word = kind === "payment" ? "payment" : "refund";

  function close() {
    setWhich(null);
    setReason("");
    setError(null);
    setBlocked(false);
  }
  function run(decision: "approve" | "reject" | "reverse") {
    setError(null);
    setBlocked(false);
    if (decision !== "approve") {
      const p = reasonProblem(reason, MIN_REASON);
      if (p) return setError(p);
    }
    startTransition(async () => {
      const r = await decideAction({
        kind,
        id,
        expectedVersion: version,
        decision,
        reason,
      });
      if (!r.ok) {
        setError(r.errors?.reason ?? r.message);
        if (
          decision === "reverse" &&
          kind === "payment" &&
          /refunds depend/i.test(r.message)
        )
          setBlocked(true);
        return;
      }
      close();
      if (nextHref !== undefined) router.push(nextHref ?? "/approvals");
      else router.refresh();
    });
  }

  if (!a.approve && !a.reject && !a.reverse) return null;
  return (
    <div className="grid gap-2">
      {a.selfNote ? (
        <p
          role="note"
          className="rounded-lg border border-self/40 bg-self-soft px-3 py-2 text-sm font-medium text-self"
        >
          {a.selfNote}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {a.approve ? (
          <Button
            className={cn(field, "bg-approved text-white hover:bg-approved/90")}
            onClick={() => setWhich("approve")}
          >
            Approve
          </Button>
        ) : null}
        {a.reject ? (
          <Button
            variant="outline"
            className={cn(field, "border-rejected text-rejected")}
            onClick={() => setWhich("reject")}
          >
            Reject
          </Button>
        ) : null}
        {a.reverse ? (
          <Button
            variant="outline"
            className={cn(field, "border-rejected text-rejected")}
            onClick={() => setWhich("reverse")}
          >
            Reverse
          </Button>
        ) : null}
        {a.edit ? (
          <Link
            href={`/${kind}s/${id}/edit`}
            className={cn(buttonVariants({ variant: "outline" }), field)}
          >
            Change
          </Link>
        ) : null}
      </div>

      <Dialog open={which !== null} onOpenChange={(o) => !o && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {which === "approve"
                ? `Approve this ${word}?`
                : which === "reject"
                  ? `Reject this ${word}?`
                  : `Reverse this ${word}?`}
            </DialogTitle>
            <DialogDescription>
              {code} · {formatPaise(amountP)}.{" "}
              {which === "approve"
                ? kind === "payment"
                  ? "Once approved, the amount counts as collected money. You can still reverse it later with a reason."
                  : "Once approved, the refund reduces the money kept. You can still reverse it later with a reason."
                : which === "reject"
                  ? `A rejected ${word} never counts. It stays in the history with your reason.`
                  : `A reversed ${word} stops counting. It stays in the history with your reason. This cannot be undone.`}
            </DialogDescription>
          </DialogHeader>
          {which === "approve" && a.selfNote ? (
            <p className="text-sm font-medium text-self">{a.selfNote}</p>
          ) : null}
          {which === "reject" || which === "reverse" ? (
            <div className="grid gap-2">
              {which === "reject" ? (
                <div
                  className="flex flex-wrap gap-2"
                  role="group"
                  aria-label="Quick reasons"
                >
                  {REJECT_QUICK_REASONS.map((r) => (
                    <Button
                      key={r}
                      type="button"
                      variant="outline"
                      className={field}
                      onClick={() => setReason(r)}
                    >
                      {r}
                    </Button>
                  ))}
                </div>
              ) : null}
              <Label htmlFor="decision-reason">Reason</Label>
              <Input
                id="decision-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className={field}
              />
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {blocked ? REVERSAL_BLOCKED_TEXT : error}
            </p>
          ) : null}
          {blocked && reverseBlockedLinks.length > 0 ? (
            <ul className="grid gap-1 text-sm">
              {reverseBlockedLinks.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/refunds/${r.id}`}
                    className="underline underline-offset-4"
                  >
                    Refund {r.code}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          <Button
            className={cn(
              "min-h-12",
              which === "approve"
                ? "bg-approved text-white hover:bg-approved/90"
                : "bg-rejected text-white hover:bg-rejected/90",
            )}
            disabled={pending}
            onClick={() => which && run(which)}
          >
            {pending
              ? "Saving…"
              : which === "approve"
                ? "Yes, approve"
                : which === "reject"
                  ? "Yes, reject"
                  : "Yes, reverse"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** More files while waiting (at most 5 visible files in all), or a correction file once approved (Q9a). */
export function FileAdder({
  kind,
  id,
  bookingId,
  status,
  visibleCount,
}: {
  kind: Kind;
  id: string;
  bookingId: string;
  status: Status;
  visibleCount: number;
}) {
  const router = useRouter();
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();
  const correction = status === "approved";
  if (status !== "waiting" && !correction) return null;
  const room = 5 - visibleCount;
  if (!correction && room <= 0)
    return (
      <p className="text-sm text-muted-foreground">
        This {kind} already has 5 files.
      </p>
    );

  function save() {
    setMessage(null);
    if (files.length === 0)
      return setMessage({ ok: false, text: "Please add a file first." });
    if (correction) {
      const p = reasonProblem(reason, MIN_CORRECTION_REASON);
      if (p) return setMessage({ ok: false, text: p });
    }
    const payload = files.map(({ key, ...f }) => (void key, f));
    startTransition(async () => {
      const r = correction
        ? await addCorrectionAction({
            kind,
            parentId: id,
            reason,
            files: payload,
          })
        : await addFilesAction({ kind, parentId: id, files: payload });
      if (!r.ok)
        return setMessage({ ok: false, text: r.errors?.reason ?? r.message });
      setFiles([]);
      setReason("");
      setMessage({ ok: true, text: r.message ?? "Saved." });
      router.refresh();
    });
  }

  return (
    <section
      className="grid gap-3 rounded-xl border p-3"
      aria-label={correction ? "Add correction file" : "Add more files"}
    >
      <h3 className="font-semibold">
        {correction ? "Add correction file" : "Add more files"}
      </h3>
      {correction ? (
        <p className="text-sm text-muted-foreground">
          The original files and the amounts will not change. Your reason is
          kept in the history.
        </p>
      ) : null}
      <ProofUploader
        kind={kind}
        bookingId={bookingId}
        label="File"
        files={files}
        onChange={(f, busy) => (setFiles(f), setUploading(busy))}
        max={correction ? 5 : Math.min(5, room)}
      />
      {correction ? (
        <div className="grid gap-1">
          <Label htmlFor="correction-reason">
            Reason (at least 10 letters)
          </Label>
          <Input
            id="correction-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className={field}
          />
        </div>
      ) : null}
      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={cn(
            "text-sm font-medium",
            message.ok ? "text-approved" : "text-destructive",
          )}
        >
          {message.text}
        </p>
      ) : null}
      <Button
        className="min-h-11 justify-self-start"
        disabled={pending || uploading || files.length === 0}
        onClick={save}
      >
        {pending
          ? "Saving…"
          : correction
            ? "Add correction file"
            : "Add the files"}
      </Button>
    </section>
  );
}
