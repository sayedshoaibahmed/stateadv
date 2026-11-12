"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateText } from "@/components/app/date-text";
import { hideFileAction } from "@/lib/payments/actions";
import { proofDownloadUrl } from "@/lib/storage/actions";

export interface ProofItem {
  id: string;
  name: string | null;
  mime: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedByName: string | null;
  isCorrection: boolean;
  correctionReason: string | null;
  hidden: boolean;
  hiddenReason: string | null;
}

/**
 * The files of a payment or refund. A file opens through a link that works for 60 seconds and is made for the signed-in
 * person only (the storage bucket is private). Pictures can be zoomed. A wrong file on a WAITING item can be hidden with
 * a reason (never deleted); on an approved item the originals cannot be hidden, and files added later are marked
 * "Added after approval" with their date, person and reason.
 */
export function ProofViewer({
  proofs,
  itemKind,
  itemId,
  canHide,
}: {
  proofs: ProofItem[];
  itemKind: "payment" | "refund";
  itemId: string;
  canHide: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<{ item: ProofItem; url: string } | null>(
    null,
  );
  const [zoom, setZoom] = useState(false);
  const [hiding, setHiding] = useState<ProofItem | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function view(p: ProofItem) {
    setMessage(null);
    const r = await proofDownloadUrl(p.id);
    if (!r.ok) return setMessage(r.message);
    setZoom(false);
    setOpen({ item: p, url: r.url });
  }
  async function hide() {
    if (!hiding) return;
    setBusy(true);
    const r = await hideFileAction({
      proofId: hiding.id,
      reason,
      itemKind,
      itemId,
    });
    setBusy(false);
    if (!r.ok) return setMessage(r.errors?.reason ?? r.message);
    setHiding(null);
    setReason("");
    router.refresh();
  }

  if (proofs.length === 0)
    return <p className="text-sm text-muted-foreground">No files.</p>;
  return (
    <div className="grid gap-2">
      <ul className="grid gap-2" aria-label="Files">
        {proofs.map((p) => (
          <li key={p.id} className="grid gap-1 rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <FileText className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate font-medium">{p.name ?? "File"}</span>
                <span className="text-muted-foreground">
                  {Math.max(1, Math.round(p.sizeBytes / 1024))} KB
                </span>
                {p.isCorrection ? (
                  <span className="rounded-md bg-self-soft px-1.5 py-0.5 text-xs font-medium text-self">
                    Added after approval
                  </span>
                ) : null}
                {p.hidden ? (
                  <span className="rounded-md bg-adjusted-soft px-1.5 py-0.5 text-xs font-medium text-adjusted">
                    Hidden
                  </span>
                ) : null}
              </span>
              <span className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => view(p)}
                >
                  View
                </Button>
                {canHide && !p.hidden && !p.isCorrection ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11"
                    onClick={() => setHiding(p)}
                  >
                    Hide
                  </Button>
                ) : null}
              </span>
            </div>
            <p className="text-muted-foreground">
              Added by {p.uploadedByName ?? "—"} on{" "}
              <DateText value={p.uploadedAt} withTime />
              {p.isCorrection && p.correctionReason
                ? ` · Reason: ${p.correctionReason}`
                : ""}
              {p.hidden && p.hiddenReason
                ? ` · Hidden because: ${p.hiddenReason}`
                : ""}
            </p>
          </li>
        ))}
      </ul>
      {message ? (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      ) : null}

      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-h-[92vh] overflow-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{open?.item.name ?? "File"}</DialogTitle>
            <DialogDescription>
              This link works for one minute. Close and open the file again if
              it stops working.
            </DialogDescription>
          </DialogHeader>
          {open ? (
            open.item.mime === "application/pdf" ? (
              <iframe
                src={open.url}
                title={open.item.name ?? "PDF"}
                className="h-[70vh] w-full rounded-lg border"
              />
            ) : (
              <div className="grid gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 justify-self-start"
                  onClick={() => setZoom((z) => !z)}
                >
                  {zoom ? (
                    <ZoomOut className="size-4" aria-hidden="true" />
                  ) : (
                    <ZoomIn className="size-4" aria-hidden="true" />
                  )}
                  {zoom ? "Fit to screen" : "Zoom in"}
                </Button>
                <div className="max-h-[70vh] overflow-auto rounded-lg border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={open.url}
                    alt={open.item.name ?? "Payment proof"}
                    className={
                      zoom
                        ? "max-w-none"
                        : "mx-auto max-h-[68vh] w-auto max-w-full"
                    }
                  />
                </div>
              </div>
            )
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={hiding !== null}
        onOpenChange={(o) => !o && setHiding(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hide this file?</DialogTitle>
            <DialogDescription>
              Use this only if the wrong file was added. The file is not
              deleted: it stays in the history with your reason.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1">
            <Label htmlFor="hide-reason">Reason</Label>
            <Input
              id="hide-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="min-h-11"
            />
          </div>
          <Button className="min-h-12" disabled={busy} onClick={hide}>
            {busy ? "Saving…" : "Hide the file"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
