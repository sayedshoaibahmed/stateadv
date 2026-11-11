/**
 * Guard branches found untested during the pre-push review (2026-11-11).
 * Fictional data only.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { expectDbError } from "./harness";
import {
  addPayment,
  createBooking,
  setupWorld,
  uid,
  type World,
} from "./fixtures";

let w: World;
beforeAll(async () => {
  w = await setupWorld();
}, 120_000);

const q = <T = Record<string, unknown>>(sql: string, p?: unknown[]) =>
  w.db.q<T>(sql, p);
const asUser = <T>(id: string | null, fn: () => Promise<T>) =>
  w.db.as({ role: "postgres", uid: id }, fn);
const tx = <T>(id: string, fn: () => Promise<T>) =>
  w.db.tx({ role: "postgres", uid: id }, fn);

describe("who and when are never misattributed", () => {
  it("a change with no logged-in person leaves updated_by EMPTY (system), not the previous editor", async () => {
    // a person edits first ...
    await asUser(w.manager, () =>
      q(`update public.guests set notes = 'edited by a person' where id = $1`, [
        w.guestId,
      ]),
    );
    const [p1] = await q<{ updated_by: string | null }>(
      `select updated_by from public.guests where id = $1`,
      [w.guestId],
    );
    expect(p1.updated_by).toBe(w.manager);
    // ... then a system (no session) edit must not still say the manager did it
    await q(
      `update public.guests set notes = 'edited by the system' where id = $1`,
      [w.guestId],
    );
    const [p2] = await q<{ updated_by: string | null }>(
      `select updated_by from public.guests where id = $1`,
      [w.guestId],
    );
    expect(p2.updated_by).toBeNull();
  });
});

describe("account creation and booking cancellation need a real session", () => {
  it("a new account must be created active", async () => {
    const id = uid();
    await q(
      `insert into auth.users (id, email) values ($1, 'inactive@test.example')`,
      [id],
    );
    await expectDbError(
      asUser(w.owner, () =>
        q(
          `insert into public.user_profiles (id, full_name, email, is_active) values ($1, 'Test Inactive', 'inactive@test.example', false)`,
          [id],
        ),
      ),
      "NEW_USER_MUST_BE_ACTIVE",
    );
  });

  it("a booking cannot be cancelled without a logged-in user (nobody to record as the canceller)", async () => {
    const b = await createBooking(w);
    await expectDbError(
      q(
        `update public.bookings set status = 'cancelled', cancellation_reason = 'x', cancellation_date = public.today_ist(), cancellation_charge_paise = 0 where id = $1`,
        [b.id],
      ),
      "NOT_AUTHENTICATED",
    );
  });
});

describe("the screenshot rule also applies when a waiting payment is edited", () => {
  it("changing a waiting CASH payment to UPI without a file is refused at commit", async () => {
    const b = await createBooking(w);
    const pid = await addPayment(w, b, { method: "cash" });
    await expectDbError(
      tx(w.owner, () =>
        q(`update public.payments set method = 'upi' where id = $1`, [pid]),
      ),
      "PROOF_REQUIRED",
    );
    const [{ method }] = await q<{ method: string }>(
      `select method from public.payments where id = $1`,
      [pid],
    );
    expect(method).toBe("cash"); // nothing was saved
  });
});

describe("PDF versions, PDF jobs and system status", () => {
  it("each PDF version number exists once per booking; versions are permanent", async () => {
    const b = await createBooking(w);
    const ins = (n: number, path: string) =>
      q(
        `insert into public.booking_pdf_versions (booking_id, version_no, storage_path, content_hash, trigger_reason, summary)
         values ($1, $2, $3, $4, 'booking_created', '{"final_paise": 500000}')`,
        [b.id, n, path, "d".repeat(64)],
      );
    await ins(1, `${b.id}/v1.pdf`);
    await expectDbError(
      ins(1, `${b.id}/v1-again.pdf`),
      "booking_pdf_versions_no_key",
    );
    await expectDbError(
      ins(2, `${b.id}/v1.pdf`),
      "booking_pdf_versions_path_key",
    );
    await expectDbError(
      q(
        `update public.booking_pdf_versions set trigger_reason = 'x' where booking_id = $1`,
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

  it("PDF jobs can move from pending to done but are never deleted", async () => {
    const b = await createBooking(w);
    const [job] = await q<{ id: string }>(
      `insert into public.pdf_jobs (booking_id, reason) values ($1, 'booking_created') returning id`,
      [b.id],
    );
    await q(
      `update public.pdf_jobs set status = 'done', attempts = 1 where id = $1`,
      [job.id],
    );
    await expectDbError(
      q(`delete from public.pdf_jobs where id = $1`, [job.id]),
      "DELETE_NOT_ALLOWED",
    );
  });

  it("system status can be updated but not deleted", async () => {
    await q(
      `insert into public.system_status (key, value) values ('last_backup', '{"at": "2026-01-01"}')`,
    );
    await q(
      `update public.system_status set value = '{"at": "2026-01-02"}' where key = 'last_backup'`,
    );
    await expectDbError(
      q(`delete from public.system_status where key = 'last_backup'`),
      "DELETE_NOT_ALLOWED",
    );
  });
});

describe("a stored file name can be used once", () => {
  it("two proof records cannot point at the same file", async () => {
    const b = await createBooking(w);
    const p1 = await addPayment(w, b, { method: "cash" });
    const p2 = await addPayment(w, b, { method: "cash" });
    const path = `${b.id}/${uid()}.jpg`;
    const ins = (pid: string, sha: string) =>
      tx(w.owner, () =>
        q(
          `insert into public.proofs (payment_id, storage_path, mime_type, size_bytes, sha256, uploaded_by) values ($1, $2, 'image/jpeg', 10, $3, $4)`,
          [pid, path, sha, w.owner],
        ),
      );
    await ins(p1, "e".repeat(64));
    await expectDbError(ins(p2, "f".repeat(64)), "proofs_path_key");
  });
});
