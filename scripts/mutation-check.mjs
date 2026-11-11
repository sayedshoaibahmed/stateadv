#!/usr/bin/env node
/**
 * "Do the tests really guard the rules?"
 *
 * Deliberately weakens the migrations, one rule at a time, in a TEMPORARY COPY,
 * and checks that the database tests FAIL because a test noticed - not because
 * the SQL stopped working. The real migration files are never modified.
 *
 *   node scripts/mutation-check.mjs
 */
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const SRC = "supabase/migrations";
const ANSI = /\u001b\[[0-9;]*m/g; // terminal colour codes

// "file" is the two-digit number of the migration that contains the text to weaken.
const MUTATIONS = [
  // ---- security, accounts, money (first review) -----------------------------
  {
    name: "last-Owner protection removed",
    file: "06",
    from: "if n_other_owners = 0 then",
    to: "if false then",
  },
  {
    name: "RLS switched off on payments",
    file: "08",
    from: "alter table public.payments               enable row level security;",
    to: "",
  },
  {
    name: "past-due plan rows no longer locked",
    file: "06",
    from: "  if old.due_date < public.today_ist() then\n    raise exception 'PAST_DUE_ROW_LOCKED'",
    to: "  if false then\n    raise exception 'PAST_DUE_ROW_LOCKED'",
  },
  {
    name: "waiting refunds wrongly reduce Pending (D1 broken)",
    file: "07",
    from: "greatest(x.due_paise - (x.approved_paise + x.waiting_paise - x.refunds_approved_paise), 0)  as pending_paise",
    to: "greatest(x.due_paise - (x.approved_paise + x.waiting_paise - x.refunds_approved_paise - x.refunds_waiting_paise), 0)  as pending_paise",
  },
  {
    name: "app users given INSERT on bookings",
    file: "08",
    from: "grant usage on schema public to authenticated;",
    to: "grant usage on schema public to authenticated;\ngrant insert on public.bookings to authenticated;",
  },
  {
    name: "functions executable by anon / PUBLIC again",
    file: "08",
    from: "revoke all on all functions in schema public from public, anon, authenticated;",
    to: "",
  },
  {
    name: "refund limit check removed",
    file: "16",
    from: "    if new.amount_paise > v_max then\n      raise exception 'REFUND_TOO_LARGE'",
    to: "    if false then\n      raise exception 'REFUND_TOO_LARGE'",
  },
  {
    name: "approved payments editable",
    file: "06",
    from: "      raise exception 'PAYMENT_LOCKED' using detail = 'An approved payment can only be reversed.';",
    to: "      null;",
  },
  {
    name: "cancellation allowed to rewrite original amounts",
    file: "17",
    from: "        raise exception 'CANCELLED_AMOUNTS_LOCKED'\n          using detail = 'The original amounts of a cancelled booking cannot be changed.';",
    to: "        null;",
  },
  {
    name: "audit log editable",
    file: "06",
    from: "foreach t in array array['payment_plan_revisions','expected_adjustments','approval_history','booking_pdf_versions','audit_logs']",
    to: "foreach t in array array['payment_plan_revisions']",
  },

  // ---- decisions of 2026-11-11 ------------------------------------------------
  {
    name: "email sync accepts ANY address, not just the one Auth confirmed (O7)",
    file: "06",
    from: "verified_sync := new.email = confirmed_mail",
    to: "verified_sync := true",
  },
  {
    name: "email sync may carry other changes such as a role change (O7)",
    file: "06",
    from:
      "      and (new.full_name, new.phone, new.role, new.is_active, new.must_change_password, new.disabled_at, new.disabled_by)\n" +
      "          is not distinct from\n" +
      "          (old.full_name, old.phone, old.role, old.is_active, old.must_change_password, old.disabled_at, old.disabled_by);",
    to: "      ;",
  },
  {
    name: "users may edit their OWN profile email directly (O7)",
    file: "06",
    from: "not verified_sync and not recovery and actor = old.id then",
    to: "not verified_sync and not recovery and false then",
  },
  {
    name: "correction files allowed on WAITING payments (Q9a)",
    file: "06",
    from: "      if new.is_correction then\n        raise exception 'PROOF_CORRECTION_NOT_ALLOWED'",
    to: "      if false then\n        raise exception 'PROOF_CORRECTION_NOT_ALLOWED'",
  },
  {
    name: "ordinary files allowed on APPROVED payments (Q9a)",
    file: "06",
    from: "      if not new.is_correction then\n        raise exception 'PROOF_LOCKED'\n          using detail = 'An approved payment or refund is locked.",
    to: "      if false then\n        raise exception 'PROOF_LOCKED'\n          using detail = 'An approved payment or refund is locked.",
  },
  {
    name: "correction reason no longer mandatory (Q9a)",
    file: "04",
    from: "length(btrim(coalesce(correction_reason, ''))) >= 10",
    to: "length(btrim(coalesce(correction_reason, ''))) >= 0",
  },
  {
    name: "original files can be hidden after approval (Q9a)",
    file: "06",
    from: "  if parent is distinct from 'waiting' then\n    raise exception 'PROOF_LOCKED' using detail = 'Files can only be hidden while",
    to: "  if false then\n    raise exception 'PROOF_LOCKED' using detail = 'Files can only be hidden while",
  },
  {
    name: "payment reversal allowed while refunds depend on it (D5)",
    file: "06",
    from: "if sum_a - old.amount_paise - sum_ra - sum_rw < 0 then",
    to: "if false then",
  },
  {
    name: "a system change keeps the PREVIOUS editor's name in updated_by",
    file: "01",
    from: "  new.updated_by := auth.uid();",
    to: "  new.updated_by := coalesce(auth.uid(), old.updated_by);",
  },
  // ---- write functions (migrations 12-15) ---------------------------------
  {
    name: "a Manager may reset an Owner password (profile_reset_password)",
    file: "12",
    from: "    if v_actor_role <> 'owner' then\n      raise exception 'OWNER_ACTION_REQUIRES_OWNER' using detail = 'Only another Owner can do this to an Owner account.';\n    end if;\n    v_reason := public.require_reason(p_reason, 10);   -- O3",
    to: "    if false then\n      raise exception 'OWNER_ACTION_REQUIRES_OWNER' using detail = 'Only another Owner can do this to an Owner account.';\n    end if;\n    v_reason := public.require_reason(p_reason, 10);   -- O3",
  },
  {
    name: "people may change their own role (profile_update)",
    file: "12",
    from: "    if p_id = auth.uid() then\n      raise exception 'CANNOT_CHANGE_OWN_ROLE'",
    to: "    if false then\n      raise exception 'CANNOT_CHANGE_OWN_ROLE'",
  },
  {
    name: "owner recovery callable by logged-in users",
    file: "12",
    from: "to service_role;",
    to: "to service_role, authenticated;",
  },
  {
    name: "master data writable without an active account",
    file: "13",
    from: "if auth.uid() is null or not public.is_active_user() then",
    to: "if false then",
  },
  {
    name: "nights counted in UTC instead of IST (D4)",
    file: "14",
    from: "v_nights := (p_out at time zone 'Asia/Kolkata')::date - (p_in at time zone 'Asia/Kolkata')::date;",
    to: "v_nights := (p_out at time zone 'UTC')::date - (p_in at time zone 'UTC')::date;",
  },
  {
    name: "any amount may be moved from overdue (D2)",
    file: "14",
    from: "if v_move > v_unpaid then",
    to: "if false then",
  },
  {
    name: "cancellation charge may exceed the final amount",
    file: "14",
    from: "if v_charge < 0 or v_charge > cur.final_amount_paise then",
    to: "if false then",
  },
  {
    name: "booking function left open to PUBLIC",
    file: "14",
    from: "revoke all on function public.create_booking(jsonb, jsonb, uuid) from public, anon, authenticated;",
    to: "",
  },
  {
    name: "active bookings refundable without overpayment (Q12)",
    file: "15",
    from: "if b.status not in ('cancelled', 'no_show') and v_refund_due = 0 then",
    to: "if false then",
  },
  {
    name: "stored file size not compared with storage",
    file: "15",
    from: "or (obj.metadata ->> 'size') is distinct from v_size::text",
    to: "or false",
  },
  {
    name: "second approver not told it was already decided",
    file: "15",
    from: "  if cur.status <> p_from then\n    -- the second person sees who already acted (FR-APR-6)",
    to: "  if false then\n    -- the second person sees who already acted (FR-APR-6)",
  },
  {
    name: "correction reason shorter than 10 characters accepted",
    file: "15",
    from: "v_reason := public.require_reason(p_reason, 10);\n  select * into pr from public.proof_parent(p_kind, p_parent);\n  perform 1 from public.bookings",
    to: "v_reason := public.require_reason(p_reason, 0);\n  select * into pr from public.proof_parent(p_kind, p_parent);\n  perform 1 from public.bookings",
  },
  // ---- owner decisions of 2026-11-11 (migrations 12, 14, 15, 16) -------------
  {
    name: "running bookings use the cancelled-booking refund limit (decision 5)",
    file: "16",
    from: "v_max := greatest(sum_a - b.amount_due_paise - sum_ra - sum_rw, 0);",
    to: "v_max := greatest(sum_a - sum_ra - sum_rw, 0);",
  },
  {
    name: "running-booking refund limit ignores waiting refunds (decision 5)",
    file: "16",
    from: "v_max := greatest(sum_a - b.amount_due_paise - sum_ra - sum_rw, 0);",
    to: "v_max := greatest(sum_a - b.amount_due_paise - sum_ra, 0);",
  },
  {
    name: "editing a waiting refund on a running booking skips the amount-due limit (decision 5)",
    file: "16",
    from: "v_max := greatest(sum_a - v_due - sum_ra - (sum_rw - old.amount_paise), 0);",
    to: "v_max := greatest(sum_a - sum_ra - (sum_rw - old.amount_paise), 0);",
  },
  {
    name: "cancelled bookings use the running-booking refund limit (decision 5)",
    file: "16",
    from: "v_max := greatest(sum_a - sum_ra - sum_rw, 0);\n    else",
    to: "v_max := greatest(sum_a - b.amount_due_paise - sum_ra - sum_rw, 0);\n    else",
  },
  {
    name: "undoing a status step no longer needs a reason (decision 2)",
    file: "14",
    from: "    v_reason := public.require_reason(p_reason, 5);\n  else\n    v_reason := public.optional_reason(p_reason);",
    to: "    v_reason := public.optional_reason(p_reason);\n  else\n    v_reason := public.optional_reason(p_reason);",
  },
  {
    name: "booking reasons back to 1 character, in every layer (decision 3)",
    file: "14",
    all: true,
    from: "require_reason(p_reason, 5)",
    to: "require_reason(p_reason, 1)",
  },
  {
    name: "refund reason no longer needs 5 characters (decision 3)",
    file: "15",
    from: "if v_reason is null or length(v_reason) < 5 then",
    to: "if v_reason is null then",
  },
  {
    name: "reject/reverse reason back to 1 character (decision 3)",
    file: "15",
    from: "    p_reason := public.require_reason(p_reason, 5);",
    to: "    p_reason := public.require_reason(p_reason, 1);",
  },
  {
    name: "optional account reasons accepted at any length (decision 3)",
    file: "12",
    from: "  return public.require_reason(p_reason, 5);",
    to: "  return nullif(btrim(p_reason), '');",
  },
  {
    name: "payment app 'Other' without a name accepted (decision 4)",
    file: "15",
    from: "if v_name = 'Other' and p_other is null then",
    to: "if false then",
  },
  {
    name: "payment on a cancelled booking with nothing unpaid accepted (decision 1)",
    file: "15",
    from: "    if v_pending = 0 then",
    to: "    if false then",
  },
  // ---- configurable C/O, resorts and stay types (migrations 13, 14, 17) -----
  {
    name: "a switched-off C/O category accepted for a NEW booking (database guard)",
    file: "17",
    from: "    if not cat.is_active then",
    to: "    if false then",
  },
  {
    name: "a switched-off C/O name accepted for a NEW booking (database guard)",
    file: "17",
    from: "      if not ent.is_active then",
    to: "      if false then",
  },
  {
    name: "a C/O name from another category accepted (database guard)",
    file: "17",
    from: "      if not found or ent.category_id <> new.co_category_id then",
    to: "      if not found then",
  },
  {
    name: "a switched-off stay type accepted for a NEW booking (database guard)",
    file: "17",
    from: "    if not found or not stay.is_active then",
    to: "    if not found then",
  },
  {
    name: "renaming a category rewrites old bookings (category-name copy follows the master data)",
    file: "17",
    from: "    new.co_category_name := old.co_category_name;",
    to: "    select c.name into new.co_category_name from public.co_categories c where c.id = new.co_category_id;",
  },
  {
    name: "renaming a stay type rewrites old bookings (stay-type copy follows the master data)",
    file: "17",
    from: "    new.stay_type_name := old.stay_type_name;",
    to: "    select s.name into new.stay_type_name from public.stay_types s where s.id = new.stay_type_id;",
  },
  {
    name: "renaming a C/O name rewrites old bookings (name copy follows the master data)",
    file: "17",
    from: "      new.co_name := old.co_name;",
    to: "      select e.name into new.co_name from public.co_entries e where e.id = new.co_entry_id;",
  },
  {
    name: "booking numbers can repeat when the counter row is missing",
    file: "14",
    from: "          (select coalesce(max(b.booking_seq), 0) + 1 from public.bookings b where b.resort_id = p_resort and b.booking_year = v_year))",
    to: "          1)",
  },
  {
    name: "a name can be moved to another C/O category",
    file: "13",
    from: "      if exists (select 1 from public.co_entries e where e.id = p_id and e.category_id <> p_category_id) then",
    to: "      if false then",
  },
  {
    name: "names accepted in a category that has no list",
    file: "13",
    from: "  if v_mode <> 'listed' then",
    to: "  if false then",
  },
  {
    name: "C/O master data writable without an active account",
    file: "13",
    from: "grant execute on function public.upsert_co_category(smallint, text, text, boolean, int) to authenticated;",
    to: "grant execute on function public.upsert_co_category(smallint, text, text, boolean, int) to authenticated, anon;",
  },
  // ---- re-authentication grants, owner decision O3 (migration 19) -------------
  {
    name: "O3: switching an Owner off no longer needs a re-authentication grant",
    file: "19",
    from: "    perform public.consume_reauth(auth.uid(), 'set_active', p_id, p_active::text);   -- O3: for exactly this switch (on or off)",
    to: "    null;",
  },
  {
    name: "O3: adding an Owner no longer needs a re-authentication grant",
    file: "19",
    from: "    perform public.consume_reauth(auth.uid(), 'add_owner', p_id, v_email);   -- O3: password re-entered for this very account and email",
    to: "    null;",
  },
  {
    name: "O3: changing an Owner's email no longer needs a re-authentication grant",
    file: "19",
    from: "    perform public.consume_reauth(auth.uid(), 'change_email', p_id, v_email);   -- O3: for exactly this new email",
    to: "    null;",
  },
  {
    name: "O3: a grant can be used by a different signed-in user than the one it was issued to",
    file: "19",
    from: "where x.user_id = p_user and x.action = p_action and x.target_id = p_target",
    to: "where x.action = p_action and x.target_id = p_target",
  },
  {
    name: "O3: a grant for one account works on any other account",
    file: "19",
    from: "x.action = p_action and x.target_id = p_target",
    to: "x.action = p_action",
  },
  {
    name: "O3: M1: a grant is no longer bound to the exact operation (new flag, role or email)",
    file: "19",
    from: "and x.detail is not distinct from p_detail",
    to: "and true",
  },
  {
    name: "O3: an expired grant is still accepted",
    file: "19",
    from: "and x.used_at is null and x.expires_at > now()",
    to: "and x.used_at is null",
  },
  {
    name: "O3: a used grant can be used again (replay)",
    file: "19",
    from: "       set used_at = now()",
    to: "       set used_at = used_at",
  },
  {
    name: "O3: signed-in users can issue their own grants",
    file: "19",
    from: "grant execute on function public.issue_reauth(uuid, text, uuid, text) to service_role;",
    to: "grant execute on function public.issue_reauth(uuid, text, uuid, text) to service_role, authenticated;",
  },
  {
    name: "O3: M2: signed-in users can reserve attempts",
    file: "19",
    from: "grant execute on function public.reauth_begin(uuid, text, uuid) to service_role;",
    to: "grant execute on function public.reauth_begin(uuid, text, uuid) to service_role, authenticated;",
  },
  {
    name: "O3: M2: the five-attempt limit is gone",
    file: "19",
    from: "  if v_n >= 5 then",
    to: "  if false then",
  },
  {
    name: "O3: M2: far more than five attempts are allowed",
    file: "19",
    from: "  if v_n >= 5 then",
    to: "  if v_n >= 500 then",
  },
  {
    name: "O3: M2: a success no longer resets the attempt count",
    file: "19",
    from: "v.action = 'reauth_verified';",
    to: "v.action = 'reauth_never';",
  },
  {
    name: "O3: a Manager can reserve attempts and be given a grant",
    file: "19",
    from: "if not found or not v_actor.is_active or v_actor.role <> 'owner' then",
    to: "if not found or not v_actor.is_active then",
    all: true,
  },
  {
    name: "O3: the grants table is readable and writable by app roles",
    file: "19",
    from: "revoke all on public.reauth_grants from public, anon, authenticated, service_role;",
    to: "grant select, insert, update on public.reauth_grants to authenticated, service_role;",
  },
  {
    name: "O3: an issue request that does not say what it is for is accepted",
    file: "19",
    from: "  if not coalesce(",
    to: "  if false and coalesce(",
  },
  {
    name: "O3: L3: Managers can read the re-authentication audit rows (policy opens to every active user)",
    file: "19",
    from: "and p.role = 'owner' and p.is_active)\n  );",
    to: "and p.is_active)\n  );",
  },
  {
    name: "O3: L3: the re-authentication audit rows are readable by everyone (policy always true)",
    file: "19",
    from: "    left(action, 7) <> 'reauth_'\n    or exists (select 1 from public.user_profiles p where p.id = (select auth.uid()) and p.role = 'owner' and p.is_active)",
    to: "    true",
  },
  {
    name: "O3: M2: attempts older than 15 minutes still count (window far too long)",
    file: "19",
    from: "and a.occurred_at > now() - interval '15 minutes'",
    to: "and a.occurred_at > now() - interval '15 days'",
  },
  {
    name: "O3: M2: the window is far too short (one minute)",
    file: "19",
    from: "and a.occurred_at > now() - interval '15 minutes'",
    to: "and a.occurred_at > now() - interval '1 minute'",
  },
  {
    name: "O3: M2: an attempt exactly 15 minutes old still counts (boundary)",
    file: "19",
    from: "and a.occurred_at > now() - interval '15 minutes'",
    to: "and a.occurred_at >= now() - interval '15 minutes'",
  },
  {
    name: "O3: M2: reserved failures, not attempts, are what gets counted",
    file: "19",
    from: "where a.actor_id = p_actor and a.action = 'reauth_attempt'",
    to: "where a.actor_id = p_actor and a.action in ('reauth_attempt', 'reauth_failed')",
  },
  {
    name: "O3: M2: the attempt count is shared by every Owner (not per actor)",
    file: "19",
    from: "where a.actor_id = p_actor and a.action = 'reauth_attempt'",
    to: "where a.action = 'reauth_attempt'",
  },
  {
    name: "O3 M2 (real PostgreSQL only): attempts are no longer serialized per Owner (no advisory lock in reauth_begin)",
    file: "19",
    from: "  perform pg_advisory_xact_lock(hashtextextended('stateadv.reauth:' || p_actor::text, 0));\n  select coalesce(max(v.id), 0) into v_last",
    to: "  select coalesce(max(v.id), 0) into v_last",
    pgOnly: true,
    files: ["tests/db/concurrency.pg.test.ts"],
  },
];

let problems = 0;
const ONLY = (process.env.MUTATION_ONLY ?? "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
const SELECTED = MUTATIONS.filter(
  (x) =>
    (ONLY.length === 0 || ONLY.some((o) => x.name.includes(o))) &&
    (!x.pgOnly || process.env.STATEADV_PG_URL), // pgOnly: needs real simultaneous connections (STATEADV_PG_URL)
);
for (const m of SELECTED) {
  const dir = mkdtempSync(join(tmpdir(), "stateadv-mut-"));
  try {
    cpSync(SRC, dir, { recursive: true });
    const file = readdirSync(dir).find((f) =>
      f.startsWith(`202611110000${m.file}`),
    );
    const text = readFileSync(join(dir, file), "utf8");
    if (!text.includes(m.from))
      throw new Error(`mutation anchor not found for "${m.name}"`);
    writeFileSync(
      join(dir, file),
      m.all ? text.split(m.from).join(m.to) : text.replace(m.from, () => m.to),
    );

    // A run can end without a verdict: the test process itself can die (seen on Windows as a worker crash). That is
    // INCONCLUSIVE, not "survived": it is repeated, and only a run in which every test PASSED counts as a survivor.
    let out = "";
    let status = 0;
    let verdict = "inconclusive";
    let failed = 0;
    for (
      let attempt = 1;
      attempt <= 3 && verdict === "inconclusive";
      attempt++
    ) {
      const r = spawnSync(
        "npx",
        ["vitest", "run", ...(m.files ?? ["tests/db"])],
        {
          env: { ...process.env, STATEADV_MIGRATIONS_DIR: dir },
          encoding: "utf8",
          shell: true,
        },
      );
      out = `${r.stdout}\n${r.stderr}`.replace(ANSI, "");
      status = r.status ?? 1;
      failed = Number((out.match(/Tests\s+(\d+) failed/) ?? [])[1] ?? 0);
      const crashed =
        /Worker exited unexpectedly|exited unexpectedly|Worker forks emitted error/.test(
          out,
        );
      if (/Migration .* failed/.test(out)) verdict = "invalid";
      else if (failed > 0 && status !== 0 && !crashed) verdict = "caught";
      else if (failed > 0 && status !== 0)
        verdict = "caught"; // real failing assertions were counted even though a worker also died
      else if (status === 0) verdict = "survived";
      else verdict = "inconclusive"; // non-zero exit, no failing assertion counted: the test process died
    }
    if (verdict === "invalid") {
      problems++;
      console.log(
        `INVALID   ${m.name}  (the weakened SQL did not even run - fix the mutation)`,
      );
      continue;
    }
    if (verdict !== "caught") problems++;
    console.log(
      `${verdict === "caught" ? "CAUGHT  " : verdict === "survived" ? "SURVIVED" : "INCONCLUSIVE"}  ${m.name}  (${failed} test(s) failed)`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
console.log(
  problems === 0
    ? `\nAll ${SELECTED.length} weakened versions were caught by the tests${SELECTED.length < MUTATIONS.length ? ` (a selection; ${MUTATIONS.length} exist)` : ""}.`
    : `\n${problems} problem(s): a weakened version survived, was inconclusive after 3 tries, or a mutation was invalid.`,
);
process.exit(problems === 0 ? 0 : 1);
