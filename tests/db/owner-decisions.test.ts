/**
 * Owner decisions of 2026-11-11 (DATABASE_SCHEMA 5a). One test group per decision (DEC-1 .. DEC-5).
 * Runs on PGlite and on real PostgreSQL 17; the simultaneous-request versions are in concurrency.pg.test.ts.
 * Fictional data only.
 */
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { expectDbError } from "./harness";
import { dateOffset, reauth, setupWorld, uid, type World } from "./fixtures";

let w: World;
beforeAll(async () => {
  w = await setupWorld();
}, 120_000);

// Test helper: rows and JSON results are inspected loosely on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const j = (x: unknown) => JSON.stringify(x);
const q = <T = Json>(sql: string, p?: unknown[]) => w.db.q<T>(sql, p);
const call = <T = Json>(
  sql: string,
  p?: unknown[],
  actor: string | null = w.manager,
) => w.db.as({ role: "authenticated", uid: actor }, () => q<T>(sql, p));

async function newBooking(
  final = 500000,
): Promise<{ id: string; version: number }> {
  const in1 = await dateOffset(w.db, 2);
  const p = {
    resort_id: w.resorts.A.id,
    guest_id: w.guestId,
    pax: 2,
    co_category_id: w.cat.direct,
    stay_type_id: w.stayTypeId,
    booking_date: await dateOffset(w.db, 0),
    check_in_at: `${in1}T14:00:00+05:30`,
    check_out_at: `${await dateOffset(w.db, 3)}T11:00:00+05:30`,
    pricing_method: "per_person_per_stay",
    tariff_paise: final / 2,
  };
  const r = await call<{ r: Json }>(
    `select public.create_booking($1::jsonb, $2::jsonb, $3::uuid) as r`,
    [
      j(p),
      j([{ label: "Balance", due_date: in1, amount_paise: final }]),
      uid(),
    ],
  );
  return { id: r[0].r.id, version: 1 };
}
async function addPayment(
  b: string,
  amount: number,
  over: Json = {},
  files: Json[] | null = null,
) {
  const out = await call<{ r: Json }>(
    `select public.add_payment($1::jsonb, $2::jsonb, $3::uuid) as r`,
    [
      j({
        booking_id: b,
        amount_paise: amount,
        method: "cash",
        payment_date: await dateOffset(w.db, 0),
        ...over,
      }),
      files ? j(files) : null,
      uid(),
    ],
  );
  return out[0].r;
}
const approvePay = (id: string) =>
  call(`select public.approve_payment($1, 1)`, [id], w.owner);
async function addRefund(b: string, amount: number, over: Json = {}) {
  const out = await call<{ r: Json }>(
    `select public.add_refund($1::jsonb, null, $2::uuid) as r`,
    [
      j({
        booking_id: b,
        amount_paise: amount,
        method: "cash",
        refund_date: await dateOffset(w.db, 0),
        reason: "Guest overpaid",
        ...over,
      }),
      uid(),
    ],
  );
  return out[0].r;
}
async function cancel(b: string, charge: number, plan = true) {
  const rows =
    charge > 0 && plan
      ? [
          {
            label: "Cancellation charge",
            due_date: await dateOffset(w.db, 1),
            amount_paise: charge,
          },
        ]
      : [];
  await call(
    `select public.cancel_booking($1, 1, 'cancelled', null, $2, 'Guest cancelled', null, $3::jsonb)`,
    [b, charge, j(rows)],
  );
}
/** A booking with approved money A, amount due D, and the chosen state. */
async function booking(
  state: "active" | "cancelled",
  due: number,
  held: number,
) {
  const b = await newBooking(due);
  const p = await addPayment(b.id, held);
  await approvePay(p.id);
  if (state === "cancelled") await cancel(b.id, due); // charge = D, so D is the same number in both states
  return b.id;
}
const fin = async (b: string) =>
  (
    await q(`select * from public.booking_financials where booking_id = $1`, [
      b,
    ])
  )[0];
const file = async (b: string) => {
  const path = `${b}/${uid()}.png`;
  await q(
    `insert into storage.objects (bucket_id, name, metadata) values ('payment-proofs', $1, $2::jsonb)`,
    [path, j({ size: 1000, mimetype: "image/png" })],
  );
  return {
    storage_path: path,
    original_file_name: "a.png",
    mime_type: "image/png",
    size_bytes: 1000,
    sha256: randomBytes(32).toString("hex"),
  };
};

// ======================================================================= DEC-1
describe("DEC-1 payments on cancelled / no-show bookings", () => {
  it("DEC-1a: allowed while an unpaid charge remains; an amount above it is a WARNING, never a block", async () => {
    const b = await newBooking();
    await cancel(b.id, 100000);
    const ok = await addPayment(b.id, 100000);
    expect(ok.warnings).toEqual([]);
    const c = await newBooking();
    await cancel(c.id, 100000);
    const over = await addPayment(c.id, 150000); // above the 100000 charge
    expect(over.warnings.map((x: Json) => x.code)).toEqual([
      "ABOVE_AMOUNT_DUE",
    ]);
    expect(
      (await q(`select 1 from public.payments where id = $1`, [over.id]))
        .length,
    ).toBe(1);
  });
  it("DEC-1b: refused when no unpaid charge remains (charge zero, or already covered by recorded payments)", async () => {
    const free = await newBooking();
    await cancel(free.id, 0);
    await expectDbError(addPayment(free.id, 1000), "PAYMENT_ON_CANCELLED");
    const covered = await newBooking();
    await cancel(covered.id, 100000);
    await addPayment(covered.id, 100000);
    await expectDbError(addPayment(covered.id, 1000), "PAYMENT_ON_CANCELLED");
  });
});

// ======================================================================= DEC-2
describe("DEC-2 booking status steps", () => {
  const st = (id: string, v: number, s: string, reason: string | null = null) =>
    call<{ r: Json }>(
      `select public.set_booking_status($1, $2, $3::public.booking_status, $4) as r`,
      [id, v, s, reason],
    );

  it("DEC-2a: going forward needs no reason (a reason, if given, must be 5+ characters)", async () => {
    const b = await newBooking();
    await st(b.id, 1, "checked_in");
    await expectDbError(st(b.id, 2, "checked_out", "abcd"), "REASON_REQUIRED");
    await st(b.id, 2, "checked_out", "  Left early  ");
    expect(
      (
        await q(`select status::text s from public.bookings where id = $1`, [
          b.id,
        ])
      )[0].s,
    ).toBe("checked_out");
  });
  it("DEC-2b: UNDOING a step needs a reason of 5+ trimmed characters (both undo steps)", async () => {
    const b = await newBooking();
    await st(b.id, 1, "checked_in");
    await st(b.id, 2, "checked_out");
    for (const bad of [null, "", "     ", "abcd", "  abcd  "]) {
      await expectDbError(st(b.id, 3, "checked_in", bad), "REASON_REQUIRED");
    }
    await st(b.id, 3, "checked_in", "Marked by mistake");
    for (const bad of [null, "abcd"])
      await expectDbError(st(b.id, 4, "confirmed", bad), "REASON_REQUIRED");
    await st(b.id, 4, "confirmed", "Guest has not arrived");
    expect(
      (
        await q(`select status::text s from public.bookings where id = $1`, [
          b.id,
        ])
      )[0].s,
    ).toBe("confirmed");
  });
  it("DEC-2c: the action, the reason and the person are in the audit history", async () => {
    const b = await newBooking();
    await st(b.id, 1, "checked_in");
    await st(b.id, 2, "confirmed", "Clicked check-in by mistake");
    const a = await q<{
      action: string;
      reason: string | null;
      actor_id: string;
      changed_fields: string[];
      old_data: Json;
      new_data: Json;
    }>(
      `select action, reason, actor_id, changed_fields, old_data, new_data from public.audit_logs
       where table_name = 'bookings' and record_id = $1 and action = 'update' order by id desc limit 1`,
      [b.id],
    );
    expect(a[0].reason).toBe("Clicked check-in by mistake");
    expect(a[0].actor_id).toBe(w.manager);
    expect(a[0].changed_fields).toContain("status");
    expect([a[0].old_data.status, a[0].new_data.status]).toEqual([
      "checked_in",
      "confirmed",
    ]);
  });
  it("DEC-2d: a failed undo leaves the booking and its history unchanged; reasons do not leak into later changes", async () => {
    const b = await newBooking();
    await st(b.id, 1, "checked_in");
    await expectDbError(st(b.id, 2, "confirmed", "abc"), "REASON_REQUIRED");
    expect(
      (
        await q(
          `select status::text s, version v from public.bookings where id = $1`,
          [b.id],
        )
      )[0],
    ).toEqual({ s: "checked_in", v: 2 });
    await st(b.id, 2, "checked_out"); // forward step with NO reason: the earlier reason must not appear
    const a = await q<{ reason: string | null }>(
      `select reason from public.audit_logs where table_name = 'bookings' and record_id = $1 and action = 'update' order by id desc limit 1`,
      [b.id],
    );
    expect(a[0].reason).toBeNull();
  });
  it("DEC-2e: cancelled and no-show are not reachable here, and cannot be undone here", async () => {
    const b = await newBooking();
    await expectDbError(
      st(b.id, 1, "cancelled", "Guest cancelled"),
      "STATUS_NOT_ALLOWED",
    );
    await expectDbError(
      st(b.id, 1, "no_show", "Guest absent"),
      "STATUS_NOT_ALLOWED",
    );
    await expectDbError(
      st(b.id, 1, "checked_out", "Skipping a step"),
      "STATUS_NOT_ALLOWED",
    );
    await call(
      `select public.cancel_booking($1, 1, 'cancelled', null, 0, 'Guest cancelled')`,
      [b.id],
    );
    await expectDbError(
      st(b.id, 2, "confirmed", "Reopen it please"),
      "STATUS_NOT_ALLOWED",
    );
  });
});

// ======================================================================= DEC-3
describe("DEC-3 reason lengths: ordinary 5, protected Owner actions and correction files 10", () => {
  const SHORT = ["", "   ", "abcd", "  abcd  "];
  async function each(fn: (reason: string) => Promise<unknown>) {
    for (const r of SHORT) await expectDbError(fn(r), "REASON_REQUIRED");
  }

  it("DEC-3a: bookings: amount change, cancellation, no-show charge change, charge correction, plan change", async () => {
    const b = await newBooking();
    await each((r) =>
      call(`select public.update_booking($1, 1, $2::jsonb, null, 0, $3)`, [
        b.id,
        j({ tariff_paise: 300000 }),
        r,
      ]),
    );
    await each((r) =>
      call(`select public.cancel_booking($1, 1, 'cancelled', null, 0, $2)`, [
        b.id,
        r,
      ]),
    );
    await each((r) =>
      call(
        `select public.cancel_booking($1, 1, 'no_show', null, 100, 'Did not arrive', $2)`,
        [b.id, r],
      ),
    );
    await each((r) =>
      call(`select public.set_payment_schedule($1, 1, '[]'::jsonb, 0, $2)`, [
        b.id,
        r,
      ]),
    );
    // exactly 5 trimmed characters is enough
    await call(
      `select public.cancel_booking($1, 1, 'cancelled', null, 0, '  abcde  ')`,
      [b.id],
    );
    const open = await newBooking();
    await call(
      `select public.cancel_booking($1, 1, 'cancelled', null, 0, 'Guest cancelled')`,
      [open.id],
    );
    await each((r) =>
      call(`select public.change_cancellation_charge($1, 2, 1000, $2)`, [
        open.id,
        r,
      ]),
    );
  });
  it("DEC-3b: a manual change of the final amount needs a 5+ character reason", async () => {
    const in1 = await dateOffset(w.db, 2);
    const out1 = await dateOffset(w.db, 3);
    const p = (reason: string) => ({
      resort_id: w.resorts.A.id,
      guest_id: w.guestId,
      pax: 2,
      co_category_id: w.cat.direct,
      stay_type_id: w.stayTypeId,
      booking_date: in1,
      check_in_at: `${in1}T14:00:00+05:30`,
      check_out_at: `${out1}T11:00:00+05:30`,
      pricing_method: "per_person_per_stay",
      tariff_paise: 250000,
      manual_adjustment_paise: -1000,
      manual_adjustment_reason: reason,
    });
    const plan = [{ label: "Balance", due_date: in1, amount_paise: 499000 }];
    const create = (reason: string) =>
      call(`select public.create_booking($1::jsonb, $2::jsonb, $3::uuid)`, [
        j(p(reason)),
        j(plan),
        uid(),
      ]);
    for (const r of SHORT)
      await expectDbError(create(r), "ADJUSTMENT_REASON_REQUIRED");
    await create("  Loyal guest  "); // 10 trimmed characters: accepted
    await create("abcde"); // exactly 5: accepted
  });

  it("DEC-3c: payments and refunds: edit, reject, reverse, hide a file, refund reason", async () => {
    const b = await newBooking();
    const pay = await addPayment(b.id, 100000);
    await each((r) =>
      call(`select public.update_waiting_payment($1, 1, '{}'::jsonb, $2)`, [
        pay.id,
        r,
      ]),
    );
    await each((r) =>
      call(`select public.reject_payment($1, 1, $2)`, [pay.id, r]),
    );
    await approvePay(pay.id);
    await each((r) =>
      call(`select public.reverse_payment($1, 2, $2)`, [pay.id, r]),
    );
    const over = await booking("active", 500000, 700000);
    await each((r) => addRefund(over, 1000, { reason: r }));
    const ref = await addRefund(over, 1000);
    await each((r) =>
      call(`select public.update_waiting_refund($1, 1, '{}'::jsonb, $2)`, [
        ref.id,
        r,
      ]),
    );
    await each((r) =>
      call(`select public.reject_refund($1, 1, $2)`, [ref.id, r]),
    );
    await call(`select public.approve_refund($1, 1)`, [ref.id], w.owner);
    await each((r) =>
      call(`select public.reverse_refund($1, 2, $2)`, [ref.id, r]),
    );
    const b2 = await newBooking();
    const up = await addPayment(
      b2.id,
      1000,
      { method: "upi", provider_id: 1 },
      [await file(b2.id), await file(b2.id)],
    );
    const [pr] = await q<{ id: string }>(
      `select id from public.proofs where payment_id = $1 limit 1`,
      [up.id],
    );
    await each((r) => call(`select public.hide_proof($1, $2)`, [pr.id, r]));
    await call(`select public.hide_proof($1, 'Wrong screenshot')`, [pr.id]);
  });
  it("DEC-3d: optional reasons on accounts: blank is fine, but if written it must be 5+ characters", async () => {
    const l = uid();
    await q(
      `insert into auth.users (id, email) values ($1, 'dec3d@test.example')`,
      [l],
    );
    await call(
      `select public.profile_create($1, 'Test Dec3d', 'dec3d@test.example', 'manager')`,
      [l],
    );
    await expectDbError(
      call(`select public.profile_set_active($1, false, 'abcd')`, [l]),
      "REASON_REQUIRED",
    );
    await expectDbError(
      call(`select public.profile_reset_password($1, 'abcd')`, [l]),
      "REASON_REQUIRED",
    );
    await expectDbError(
      call(
        `select public.profile_update($1, 'Test Renamed', null, null, 'abcd')`,
        [l],
      ),
      "REASON_REQUIRED",
    );
    await call(`select public.profile_update($1, 'Test Renamed')`, [l]); // blank = fine
    await call(`select public.profile_reset_password($1)`, [l]);
    await call(`select public.profile_set_active($1, false, 'Left the team')`, [
      l,
    ]);
  });
  it("DEC-3e: protected Owner actions and correction files still need 10 (9 is refused, 10 is accepted)", async () => {
    const o2 = uid();
    await q(
      `insert into auth.users (id, email) values ($1, 'dec3e@test.example')`,
      [o2],
    );
    await expectDbError(
      call(
        `select public.profile_create($1, 'Test Dec3e', 'dec3e@test.example', 'owner', null, 'abcdefghi')`,
        [o2],
        w.owner,
      ),
      "REASON_REQUIRED",
    );
    await reauth(w.db, w.owner, "add_owner", o2);
    await call(
      `select public.profile_create($1, 'Test Dec3e', 'dec3e@test.example', 'owner', null, 'abcdefghij')`,
      [o2],
      w.owner,
    );
    await expectDbError(
      call(
        `select public.profile_set_active($1, false, 'abcdefghi')`,
        [o2],
        w.owner,
      ),
      "REASON_REQUIRED",
    );
    await reauth(w.db, w.owner, "set_active", o2);
    await call(
      `select public.profile_set_active($1, false, 'abcdefghij')`,
      [o2],
      w.owner,
    );
    const b = await newBooking();
    const pay = await addPayment(b.id, 1000);
    await approvePay(pay.id);
    await expectDbError(
      call(
        `select public.add_correction_files('payment', $1, 'abcdefghi', $2::jsonb)`,
        [pay.id, j([await file(b.id)])],
      ),
      "REASON_REQUIRED",
    ); // 9 characters
    await call(
      `select public.add_correction_files('payment', $1, 'abcdefghij', $2::jsonb)`,
      [pay.id, j([await file(b.id)])],
    );
  });
});

// ======================================================================= DEC-4
describe("DEC-4 payment providers", () => {
  it("DEC-4: UPI and card need a valid app/network; 'Other' needs a typed name; other methods take none", async () => {
    const b = await newBooking();
    const f = async () => [await file(b.id)];
    for (const method of ["upi", "card"]) {
      await expectDbError(
        addPayment(b.id, 1000, { method }, await f()),
        "INVALID_INPUT",
      ); // none chosen
      await expectDbError(
        addPayment(b.id, 1000, { method, provider_id: 9999 }, await f()),
        "INVALID_INPUT",
      ); // unknown
    }
    await expectDbError(
      addPayment(b.id, 1000, { method: "upi", provider_id: 6 }, await f()),
      "INVALID_INPUT",
    ); // a card network for UPI
    await expectDbError(
      addPayment(b.id, 1000, { method: "card", provider_id: 1 }, await f()),
      "INVALID_INPUT",
    ); // a UPI app for card
    await expectDbError(
      addPayment(b.id, 1000, { method: "upi", provider_id: 5 }, await f()),
      "INVALID_INPUT",
    ); // Other, no name
    await expectDbError(
      addPayment(
        b.id,
        1000,
        { method: "card", provider_id: 9, provider_other: "  " },
        await f(),
      ),
      "INVALID_INPUT",
    ); // Other, blank name
    await addPayment(
      b.id,
      1000,
      { method: "upi", provider_id: 5, provider_other: "Test Wallet" },
      await f(),
    );
    await addPayment(
      b.id,
      1000,
      { method: "card", provider_id: 9, provider_other: "Test Card" },
      await f(),
    );
    await addPayment(b.id, 1000, { method: "upi", provider_id: 1 }, await f());
    await addPayment(b.id, 1000, { method: "card", provider_id: 6 }, await f());
    await expectDbError(
      addPayment(b.id, 1000, { method: "cash", provider_id: 1 }),
      "INVALID_INPUT",
    );
    await expectDbError(
      addPayment(b.id, 1000, { method: "cheque", provider_id: 1 }, await f()),
      "INVALID_INPUT",
    );
  });
});

// ======================================================================= DEC-5
describe("DEC-5 refund limits", () => {
  it("DEC-5a: with the SAME numbers (A=700000, D=500000) a running booking may refund 200000, a cancelled one 700000", async () => {
    const active = await booking("active", 500000, 700000);
    const cancelled = await booking("cancelled", 500000, 700000);
    expect((await fin(active)).due_paise).toBe(500000);
    expect((await fin(cancelled)).due_paise).toBe(500000);
    expect((await fin(active)).approved_paise).toBe(
      (await fin(cancelled)).approved_paise,
    );
    // running: max(A - D - RA - RW, 0) = 200000
    await expectDbError(addRefund(active, 200001), "REFUND_TOO_LARGE");
    await addRefund(active, 200000);
    await expectDbError(addRefund(active, 1), "REFUND_TOO_LARGE");
    // cancelled / no-show: max(A - RA - RW, 0) = 700000
    await expectDbError(addRefund(cancelled, 700001), "REFUND_TOO_LARGE");
    await addRefund(cancelled, 700000);
    await expectDbError(addRefund(cancelled, 1), "REFUND_TOO_LARGE");
  });

  it("DEC-5b: waiting refunds use up the room but change NO financial balance (D1), on both kinds of booking", async () => {
    for (const state of ["active", "cancelled"] as const) {
      const b = await booking(state, 500000, 700000);
      const before = await fin(b);
      await addRefund(b, 150000);
      const after = await fin(b);
      for (const k of [
        "total_collection_paise",
        "net_collection_paise",
        "pending_paise",
        "verified_remaining_paise",
        "extra_paise",
        "refund_due_paise",
        "due_paise",
        "approved_paise",
        "refunds_approved_paise",
      ]) {
        expect(after[k], `${state} ${k}`).toBe(before[k]);
      }
      expect(after.refund_waiting_paise).toBe(150000);
    }
    const a = await booking("active", 500000, 700000);
    await addRefund(a, 150000);
    await expectDbError(addRefund(a, 50001), "REFUND_TOO_LARGE"); // 200000 - 150000 waiting = 50000 left
    await addRefund(a, 50000);
  });

  it("DEC-5c: approved refunds reduce the room as well; rejecting or reversing gives it back", async () => {
    const a = await booking("active", 500000, 700000);
    const r1 = await addRefund(a, 120000);
    await call(`select public.approve_refund($1, 1)`, [r1.id], w.owner);
    await expectDbError(addRefund(a, 80001), "REFUND_TOO_LARGE"); // 200000 - 120000 approved
    const r2 = await addRefund(a, 80000);
    await expectDbError(addRefund(a, 1), "REFUND_TOO_LARGE");
    await call(`select public.reject_refund($1, 1, 'Not needed now')`, [r2.id]);
    const r3 = await addRefund(a, 80000); // rejected one no longer blocks
    await call(`select public.reverse_refund($1, 2, 'Sent twice by mistake')`, [
      r1.id,
    ]);
    await addRefund(a, 120000); // reversed one no longer counts
    expect(r3.id).toBeTruthy();
  });

  it("DEC-5d: an active booking that is not overpaid cannot be refunded at all (limit is zero)", async () => {
    const even = await booking("active", 500000, 500000);
    const under = await booking("active", 500000, 300000);
    for (const b of [even, under])
      await expectDbError(addRefund(b, 1), "REFUND_NOT_ALLOWED");
  });

  it("DEC-5e: raising the amount of a waiting refund obeys the same two limits (its own old amount is freed first)", async () => {
    const a = await booking("active", 500000, 700000);
    const r = await addRefund(a, 50000);
    const edit = (id: string, amount: number) =>
      call(
        `select public.update_waiting_refund($1, $2, $3::jsonb, 'Corrected the amount')`,
        [id, 1, j({ amount_paise: amount })],
      );
    await expectDbError(edit(r.id, 200001), "REFUND_TOO_LARGE");
    await edit(r.id, 200000); // exactly the room, own 50000 freed
    const c = await booking("cancelled", 500000, 700000);
    const rc = await addRefund(c, 50000);
    await expectDbError(edit(rc.id, 700001), "REFUND_TOO_LARGE");
    await edit(rc.id, 700000);
  });

  it("DEC-5f: the limit lives in the database guard: a direct insert that skips add_refund is refused too", async () => {
    const a = await booking("active", 500000, 700000);
    const c = await booking("cancelled", 500000, 700000);
    const direct = (b: string, amount: number) =>
      w.db.as({ role: "postgres", uid: w.manager }, () =>
        q(
          `insert into public.refunds (booking_id, amount_paise, method, refund_date, reason, idempotency_key)
           values ($1, $2, 'cash', public.today_ist(), 'Direct insert test', $3)`,
          [b, amount, uid()],
        ),
      );
    await expectDbError(direct(a, 200001), "REFUND_TOO_LARGE");
    await direct(a, 200000);
    await expectDbError(direct(c, 700001), "REFUND_TOO_LARGE");
    await direct(c, 700000);
  });

  it("DEC-5g: a booking that becomes cancelled switches to the cancelled-booking limit", async () => {
    const b = await newBooking(500000);
    const p = await addPayment(b.id, 700000);
    await approvePay(p.id);
    await expectDbError(addRefund(b.id, 300000), "REFUND_TOO_LARGE"); // running: 200000 only
    await cancel(b.id, 100000);
    await addRefund(b.id, 300000); // cancelled: up to the 700000 held
  });
});
