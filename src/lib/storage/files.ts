/**
 * Pure rules for stored files (PRD FR-PAY-3, SECURITY section 5). No network, no Next.js, so they
 * can be tested directly. The server actions in actions.ts apply them; the database and the storage
 * policies enforce the same shapes again (migrations 09 and 15).
 */
import { createHash, randomUUID } from "node:crypto";

export type Bucket = "payment-proofs" | "booking-pdfs" | "resort-logos";

import {
  LOGO_MIME,
  MAX_LOGO_BYTES,
  MAX_PROOF_BYTES,
  PROOF_MIME,
  type FileCheck,
  type ProofMime,
} from "./claims";
export {
  LOGO_MIME,
  MAX_FILES_PER_ITEM,
  MAX_LOGO_BYTES,
  MAX_PROOF_BYTES,
  PROOF_MIME,
  checkClaim,
  type FileCheck,
  type FileClaim,
  type ProofMime,
} from "./claims";

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};
export const extensionFor = (mime: string): string | null => EXT[mime] ?? null;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const isUuid = (v: unknown): v is string =>
  typeof v === "string" && new RegExp(`^${UUID}$`, "i").test(v);

/**
 * What the file REALLY is, from its first bytes (not from its name or what the browser claims).
 * Returns null for anything that is not a JPG, PNG, WEBP or PDF.
 */
export function detectMime(bytes: Uint8Array): ProofMime | null {
  const b = bytes;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return "image/jpeg";
  if (
    b.length >= 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 && // RIFF
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50 // WEBP
  ) {
    return "image/webp";
  }
  if (
    b.length >= 5 &&
    b[0] === 0x25 &&
    b[1] === 0x50 &&
    b[2] === 0x44 &&
    b[3] === 0x46 &&
    b[4] === 0x2d
  ) {
    return "application/pdf"; // %PDF-
  }
  return null;
}

export const sha256Hex = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/** Is the real content what was claimed? */
export function checkContent(
  bytes: Uint8Array,
  claimed: string,
  bucket: "payment-proofs" | "resort-logos" = "payment-proofs",
): FileCheck {
  const real = detectMime(bytes);
  const allowed: readonly string[] =
    bucket === "resort-logos" ? LOGO_MIME : PROOF_MIME;
  if (!real || !allowed.includes(real))
    return {
      ok: false,
      message: "That file is not a picture or PDF we can accept.",
    };
  if (real !== claimed)
    return {
      ok: false,
      message: "The file does not match its type. Please choose it again.",
    };
  const max = bucket === "resort-logos" ? MAX_LOGO_BYTES : MAX_PROOF_BYTES;
  if (bytes.length > max)
    return { ok: false, message: "That file is too big." };
  return { ok: true, mime: real };
}

// --- server-chosen object names (the browser never picks one) ------------------------------------
export const proofPath = (
  kind: "payment" | "refund",
  bookingId: string,
  mime: string,
): string => {
  const ext = extensionFor(mime);
  if (!isUuid(bookingId) || !ext) throw new Error("invalid proof path input");
  return `${kind === "refund" ? "refunds/" : ""}${bookingId.toLowerCase()}/${randomUUID()}.${ext}`;
};
export const logoPath = (resortId: string, mime: string): string => {
  const ext = extensionFor(mime);
  if (!isUuid(resortId) || !ext || ext === "pdf")
    throw new Error("invalid logo path input");
  return `${resortId.toLowerCase()}/${randomUUID()}.${ext}`;
};

const PROOF_RE = new RegExp(
  `^(refunds/)?${UUID}/${UUID}\\.(jpg|png|webp|pdf)$`,
);
/** A path the server could have produced for this booking and kind (used to refuse anything else). */
export function isProofPathFor(
  path: string,
  kind: "payment" | "refund",
  bookingId: string,
): boolean {
  if (!PROOF_RE.test(path)) return false;
  return (
    path.startsWith(
      kind === "refund"
        ? `refunds/${bookingId.toLowerCase()}/`
        : `${bookingId.toLowerCase()}/`,
    ) && (kind === "refund" ? true : !path.startsWith("refunds/"))
  );
}

/** Signed download links live only this long (seconds). */
export const SIGNED_URL_SECONDS = 60;
