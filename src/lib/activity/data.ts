import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ActivityEntry } from "@/lib/activity/diff";
import { listArgs, type ActivityFilter } from "@/lib/activity/filters";

/**
 * The Activity screen reads the audit log through the database function `activity_list`, as the signed-in user: the
 * log's own row-level security applies (password re-entry rows are for Owners only) and nothing here uses a master key.
 * A failed read returns `{ ok: false }` so the page can show a small "Try again".
 */
export type Loaded<T> = { ok: true; data: T } | { ok: false };

const asObject = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;

export async function loadActivity(
  f: ActivityFilter,
): Promise<Loaded<{ rows: ActivityEntry[]; total: number }>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("activity_list", listArgs(f));
    if (error || !data) return { ok: false };
    return {
      ok: true,
      data: {
        total: data[0]?.total_rows ?? 0,
        rows: data.map((r) => ({
          id: r.id,
          at: r.occurred_at,
          actorName: r.actor_name,
          action: r.action,
          recordType: r.record_type,
          tableName: r.table_name,
          recordId: r.record_id,
          recordCode: r.record_code,
          bookingId: r.booking_id,
          bookingCode: r.booking_code,
          resortId: r.resort_id,
          targetUserName: r.target_user_name,
          changedFields: r.changed_fields,
          oldValues: asObject(r.old_values),
          newValues: asObject(r.new_values),
          reason: r.reason,
        })),
      },
    };
  } catch {
    return { ok: false };
  }
}

/** The people for the "Who" choice (everybody, also those switched off). */
export async function loadPeopleChoices(): Promise<
  { id: string; name: string }[]
> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("user_profiles")
      .select("id, full_name, is_active")
      .order("full_name");
    return (data ?? []).map((p) => ({
      id: p.id,
      name: p.is_active ? p.full_name : `${p.full_name} (switched off)`,
    }));
  } catch {
    return [];
  }
}
