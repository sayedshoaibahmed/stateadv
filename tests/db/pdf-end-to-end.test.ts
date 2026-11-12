/**
 * The whole PDF path against the real database functions: real booking and payment functions queue the jobs, the pipeline
 * reads the data from `pdf_booking_data`, renders a REAL PDF with the bundled font, "uploads" it (storage is a table in
 * the test database) and registers the version. TEST_PLAN PDF-01..09. E2E-01..
 */
import { beforeAll, describe, expect, it } from "vitest";
import { dateOffset, setupWorld, uid, type World } from "./fixtures";
import { processBookingPdf, type PipelineClient } from "@/lib/pdf/pipeline";
import { buildModel, parsePdfData } from "@/lib/pdf/model";
import { renderBookingPdf } from "@/lib/pdf/render";

let w: World;
const R = (rupees: number) => rupees * 100;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const q = <T = Json>(sql: string, p?: unknown[]) => w.db.q<T>(sql, p);
const files = new Map<string, Buffer>();
const AT = new Date("2026-11-12T10:35:00Z");

/** The pipeline's client, backed by the test database: rpc as a signed-in person (or the service role), storage as a table + map. */
function client(actor: string | "service"): PipelineClient {
  const run = <T>(fn: () => Promise<T>) =>
    actor === "service"
      ? w.db.as({ role: "service_role" }, fn)
      : w.db.as({ role: "authenticated", uid: actor }, fn);
  return {
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      const keys = Object.keys(args);
      try {
        const rows = await run(() =>
          q<{ r: unknown }>(
            `select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`,
            keys.map((k) => args[k]),
          ),
        );
        return { data: rows[0].r, error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } };
      }
    },
    from: () =>
      ({
        select: () => ({
          eq: (_c: string, id: string) => ({
            in: (_c2: string, st: string[]) => ({
              order: async () => {
                const rows = await run(() =>
                  q<{ id: string; reason: string }>(
                    `select id, reason from public.pdf_jobs where booking_id = $1 and status::text = any($2) order by id`,
                    [id, st],
                  ),
                );
                return {
                  data: rows.map((x) => ({
                    id: Number(x.id),
                    reason: x.reason,
                  })),
                  error: null,
                };
              },
            }),
          }),
        }),
      }) as never,
    storage: {
      from: (bucket: string) => ({
        upload: async (
          path: string,
          body: Buffer,
          o: { contentType: string; upsert: boolean },
        ) => {
          if (bucket !== "booking-pdfs")
            return { error: { message: "wrong bucket" } };
          if (files.has(path) && !o.upsert)
            return { error: { message: "The resource already exists" } };
          files.set(path, body);
          await q(
            `delete from storage.objects where bucket_id = 'booking-pdfs' and name = $1`,
            [path],
          ).catch(() => undefined);
          await q(
            `insert into storage.objects (bucket_id, name, metadata) values ('booking-pdfs', $1, $2::jsonb)`,
            [
              path,
              JSON.stringify({ size: body.length, mimetype: o.contentType }),
            ],
          );
          return { error: null };
        },
        download: async () => ({ data: null, error: { message: "none" } }),
      }),
    },
  } as unknown as PipelineClient;
}
const make = (
  actor: string | "service",
  b: string,
  o: Partial<Parameters<typeof processBookingPdf>[2]> = {},
) =>
  processBookingPdf(client(actor), b, {
    render: renderBookingPdf,
    now: () => AT,
    system: actor === "service",
    ...o,
  });
const as = <T>(id: string, fn: () => Promise<T>) =>
  w.db.as({ role: "authenticated", uid: id }, fn);
const call = async (sql: string, p: unknown[] = [], actor = w.manager) =>
  (await as(actor, () => q<{ r: Json }>(sql, p)))[0].r;
const versions = (b: string) =>
  q<{
    version_no: number;
    storage_path: string;
    trigger_reason: string;
    size_bytes: number;
    summary: Json;
  }>(
    `select version_no, storage_path, trigger_reason, size_bytes, summary from public.booking_pdf_versions where booking_id = $1 order by version_no`,
    [b],
  );
const jobs = (b: string) =>
  q<{ status: string; last_error: string | null; reason: string }>(
    `select status::text, last_error, reason from public.pdf_jobs where booking_id = $1 order by id`,
    [b],
  );
let d0: string, in1: string, out1: string;
async function newBooking(tariff = R(1000)): Promise<string> {
  const r = await call(
    `select public.create_booking($1::jsonb, $2::jsonb, $3::uuid) as r`,
    [
      JSON.stringify({
        resort_id: w.resorts.A.id,
        guest_id: w.guestId,
        pax: 1,
        co_category_id: w.cat.direct,
        stay_type_id: w.stayTypeId,
        booking_date: d0,
        check_in_at: `${in1}T14:00:00+05:30`,
        check_out_at: `${out1}T11:00:00+05:30`,
        pricing_method: "per_person_per_stay",
        tariff_paise: tariff,
      }),
      JSON.stringify([
        { label: "Balance", due_date: in1, amount_paise: tariff },
      ]),
      uid(),
    ],
  );
  return r.id as string;
}
const addPay = (b: string, amount: number) =>
  call(`select public.add_payment($1::jsonb, '[]'::jsonb, $2::uuid) as r`, [
    JSON.stringify({
      booking_id: b,
      amount_paise: amount,
      method: "cash",
      payment_date: d0,
    }),
    uid(),
  ]);

beforeAll(async () => {
  w = await setupWorld();
  d0 = await dateOffset(w.db, 0);
  in1 = await dateOffset(w.db, 3);
  out1 = await dateOffset(w.db, 4);
});

describe("versions follow what is printed (E2E-01..)", () => {
  it("E2E-01 (PDF-01): a new booking gets v1: a real PDF in the named file, a version row, the job done", async () => {
    const b = await newBooking();
    expect(await jobs(b)).toEqual([
      expect.objectContaining({ status: "pending", reason: "booking created" }),
    ]);
    expect(await make(w.manager, b)).toEqual({ status: "created", version: 1 });
    const [v] = await versions(b);
    expect(v).toMatchObject({
      version_no: 1,
      storage_path: `${b}/v1.pdf`,
      trigger_reason: "booking created",
    });
    const bytes = files.get(`${b}/v1.pdf`)!;
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBe(Number(v.size_bytes));
    expect(v.summary).toMatchObject({
      amount_due_paise: R(1000),
      pending_paise: R(1000),
      total_collection_paise: 0,
    });
    expect(await jobs(b)).toEqual([
      expect.objectContaining({ status: "done", last_error: null }),
    ]);
  });

  it("E2E-02 (PDF-02, PDF-05): a payment added, then approved: a new version each time; running again with nothing changed makes none", async () => {
    const b = await newBooking();
    await make(w.manager, b);
    const p = await addPay(b, R(400));
    expect(await make(w.manager, b)).toEqual({ status: "created", version: 2 });
    expect(await make(w.manager, b)).toEqual({
      status: "unchanged",
      version: 2,
    }); // nothing changed since v2
    await call(`select public.approve_payment($1, 1) as r`, [p.id], w.owner);
    expect(await make(w.manager, b)).toEqual({ status: "created", version: 3 });
    const vs = await versions(b);
    expect(vs.map((x) => x.version_no)).toEqual([1, 2, 3]);
    expect(vs[1].summary).toMatchObject({
      waiting_paise: R(400),
      pending_paise: R(600),
      total_collection_paise: 0,
    });
    expect(vs[2].summary).toMatchObject({
      waiting_paise: 0,
      pending_paise: R(600),
      total_collection_paise: R(400),
    });
    expect(vs[1].trigger_reason).toBe("payment added");
    expect(vs[2].trigger_reason).toBe("payment approved");
    for (const v of vs) expect(files.has(v.storage_path)).toBe(true); // every version is still there to download (PDF-09)
    expect((await jobs(b)).every((j) => j.status === "done")).toBe(true);
  });

  it("E2E-03: the Regenerate button when nothing changed (FR-PDF-5): the job is queued and finished, no new version", async () => {
    const b = await newBooking();
    await make(w.manager, b);
    await call(`select public.request_pdf_regeneration($1) as r`, [b]);
    expect((await jobs(b)).at(-1)).toMatchObject({
      status: "pending",
      reason: "regenerate requested",
    });
    expect(
      await make(w.manager, b, { reason: "regenerated by a person" }),
    ).toEqual({ status: "unchanged", version: 1 });
    expect((await jobs(b)).at(-1)).toMatchObject({ status: "done" });
    expect(await versions(b)).toHaveLength(1);
  });

  it("E2E-04 (PDF-03, PDF-04): a refund, a plan change, an edit and a cancellation each make a new version; the cancelled one prints the charge", async () => {
    const b = await newBooking(R(1000));
    const p = await addPay(b, R(1300));
    await call(`select public.approve_payment($1, 1) as r`, [p.id], w.owner);
    await make(w.manager, b); // v1: everything so far
    const r = await call(
      `select public.add_refund($1::jsonb, '[]'::jsonb, $2::uuid) as r`,
      [
        JSON.stringify({
          booking_id: b,
          amount_paise: R(100),
          method: "cash",
          refund_date: d0,
          reason: "Guest paid extra",
        }),
        uid(),
      ],
    );
    expect(await make(w.manager, b)).toMatchObject({
      status: "created",
      version: 2,
    });
    await call(`select public.approve_refund($1, 1) as r`, [r.id], w.owner);
    expect(await make(w.manager, b)).toMatchObject({
      status: "created",
      version: 3,
    });
    await call(
      `select public.update_booking($1, 1, '{"remarks":"Late arrival"}'::jsonb) as r`,
      [b],
    );
    expect(await make(w.manager, b)).toMatchObject({
      status: "created",
      version: 4,
    });
    await call(
      `select public.cancel_booking($1, 2, 'cancelled', null, $2, 'Guest cancelled', null, $3::jsonb) as r`,
      [
        b,
        R(500),
        JSON.stringify([
          { label: "Cancellation charge", due_date: d0, amount_paise: R(500) },
        ]),
      ],
    );
    expect(await make(w.manager, b)).toMatchObject({
      status: "created",
      version: 5,
    });
    const [{ r: prep }] = await as(w.manager, () =>
      q<{ r: Json }>(`select public.pdf_prepare($1) as r`, [b]),
    );
    const model = buildModel(parsePdfData(prep.data), {
      version: 5,
      generatedAt: AT,
    });
    expect(model.statusLabel).toBe("Cancelled");
    expect(
      model.cancellationBlock?.find((x) =>
        x.label.startsWith("Cancellation Charge"),
      )?.value,
    ).toBe("₹500");
    expect(model.refunds.rows).toHaveLength(1);
  });
});

describe("failures never touch the booking (E2E-05..)", () => {
  it("E2E-05 (PDF-08): the generator throws: the payment is still saved, the job fails with a safe message, no version; the retry job then succeeds", async () => {
    const b = await newBooking();
    await make(w.manager, b);
    const p = await addPay(b, R(250));
    const boom = async () => {
      throw new Error("renderer exploded for guest Test Guest 9876543210");
    };
    const out = await make(w.manager, b, { render: boom });
    expect(out).toEqual({
      status: "failed",
      message: "The PDF could not be made.",
    });
    expect(
      await q(
        `select amount_paise, status::text s from public.payments where id = $1`,
        [p.id],
      ),
    ).toEqual([
      expect.objectContaining({ amount_paise: R(250), s: "waiting" }),
    ]);
    expect(await versions(b)).toHaveLength(1);
    const failed = (await jobs(b)).at(-1)!;
    expect(failed.status).toBe("failed");
    expect(failed.last_error).toBe("The PDF could not be made.");
    expect(failed.last_error).not.toMatch(/Test Guest|9876543210|exploded/);
    // the retry job (service role) claims the failed job and makes the PDF
    const claimed = await w.db.as({ role: "service_role" }, () =>
      q<{ booking_id: string; attempts: number }>(
        `select booking_id, attempts from public.claim_pdf_jobs(10)`,
      ),
    );
    expect(claimed.find((c) => c.booking_id === b)).toMatchObject({
      attempts: 1,
    });
    expect(await make("service", b)).toEqual({ status: "created", version: 2 });
    expect((await jobs(b)).at(-1)!.status).toBe("done");
  });

  it("E2E-06: the booking changes while the PDF is being drawn (PDF_STALE): nothing wrong is recorded; the next try uses the new data", async () => {
    const b = await newBooking();
    await make(w.manager, b);
    await addPay(b, R(100));
    let once = true;
    const slow = async (...a: Parameters<typeof renderBookingPdf>) => {
      if (once) {
        once = false;
        await addPay(b, R(50)); // someone adds another payment while we draw
      }
      return renderBookingPdf(...a);
    };
    expect(await make(w.manager, b, { render: slow })).toEqual({
      status: "created",
      version: 2,
    });
    const [, v2] = await versions(b);
    expect(v2.summary).toMatchObject({ waiting_paise: R(150) }); // both payments are in the version that was kept
    expect(await versions(b)).toHaveLength(2);
  });

  it("E2E-07: the retry job (service role) can do the whole path too, including a file left behind by a crash (it may overwrite; a person may not)", async () => {
    const b = await newBooking();
    files.set(`${b}/v1.pdf`, Buffer.from("%PDF-1.3 left behind")); // an orphan: uploaded, never registered
    expect((await make(w.manager, b)).status).toBe("failed"); // a person's session cannot overwrite it
    expect(await versions(b)).toHaveLength(0);
    expect(await make("service", b)).toEqual({ status: "created", version: 1 });
    expect(files.get(`${b}/v1.pdf`)!.length).toBeGreaterThan(5000); // the real file replaced the orphan
    const [v] = await versions(b);
    expect(v.size_bytes).toBe(files.get(`${b}/v1.pdf`)!.length);
  });

  it("E2E-08: someone who is not an active person cannot make a PDF through the database", async () => {
    const b = await newBooking();
    const out = await make(uid(), b);
    expect(out).toEqual({ status: "failed", message: "Not allowed." });
    expect(await versions(b)).toHaveLength(0);
  });
});
