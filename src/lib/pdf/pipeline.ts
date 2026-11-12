/**
 * Making a booking's PDF (TRD 5.6, PRD FR-PDF-1..6). Free of Next.js and of any one Supabase client, so it can be
 * tested with fakes and used by both the person's own session (after a save, and the "Regenerate PDF" button) and the
 * retry job (the service role, SECURITY.md section 4).
 *
 * Steps for one booking:
 *   1. note the open jobs (they are finished at the end, up to the highest number seen now)
 *   2. pdf_prepare: is a new version needed (FR-PDF-5), its number and file name, the printed data and its hash
 *   3. format, render, upload to the private "booking-pdfs" bucket under the name the DATABASE chose
 *   4. register_pdf_version: the database checks the data is unchanged, the number is next, and the file is in storage
 *   5. finish the jobs
 * A failure NEVER touches the booking: the job is marked failed with a short message (no booking data in it) and the
 * retry job or a person pressing "Regenerate PDF" tries again. The function never throws.
 */
import { buildModel, parsePdfData, type PdfData } from "@/lib/pdf/model";
import type { Logo } from "@/lib/pdf/document";

export interface PipelineClient {
  rpc(
    name: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  from(table: "pdf_jobs"): {
    select(cols: string): {
      eq(
        col: string,
        v: string,
      ): {
        in(
          col: string,
          vals: string[],
        ): {
          order(
            col: string,
            o: { ascending: boolean },
          ): PromiseLike<{
            data: { id: number; reason: string }[] | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
  };
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        body: Buffer,
        o: { contentType: string; upsert: boolean },
      ): PromiseLike<{ error: { message: string } | null }>;
      download(path: string): PromiseLike<{
        data: { arrayBuffer(): Promise<ArrayBuffer> } | null;
        error: { message: string } | null;
      }>;
    };
  };
}

export type PdfOutcome =
  | { status: "created"; version: number }
  | { status: "unchanged"; version: number | null }
  | { status: "failed"; message: string };

export interface PipelineOptions {
  /** the retry job may overwrite a file left behind by a crash (nothing is registered under that name) */
  system?: boolean;
  /** the reasons to record (default: those of the open jobs) */
  reason?: string;
  now?: () => Date;
  render: (
    model: ReturnType<typeof buildModel>,
    logo: Logo | null,
  ) => Promise<Buffer>;
}

const MAX_BYTES = 10 * 1024 * 1024;
const TRIES = 3;

type Prepared = {
  needed: boolean;
  version_no: number;
  path: string;
  hash: string;
  latest_version: number | null;
  data: unknown;
};

async function openJobs(client: PipelineClient, bookingId: string) {
  const r = await client
    .from("pdf_jobs")
    .select("id, reason")
    .eq("booking_id", bookingId)
    .in("status", ["pending", "running", "failed"])
    .order("id", { ascending: true });
  if (r.error) throw new Error("jobs");
  return r.data ?? [];
}

/** What a logo file really is, from its first bytes (not its name): only PNG and JPEG can be drawn; anything else is "no logo". */
export function logoFormat(b: Uint8Array): "png" | "jpg" | null {
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
  )
    return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return "jpg";
  return null;
}

/** The resort logo, if it is really a PNG or JPEG (the PDF library cannot draw WEBP). Any problem simply means "no logo". */
export async function loadLogo(
  client: PipelineClient,
  path: string | null,
): Promise<Logo | null> {
  if (!path || !/\.(png|jpe?g)$/i.test(path)) return null;
  try {
    const r = await client.storage.from("resort-logos").download(path);
    if (r.error || !r.data) return null;
    const data = Buffer.from(await r.data.arrayBuffer());
    if (data.length === 0 || data.length > 2 * 1024 * 1024) return null;
    const format = logoFormat(data);
    return format ? { data, format } : null;
  } catch {
    return null;
  }
}

const rpc = async <T>(
  client: PipelineClient,
  name: string,
  args: Record<string, unknown>,
): Promise<T> => {
  const r = await client.rpc(name, args);
  if (r.error) throw new Error(r.error.message.slice(0, 120));
  return r.data as T;
};

/** A message that is safe to store and show: a code word or a fixed sentence, never booking data. */
function safeMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : "";
  if (/PDF_STALE|PDF_VERSION_CONFLICT|already exists|Duplicate/i.test(m))
    return "Another PDF was being made at the same time.";
  if (/NOT_ALLOWED/.test(m)) return "Not allowed.";
  if (/NOT_FOUND/.test(m)) return "The booking was not found.";
  if (/INVALID_FILE/.test(m)) return "The PDF file could not be stored.";
  if (e instanceof Error && e.name === "PdfDataError")
    return "The booking details could not be read for the PDF.";
  return "The PDF could not be made.";
}

export async function processBookingPdf(
  client: PipelineClient,
  bookingId: string,
  opts: PipelineOptions,
): Promise<PdfOutcome> {
  const now = opts.now ?? (() => new Date());
  let jobs: { id: number; reason: string }[] = [];
  try {
    jobs = await openJobs(client, bookingId);
  } catch {
    return { status: "failed", message: "The PDF queue could not be read." };
  }
  const upTo = jobs.length > 0 ? Math.max(...jobs.map((j) => j.id)) : null;
  const reason =
    (opts.reason ??
      [...new Set(jobs.map((j) => j.reason))].slice(0, 3).join(", ")) ||
    "generated";
  const finish = async (ok: boolean, error?: string) => {
    if (upTo === null) return;
    try {
      await rpc(client, "finish_pdf_jobs", {
        p_booking: bookingId,
        p_up_to: upTo,
        p_ok: ok,
        p_error: error ?? null,
      });
    } catch {
      /* the jobs stay open; the retry job will look again */
    }
  };

  let last: unknown = null;
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    try {
      const prep = await rpc<Prepared>(client, "pdf_prepare", {
        p_booking: bookingId,
      });
      if (!prep.needed) {
        await finish(true);
        return { status: "unchanged", version: prep.latest_version };
      }
      const data: PdfData = parsePdfData(prep.data);
      const model = buildModel(data, {
        version: prep.version_no,
        generatedAt: now(),
      });
      const logo = await loadLogo(client, data.booking.logo_path);
      const file = await opts.render(model, logo);
      if (file.length < 1 || file.length > MAX_BYTES) throw new Error("size");
      // look once more BEFORE uploading: if the booking changed while the file was drawn, draw it again instead of
      // leaving a file behind that no version points to (a person's session cannot overwrite a stored file)
      const again = await rpc<Prepared>(client, "pdf_prepare", {
        p_booking: bookingId,
      });
      if (again.hash !== prep.hash || again.version_no !== prep.version_no)
        throw new Error("PDF_STALE");
      const up = await client.storage
        .from("booking-pdfs")
        .upload(prep.path, file, {
          contentType: "application/pdf",
          upsert: opts.system === true,
        });
      if (up.error) throw new Error(up.error.message.slice(0, 120));
      const done = await rpc<{ created: boolean; version_no: number }>(
        client,
        "register_pdf_version",
        {
          p_booking: bookingId,
          p_hash: prep.hash,
          p_version: prep.version_no,
          p_reason: reason,
          p_size: file.length,
        },
      );
      await finish(true);
      return done.created
        ? { status: "created", version: done.version_no }
        : { status: "unchanged", version: done.version_no };
    } catch (e) {
      last = e;
      // another process made the same version, or the booking changed meanwhile: look again from the start
      if (
        attempt < TRIES &&
        /PDF_STALE|PDF_VERSION_CONFLICT|already exists|Duplicate/i.test(
          e instanceof Error ? e.message : "",
        )
      )
        continue;
      break;
    }
  }
  const message = safeMessage(last);
  await finish(false, message);
  return { status: "failed", message };
}

/** A friendly sentence for the person who pressed "Regenerate PDF". */
export function outcomeText(o: PdfOutcome): string {
  if (o.status === "created") return `The PDF was made (version ${o.version}).`;
  if (o.status === "unchanged")
    return o.version
      ? `Nothing has changed since version ${o.version}, so no new PDF was needed.`
      : "Nothing needed to be made.";
  return "The PDF could not be made right now. The booking is saved. It will be tried again automatically; you can also press Regenerate PDF later.";
}
