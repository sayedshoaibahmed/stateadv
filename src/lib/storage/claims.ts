/**
 * The parts of the file rules that are safe to use in the BROWSER too (no Node modules): limits, allowed types and the
 * check of what the browser says about a file before it is uploaded. The server re-checks the real bytes
 * (files.ts: checkContent), so this is only for quick, friendly feedback.
 */
export const MAX_PROOF_BYTES = 10 * 1024 * 1024;
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const MAX_FILES_PER_ITEM = 5;

export const PROOF_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;
export const LOGO_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export type ProofMime = (typeof PROOF_MIME)[number];

export interface FileClaim {
  name: string;
  size: number;
  type: string;
}

export type FileCheck =
  { ok: true; mime: ProofMime } | { ok: false; message: string };

/** What the browser says about a file before upload. Checked again after upload from the real bytes. */
export function checkClaim(
  f: FileClaim,
  bucket: "payment-proofs" | "resort-logos" = "payment-proofs",
): FileCheck {
  const allowed: readonly string[] =
    bucket === "resort-logos" ? LOGO_MIME : PROOF_MIME;
  const max = bucket === "resort-logos" ? MAX_LOGO_BYTES : MAX_PROOF_BYTES;
  if (!allowed.includes(f.type)) {
    return {
      ok: false,
      message:
        bucket === "resort-logos"
          ? "Use a JPG, PNG or WEBP picture."
          : "Use a JPG, PNG, WEBP or PDF file.",
    };
  }
  if (!Number.isInteger(f.size) || f.size <= 0)
    return { ok: false, message: "That file is empty." };
  if (f.size > max)
    return {
      ok: false,
      message: `That file is too big. The limit is ${max / 1024 / 1024} MB.`,
    };
  return { ok: true, mime: f.type as ProofMime };
}
