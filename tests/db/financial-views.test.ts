/**
 * The money views must give EXACTLY the same numbers as the reference formulas in
 * src/lib/calc.ts (TEST_PLAN section 2.9, FIN-01..19, COL-*). Fictional data only.
 *
 * Payments/refunds with arbitrary statuses are inserted with triggers switched off
 * (session_replication_role = replica) so the VIEW can be tested against any
 * combination; the guard triggers themselves are covered by the other test files.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { computeFinancials } from "../../src/lib/calc";
import { FIN_CASES } from "../shared/fin-cases";
import {
  cancelBooking,
  createBooking,
  setupWorld,
  uid,
  type Booking,
  type World,
} from "./fixtures";

let w: World;
beforeAll(async () => {
  w = await setupWorld();
}, 120_000);

const q = <T = Record<string, unknown>>(sql: string, p?: unknown[]) =>
  w.db.q<T>(sql, p);

type Status = "waiting" | "approved" | "rejected" | "reversed";

async function putMoney(
  b: Booking,
  kind: "payments" | "refunds",
  status: Status,
  amount: number,
  dateOffset = 0,
): Promise<void> {
  if (amount <= 0) return;
  const id = uid();
  const isPay = kind === "payments";
  const cols = [
    "id",
    isPay ? "payment_code" : "refund_code",
    "booking_id",
    "resort_id",
    "amount_paise",
    "method",
    isPay ? "payment_date" : "refund_date",
    "status",
    "recorded_by",
    "idempotency_key",
  ];
  const vals: string[] = [
    `'${id}'`,
    `'${b.code}-${isPay ? "P" : "R"}-${id.slice(0, 8)}'`,
    `'${b.id}'`,
    `'${b.resortId}'`,
    String(amount),
    "'cash'",
    `(public.today_ist() + ${dateOffset})`,
    `'${status}'`,
    `'${w.manager}'`,
    `'${uid()}'`,
  ];
  const add = (c: string, v: string) => (cols.push(c), vals.push(v));
  if (!isPay) add("reason", "'test refund'");
  if (status === "approved" || status === "reversed") {
    add("approved_by", `'${w.owner}'`);
    add("approved_at", "now()");
  }
  if (status === "rejected") {
    add("rejected_by", `'${w.owner}'`);
    add("rejected_at", "now()");
    add("rejection_reason", "'test'");
  }
  if (status === "reversed") {
    add("reversed_by", `'${w.owner}'`);
    add("reversed_at", "now()");
    add("reversal_reason", "'test'");
  }
  await w.db.exec("set session_replication_role = replica");
  try {
    await q(
      `insert into public.${kind} (${cols.join(",")}) values (${vals.join(",")})`,
    );
  } finally {
    await w.db.exec("set session_replication_role = origin");
  }
}

const view = async (bookingId: string) => {
  const [r] = await q<Record<string, string | number>>(
    `select * from public.booking_financials where booking_id = $1`,
    [bookingId],
  );
  const n = (k: string) => Number(r[k]);
  return {
    due: n("due_paise"),
    totalRecordedPaise: n("total_recorded_paise"),
    totalCollectionPaise: n("total_collection_paise"),
    netCollectionPaise: n("net_collection_paise"),
    pendingPaise: n("pending_paise"),
    verifiedRemainingPaise: n("verified_remaining_paise"),
    extraPaise: n("extra_paise"),
    refundDuePaise: n("refund_due_paise"),
    refundWaitingPaise: n("refund_waiting_paise"),
    refundStillToRecordPaise: n("refund_still_to_record_paise"),
    refundLimitPaise: n("refundable_limit_paise"),
    rejected: n("rejected_paise"),
    reversed: n("reversed_paise"),
  };
};

const R = (rupees: number) => rupees * 100;

/** Every field the view exposes must equal the reference implementation. */
function expectSameAsReference(
  v: Awaited<ReturnType<typeof view>>,
  input: { due: number; A: number; W: number; RA: number; RW: number },
  label: string,
) {
  const ref = computeFinancials({
    amountDuePaise: input.due,
    approvedPaise: input.A,
    waitingPaise: input.W,
    refundsApprovedPaise: input.RA,
    refundsWaitingPaise: input.RW,
  });
  expect(v.due, `${label} due`).toBe(input.due);
  expect(v.totalRecordedPaise, `${label} total recorded`).toBe(
    ref.totalRecordedPaise,
  );
  expect(v.totalCollectionPaise, `${label} total collection`).toBe(
    ref.totalCollectionPaise,
  );
  expect(v.netCollectionPaise, `${label} net collection`).toBe(
    ref.netCollectionPaise,
  );
  expect(v.pendingPaise, `${label} pending`).toBe(ref.pendingPaise);
  expect(v.verifiedRemainingPaise, `${label} verified remaining`).toBe(
    ref.verifiedRemainingPaise,
  );
  expect(v.extraPaise, `${label} extra`).toBe(ref.extraPaise);
  expect(v.refundDuePaise, `${label} refund due`).toBe(ref.refundDuePaise);
  expect(v.refundWaitingPaise, `${label} refund waiting`).toBe(
    ref.refundWaitingPaise,
  );
  expect(v.refundStillToRecordPaise, `${label} refund still to record`).toBe(
    ref.refundStillToRecordPaise,
  );
  expect(v.refundLimitPaise, `${label} refund limit`).toBe(
    ref.refundLimitPaise,
  );
}

describe("booking_financials = reference formulas (FIN-01..19)", () => {
  it.each(FIN_CASES)("%s", async (id, [D, A, W, RA, RW], expected) => {
    const b = await createBooking(w, {
      pax: 1,
      tariff: R(D),
      plan: D > 0 ? "auto" : "none",
    });
    await putMoney(b, "payments", "approved", R(A));
    await putMoney(b, "payments", "waiting", R(W));
    await putMoney(b, "refunds", "approved", R(RA));
    await putMoney(b, "refunds", "waiting", R(RW));
    const v = await view(b.id);
    // 1) the published golden numbers
    expect(v.pendingPaise, "pending").toBe(R(expected.pending));
    expect(v.verifiedRemainingPaise, "verified remaining").toBe(
      R(expected.verified),
    );
    expect(v.extraPaise, "extra").toBe(R(expected.extra));
    expect(v.refundDuePaise, "refund due").toBe(R(expected.refundDue));
    expect(v.totalCollectionPaise, "total collection").toBe(R(expected.total));
    expect(v.netCollectionPaise, "net collection").toBe(R(expected.net));
    if (expected.stillToRecord !== undefined)
      expect(v.refundStillToRecordPaise, "still to record").toBe(
        R(expected.stillToRecord),
      );
    // 2) and every other field against the reference code
    expectSameAsReference(
      v,
      { due: R(D), A: R(A), W: R(W), RA: R(RA), RW: R(RW) },
      id,
    );
  });

  it("rejected and reversed payments are shown for information but NEVER counted (Q5)", async () => {
    const b = await createBooking(w, { pax: 1, tariff: R(5000) });
    await putMoney(b, "payments", "approved", R(1000));
    await putMoney(b, "payments", "rejected", R(2000));
    await putMoney(b, "payments", "reversed", R(1500));
    const v = await view(b.id);
    expect(v.rejected).toBe(R(2000));
    expect(v.reversed).toBe(R(1500));
    expect(v.totalCollectionPaise).toBe(R(1000));
    expect(v.totalRecordedPaise).toBe(R(1000));
    expect(v.pendingPaise).toBe(R(4000));
  });

  it("Q5: waiting payments never become Total Collection", async () => {
    const b = await createBooking(w, { pax: 1, tariff: R(5000) });
    await putMoney(b, "payments", "waiting", R(5000));
    const v = await view(b.id);
    expect(v.totalCollectionPaise).toBe(0);
    expect(v.verifiedRemainingPaise).toBe(R(5000));
    expect(v.pendingPaise).toBe(0); // fully recorded, just not approved yet
  });

  it("D1: a waiting refund changes no balance - only its own lines (PRD example B)", async () => {
    const b = await createBooking(w, { pax: 1, tariff: R(5000) });
    await putMoney(b, "payments", "approved", R(6000));
    const before = await view(b.id);
    await putMoney(b, "refunds", "waiting", R(1500));
    const during = await view(b.id);
    for (const k of [
      "pendingPaise",
      "verifiedRemainingPaise",
      "extraPaise",
      "refundDuePaise",
      "netCollectionPaise",
      "totalCollectionPaise",
    ] as const) {
      expect(during[k], k).toBe(before[k]);
    }
    expect(during.refundWaitingPaise).toBe(R(1500));
    expect(during.refundLimitPaise).toBe(R(4500));
  });

  it("a cancelled booking uses the cancellation charge as the amount due; the original amount stays (Q7a, PRD example A)", async () => {
    // final Rs5,000; Rs3,000 approved; cancelled with a Rs1,000 charge
    const b = await createBooking(w, { pax: 1, tariff: R(5000) });
    await putMoney(b, "payments", "approved", R(3000));
    await cancelBooking(w, b, {
      charge: R(1000),
      newRows: [{ dueOffset: 0, amount: R(1000) }],
    }); // a real cancellation: plan rebuilt in the same transaction
    const v = await view(b.id);
    expect(v.due).toBe(R(1000)); //                         amount due is now the charge
    expect(v.refundDuePaise).toBe(R(2000)); //              refund due = 3000 - 1000
    expect(v.extraPaise).toBe(R(2000));
    expect(v.pendingPaise).toBe(0);
    const [orig] = await q<{ f: string }>(
      `select final_paise f from public.booking_financials where booking_id = $1`,
      [b.id],
    );
    expect(Number(orig.f)).toBe(R(5000)); //                original amount still shown separately
    // refund recorded (waiting), then approved
    await putMoney(b, "refunds", "waiting", R(2000));
    expect((await view(b.id)).refundStillToRecordPaise).toBe(0);
    expect((await view(b.id)).netCollectionPaise).toBe(R(3000));
  });

  it("RANDOM: 250 random bookings agree with the reference formulas, to the paisa", async () => {
    // deterministic pseudo-random numbers (mulberry32) so a failure can be reproduced
    let seed = 20261112;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const amt = () => (rnd() < 0.25 ? 0 : Math.floor(rnd() * 2_000_000)); // paise, odd values included
    for (let i = 0; i < 250; i++) {
      const D = Math.floor(rnd() * 3_000_000);
      const A1 = amt(),
        A2 = amt(),
        W = amt(),
        RA = amt(),
        RW = amt();
      const noise = amt();
      const b = await createBooking(w, {
        pax: 1,
        tariff: D,
        plan: D > 0 ? "auto" : "none",
      });
      await putMoney(b, "payments", "approved", A1);
      await putMoney(b, "payments", "approved", A2);
      await putMoney(b, "payments", "waiting", W);
      await putMoney(b, "payments", "rejected", noise); //   must not matter
      await putMoney(b, "payments", "reversed", noise); //   must not matter
      await putMoney(b, "refunds", "approved", RA);
      await putMoney(b, "refunds", "waiting", RW);
      expectSameAsReference(
        await view(b.id),
        { due: D, A: A1 + A2, W, RA, RW },
        `random #${i}`,
      );
    }
  }, 120_000);
});

describe("expected collection and overdue (COL-*, D2)", () => {
  const sum = async (
    bookingId: string,
    fromOffset: number,
    toOffset: number,
  ) => {
    const [{ s }] = await q<{ s: string | null }>(
      `select sum(amount_paise) s from public.expected_entries where booking_id = $1
         and entry_date between public.today_ist() + $2::int and public.today_ist() + $3::int`,
      [bookingId, fromOffset, toOffset],
    );
    return Number(s ?? 0);
  };
  const overdue = async (bookingId: string, asOfOffset: number) => {
    const [r] = await q<{
      expected_to_date_paise: string;
      net_collected_to_date_paise: string;
      overdue_paise: string;
    }>(
      `select * from public.booking_overdue(public.today_ist() + $2::int) where booking_id = $1`,
      [bookingId, asOfOffset],
    );
    return {
      expected: Number(r.expected_to_date_paise),
      collected: Number(r.net_collected_to_date_paise),
      overdue: Number(r.overdue_paise),
    };
  };

  it("COL-01: expected collection is split by DUE DATE, not put on check-in", async () => {
    const b = await createBooking(w, {
      plan: [
        { label: "Advance", dueOffset: -40, amount: 150000 },
        { label: "Balance", dueOffset: 20, amount: 350000 },
      ],
    });
    expect(await sum(b.id, -45, -35)).toBe(150000); // the "October" window
    expect(await sum(b.id, 15, 25)).toBe(350000); //   the "December" window
    expect(await sum(b.id, -100, 100)).toBe(500000); // nothing counted twice
  });

  it("COL-06: overdue = what should have arrived by that date minus net money collected by that date", async () => {
    const b = await createBooking(w, {
      plan: [
        { label: "Advance", dueOffset: -40, amount: 200000 },
        { label: "Balance", dueOffset: 30, amount: 300000 },
      ],
    });
    await putMoney(b, "payments", "approved", 150000, -35); // part of the advance, paid 5 days after it was due
    await putMoney(b, "payments", "waiting", 50000, -34); //   waiting money is not collection
    await putMoney(b, "payments", "rejected", 50000, -33); //  rejected money is not collection
    expect(await overdue(b.id, -41)).toEqual({
      expected: 0,
      collected: 0,
      overdue: 0,
    }); //         before anything was due
    expect(await overdue(b.id, -36)).toEqual({
      expected: 200000,
      collected: 0,
      overdue: 200000,
    }); // due, nothing paid yet
    expect(await overdue(b.id, -35)).toEqual({
      expected: 200000,
      collected: 150000,
      overdue: 50000,
    });
    expect(await overdue(b.id, 0)).toEqual({
      expected: 200000,
      collected: 150000,
      overdue: 50000,
    }); // today
    expect(await overdue(b.id, 30)).toEqual({
      expected: 500000,
      collected: 150000,
      overdue: 350000,
    }); // balance now due too
  });

  it("COL-05: money paid BEFORE its due date reduces nothing that is not yet due", async () => {
    const b = await createBooking(w, {
      plan: [{ label: "Balance", dueOffset: 20, amount: 500000 }],
    });
    await putMoney(b, "payments", "approved", 500000, -2); // paid early
    expect(await overdue(b.id, 0)).toEqual({
      expected: 0,
      collected: 500000,
      overdue: 0,
    });
    expect(await overdue(b.id, 20)).toEqual({
      expected: 500000,
      collected: 500000,
      overdue: 0,
    });
  });

  it("COL-10: an approved refund lowers collected-to-date from its own refund date onwards", async () => {
    const b = await createBooking(w, {
      plan: [{ label: "Advance", dueOffset: -20, amount: 500000 }],
    });
    await putMoney(b, "payments", "approved", 500000, -15);
    await putMoney(b, "refunds", "approved", 100000, -5);
    expect((await overdue(b.id, -6)).collected).toBe(500000); // before the refund date
    expect((await overdue(b.id, -5)).collected).toBe(400000); // from the refund date
    expect((await overdue(b.id, 0)).overdue).toBe(100000); //    Rs1,000 is again overdue
  });

  it("every booking: active plan rows + adjustments = amount due (the invariant holds for all test data)", async () => {
    const bad = await q(
      `select b.id from public.bookings b
       where b.amount_due_paise is distinct from (
         coalesce((select sum(amount_paise) from public.payment_schedules s where s.booking_id = b.id and s.superseded_at is null), 0)
         + coalesce((select sum(amount_paise) from public.expected_adjustments a where a.booking_id = b.id), 0))`,
    );
    expect(bad).toEqual([]);
  });
});
