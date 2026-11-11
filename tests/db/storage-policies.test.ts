/**
 * Private file storage rules (migration 09): who may add, read, replace or delete files, and which names are allowed.
 * Runs on the stand-in for storage.objects (PGlite) and on a real PostgreSQL 17 (same policies). The REAL Supabase
 * Storage service (signed upload links, size and type limits enforced by the service) is tested separately,
 * against the hosted project, as RSV-07.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { expectDbError } from "./harness";
import { setupWorld, uid, type World } from "./fixtures";

let w: World;
let disabled: string;
beforeAll(async () => {
  w = await setupWorld();
  disabled = uid();
  await w.db.q(
    `insert into auth.users (id, email) values ($1, 'sto-off@test.example')`,
    [disabled],
  );
  await w.db.as({ role: "postgres", uid: w.owner }, async () => {
    await w.db.q(
      `insert into public.user_profiles (id, full_name, email, role) values ($1, 'Test Off', 'sto-off@test.example', 'manager')`,
      [disabled],
    );
    await w.db.q(
      `update public.user_profiles set is_active = false, disabled_at = now() where id = $1`,
      [disabled],
    );
  });
}, 120_000);

const q = <T = Record<string, unknown>>(sql: string, p?: unknown[]) =>
  w.db.q<T>(sql, p);
const as = <T>(id: string | null, fn: () => Promise<T>) =>
  w.db.as({ role: "authenticated", uid: id }, fn);
const put = (id: string | null, bucket: string, name: string) =>
  as(id, () =>
    q(`insert into storage.objects (bucket_id, name) values ($1, $2)`, [
      bucket,
      name,
    ]),
  );
const exists = async (bucket: string, name: string) =>
  (
    await q(
      `select 1 from storage.objects where bucket_id = $1 and name = $2`,
      [bucket, name],
    )
  ).length === 1;

const B = () => w.resorts.A.id; // any uuid works as a folder
const proof = () => `${B()}/${uid()}.png`;

describe("buckets", () => {
  it("STO-DB1: the three buckets are private, with the agreed size and type limits", async () => {
    const rows = await q<{
      id: string;
      public: boolean;
      file_size_limit: number;
      allowed_mime_types: string[];
    }>(
      `select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id`,
    );
    expect(
      rows.map((r) => [r.id, r.public, Number(r.file_size_limit)]),
    ).toEqual([
      ["booking-pdfs", false, 10485760],
      ["payment-proofs", false, 10485760],
      ["resort-logos", false, 2097152],
    ]);
    const by = Object.fromEntries(
      rows.map((r) => [r.id, r.allowed_mime_types]),
    );
    expect(by["payment-proofs"].sort()).toEqual([
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
    expect(by["booking-pdfs"]).toEqual(["application/pdf"]);
    expect(by["resort-logos"].sort()).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
    ]); // no SVG
  });
});

describe("adding files", () => {
  it("STO-DB2: an active user can add well-formed names to each bucket", async () => {
    await put(w.manager, "payment-proofs", proof());
    await put(w.manager, "payment-proofs", `refunds/${B()}/${uid()}.pdf`);
    await put(w.manager, "booking-pdfs", `${B()}/v1.pdf`);
    await put(w.manager, "booking-pdfs", `${B()}/v123456.pdf`);
    await put(w.owner, "resort-logos", `${B()}/${uid()}.webp`);
  });

  it("STO-DB3: badly named files are refused, even for an active user", async () => {
    const bad: Array<[string, string]> = [
      ["payment-proofs", "evil.png"],
      ["payment-proofs", `${B()}/evil.png`],
      ["payment-proofs", `../${B()}/${uid()}.png`],
      ["payment-proofs", `${B()}/${uid()}.exe`],
      ["payment-proofs", `${B()}/${uid()}.svg`],
      ["payment-proofs", `${B()}/${uid()}.html`],
      ["payment-proofs", `${B()}/sub/${uid()}.png`],
      ["payment-proofs", `${B().toUpperCase()}/${uid()}.png`],
      ["payment-proofs", `refunds/refunds/${B()}/${uid()}.png`],
      ["payment-proofs", `${B()}/v1.pdf`], // a PDF-version name in the proofs bucket
      ["booking-pdfs", `${B()}/${uid()}.pdf`], // a proof name in the PDF bucket
      ["booking-pdfs", `${B()}/v1.png`],
      ["booking-pdfs", `${B()}/v1234567.pdf`],
      ["resort-logos", `${B()}/${uid()}.pdf`],
      ["resort-logos", `${B()}/${uid()}.svg`],
      ["resort-logos", "logo.png"],
    ];
    for (const [bucket, name] of bad) {
      await expectDbError(put(w.manager, bucket, name), "row-level security");
      expect(await exists(bucket, name), `${bucket}/${name}`).toBe(false);
    }
  });

  it("STO-DB4: anonymous visitors, people without a profile and switched-off users cannot add files", async () => {
    const name = proof();
    await expectDbError(
      w.db.as({ role: "anon" }, () =>
        q(
          `insert into storage.objects (bucket_id, name) values ('payment-proofs', $1)`,
          [name],
        ),
      ),
      "row-level security",
    );
    await expectDbError(
      put(null, "payment-proofs", name),
      "row-level security",
    );
    await expectDbError(
      put(uid(), "payment-proofs", name),
      "row-level security",
    );
    await expectDbError(
      put(disabled, "payment-proofs", name),
      "row-level security",
    );
    expect(await exists("payment-proofs", name)).toBe(false);
  });

  it("STO-DB5: a file name cannot be used twice, so nothing can be overwritten by adding", async () => {
    const name = proof();
    await put(w.manager, "payment-proofs", name);
    await expectDbError(
      put(w.manager2, "payment-proofs", name),
      "objects_bucket_name",
    );
  });
});

describe("reading, replacing and deleting", () => {
  it("STO-DB6: active users can read; switched-off users, strangers and anonymous visitors cannot", async () => {
    const name = proof();
    await put(w.manager, "payment-proofs", name);
    const read = (id: string | null) =>
      as(id, () =>
        q(
          `select 1 from storage.objects where bucket_id = 'payment-proofs' and name = $1`,
          [name],
        ),
      );
    expect((await read(w.owner)).length).toBe(1);
    expect((await read(w.manager2)).length).toBe(1);
    expect((await read(disabled)).length).toBe(0);
    expect((await read(uid())).length).toBe(0);
    expect((await read(null)).length).toBe(0);
    // anonymous visitors: table rights exist (as on Supabase) but no policy lets them see anything
    expect(
      (
        await w.db.as({ role: "anon" }, () =>
          q(`select 1 from storage.objects`),
        )
      ).length,
    ).toBe(0);
  });

  it("STO-DB7: nobody can change or replace a stored file", async () => {
    const name = proof();
    await put(w.manager, "payment-proofs", name);
    for (const actor of [w.manager, w.owner]) {
      await as(actor, () =>
        q(
          `update storage.objects set name = $2, metadata = '{"x":1}'::jsonb where bucket_id = 'payment-proofs' and name = $1`,
          [name, `${B()}/${uid()}.png`],
        ),
      );
    }
    expect(await exists("payment-proofs", name)).toBe(true); // unchanged: the update touched 0 rows
    expect(
      (
        await q<{ n: string }>(
          `select count(*)::text n from storage.objects where bucket_id = 'payment-proofs' and metadata is not null and metadata ->> 'x' = '1'`,
        )
      )[0].n,
    ).toBe("0");
  });

  it("STO-DB8: nobody can delete a stored file, not even an Owner", async () => {
    const name = proof();
    await put(w.manager, "payment-proofs", name);
    for (const actor of [w.manager, w.owner]) {
      await as(actor, () =>
        q(
          `delete from storage.objects where bucket_id = 'payment-proofs' and name = $1`,
          [name],
        ),
      );
      expect(await exists("payment-proofs", name)).toBe(true);
    }
  });
});
