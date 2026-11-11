import { describe, expect, it } from "vitest";
import { callRpc, type RpcClient } from "@/lib/db/call";
import { DB_ERROR_MESSAGES, GENERIC_ERROR } from "@/lib/errors";

const client = (
  res: { data?: unknown; error?: { message: string } | null } | Error,
): RpcClient => ({
  rpc: async () => {
    if (res instanceof Error) throw res;
    return { data: res.data ?? null, error: res.error ?? null };
  },
});

describe("calling a database function", () => {
  it("DBC-01: success returns the data untouched", async () => {
    const r = await callRpc<{ id: string }>(
      client({ data: { id: "x" } }),
      "add_payment",
      {},
    );
    expect(r).toEqual({ ok: true, data: { id: "x" } });
  });
  it("DBC-02: a rule error becomes a plain sentence, never the code or raw database text", async () => {
    const r = await callRpc(
      client({ error: { message: "REFUND_TOO_LARGE" } }),
      "add_refund",
      {},
    );
    expect(r).toEqual({
      ok: false,
      message: DB_ERROR_MESSAGES.REFUND_TOO_LARGE,
    });
    for (const raw of [
      'duplicate key value violates unique constraint "bookings_code_key"',
      "permission denied for table payments",
      "syntax error at or near",
    ]) {
      expect(
        await callRpc(client({ error: { message: raw } }), "x", {}),
      ).toEqual({ ok: false, message: GENERIC_ERROR });
    }
  });
  it("DBC-03: a network or unexpected failure is reported plainly, not thrown", async () => {
    expect(
      await callRpc(
        client(new Error("connect ECONNREFUSED 10.0.0.1:5432")),
        "x",
        {},
      ),
    ).toEqual({ ok: false, message: GENERIC_ERROR });
  });
  it("DBC-04: the arguments are passed exactly as given", async () => {
    let seen: unknown;
    await callRpc(
      { rpc: async (n, a) => ((seen = [n, a]), { data: null, error: null }) },
      "approve_payment",
      { p_id: "1", p_expected_version: 3 },
    );
    expect(seen).toEqual([
      "approve_payment",
      { p_id: "1", p_expected_version: 3 },
    ]);
  });
});
