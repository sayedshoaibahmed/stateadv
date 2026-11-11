/**
 * Who may decide payments and refunds, and what a refused or repeated decision leaves behind (PAF-50..55).
 * The rule set itself (self-approval allowed and flagged, final decisions, reasons) is proven in
 * payment-refund-functions.test.ts; this file adds the access side: wrong people, wrong ids, repeats.
 * There is no expiry on waiting approvals in the product, so none is tested. Everything is fictional.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { expectDbError } from "./harness";
import { dateOffset, setupWorld, uid, type World } from "./fixtures";

let w: World;
beforeAll(async () => {
  w = await setupWorld();
}, 120_000);

const q = <T = Record<string, unknown>>(sql: string, p?: unknown[]) =>
  w.db.q<T>(sql, p);
const call = <T = Record<string, unknown>>(
  sql: string,
  p?: unknown[],
  actor: string | null = w.manager,
) => w.db.as({ role: "authenticated", uid: actor }, () => q<T>(sql, p));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const j = (x: unknown) => JSON.stringify(x);

async function newBooking(final = 500000) {
  const in1 = await dateOffset(w.db, 2);
  const out1 = await dateOffset(w.db, 3);
  const p = {
    resort_id: w.resorts.A.id,
    guest_id: w.guestId,
    pax: 2,
    co_category_id: w.cat.direct,
    stay_type_id: w.stayTypeId,
    booking_date: await dateOffset(w.db, 0),
    check_in_at: `${in1}T14:00:00+05:30`,
    check_out_at: `${out1}T11:00:00+05:30`,
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
  return r[0].r.id as string;
}
async function waitingPayment(b: string) {
  const r = await call<{ r: Json }>(
    `select public.add_payment($1::jsonb, null, $2::uuid) as r`,
    [
      j({
        booking_id: b,
        amount_paise: 300000,
        method: "cash",
        payment_date: await dateOffset(w.db, 0),
      }),
      uid(),
    ],
  );
  return r[0].r.id as string;
}
const status = async (table: "payments" | "refunds", id: string) =>
  (
    await q<{ status: string; version: number }>(
      `select status::text, version from public.${table} where id = $1`,
      [id],
    )
  )[0];
const historyRows = async (id: string) =>
  (
    await q<{ n: number }>(
      `select count(*)::int n from public.approval_history where payment_id = $1`,
      [id],
    )
  )[0].n;

describe("deciding payments and refunds: access", () => {
  it("PAF-50: no session, an unknown user and the anonymous role cannot approve, reject or reverse a payment", async () => {
    const b = await newBooking();
    const p = await waitingPayment(b);
    const before = await historyRows(p);
    for (const actor of [null, uid()]) {
      await expectDbError(
        call(`select public.approve_payment($1, 1)`, [p], actor),
        "NOT_ALLOWED",
      );
      await expectDbError(
        call(
          `select public.reject_payment($1, 1, 'Not valid at all')`,
          [p],
          actor,
        ),
        "NOT_ALLOWED",
      );
      await expectDbError(
        call(
          `select public.reverse_payment($1, 1, 'Not valid at all')`,
          [p],
          actor,
        ),
        "NOT_ALLOWED",
      );
    }
    await expectDbError(
      w.db.as({ role: "anon" }, () =>
        q(`select public.approve_payment($1, 1)`, [p]),
      ),
      "permission denied",
    );
    // nothing changed
    expect(await status("payments", p)).toEqual({
      status: "waiting",
      version: 1,
    });
    expect(await historyRows(p)).toBe(before);
  });

  it("PAF-51: a switched-off user can no longer decide anything, but an active one still can", async () => {
    const b = await newBooking();
    const p = await waitingPayment(b);
    await call(
      `select public.profile_set_active($1, false, 'Left the company, access removed')`,
      [w.manager2],
      w.owner,
    );
    await expectDbError(
      call(`select public.approve_payment($1, 1)`, [p], w.manager2),
      "NOT_ALLOWED",
    );
    expect((await status("payments", p)).status).toBe("waiting");
    await call(`select public.approve_payment($1, 1)`, [p], w.owner);
    expect((await status("payments", p)).status).toBe("approved");
    // put the world back for other tests in this file
    await call(
      `select public.profile_set_active($1, true, 'Back at work, access restored')`,
      [w.manager2],
      w.owner,
    );
  });

  it("PAF-52: an unknown payment or refund id is refused as not found, never silently ignored", async () => {
    await expectDbError(
      call(`select public.approve_payment($1, 1)`, [uid()], w.owner),
      "NOT_FOUND",
    );
    await expectDbError(
      call(`select public.approve_refund($1, 1)`, [uid()], w.owner),
      "NOT_FOUND",
    );
  });

  it("PAF-53: approving the same payment twice, or a rejected one, leaves exactly one decision in the history", async () => {
    const b = await newBooking();
    const p = await waitingPayment(b);
    await call(`select public.approve_payment($1, 1)`, [p], w.owner);
    const after = await historyRows(p);
    await expectDbError(
      call(`select public.approve_payment($1, 2)`, [p], w.owner),
      "ALREADY_DECIDED",
    );
    await expectDbError(
      call(`select public.approve_payment($1, 1)`, [p], w.manager2),
      "ALREADY_DECIDED",
    );
    expect(await historyRows(p)).toBe(after);
    expect(await status("payments", p)).toEqual({
      status: "approved",
      version: 2,
    });

    const p2 = await waitingPayment(b);
    await call(
      `select public.reject_payment($1, 1, 'Wrong amount entered')`,
      [p2],
      w.owner,
    );
    await expectDbError(
      call(`select public.approve_payment($1, 2)`, [p2], w.owner),
      "ALREADY_DECIDED",
    );
    expect((await status("payments", p2)).status).toBe("rejected");
  });

  it("PAF-54: refund decisions have the same access rules and repeat protection", async () => {
    // a booking worth 2,000 that has been paid 3,000: the guest overpaid (Q12), so a refund is allowed
    const b = await newBooking(200000);
    const p = await waitingPayment(b);
    await call(`select public.approve_payment($1, 1)`, [p], w.owner);
    const r = (
      await call<{ r: Json }>(
        `select public.add_refund($1::jsonb, null, $2::uuid) as r`,
        [
          j({
            booking_id: b,
            amount_paise: 10000,
            method: "cash",
            refund_date: await dateOffset(w.db, 0),
            reason: "Guest overpaid",
          }),
          uid(),
        ],
      )
    )[0].r.id as string;
    await expectDbError(
      call(`select public.approve_refund($1, 1)`, [r], null),
      "NOT_ALLOWED",
    );
    await expectDbError(
      call(`select public.approve_refund($1, 1)`, [r], uid()),
      "NOT_ALLOWED",
    );
    expect((await status("refunds", r)).status).toBe("waiting");
    await call(`select public.approve_refund($1, 1)`, [r], w.owner);
    await expectDbError(
      call(`select public.approve_refund($1, 2)`, [r], w.manager2),
      "ALREADY_DECIDED",
    );
    await expectDbError(
      call(
        `select public.reject_refund($1, 2, 'Changed our mind')`,
        [r],
        w.owner,
      ),
      "ALREADY_DECIDED",
    );
    expect((await status("refunds", r)).status).toBe("approved");
  });

  it("PAF-55: deciding never lets the decider be chosen by the caller (the session decides who approved)", async () => {
    const b = await newBooking();
    const p = await waitingPayment(b);
    await call(`select public.approve_payment($1, 1)`, [p], w.manager2);
    const row = (
      await q<{ approved_by: string }>(
        `select approved_by from public.payments where id = $1`,
        [p],
      )
    )[0];
    expect(row.approved_by).toBe(w.manager2);
    // the table itself cannot be written by an app user to fake or change a decision
    await expectDbError(
      call(
        `update public.payments set status = 'approved', approved_by = $2 where id = $1`,
        [p, w.owner],
      ),
      "permission denied",
    );
  });
});
