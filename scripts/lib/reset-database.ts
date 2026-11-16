/**
 * The decision logic for scripts/reset-database.ts, kept separate and pure so it is unit-tested without a real
 * database (RST-* tests). The script does the actual work against a real project; this only decides whether
 * it is allowed to, and in what order the destructive steps run.
 */

export interface ResetDeps {
  /** DDL only: drops and recreates the "public" schema. Bypasses the row-level prevent_delete triggers,
   * which fire on DELETE/TRUNCATE, never on dropping the table itself. */
  dropAndRecreateSchema(): Promise<void>;
  /** Replays every migration from scratch onto the now-empty schema. */
  pushMigrations(): Promise<void>;
  /** Auth users live outside "public"; the schema drop never touches them. Returns how many were removed. */
  deleteAllAuthUsers(): Promise<number>;
  /** Storage files also live outside "public". Returns each bucket's name and how many files were removed. */
  emptyAllBuckets(): Promise<{ bucket: string; removed: number }[]>;
  log: (message: string) => void;
}

export type ResetResult =
  | { status: "dry-run" }
  | { status: "refused"; reason: string }
  | { status: "done"; authUsersDeleted: number; buckets: { bucket: string; removed: number }[] };

/** Both must match exactly, or nothing runs. Protects against running this against the wrong project by habit. */
export function checkConfirmation(
  hostTyped: string,
  hostActual: string,
  phraseTyped: string,
): { ok: true } | { ok: false; reason: string } {
  if (hostTyped.trim() !== hostActual) {
    return {
      ok: false,
      reason: "The project host you typed does not match. Nothing was done.",
    };
  }
  if (phraseTyped !== "RESET DATABASE") {
    return { ok: false, reason: "Stopped. Nothing was changed." };
  }
  return { ok: true };
}

/**
 * Runs the four destructive steps in a fixed order: schema first (so a half-applied migration state never
 * meets a still-logged-in Auth user), then Auth users, then Storage. A dry run calls nothing.
 */
export async function resetDatabase(
  deps: ResetDeps,
  opts: { dryRun: boolean },
): Promise<ResetResult> {
  if (opts.dryRun) {
    deps.log(
      "Dry run: nothing was changed. A real run would drop and rebuild the schema, " +
        "delete every Auth user, and empty every Storage bucket.",
    );
    return { status: "dry-run" };
  }
  deps.log("Dropping and rebuilding the schema...");
  await deps.dropAndRecreateSchema();
  deps.log("Re-applying every migration...");
  await deps.pushMigrations();
  deps.log("Deleting Auth users...");
  const authUsersDeleted = await deps.deleteAllAuthUsers();
  deps.log(`${authUsersDeleted} Auth user(s) deleted.`);
  deps.log("Emptying Storage buckets...");
  const buckets = await deps.emptyAllBuckets();
  for (const b of buckets) deps.log(`${b.bucket}: ${b.removed} file(s) removed.`);
  return { status: "done", authUsersDeleted, buckets };
}
