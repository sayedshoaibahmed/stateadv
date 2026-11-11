"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireUser } from "@/lib/auth/session";
import {
  MAX_FILES_PER_ITEM,
  SIGNED_URL_SECONDS,
  checkClaim,
  checkContent,
  isProofPathFor,
  isUuid,
  logoPath,
  proofPath,
  sha256Hex,
} from "@/lib/storage/files";

/**
 * Storage actions. Every one starts with requireUser() and acts with THE USER'S OWN LOGIN, so the storage
 * policies (migration 09: active users only, well-formed names only, no overwrite, no delete) and row-level
 * security always apply. The secret key is used in exactly one place: discarding a file that has just been
 * uploaded but failed the content check (a user cannot delete files by design).
 *
 * Flow for a payment/refund proof:
 *   1. prepareProofUploads  -> the SERVER picks the file names and returns one-time upload links
 *   2. the browser uploads straight to private storage (no file passes through this app)
 *   3. confirmProofUploads  -> the server downloads each file, checks its real type, size and SHA-256
 *   4. add_payment / add_refund / add_proofs (database functions) save the file details
 */

export interface UploadTicket {
  path: string;
  token: string;
  name: string;
  mime: string;
}
export type PrepareResult =
  { ok: true; tickets: UploadTicket[] } | { ok: false; message: string };

const claims = z
  .array(
    z.object({
      name: z.string().max(200),
      size: z.number(),
      type: z.string().max(100),
    }),
  )
  .min(1, "Please choose a file.")
  .max(MAX_FILES_PER_ITEM, `You can add at most ${MAX_FILES_PER_ITEM} files.`);

export async function prepareProofUploads(
  kind: "payment" | "refund",
  bookingId: string,
  files: Array<{ name: string; size: number; type: string }>,
): Promise<PrepareResult> {
  await requireUser();
  if (!isUuid(bookingId) || (kind !== "payment" && kind !== "refund")) {
    return { ok: false, message: "That booking was not found." };
  }
  const parsed = claims.safeParse(files);
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0].message };
  for (const f of parsed.data) {
    const c = checkClaim(f);
    if (!c.ok) return { ok: false, message: c.message };
  }
  const supabase = await createClient();
  const tickets: UploadTicket[] = [];
  for (const f of parsed.data) {
    const path = proofPath(kind, bookingId, f.type);
    const { data, error } = await supabase.storage
      .from("payment-proofs")
      .createSignedUploadUrl(path);
    if (error || !data)
      return {
        ok: false,
        message: "We could not prepare the upload. Please try again.",
      };
    tickets.push({ path, token: data.token, name: f.name, mime: f.type });
  }
  return { ok: true, tickets };
}

export interface ConfirmedFile {
  storage_path: string;
  original_file_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
}
export type ConfirmResult =
  { ok: true; files: ConfirmedFile[] } | { ok: false; message: string };

export async function confirmProofUploads(
  kind: "payment" | "refund",
  bookingId: string,
  uploaded: Array<{ path: string; name: string; mime: string }>,
): Promise<ConfirmResult> {
  await requireUser();
  if (
    !isUuid(bookingId) ||
    uploaded.length === 0 ||
    uploaded.length > MAX_FILES_PER_ITEM
  ) {
    return { ok: false, message: "Please check the files and try again." };
  }
  const supabase = await createClient();
  const confirmed: ConfirmedFile[] = [];
  for (const u of uploaded) {
    // only names the server could have produced for THIS booking
    if (!isProofPathFor(u.path, kind, bookingId))
      return {
        ok: false,
        message: "That file does not belong to this booking.",
      };
    const { data, error } = await supabase.storage
      .from("payment-proofs")
      .download(u.path);
    if (error || !data)
      return {
        ok: false,
        message: "A file did not upload. Please add it again.",
      };
    const bytes = new Uint8Array(await data.arrayBuffer());
    const content = checkContent(bytes, u.mime);
    if (!content.ok) {
      await discardUpload(u.path);
      return { ok: false, message: content.message };
    }
    confirmed.push({
      storage_path: u.path,
      original_file_name: u.name.slice(0, 200),
      mime_type: content.mime,
      size_bytes: bytes.length,
      sha256: sha256Hex(bytes),
    });
  }
  return { ok: true, files: confirmed };
}

/** Removes ONE just-uploaded file that failed the check. Refuses anything already saved against a record. */
async function discardUpload(path: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("proofs")
      .select("id")
      .eq("storage_path", path)
      .maybeSingle();
    if (data) return; // saved against a payment/refund: never removed
    await admin.storage.from("payment-proofs").remove([path]);
  } catch {
    /* an unreferenced private file may stay; it is invisible and harmless */
  }
}

// ---------------------------------------------------------------- downloads
export type UrlResult =
  | { ok: true; url: string; expiresInSeconds: number }
  | { ok: false; message: string };

/** A 60-second link to one proof file. The proof row is read with the user's login (active users only). */
export async function proofDownloadUrl(proofId: string): Promise<UrlResult> {
  await requireUser();
  if (!isUuid(proofId))
    return { ok: false, message: "That file was not found." };
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("proofs")
    .select("storage_path")
    .eq("id", proofId)
    .maybeSingle();
  if (!row) return { ok: false, message: "That file was not found." };
  const { data, error } = await supabase.storage
    .from("payment-proofs")
    .createSignedUrl(row.storage_path as string, SIGNED_URL_SECONDS);
  if (error || !data)
    return { ok: false, message: "We could not open that file." };
  return {
    ok: true,
    url: data.signedUrl,
    expiresInSeconds: SIGNED_URL_SECONDS,
  };
}

/** A 60-second link to one saved booking PDF version. */
export async function bookingPdfUrl(versionId: string): Promise<UrlResult> {
  await requireUser();
  if (!isUuid(versionId))
    return { ok: false, message: "That file was not found." };
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("booking_pdf_versions")
    .select("storage_path")
    .eq("id", versionId)
    .maybeSingle();
  if (!row) return { ok: false, message: "That file was not found." };
  const { data, error } = await supabase.storage
    .from("booking-pdfs")
    .createSignedUrl(row.storage_path as string, SIGNED_URL_SECONDS);
  if (error || !data)
    return { ok: false, message: "We could not open that file." };
  return {
    ok: true,
    url: data.signedUrl,
    expiresInSeconds: SIGNED_URL_SECONDS,
  };
}

// -------------------------------------------------------------------- logos
export async function prepareLogoUpload(
  resortId: string,
  file: { name: string; size: number; type: string },
): Promise<PrepareResult> {
  await requireUser();
  if (!isUuid(resortId))
    return { ok: false, message: "That resort was not found." };
  const c = checkClaim(file, "resort-logos");
  if (!c.ok) return { ok: false, message: c.message };
  const path = logoPath(resortId, file.type);
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("resort-logos")
    .createSignedUploadUrl(path);
  if (error || !data)
    return {
      ok: false,
      message: "We could not prepare the upload. Please try again.",
    };
  return {
    ok: true,
    tickets: [{ path, token: data.token, name: file.name, mime: file.type }],
  };
}

/** After upload: check the real content, then save the logo path on the resort through the database function. */
export async function confirmLogoUpload(
  resortId: string,
  path: string,
  mime: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  await requireUser();
  if (!isUuid(resortId) || !path.startsWith(`${resortId.toLowerCase()}/`))
    return { ok: false, message: "That file does not belong to this resort." };
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("resort-logos")
    .download(path);
  if (error || !data)
    return {
      ok: false,
      message: "The picture did not upload. Please try again.",
    };
  const bytes = new Uint8Array(await data.arrayBuffer());
  const content = checkContent(bytes, mime, "resort-logos");
  if (!content.ok) return { ok: false, message: content.message };
  const { data: r } = await supabase
    .from("resorts")
    .select("code, name, location, contact_number")
    .eq("id", resortId)
    .maybeSingle();
  if (!r) return { ok: false, message: "That resort was not found." };
  const { error: saveError } = await supabase.rpc("upsert_resort", {
    p_id: resortId,
    p_code: r.code,
    p_name: r.name,
    p_location: r.location ?? undefined,
    p_contact_number: r.contact_number ?? undefined,
    p_logo_path: path,
  });
  return saveError
    ? { ok: false, message: "We could not save the picture. Please try again." }
    : { ok: true };
}
