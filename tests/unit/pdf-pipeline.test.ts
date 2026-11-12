import { describe, expect, it, vi } from "vitest";
import {
  loadLogo,
  logoFormat,
  outcomeText,
  processBookingPdf,
  type PipelineClient,
} from "@/lib/pdf/pipeline";
import { sample } from "../shared/pdf-sample";

const BOOKING = "44444444-4444-4444-8444-444444444444";
const HASH = "a".repeat(64);
const AT = new Date("2026-11-12T10:35:00Z");
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQ0R42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

interface Fake {
  client: PipelineClient;
  calls: { name: string; args: Record<string, unknown> }[];
  uploads: {
    path: string;
    size: number;
    upsert: boolean;
    contentType: string;
  }[];
  prepared: Record<string, unknown>;
}
/** A fake database and storage. `script` decides what each rpc answers. */
function fake(
  opts: {
    jobs?: { id: number; reason: string }[];
    prepare?: (n: number) => Record<string, unknown> | Error;
    register?: (n: number) => Record<string, unknown> | Error;
    upload?: (n: number) => { message: string } | null;
    logo?: Buffer | null;
    data?: unknown;
  } = {},
): Fake {
  const calls: Fake["calls"] = [];
  const uploads: Fake["uploads"] = [];
  let prepN = 0;
  let regN = 0;
  let upN = 0;
  const prepared = {
    needed: true,
    version_no: 2,
    path: `${BOOKING}/v2.pdf`,
    hash: HASH,
    latest_version: 1,
    data: opts.data ?? sample(),
  };
  const client = {
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      calls.push({ name, args });
      if (name === "pdf_prepare") {
        const r = opts.prepare ? opts.prepare(++prepN) : prepared;
        return r instanceof Error
          ? { data: null, error: { message: r.message } }
          : { data: r, error: null };
      }
      if (name === "register_pdf_version") {
        const r = opts.register
          ? opts.register(++regN)
          : { created: true, version_no: 2 };
        return r instanceof Error
          ? { data: null, error: { message: r.message } }
          : { data: r, error: null };
      }
      return { data: 1, error: null };
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => ({
            order: async () => ({
              data: opts.jobs ?? [
                { id: 5, reason: "payment added" },
                { id: 7, reason: "payment approved" },
              ],
              error: null,
            }),
          }),
        }),
      }),
    }),
    storage: {
      from: (bucket: string) => ({
        upload: async (
          path: string,
          body: Buffer,
          o: { contentType: string; upsert: boolean },
        ) => {
          uploads.push({
            path,
            size: body.length,
            upsert: o.upsert,
            contentType: o.contentType,
          });
          return { error: opts.upload ? opts.upload(++upN) : null };
        },
        download: async () =>
          bucket === "resort-logos" && opts.logo
            ? {
                data: {
                  arrayBuffer: async () =>
                    opts.logo!.buffer.slice(
                      opts.logo!.byteOffset,
                      opts.logo!.byteOffset + opts.logo!.length,
                    ),
                },
                error: null,
              }
            : { data: null, error: { message: "none" } },
      }),
    },
  } as unknown as PipelineClient;
  return { client, calls, uploads, prepared };
}
const render = vi.fn(async () => Buffer.from("%PDF-1.3 fake file"));
const run = (
  f: Fake,
  o: Partial<Parameters<typeof processBookingPdf>[2]> = {},
) => processBookingPdf(f.client, BOOKING, { render, now: () => AT, ...o });
const names = (f: Fake) => f.calls.map((c) => c.name);
const finishes = (f: Fake) =>
  f.calls.filter((c) => c.name === "finish_pdf_jobs").map((c) => c.args);

describe("making a version (PP-01..)", () => {
  it("PP-01: prepare -> render -> upload to the name the DATABASE chose -> register -> finish the jobs up to the highest number seen (PDF-01)", async () => {
    render.mockClear();
    const f = fake();
    const out = await run(f);
    expect(out).toEqual({ status: "created", version: 2 });
    expect(names(f)).toEqual([
      "pdf_prepare",
      "pdf_prepare",
      "register_pdf_version",
      "finish_pdf_jobs",
    ]); // prepare, draw, check again, upload, register, finish
    expect(f.uploads).toEqual([
      {
        path: `${BOOKING}/v2.pdf`,
        size: 18,
        upsert: false,
        contentType: "application/pdf",
      },
    ]);
    expect(f.calls[2].args).toEqual({
      p_booking: BOOKING,
      p_hash: HASH,
      p_version: 2,
      p_reason: "payment added, payment approved",
      p_size: 18,
    });
    expect(finishes(f)).toEqual([
      { p_booking: BOOKING, p_up_to: 7, p_ok: true, p_error: null },
    ]);
    expect(render).toHaveBeenCalledTimes(1);
  });
  it("PP-02: the model handed to the renderer carries the version number and the generation time from the pipeline", async () => {
    render.mockClear();
    await run(fake());
    const [model] = render.mock.calls[0] as unknown as [
      { version: number; generatedLine: string; code: string },
    ];
    expect(model.version).toBe(2);
    expect(model.generatedLine).toBe(
      "Version 2 · Generated 12 Nov 2026, 4:05 PM IST",
    );
    expect(model.code).toBe("AAA-2026-000001");
  });
  it("PP-03: nothing printed changed (FR-PDF-5): no render, no upload, no register; the jobs are finished as done (PDF-05)", async () => {
    render.mockClear();
    const f = fake({
      prepare: () => ({
        needed: false,
        version_no: 3,
        path: "x",
        hash: HASH,
        latest_version: 2,
        data: sample(),
      }),
    });
    expect(await run(f)).toEqual({ status: "unchanged", version: 2 });
    expect(render).not.toHaveBeenCalled();
    expect(f.uploads).toEqual([]);
    expect(names(f)).toEqual(["pdf_prepare", "finish_pdf_jobs"]);
    expect(finishes(f)[0]).toMatchObject({ p_ok: true });
  });
  it("PP-04: the same data registered elsewhere at the same moment (created = false) is not an error", async () => {
    expect(
      await run(fake({ register: () => ({ created: false, version_no: 2 }) })),
    ).toEqual({ status: "unchanged", version: 2 });
  });
  it("PP-05: a reason is given by the caller, or taken from the jobs (at most 3 different ones), or 'generated'", async () => {
    const f = fake();
    await run(f, { reason: "regenerated by a person" });
    expect(
      f.calls.find((c) => c.name === "register_pdf_version")!.args.p_reason,
    ).toBe("regenerated by a person");
    const g = fake({
      jobs: [1, 2, 3, 4, 5].map((i) => ({ id: i, reason: `reason ${i}` })),
    });
    await run(g);
    expect(
      g.calls.find((c) => c.name === "register_pdf_version")!.args.p_reason,
    ).toBe("reason 1, reason 2, reason 3");
    const h = fake({ jobs: [] });
    await run(h);
    expect(
      h.calls.find((c) => c.name === "register_pdf_version")!.args.p_reason,
    ).toBe("generated");
    expect(finishes(h)).toEqual([]); // no job to finish
  });
});

describe("when something goes wrong (PP-06..)", () => {
  it("PP-06: the generator throws (PDF-08): the job is marked failed with a SAFE message, nothing is uploaded, nothing is thrown; the next run succeeds", async () => {
    const boom = vi.fn(async () => {
      throw new Error("secret guest Asha Verma 9876543210 exploded");
    });
    const f = fake();
    const out = await processBookingPdf(f.client, BOOKING, {
      render: boom,
      now: () => AT,
    });
    expect(out).toEqual({
      status: "failed",
      message: "The PDF could not be made.",
    });
    expect(f.uploads).toEqual([]);
    expect(names(f)).not.toContain("register_pdf_version");
    const fin = finishes(f)[0];
    expect(fin).toMatchObject({
      p_ok: false,
      p_error: "The PDF could not be made.",
      p_up_to: 7,
    });
    expect(JSON.stringify(f.calls)).not.toMatch(/Asha|9876543210|exploded/);
    // the retry job
    expect((await run(fake())).status).toBe("created");
  });
  it("PP-07: data the database returned that is not valid fails with a plain message and no booking data", async () => {
    const f = fake({ data: { booking: { code: "SECRET-CODE" } } });
    const out = await run(f);
    expect(out).toEqual({
      status: "failed",
      message: "The booking details could not be read for the PDF.",
    });
    expect(JSON.stringify(f.calls)).not.toContain("SECRET-CODE");
  });
  it("PP-08: the upload fails: failed, nothing registered", async () => {
    const f = fake({
      upload: () => ({ message: "network down for guest Asha" }),
    });
    const out = await run(f);
    expect(out.status).toBe("failed");
    expect(names(f)).not.toContain("register_pdf_version");
    expect(JSON.stringify(finishes(f))).not.toContain("Asha");
  });
  it("PP-09: the booking changed while the PDF was being made (PDF_STALE): it starts again from the data and succeeds", async () => {
    const f = fake({
      register: (n) =>
        n === 1
          ? new Error("PDF_STALE: changed")
          : { created: true, version_no: 2 },
    });
    expect(await run(f)).toEqual({ status: "created", version: 2 });
    expect(names(f).filter((n) => n === "pdf_prepare")).toHaveLength(4); // two looks per try
  });
  it("PP-09b: the booking changed while the PDF was drawn: nothing is uploaded for the old data (no stray file), the PDF is drawn again", async () => {
    render.mockClear();
    const first = {
      needed: true,
      version_no: 2,
      path: `${BOOKING}/v2.pdf`,
      hash: HASH,
      latest_version: 1,
      data: sample(),
    };
    const f = fake({
      prepare: (n) => (n === 2 ? { ...first, hash: "b".repeat(64) } : first),
    });
    expect(await run(f)).toEqual({ status: "created", version: 2 });
    expect(render).toHaveBeenCalledTimes(2);
    expect(f.uploads).toHaveLength(1); // only the second drawing was stored
  });
  it("PP-10: another version took the number (PDF_VERSION_CONFLICT) or the file name exists: look again; if the other one made it, nothing more to do", async () => {
    const f = fake({
      register: () => new Error("PDF_VERSION_CONFLICT"),
      prepare: (n) =>
        n === 1
          ? {
              needed: true,
              version_no: 2,
              path: `${BOOKING}/v2.pdf`,
              hash: HASH,
              latest_version: 1,
              data: sample(),
            }
          : {
              needed: false,
              version_no: 3,
              path: "x",
              hash: HASH,
              latest_version: 2,
              data: sample(),
            },
    });
    expect(await run(f)).toEqual({ status: "unchanged", version: 2 });
    const g = fake({
      upload: (n) =>
        n === 1 ? { message: "The resource already exists" } : null,
    });
    expect((await run(g)).status).toBe("created");
  });
  it("PP-11: it gives up after 3 tries instead of looping, and says so safely", async () => {
    const f = fake({ register: () => new Error("PDF_STALE") });
    const out = await run(f);
    expect(out).toEqual({
      status: "failed",
      message: "Another PDF was being made at the same time.",
    });
    expect(names(f).filter((n) => n === "pdf_prepare")).toHaveLength(6); // two looks per try, three tries
  });
  it("PP-12: an unreadable queue, a failing prepare and a failing finish never throw", async () => {
    const broken = {
      rpc: async () => ({ data: null, error: { message: "boom" } }),
      from: () => ({
        select: () => ({
          eq: () => ({
            in: () => ({
              order: async () => ({ data: null, error: { message: "boom" } }),
            }),
          }),
        }),
      }),
      storage: { from: () => ({}) },
    } as unknown as PipelineClient;
    expect(await processBookingPdf(broken, BOOKING, { render })).toEqual({
      status: "failed",
      message: "The PDF queue could not be read.",
    });
    const f = fake({ prepare: () => new Error("NOT_FOUND: booking") });
    expect(await run(f)).toEqual({
      status: "failed",
      message: "The booking was not found.",
    });
    const g = fake();
    const orig = g.client.rpc.bind(g.client);
    (g.client as unknown as { rpc: unknown }).rpc = async (
      name: string,
      a: Record<string, unknown>,
    ) =>
      name === "finish_pdf_jobs"
        ? { data: null, error: { message: "down" } }
        : orig(name, a);
    expect((await run(g)).status).toBe("created"); // the jobs stay open and the retry job looks again
  });
  it("PP-13: a file that is empty or over 10 MB is never uploaded", async () => {
    const f = fake();
    expect((await run(f, { render: async () => Buffer.alloc(0) })).status).toBe(
      "failed",
    );
    expect(
      (
        await run(fake(), {
          render: async () => Buffer.alloc(10 * 1024 * 1024 + 1),
        })
      ).status,
    ).toBe("failed");
    expect(f.uploads).toEqual([]);
  });
  it("PP-14: the retry job may overwrite a file left behind by a crash; a person's session may not", async () => {
    const person = fake();
    await run(person);
    expect(person.uploads[0].upsert).toBe(false);
    const system = fake();
    await run(system, { system: true });
    expect(system.uploads[0].upsert).toBe(true);
  });
});

describe("the logo and the messages (PP-15..)", () => {
  it("PP-15: only a real PNG or JPEG is used; WEBP, wrong content, huge or missing files mean 'no logo'", async () => {
    expect(logoFormat(PNG)).toBe("png");
    expect(logoFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(logoFormat(Buffer.from("RIFFxxxxWEBP"))).toBeNull();
    expect(logoFormat(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    expect(logoFormat(new Uint8Array())).toBeNull();
    expect(
      (await loadLogo(fake({ logo: PNG }).client, "r/x.png"))?.format,
    ).toBe("png");
    expect(await loadLogo(fake({ logo: PNG }).client, "r/x.webp")).toBeNull(); // by name
    expect(
      await loadLogo(
        fake({ logo: Buffer.from("not an image") }).client,
        "r/x.png",
      ),
    ).toBeNull(); // by content
    expect(await loadLogo(fake({ logo: null }).client, "r/x.png")).toBeNull(); // not found
    expect(await loadLogo(fake().client, null)).toBeNull();
    expect(
      await loadLogo(
        fake({ logo: Buffer.alloc(3 * 1024 * 1024, 0x89) }).client,
        "r/x.png",
      ),
    ).toBeNull();
  });
  it("PP-16: the sentence for the person who pressed Regenerate PDF", () => {
    expect(outcomeText({ status: "created", version: 3 })).toBe(
      "The PDF was made (version 3).",
    );
    expect(outcomeText({ status: "unchanged", version: 2 })).toBe(
      "Nothing has changed since version 2, so no new PDF was needed.",
    );
    expect(outcomeText({ status: "unchanged", version: null })).toBe(
      "Nothing needed to be made.",
    );
    expect(outcomeText({ status: "failed", message: "x" })).toContain(
      "The booking is saved",
    );
  });
});
