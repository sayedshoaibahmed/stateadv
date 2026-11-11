import { friendlyError } from "@/lib/errors";

/**
 * One way to call a database function and get a plain result back. Kept free of Next.js so it can be
 * tested with a fake client. The caller (actions.ts) supplies the logged-in user's client, so the database
 * rules and row-level security always apply.
 */
export type Result<T> = { ok: true; data: T } | { ok: false; message: string };

export interface RpcClient {
  rpc(
    name: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export async function callRpc<T>(
  client: RpcClient,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Result<T>> {
  try {
    const { data, error } = await client.rpc(name, args);
    if (error) return { ok: false, message: friendlyError(error) };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, message: friendlyError(null) };
  }
}

/** Warnings come back with a saved payment/refund; they never block saving. */
export interface Warning {
  code: string;
}
export interface Saved {
  id: string;
  duplicate?: boolean;
  warnings?: Warning[];
  [k: string]: unknown;
}
