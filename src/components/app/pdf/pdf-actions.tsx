"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pdfDownloadAction, regeneratePdfAction } from "@/lib/pdf/actions";

/**
 * Download one saved version. The browser never sees a storage path: the server makes a link that works for one
 * minute for the signed-in person, and the file is saved with a clear name like "AAA-2026-000001-v2.pdf".
 */
export function DownloadPdfButton({
  versionId,
  label = "Download",
  variant = "outline",
}: {
  versionId: string;
  label?: string;
  variant?: "outline" | "default";
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="grid gap-1">
      <Button
        type="button"
        variant={variant}
        className="min-h-11"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const r = await pdfDownloadAction(versionId);
            if (!r.ok) return setError(r.message);
            window.location.assign(r.url);
          })
        }
      >
        <Download className="size-4" aria-hidden="true" />
        {pending ? "Opening…" : label}
      </Button>
      {error ? (
        <span role="alert" className="text-sm text-destructive">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/** "Regenerate PDF": makes a new version only if something printed has changed since the latest one. */
export function RegeneratePdfButton({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  return (
    <div className="grid gap-1">
      <Button
        type="button"
        variant="outline"
        className="min-h-11 justify-self-start"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setMessage(null);
            const r = await regeneratePdfAction(bookingId);
            setMessage({ ok: r.ok, text: r.message });
            if (r.ok) router.refresh();
          })
        }
      >
        <RefreshCw className="size-4" aria-hidden="true" />
        {pending ? "Making the PDF…" : "Regenerate PDF"}
      </Button>
      {message ? (
        <p
          role={message.ok ? "status" : "alert"}
          className={
            message.ok
              ? "text-sm font-medium"
              : "text-sm font-medium text-destructive"
          }
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
