import { describe, expect, it } from "vitest";
import { checkSupabase } from "@/lib/supabase/health";

function fakeFetch(auth: number, rest: { status: number; code?: string }) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/auth/v1/health")) {
      return new Response("{}", { status: auth });
    }
    return new Response(JSON.stringify(rest.code ? { code: rest.code } : {}), {
      status: rest.status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

describe("checkSupabase", () => {
  it("ok when auth is up and the DB answers 'table not found' (no tables in M1)", async () => {
    const r = await checkSupabase(
      "https://x.test",
      "k",
      fakeFetch(200, { status: 404, code: "PGRST205" }),
    );
    expect(r).toMatchObject({ ok: true, auth: "ok", database: "ok" });
  });

  it("fails when the key is rejected", async () => {
    const r = await checkSupabase(
      "https://x.test",
      "k",
      fakeFetch(401, { status: 401 }),
    );
    expect(r.ok).toBe(false);
    expect(r.database).toBe("error");
  });

  it("fails on unexpected database errors", async () => {
    const r = await checkSupabase(
      "https://x.test",
      "k",
      fakeFetch(200, { status: 500, code: "XX000" }),
    );
    expect(r.ok).toBe(false);
  });

  it("never includes the key in its result", async () => {
    const r = await checkSupabase(
      "https://x.test",
      "SECRET-LOOKING-KEY",
      fakeFetch(401, { status: 401 }),
    );
    expect(JSON.stringify(r)).not.toContain("SECRET-LOOKING-KEY");
  });
});
