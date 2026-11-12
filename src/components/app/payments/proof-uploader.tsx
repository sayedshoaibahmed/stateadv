"use client";

import { useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  confirmProofUploads,
  prepareProofUploads,
  type ConfirmedFile,
} from "@/lib/storage/actions";
import { MAX_FILES_PER_ITEM, checkClaim } from "@/lib/storage/claims";
import { compressImage } from "@/lib/storage/compress";
import { createClient } from "@/lib/supabase/client";

export interface UploadedFile extends ConfirmedFile {
  key: string;
}

/**
 * Choose screenshots or receipts. Each file is (1) shrunk if it is a big photo, (2) sent straight to PRIVATE storage with
 * a one-time link the server prepared, and (3) checked again by the server from its real bytes (type, size, SHA-256).
 * The names are chosen by the server, never by this screen. A file removed here stays in private storage unattached and
 * invisible; nothing is ever deleted by a user (by design). `onChange` reports the confirmed files and whether an upload
 * is still running, so the Save button can wait.
 */
export function ProofUploader({
  kind,
  bookingId,
  label,
  files,
  onChange,
  error,
  max = MAX_FILES_PER_ITEM,
}: {
  kind: "payment" | "refund";
  bookingId: string;
  label: string;
  files: UploadedFile[];
  onChange: (files: UploadedFile[], busy: boolean) => void;
  error?: string;
  max?: number;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function pick(list: FileList | null) {
    if (!list || list.length === 0) return;
    setMessage(null);
    const chosen = Array.from(list);
    if (files.length + chosen.length > max) {
      setMessage(`You can add at most ${max} files.`);
      if (input.current) input.current.value = "";
      return;
    }
    setBusy(true);
    onChange(files, true);
    try {
      const prepared: File[] = [];
      for (const f of chosen) {
        const small = await compressImage(f);
        const c = checkClaim({
          name: small.name,
          size: small.size,
          type: small.type,
        });
        if (!c.ok) {
          setMessage(`${f.name}: ${c.message}`);
          onChange(files, false);
          return;
        }
        prepared.push(small);
      }
      const prep = await prepareProofUploads(
        kind,
        bookingId,
        prepared.map((f) => ({ name: f.name, size: f.size, type: f.type })),
      );
      if (!prep.ok) {
        setMessage(prep.message);
        onChange(files, false);
        return;
      }
      const supabase = createClient();
      for (let i = 0; i < prep.tickets.length; i++) {
        const t = prep.tickets[i];
        const { error: upErr } = await supabase.storage
          .from("payment-proofs")
          .uploadToSignedUrl(t.path, t.token, prepared[i], {
            contentType: t.mime,
          });
        if (upErr) {
          setMessage("A file did not upload. Please try again.");
          onChange(files, false);
          return;
        }
      }
      const done = await confirmProofUploads(
        kind,
        bookingId,
        prep.tickets.map((t) => ({ path: t.path, name: t.name, mime: t.mime })),
      );
      if (!done.ok) {
        setMessage(done.message);
        onChange(files, false);
        return;
      }
      onChange(
        [...files, ...done.files.map((f) => ({ ...f, key: f.storage_path }))],
        false,
      );
    } catch {
      setMessage("Something went wrong. Please try again.");
      onChange(files, false);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={`proof-${kind}`}>{label}</Label>
      <input
        ref={input}
        id={`proof-${kind}`}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,application/pdf"
        disabled={busy || files.length >= max}
        onChange={(e) => pick(e.target.files)}
        className="min-h-11 w-full rounded-lg border bg-background px-2 py-2 text-base sm:text-sm"
        aria-describedby={`proof-${kind}-help`}
      />
      <p id={`proof-${kind}-help`} className="text-sm text-muted-foreground">
        JPG, PNG, WEBP or PDF, up to 10 MB each, at most {max} files.
      </p>
      {busy ? (
        <p role="status" className="text-sm font-medium">
          Uploading… please wait.
        </p>
      ) : null}
      {files.length > 0 ? (
        <ul className="grid gap-1" aria-label="Files added">
          {files.map((f) => (
            <li
              key={f.key}
              className="flex items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Paperclip className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{f.original_file_name}</span>
                <span className="shrink-0 text-muted-foreground">
                  {Math.max(1, Math.round(f.size_bytes / 1024))} KB
                </span>
              </span>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() =>
                  onChange(
                    files.filter((x) => x.key !== f.key),
                    false,
                  )
                }
                aria-label={`Remove ${f.original_file_name}`}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {message ? (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
