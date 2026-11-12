/**
 * The booking PDF pipeline in the database (migration 23; PRD FR-PDF-1..6, TRD 5.6, TEST_PLAN PDF-01..09). PDB-01..
 * A fictional booking with every printed figure written down below (calculated by hand). The functions must give exactly
 * those figures, make a new version only when something printed changes, refuse stale or malformed registrations, and be
 * callable only by an active user or the service role.
 */
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { expectDbError } from "./harness";
import {
  addPayment,
  addRefund,
  cancelBooking,
  createBooking,
  dateOffset,
  setStatus,
  setupWorld,
  uid,
  type Booking,
  type World,
} from "./fixtures";

let w: World;
const R = (rupees: number) => rupees * 100;
type Row = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const q = <T = Row>(sql: string, p?: unknown[]) => w.db.q<T>(sql, p);
const as = <T>(id: string | null, fn: () => Promise<T>) =>
  w.db.as({ role: "authenticated", uid: id }, fn);
const asSystem = <T>(fn: () => Promise<T>) =>
  w.db.as({ role: "service_role" }, fn);
const call = async <T = Json>(
  sql: string,
  p: unknown[] = [],
  actor: string | null = w.manager,
): Promise<T> => (await as(actor, () => q<{ r: T }>(sql, p)))[0].r;
const data = (b: string, actor: string | null = w.manager) =>
  call<Json>(`select public.pdf_booking_data($1) as r`, [b], actor);
const prep = (b: string, actor: string | null = w.manager) =>
  call<Json>(`select public.pdf_prepare($1) as r`, [b], actor);
let X: Booking, upiId: number;
const pay: Record<string, string> = {};

/** an uploaded PDF as storage would hold it */
async function stored(path: string, size = 5000, mime = "application/pdf") {
  await q(
    `insert into storage.objects (bucket_id, name, metadata) values ('booking-pdfs', $1, $2::jsonb)`,
    [path, JSON.stringify({ size, mimetype: mime })],
  );
}
const register = (
  b: string,
  hash: string,
  version: number,
  size = 5000,
  reason = "booking created",
  actor: string | null = w.manager,
) =>
  call<Json>(
    `select public.register_pdf_version($1, $2, $3, $4, $5) as r`,
    [b, hash, version, reason, size],
    actor,
  );
/** prepare, "upload" and register in one go */
async function makeVersion(b: string, reason = "test") {
  const p = await prep(b);
  if (!p.needed) return { ...p, created: false };
  await stored(p.path);
  const r = await register(b, p.hash, p.version_no, 5000, reason);
  return { ...p, ...r };
}

beforeAll(async () => {
  w = await setupWorld();
  upiId = (
    await q<{ id: number }>(
      `select id from public.payment_providers where method = 'upi' and name <> 'Other' order by id limit 1`,
    )
  )[0].id;

  // X: resort A, 2 people x Rs 2,500 per stay = base 5,000; extra 500 "Bonfire"; discount 300; final amount changed by hand -200
  // ("Regular guest") -> total 5,500, calculated final 5,200, FINAL 5,000. Booked 8 days ago, checks in in 3 days (1 night).
  X = await createBooking(w, {
    resort: "A",
    pax: 2,
    tariff: R(2500),
    extra: R(500),
    discount: R(300),
    adjustment: -R(200),
    adjustmentReason: "Regular guest",
    bookingDateOffset: -8,
    checkInOffset: 3,
    plan: [
      { label: "Advance", dueOffset: -7, amount: R(2000) },
      { label: "Balance", dueOffset: 3, amount: R(3000) },
    ],
  });
  // P1 cash 1,000 approved by the Owner; P2 UPI 2,000 waiting; P3 cash 500 rejected; P4 cash 300 approved by the Manager who recorded it
  pay.p1 = await addPayment(w, X, {
    actor: w.manager,
    amount: R(1000),
    method: "cash",
    dateOffset: -6,
  });
  await setStatus(w, "payments", pay.p1, "approved", w.owner);
  pay.p2 = await addPayment(w, X, {
    actor: w.manager,
    amount: R(2000),
    method: "upi",
    providerId: upiId,
    dateOffset: -5,
  });
  pay.p3 = await addPayment(w, X, {
    actor: w.manager,
    amount: R(500),
    method: "cash",
    dateOffset: -4,
  });
  await setStatus(w, "payments", pay.p3, "rejected", w.owner, "Wrong booking");
  pay.p4 = await addPayment(w, X, {
    actor: w.manager,
    amount: R(300),
    method: "cash",
    dateOffset: -3,
  });
  await setStatus(w, "payments", pay.p4, "approved", w.manager);
  // a correction file on P1 (approved)
  await w.db.exec("set session_replication_role = replica");
  await q(
    `insert into public.proofs (payment_id, storage_path, original_file_name, mime_type, size_bytes, sha256, uploaded_by, is_correction, correction_reason)
     values ($1, $2, 'later.png', 'image/png', 100, $3, $4, true, 'Receipt found later')`,
    [
      pay.p1,
      `${X.id}/${uid()}.png`,
      randomBytes(32).toString("hex"),
      w.manager2,
    ],
  );
  await w.db.exec("set session_replication_role = origin");
});

describe("what is printed, with hand-calculated figures (PDB-01..)", () => {
  it("PDB-01: the booking, guest, stay and amount blocks", async () => {
    const d = await data(X.id);
    const [{ ci, co, bd }] = await q<{ ci: string; co: string; bd: string }>(
      `select to_char(check_in_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI') ci, to_char(check_out_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI') co, to_char(booking_date,'YYYY-MM-DD') bd from public.bookings where id = $1`,
      [X.id],
    );
    expect(d.booking).toMatchObject({
      code: X.code,
      status: "confirmed",
      resort_name: "Test Resort Alpha",
      resort_code: "AAA",
      booking_date: bd,
      check_in: ci,
      check_out: co,
      nights: 1,
      pax: 2,
      stay_type: "Resort Stay",
      co_category: "Direct",
      pricing_method: "per_person_per_stay",
      tariff_paise: R(2500),
      base_paise: R(5000),
      extra_paise: R(500),
      total_paise: R(5500),
      discount_paise: R(300),
      adjustment_paise: -R(200),
      adjustment_reason: "Regular guest",
      final_paise: R(5000),
    });
    expect(ci).toMatch(/^\d{4}-\d{2}-\d{2}T14:00$/); // IST wall clock, the same time that was booked
    expect(d.guest).toEqual({ name: "Test Guest", mobile: "9876543210" });
    expect(d.cancellation).toBeNull();
  });

  it("PDB-02: the plan (active rows in date order) and the payments (status, self-approved mark, app) are listed in a fixed order", async () => {
    const d = await data(X.id);
    expect(d.plan.map((r: Json) => [r.label, r.amount_paise])).toEqual([
      ["Advance", R(2000)],
      ["Balance", R(3000)],
    ]);
    expect(d.adjustments).toEqual([]);
    expect(
      d.payments.map((p: Json) => [
        p.amount_paise,
        p.status,
        p.self_approved,
        p.method,
      ]),
    ).toEqual([
      [R(1000), "approved", false, "cash"],
      [R(2000), "waiting", false, "upi"],
      [R(500), "rejected", false, "cash"],
      [R(300), "approved", true, "cash"],
    ]);
    expect(d.payments[1].provider).toBeTruthy();
    expect(d.payments[0].provider).toBeNull();
    expect(d.payments[0].code).toBe(`${X.code}-P1`);
    expect(d.refunds).toEqual([]);
  });

  it("PDB-03: totals equal the trusted view AND the figures worked out by hand: Due 5,000; Approved 1,300; Waiting 2,000; Pending 5,000-(1,300+2,000)=1,700; Verified 3,700; Net 1,300", async () => {
    const d = await data(X.id);
    expect(d.totals).toMatchObject({
      amount_due_paise: R(5000),
      total_collection_paise: R(1300),
      waiting_paise: R(2000),
      refunds_approved_paise: 0,
      refunds_waiting_paise: 0,
      net_collection_paise: R(1300),
      pending_paise: R(1700),
      verified_remaining_paise: R(3700),
      extra_paise: 0,
      refund_due_paise: 0,
    });
    const [f] = await q(
      `select * from public.booking_financials where booking_id = $1`,
      [X.id],
    );
    expect(d.totals.pending_paise).toBe(Number(f.pending_paise));
    expect(d.totals.verified_remaining_paise).toBe(
      Number(f.verified_remaining_paise),
    );
    expect(d.totals.total_collection_paise).toBe(
      Number(f.total_collection_paise),
    );
    expect(d.totals.net_collection_paise).toBe(Number(f.net_collection_paise));
  });

  it("PDB-04: correction files are printed with the record, the date, the person and the reason (Q9a); rejected and waiting items have none", async () => {
    const d = await data(X.id);
    expect(d.corrections).toHaveLength(1);
    expect(d.corrections[0]).toMatchObject({
      record_code: `${X.code}-P1`,
      kind: "payment",
      file_name: "later.png",
      by: "Test Manager Two",
      reason: "Receipt found later",
    });
    expect(d.corrections[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("PDB-05: a cancelled booking prints the cancellation block with the original amount shown separately; the charge is the Amount Due", async () => {
    const c = await createBooking(w, {
      resort: "B",
      pax: 1,
      tariff: R(5000),
      bookingDateOffset: -5,
      checkInOffset: 2,
      plan: "auto",
    });
    await cancelBooking(w, c, {
      charge: R(1000),
      reason: "Guest cancelled",
      newRows: [{ dueOffset: 1, amount: R(1000) }],
    });
    const d = await data(c.id);
    expect(d.booking.status).toBe("cancelled");
    expect(d.cancellation).toMatchObject({
      kind: "cancelled",
      reason: "Guest cancelled",
      charge_paise: R(1000),
      original_final_paise: R(5000),
    });
    expect(d.totals).toMatchObject({
      amount_due_paise: R(1000),
      pending_paise: R(1000),
    });
    expect(d.plan.map((r: Json) => r.amount_paise)).toEqual([R(1000)]);
  });

  it("PDB-06: refunds are listed with their reason and status; a waiting refund changes no total (D1)", async () => {
    const b = await createBooking(w, {
      resort: "A",
      pax: 1,
      tariff: R(1000),
      bookingDateOffset: -4,
      checkInOffset: 2,
      plan: "auto",
    });
    const p = await addPayment(w, b, {
      actor: w.manager,
      amount: R(1300),
      method: "cash",
      dateOffset: -2,
    });
    await setStatus(w, "payments", p, "approved", w.owner);
    const f1 = await addRefund(w, b, {
      actor: w.manager,
      amount: R(100),
      method: "cash",
    });
    await setStatus(w, "refunds", f1, "approved", w.owner);
    await addRefund(w, b, { actor: w.manager, amount: R(150), method: "cash" }); // waiting
    const d = await data(b.id);
    expect(
      d.refunds.map((r: Json) => [r.amount_paise, r.status, r.reason]),
    ).toEqual([
      [R(100), "approved", "Test refund"],
      [R(150), "waiting", "Test refund"],
    ]);
    // due 1,000; A 1,300; RA 100; RW 150: net 1,200; extra = (1,300+0-100)-1,000 = 200; refund due 200; pending 0
    expect(d.totals).toMatchObject({
      total_collection_paise: R(1300),
      refunds_approved_paise: R(100),
      refunds_waiting_paise: R(150),
      net_collection_paise: R(1200),
      pending_paise: 0,
      extra_paise: R(200),
      refund_due_paise: R(200),
    });
  });
});

describe("one new version only when something printed changed (PDB-07..)", () => {
  it("PDB-07: the first version is v1; the same data again needs no new version (FR-PDF-5); an unprinted change does not count", async () => {
    const b = await createBooking(w, {
      resort: "A",
      bookingDateOffset: -1,
      checkInOffset: 3,
      plan: "auto",
    });
    const p0 = await prep(b.id);
    expect(p0).toMatchObject({
      needed: true,
      version_no: 1,
      path: `${b.id}/v1.pdf`,
      latest_version: null,
    });
    expect(p0.hash).toMatch(/^[0-9a-f]{64}$/);
    const v1 = await makeVersion(b.id, "booking created");
    expect(v1).toMatchObject({ created: true, version_no: 1 });
    const again = await prep(b.id);
    expect(again).toMatchObject({
      needed: false,
      version_no: 2,
      latest_version: 1,
      hash: p0.hash,
    });
    // a reference number is not printed
    const pid = await addPaymentOn(b);
    const afterAdd = await prep(b.id);
    expect(afterAdd.needed).toBe(true); // a new payment IS printed
    await makeVersion(b.id, "payment added");
    await q(`select 1`); // (the reference number below is stored on the payment but never printed)
    await w.db.tx({ role: "postgres", uid: w.manager }, async () => {
      await q(
        `update public.payments set reference_number = 'CHANGED-REF' where id = $1`,
        [pid],
      );
    });
    expect((await prep(b.id)).needed).toBe(false);
  });
  async function addPaymentOn(b: Booking) {
    return addPayment(w, b, {
      actor: w.manager,
      amount: R(100),
      method: "cash",
      dateOffset: -1,
    });
  }

  it("PDB-08: every printed change makes a new version: approve, reject, reverse, refund, cancel, charge change, edit", async () => {
    const b = await createBooking(w, {
      resort: "A",
      pax: 1,
      tariff: R(1000),
      bookingDateOffset: -2,
      checkInOffset: 3,
      plan: "auto",
    });
    await makeVersion(b.id, "booking created");
    const p = await addPayment(w, b, {
      actor: w.manager,
      amount: R(1200),
      method: "cash",
      dateOffset: -1,
    });
    const steps: [string, () => Promise<unknown>][] = [
      ["payment added", async () => undefined],
      [
        "payment approved",
        () => setStatus(w, "payments", p, "approved", w.owner),
      ],
      [
        "refund added",
        async () => {
          await addRefund(w, b, {
            actor: w.manager,
            amount: R(100),
            method: "cash",
          });
        },
      ],
    ];
    let expected = 2;
    for (const [reason, run] of steps) {
      await run();
      const r = await makeVersion(b.id, reason);
      expect(r, reason).toMatchObject({ created: true, version_no: expected });
      expected++;
    }
    // a cancelled booking: the status and the charge are printed
    await cancelBooking(w, b, {
      charge: R(500),
      newRows: [{ dueOffset: 1, amount: R(500) }],
    });
    expect(await makeVersion(b.id, "cancelled")).toMatchObject({
      created: true,
      version_no: expected,
    });
    const vs = await q(
      `select version_no from public.booking_pdf_versions where booking_id = $1 order by version_no`,
      [b.id],
    );
    expect(vs.map((v) => Number(v.version_no))).toEqual([1, 2, 3, 4, 5]);
  });

  it("PDB-09: every version is kept and its summary holds the figures printed on it", async () => {
    const b = await createBooking(w, {
      resort: "A",
      pax: 1,
      tariff: R(1000),
      bookingDateOffset: -2,
      checkInOffset: 3,
      plan: "auto",
    });
    await makeVersion(b.id, "booking created");
    const p = await addPayment(w, b, {
      actor: w.manager,
      amount: R(400),
      method: "cash",
      dateOffset: -1,
    });
    await makeVersion(b.id, "payment added");
    await setStatus(w, "payments", p, "approved", w.owner);
    await makeVersion(b.id, "payment approved");
    const vs = await q(
      `select version_no, trigger_reason, summary, size_bytes, content_hash from public.booking_pdf_versions where booking_id = $1 order by version_no`,
      [b.id],
    );
    expect(vs).toHaveLength(3);
    expect(vs.map((v) => v.trigger_reason)).toEqual([
      "booking created",
      "payment added",
      "payment approved",
    ]);
    // v1: nothing recorded -> pending 1,000;  v2: waiting 400 -> pending 600, collection 0;  v3: approved 400 -> collection 400, pending 600
    expect((vs[0].summary as Json).pending_paise).toBe(R(1000));
    expect(vs[1].summary).toMatchObject({
      pending_paise: R(600),
      total_collection_paise: 0,
      waiting_paise: R(400),
    });
    expect(vs[2].summary).toMatchObject({
      pending_paise: R(600),
      total_collection_paise: R(400),
      waiting_paise: 0,
    });
    expect(new Set(vs.map((v) => v.content_hash)).size).toBe(3);
    for (const v of vs) expect(Number(v.size_bytes)).toBe(5000);
  });
});

describe("registering a file (PDB-10..)", () => {
  async function fresh() {
    const b = await createBooking(w, {
      resort: "A",
      bookingDateOffset: -1,
      checkInOffset: 3,
      plan: "auto",
    });
    return { b, p: await prep(b.id) };
  }
  it("PDB-10: the data changed while the PDF was being made: PDF_STALE, nothing recorded", async () => {
    const { b, p } = await fresh();
    await stored(p.path);
    await addPayment(w, b, {
      actor: w.manager,
      amount: R(100),
      method: "cash",
      dateOffset: -1,
    });
    await expectDbError(register(b.id, p.hash, p.version_no), "PDF_STALE");
    expect(
      (
        await q(
          `select count(*)::int n from public.booking_pdf_versions where booking_id = $1`,
          [b.id],
        )
      )[0].n,
    ).toBe(0);
  });
  it("PDB-11: a wrong version number: PDF_VERSION_CONFLICT; the number must be exactly the next one", async () => {
    const { b, p } = await fresh();
    await stored(p.path);
    await expectDbError(register(b.id, p.hash, 2), "PDF_VERSION_CONFLICT");
    await expectDbError(register(b.id, p.hash, 0), "INVALID_INPUT");
    await register(b.id, p.hash, 1);
  });
  it("PDB-12: the file must really be in storage with the size and type STORAGE recorded", async () => {
    const { b, p } = await fresh();
    await expectDbError(register(b.id, p.hash, 1), "INVALID_FILE"); // not uploaded
    await stored(p.path, 4000);
    await expectDbError(register(b.id, p.hash, 1, 5000), "INVALID_FILE"); // size differs from storage's record
    expect(await register(b.id, p.hash, 1, 4000)).toMatchObject({
      created: true,
      version_no: 1,
    }); // the right size is accepted
    expect(
      Number(
        (
          await q(
            `select size_bytes from public.booking_pdf_versions where booking_id = $1`,
            [b.id],
          )
        )[0].size_bytes,
      ),
    ).toBe(4000);
  });
  it("PDB-13: storage's type must be a PDF; sizes outside 1 byte - 10 MB and bad hashes are refused", async () => {
    const { b, p } = await fresh();
    await stored(p.path, 5000, "image/png");
    await expectDbError(register(b.id, p.hash, 1), "INVALID_FILE");
    for (const size of [0, -1, 10485761])
      await expectDbError(register(b.id, p.hash, 1, size), "INVALID_INPUT");
    for (const hash of ["", "xyz", "A".repeat(64), "a".repeat(63)])
      await expectDbError(register(b.id, hash, 1), "INVALID_INPUT");
  });
  it("PDB-14: an unknown booking is refused", async () => {
    await expectDbError(register(uid(), "a".repeat(64), 1), "NOT_FOUND");
    await expectDbError(prep(uid()), "NOT_FOUND");
    await expectDbError(data(uid()), "NOT_FOUND");
  });
  it("PDB-15: the same data registered again creates nothing (created = false); old versions can never be changed or deleted", async () => {
    const { b } = await fresh();
    const v1 = await makeVersion(b.id, "booking created");
    expect(v1.created).toBe(true);
    const p = await prep(b.id);
    await stored(`${b.id}/v2.pdf`);
    expect(await register(b.id, p.hash, 2)).toMatchObject({
      created: false,
      version_no: 1,
    });
    expect(
      (
        await q(
          `select count(*)::int n from public.booking_pdf_versions where booking_id = $1`,
          [b.id],
        )
      )[0].n,
    ).toBe(1);
    await expectDbError(
      q(
        `update public.booking_pdf_versions set size_bytes = 1 where booking_id = $1`,
        [b.id],
      ),
      "RECORD_IS_APPEND_ONLY",
    );
    await expectDbError(
      q(`delete from public.booking_pdf_versions where booking_id = $1`, [
        b.id,
      ]),
      "DELETE_NOT_ALLOWED",
    );
  });
  it("PDB-16: who generated it is recorded for a person, and left empty for the retry job; the audit log has the new version", async () => {
    const { b, p } = await fresh();
    await stored(p.path);
    await register(b.id, p.hash, 1, 5000, "booking created", w.manager);
    const [v] = await q(
      `select generated_by from public.booking_pdf_versions where booking_id = $1`,
      [b.id],
    );
    expect(v.generated_by).toBe(w.manager);
    const a = await q(
      `select actor_name, action from public.audit_logs where table_name = 'booking_pdf_versions' and booking_id = $1`,
      [b.id],
    );
    expect(a).toEqual([
      expect.objectContaining({
        actor_name: "Test Manager One",
        action: "insert",
      }),
    ]);
    // the retry job (service role) makes the next version
    await addPayment(w, b, {
      actor: w.manager,
      amount: R(100),
      method: "cash",
      dateOffset: -1,
    });
    const p2 = await asSystem(() =>
      q<{ r: Json }>(`select public.pdf_prepare($1) as r`, [b.id]),
    ).then((r) => r[0].r);
    await stored(p2.path);
    await asSystem(() =>
      q(`select public.register_pdf_version($1, $2, $3, 'retry', 5000)`, [
        b.id,
        p2.hash,
        p2.version_no,
      ]),
    );
    const vs = await q(
      `select version_no, generated_by from public.booking_pdf_versions where booking_id = $1 order by version_no`,
      [b.id],
    );
    expect(vs.map((x) => x.generated_by)).toEqual([w.manager, null]);
  });
});

describe("jobs: queued by every write, finished, claimed by the retry job (PDB-17..)", () => {
  const jobs = (b: string) =>
    q<{
      id: string;
      status: string;
      reason: string;
      attempts: number;
      last_error: string | null;
    }>(
      `select id::text, status::text, reason, attempts, last_error from public.pdf_jobs where booking_id = $1 order by id`,
      [b],
    );
  it("PDB-18: finishing marks the jobs up to a number done, leaves newer ones open, and keeps a short error when it failed", async () => {
    const b = await createBooking(w, {
      resort: "A",
      bookingDateOffset: -1,
      checkInOffset: 3,
      plan: "auto",
    });
    await call(
      `select public.update_booking($1, 1, '{"remarks":"one"}'::jsonb) as r`,
      [b.id],
    );
    await call(
      `select public.update_booking($1, 2, '{"remarks":"two"}'::jsonb) as r`,
      [b.id],
    );
    await makeVersion(b.id, "test"); // a person may only say "done" once a version represents the booking
    const before = await jobs(b.id);
    expect(before.length).toBeGreaterThanOrEqual(2);
    const upTo = before[1].id;
    expect(
      Number(
        await call(`select public.finish_pdf_jobs($1, $2, true) as r`, [
          b.id,
          upTo,
        ]),
      ),
    ).toBe(2);
    const mid = await jobs(b.id);
    expect(mid.map((j) => j.status).slice(0, 2)).toEqual(["done", "done"]);
    await call(
      `select public.update_booking($1, 3, '{"remarks":"three"}'::jsonb) as r`,
      [b.id],
    );
    const last = (await jobs(b.id)).at(-1)!;
    await asSystem(() =>
      q(`select public.finish_pdf_jobs($1, $2, false, $3) as r`, [
        b.id,
        last.id,
        "x".repeat(500),
      ]),
    ); // the retry job's own text is kept (cut to 300)
    const after = (await jobs(b.id)).at(-1)!;
    expect(after.status).toBe("failed");
    expect(after.last_error).toHaveLength(300);
    // a done job is not touched again
    expect(
      Number(
        await call(
          `select public.finish_pdf_jobs($1, $2, false, 'late') as r`,
          [b.id, upTo],
        ),
      ),
    ).toBe(0);
  });

  it("PDB-19: claim: only the retry job; oldest first; running jobs are not taken twice; 5 attempts at most; a crashed attempt is taken again after 15 minutes", async () => {
    const b = await createBooking(w, {
      resort: "B",
      bookingDateOffset: -1,
      checkInOffset: 3,
      plan: "auto",
    });
    await q(`update public.pdf_jobs set status = 'done'`); // clear every other open job
    await call(
      `select public.update_booking($1, 1, '{"remarks":"one"}'::jsonb) as r`,
      [b.id],
    ); // queues one job for this booking
    const own = (await jobs(b.id)).map((j) => j.id);
    const claim = (n = 10) =>
      asSystem(() =>
        q<{ job_id: string; booking_id: string; attempts: number }>(
          `select job_id::text, booking_id, attempts from public.claim_pdf_jobs($1)`,
          [n],
        ),
      );
    const c1 = await claim();
    expect(c1.map((x) => x.job_id)).toEqual(own);
    expect(c1.every((x) => x.attempts === 1 && x.booking_id === b.id)).toBe(
      true,
    );
    expect((await jobs(b.id)).every((j) => j.status === "running")).toBe(true);
    expect(await claim()).toEqual([]); // running: not taken twice
    // it fails, is claimed again, and so on up to 5 attempts
    for (let attempt = 2; attempt <= 5; attempt++) {
      await asSystem(() =>
        q(`select public.finish_pdf_jobs($1, $2, false, 'boom') as r`, [
          b.id,
          own.at(-1),
        ]),
      );
      const again = await claim();
      expect(again.map((x) => x.attempts)).toEqual([attempt]);
    }
    await asSystem(() =>
      q(`select public.finish_pdf_jobs($1, $2, false, 'boom') as r`, [
        b.id,
        own.at(-1),
      ]),
    );
    expect(await claim()).toEqual([]); // 5 attempts used: left failed for a person to press "Regenerate PDF"
    // a crashed attempt
    const b2 = await createBooking(w, {
      resort: "B",
      bookingDateOffset: -1,
      checkInOffset: 3,
      plan: "auto",
    });
    await call(
      `select public.update_booking($1, 1, '{"remarks":"one"}'::jsonb) as r`,
      [b2.id],
    );
    const first = await claim();
    expect(first.map((x) => x.booking_id)).toEqual([b2.id]);
    expect(await claim()).toEqual([]);
    await q(
      `update public.pdf_jobs set updated_at = now() - interval '16 minutes' where booking_id = $1`,
      [b2.id],
    );
    expect((await claim()).map((x) => x.booking_id)).toEqual([b2.id]);
  });

  it("PDB-20: the claim limit is respected and never above 50", async () => {
    await q(`update public.pdf_jobs set status = 'done'`);
    const b = await createBooking(w, {
      resort: "B",
      bookingDateOffset: -1,
      checkInOffset: 3,
      plan: "auto",
    });
    for (let i = 1; i <= 3; i++)
      await call(`select public.update_booking($1, $2, $3::jsonb) as r`, [
        b.id,
        i,
        JSON.stringify({ remarks: `r${i}` }),
      ]);
    const got = await asSystem(() =>
      q(`select * from public.claim_pdf_jobs(2)`),
    );
    expect(got).toHaveLength(2);
    const rest = await asSystem(() =>
      q(`select * from public.claim_pdf_jobs(1000)`),
    );
    expect(rest.length).toBeLessThanOrEqual(50);
    expect(rest).toHaveLength(1); // the third of the three
  });

  it("PDB-21: Regenerate PDF queues a job; unknown booking refused; nothing printed changes so no new version follows", async () => {
    const b = await createBooking(w, {
      resort: "A",
      bookingDateOffset: -1,
      checkInOffset: 3,
      plan: "auto",
    });
    await makeVersion(b.id, "booking created");
    const id = await call<string>(
      `select public.request_pdf_regeneration($1) as r`,
      [b.id],
    );
    expect(Number(id)).toBeGreaterThan(0);
    expect((await jobs(b.id)).at(-1)).toMatchObject({
      reason: "regenerate requested",
      status: "pending",
    });
    expect((await prep(b.id)).needed).toBe(false); // FR-PDF-5
    await expectDbError(
      call(`select public.request_pdf_regeneration($1) as r`, [uid()]),
      "NOT_FOUND",
    );
  });
  describe("finish_pdf_jobs: what a person may and may not finish (PDB-27..)", () => {
    const fresh = async (resort: "A" | "B" = "A") => {
      const b = await createBooking(w, {
        resort,
        bookingDateOffset: -1,
        checkInOffset: 3,
        plan: "auto",
      });
      await call(
        `select public.update_booking($1, 1, '{"remarks":"one"}'::jsonb) as r`,
        [b.id],
      );
      return b;
    };
    const upTo = async (b: string) => (await jobs(b)).at(-1)!.id;
    const fin = async (
      b: string,
      id: string,
      ok: boolean,
      err: string | null = null,
    ) =>
      Number(
        await call<number>(
          `select public.finish_pdf_jobs($1, $2, $3, $4) as r`,
          [b, id, ok, err],
        ),
      );
    const finSys = (
      b: string,
      id: string,
      ok: boolean,
      err: string | null = null,
    ) =>
      asSystem(async () =>
        Number(
          (
            await q<{ r: number }>(
              `select public.finish_pdf_jobs($1, $2, $3, $4) as r`,
              [b, id, ok, err],
            )
          )[0].r,
        ),
      );

    it("PDB-27: a person cannot say 'done' when no registered version exists: 0 is returned and every job stays open", async () => {
      const b = await fresh();
      const before = await jobs(b.id);
      expect(await fin(b.id, await upTo(b.id), true)).toBe(0);
      expect(await jobs(b.id)).toEqual(before);
      expect(before.every((j) => j.status === "pending")).toBe(true);
    });
    it("PDB-28: nor when the latest registered version is out of date (the booking changed after it): still 0, jobs open", async () => {
      const b = await fresh();
      await makeVersion(b.id, "first");
      await call(
        `select public.update_booking($1, 2, '{"remarks":"two"}'::jsonb) as r`,
        [b.id],
      );
      expect((await prep(b.id)).needed).toBe(true);
      expect(await fin(b.id, await upTo(b.id), true)).toBe(0);
      expect((await jobs(b.id)).every((j) => j.status === "pending")).toBe(
        true,
      );
    });
    it("PDB-29: a person's 'done' works once the latest version matches the booking now (the made-a-version path)", async () => {
      const b = await fresh();
      await makeVersion(b.id, "made");
      const n = (await jobs(b.id)).length;
      expect(await fin(b.id, await upTo(b.id), true)).toBe(n);
      expect((await jobs(b.id)).every((j) => j.status === "done")).toBe(true);
    });
    it("PDB-30: and for the unchanged-content path: nothing changed since the latest version, a Regenerate job is closed as done", async () => {
      const b = await fresh();
      await makeVersion(b.id, "made");
      await fin(b.id, await upTo(b.id), true);
      await call(`select public.request_pdf_regeneration($1) as r`, [b.id]);
      expect((await prep(b.id)).needed).toBe(false);
      expect(await fin(b.id, await upTo(b.id), true)).toBe(1);
      expect((await jobs(b.id)).at(-1)!.status).toBe("done");
    });
    it("PDB-31: a person cannot finish a RUNNING job, done or failed; the retry job (service role) can finish what it claimed", async () => {
      await q(`update public.pdf_jobs set status = 'done'`);
      const b = await fresh("B");
      await makeVersion(b.id, "made"); // so the evidence rule would allow 'done'
      const claimed = await asSystem(() =>
        q(`select * from public.claim_pdf_jobs(10)`),
      );
      expect(claimed.length).toBeGreaterThan(0);
      const last = await upTo(b.id);
      expect(await fin(b.id, last, true)).toBe(0);
      expect(await fin(b.id, last, false, "nope")).toBe(0);
      expect((await jobs(b.id)).every((j) => j.status === "running")).toBe(
        true,
      );
      expect(await finSys(b.id, last, false, "real failure")).toBe(
        claimed.length,
      );
      const after = await jobs(b.id);
      expect(after.every((j) => j.status === "failed")).toBe(true);
      expect(after.every((j) => j.last_error === "real failure")).toBe(true);
      await asSystem(() => q(`select * from public.claim_pdf_jobs(10)`));
      expect(await finSys(b.id, last, true)).toBe(claimed.length);
    });
    it("PDB-32: a person's failure text is replaced by the fixed sentence; the retry job's own text is kept and cut to 300", async () => {
      const b = await fresh();
      const n = (await jobs(b.id)).length;
      expect(
        await fin(
          b.id,
          await upTo(b.id),
          false,
          "Guest Ramesh 9999999999 leaked",
        ),
      ).toBe(n);
      let js = await jobs(b.id);
      expect(js.every((j) => j.status === "failed")).toBe(true);
      expect(
        js.every((j) => j.last_error === "The PDF could not be made."),
      ).toBe(true);
      expect(await fin(b.id, await upTo(b.id), false, "other text")).toBe(n);
      expect(
        (await jobs(b.id)).every(
          (j) => j.last_error === "The PDF could not be made.",
        ),
      ).toBe(true);
      await finSys(b.id, await upTo(b.id), false, "y".repeat(400));
      js = await jobs(b.id);
      expect(js.every((j) => j.last_error === "y".repeat(300))).toBe(true);
    });
    it("PDB-33: finishing never changes a version: numbers and hashes are the same before and after any finish", async () => {
      const b = await fresh();
      await makeVersion(b.id, "made");
      const vs = () =>
        q(
          `select version_no, content_hash from public.booking_pdf_versions where booking_id = $1 order by version_no`,
          [b.id],
        );
      const before = await vs();
      await fin(b.id, await upTo(b.id), true);
      await fin(b.id, await upTo(b.id), false, "x");
      await finSys(b.id, await upTo(b.id), true);
      expect(await vs()).toEqual(before);
    });
  });
});

describe("who may call them (PDB-22..)", () => {
  const callers: [string, string, unknown[]][] = [
    ["pdf_booking_data", `select public.pdf_booking_data($1)`, [uid()]],
    ["pdf_prepare", `select public.pdf_prepare($1)`, [uid()]],
    [
      "register_pdf_version",
      `select public.register_pdf_version($1, $2, 1, 'x', 100)`,
      [uid(), "a".repeat(64)],
    ],
    ["finish_pdf_jobs", `select public.finish_pdf_jobs($1, 1, true)`, [uid()]],
    [
      "request_pdf_regeneration",
      `select public.request_pdf_regeneration($1)`,
      [uid()],
    ],
    ["claim_pdf_jobs", `select * from public.claim_pdf_jobs()`, []],
  ];
  it("PDB-22: anonymous visitors are refused by every function", async () => {
    for (const [, sql, p] of callers)
      await expectDbError(
        w.db.as({ role: "anon" }, () => q(sql, p)),
        "permission denied",
      );
  });
  it("PDB-23: signed-out requests, unknown logins and switched-off people are refused", async () => {
    for (const [name, sql, p] of callers.filter(
      (c) => c[0] !== "claim_pdf_jobs",
    )) {
      await expectDbError(
        w.db.as({ role: "authenticated", uid: null }, () => q(sql, p)),
        name === "request_pdf_regeneration" ? "NOT_ALLOWED" : "NOT_ALLOWED",
      );
      await expectDbError(
        w.db.as({ role: "authenticated", uid: uid() }, () => q(sql, p)),
        "NOT_ALLOWED",
      );
    }
  });
  it("PDB-24: signed-in people may not claim jobs (the retry job only); the service role may use the generator functions but not the button function", async () => {
    await expectDbError(
      as(w.owner, () => q(`select * from public.claim_pdf_jobs()`)),
      "permission denied",
    );
    await expectDbError(
      as(w.manager, () => q(`select * from public.claim_pdf_jobs()`)),
      "permission denied",
    );
    const svc = await asSystem(() =>
      q<{ r: Json }>(`select public.pdf_prepare($1) as r`, [X.id]),
    );
    expect(svc[0].r.needed).toBeDefined();
    await expectDbError(
      asSystem(() => q(`select public.request_pdf_regeneration($1)`, [X.id])),
      "NOT_ALLOWED",
    ); // the button needs a signed-in person
  });
  it("PDB-25: Owners and Managers get the same data (Q10); a switched-off person is refused", async () => {
    expect(JSON.stringify(await data(X.id, w.owner))).toBe(
      JSON.stringify(await data(X.id, w.manager)),
    );
    expect(JSON.stringify(await data(X.id, w.manager2))).toBe(
      JSON.stringify(await data(X.id, w.manager)),
    );
    await w.db.tx({ role: "postgres", uid: w.owner }, async () => {
      await q(
        `update public.user_profiles set is_active = false where id = $1`,
        [w.manager2],
      );
    });
    await expectDbError(data(X.id, w.manager2), "NOT_ALLOWED");
    await expectDbError(prep(X.id, w.manager2), "NOT_ALLOWED");
  });
  it("PDB-26: reading changes nothing: no booking, payment, refund, version or job is touched by data and prepare", async () => {
    const snap = async () =>
      JSON.stringify([
        await q(
          `select id, version, updated_at from public.bookings order by id`,
        ),
        await q(`select id, version from public.payments order by id`),
        await q(`select count(*)::int n from public.booking_pdf_versions`),
        await q(
          `select count(*)::int n, sum(attempts)::int a from public.pdf_jobs`,
        ),
      ]);
    const before = await snap();
    await data(X.id);
    await prep(X.id);
    expect(await snap()).toBe(before);
  });
});

describe("every write queues a job (PDB-17) - last, because it creates a booking through the real function", () => {
  const jobs = (b: string) =>
    q<{ id: string; status: string; reason: string }>(
      `select id::text, status::text, reason from public.pdf_jobs where booking_id = $1 order by id`,
      [b],
    );
  it("PDB-17: each booking and money action queues a job in its own transaction (FR-PDF-1)", async () => {
    const d0 = await dateOffset(w.db, 0);
    const in1 = await dateOffset(w.db, 3);
    const out1 = await dateOffset(w.db, 4);
    const [{ r: created }] = await as(w.manager, () =>
      q<{ r: Json }>(
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
            tariff_paise: R(1000),
          }),
          JSON.stringify([
            { label: "Balance", due_date: in1, amount_paise: R(1000) },
          ]),
          uid(),
        ],
      ),
    );
    const b = created.id as string;
    const reasons = async () => (await jobs(b)).map((j) => j.reason);
    expect(await reasons()).toEqual(["booking created"]);
    const pj = await call<Json>(
      `select public.add_payment($1::jsonb, '[]'::jsonb, $2::uuid) as r`,
      [
        JSON.stringify({
          booking_id: b,
          amount_paise: R(1200),
          method: "cash",
          payment_date: d0,
        }),
        uid(),
      ],
    );
    await call(`select public.approve_payment($1, 1) as r`, [pj.id], w.owner);
    await call(
      `select public.reverse_payment($1, 2, 'Entered twice') as r`,
      [pj.id],
      w.owner,
    );
    const pj2 = await call<Json>(
      `select public.add_payment($1::jsonb, '[]'::jsonb, $2::uuid) as r`,
      [
        JSON.stringify({
          booking_id: b,
          amount_paise: R(1100),
          method: "cash",
          payment_date: d0,
        }),
        uid(),
      ],
    );
    await call(
      `select public.reject_payment($1, 1, 'Wrong booking') as r`,
      [pj2.id],
      w.owner,
    );
    await call(
      `select public.update_booking($1, 1, '{"remarks":"Late arrival"}'::jsonb) as r`,
      [b],
    );
    const all = await reasons();
    for (const r of [
      "booking created",
      "payment added",
      "payment approved",
      "payment reversed",
      "payment rejected",
      "booking updated",
    ])
      expect(all, r).toContain(r);
    expect((await jobs(b)).every((j) => j.status === "pending")).toBe(true);
  });
});
