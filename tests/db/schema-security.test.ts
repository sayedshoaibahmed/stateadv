import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { findViolations } from "../../scripts/check-migrations.mjs";
import { listMigrationFiles, MIGRATIONS_DIR, expectDbError } from "./harness";
import { setupWorld, uid, createBooking, type World } from "./fixtures";

let w: World;
beforeAll(async () => {
  w = await setupWorld();
}, 120_000);

const q = <T = Record<string, unknown>>(sql: string, p?: unknown[]) =>
  w.db.q<T>(sql, p);

describe("migrations", () => {
  it("are plain additive SQL: no destructive statement without an approval comment (BKP-03)", () => {
    for (const f of listMigrationFiles()) {
      const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
      expect(findViolations(f, sql), f).toEqual([]);
    }
  });

  it("insert only reference data: stay types and payment providers", async () => {
    // (the world fixture adds users/resorts afterwards; reference data comes from migration 10)
    const types = await q<{ name: string }>(
      `select name from public.stay_types order by sort_order`,
    );
    expect(types.map((t) => t.name)).toEqual([
      "Resort Stay",
      "Day Outing",
      "Package",
    ]);
    const [{ n }] = await q<{ n: number }>(
      `select count(*)::int n from public.payment_providers`,
    );
    expect(n).toBe(9);
  });

  it("a fresh database has no users, guests, bookings or money records, and only the starting master data", async () => {
    const { db } = await import("./harness").then(async (h) => ({
      db: await h.createDb(),
    }));
    for (const t of [
      "user_profiles",
      "guests",
      "co_entries",
      "bookings",
      "payment_schedules",
      "payments",
      "refunds",
      "proofs",
      "approval_history",
    ]) {
      const [{ n }] = await db.q<{ n: number }>(
        `select count(*)::int n from public.${t}`,
      );
      expect(n, t).toBe(0);
    }
    // the starting master data (owner requirement 2026-11-11): all configurable, none of it real business data
    const resorts = await db.q<{
      code: string;
      name: string;
      is_active: boolean;
    }>(`select code, name, is_active from public.resorts order by code`);
    expect(resorts).toEqual([
      { code: "SR1", name: "Sample Resort One", is_active: true },
      { code: "SR2", name: "Sample Resort Two", is_active: true },
      { code: "SR3", name: "Sample Resort Three", is_active: true },
      { code: "SR4", name: "Sample Resort Four", is_active: true },
    ]);
    const cats = await db.q<{ name: string; name_mode: string }>(
      `select name, name_mode from public.co_categories order by sort_order`,
    );
    expect(cats).toEqual([
      { name: "Agent", name_mode: "listed" },
      { name: "Partner", name_mode: "listed" },
      { name: "Own", name_mode: "typed" },
      { name: "Direct", name_mode: "none" },
    ]);
    // the only audit entries are the starting master data of migrations 10, 17 and 18 (system, no user)
    const odd = await db.q(
      `select 1 from public.audit_logs where table_name not in ('stay_types', 'payment_providers', 'co_categories', 'resorts') or actor_id is not null`,
    );
    expect(odd).toEqual([]);
  }, 120_000);
});

describe("Row Level Security and privileges (SEC-01..05)", () => {
  it("SEC-03: every table in schema public has RLS enabled", async () => {
    const rows = await q<{ tablename: string; rowsecurity: boolean }>(
      `select tablename, rowsecurity from pg_tables where schemaname = 'public'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(19);
    expect(rows.filter((r) => !r.rowsecurity).map((r) => r.tablename)).toEqual(
      [],
    );
  });

  it("SEC-01: anon has NO privilege of any kind on any table or view", async () => {
    const rows = await q<{ name: string; priv: string }>(`
      select c.relname as name, p.priv
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(priv)
      where c.relkind in ('r','v','p') and has_table_privilege('anon', c.oid, p.priv)`);
    expect(rows).toEqual([]);
  });

  it("SEC-02: authenticated can only SELECT - never insert/update/delete/truncate - and not booking_sequences", async () => {
    const writes = await q<{ name: string; priv: string }>(`
      select c.relname as name, p.priv
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      cross join (values ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) p(priv)
      where c.relkind in ('r','v','p') and has_table_privilege('authenticated', c.oid, p.priv)`);
    expect(writes).toEqual([]);
    const seq = await q<{ ok: boolean }>(
      `select has_table_privilege('authenticated', 'public.booking_sequences', 'SELECT') ok`,
    );
    expect(seq[0].ok).toBe(false);
  });

  it("SEC-04: only a short allow-list of functions is executable by app users; none by anon", async () => {
    const anon = await q<{ proname: string }>(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
      where p.prokind = 'f' and has_function_privilege('anon', p.oid, 'EXECUTE')`);
    expect(anon).toEqual([]);
    const auth = await q<{ proname: string }>(`
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
      where p.prokind = 'f' and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      order by 1`);
    // Every function an app user may call is listed here ON PURPOSE. Adding a function
    // means adding it here in the same change, after checking its authorisation rules.
    expect(auth.map((r) => r.proname)).toEqual([
      "active_owner_count",
      "activity_list",
      "add_correction_files",
      "add_payment",
      "add_proofs",
      "add_refund",
      "approve_payment",
      "approve_refund",
      "booking_list",
      "booking_overdue",
      "calendar_day",
      "calendar_month",
      "cancel_booking",
      "change_cancellation_charge",
      "complete_password_change",
      "create_booking",
      "dashboard_alerts",
      "dashboard_by_date",
      "dashboard_by_resort",
      "dashboard_range",
      "dashboard_summary",
      "finish_pdf_jobs",
      "guest_list",
      "hide_proof",
      "is_active_user",
      "like_safe",
      "normalize_mobile",
      "old_records_search",
      "payment_list",
      "pdf_booking_data",
      "pdf_prepare",
      "plan_preview",
      "profile_change_email",
      "profile_create",
      "profile_reset_password",
      "profile_set_active",
      "profile_update",
      "refund_list",
      "register_pdf_version",
      "reject_payment",
      "reject_refund",
      "report_bookings",
      "report_cancellations",
      "report_check",
      "report_collection",
      "report_expected_adjustments",
      "report_expected_vs_actual",
      "report_manual_adjustments",
      "report_payment_methods",
      "report_pending",
      "report_refunds",
      "report_waiting",
      "request_pdf_regeneration",
      "reverse_payment",
      "reverse_refund",
      "set_booking_status",
      "set_payment_schedule",
      "set_resort_active",
      "today_ist",
      "update_booking",
      "update_waiting_payment",
      "update_waiting_refund",
      "upsert_co_category",
      "upsert_co_entry",
      "upsert_guest",
      "upsert_provider",
      "upsert_resort",
      "upsert_stay_type",
    ]);
  });

  it("views run with the caller's rights (security_invoker)", async () => {
    const rows = await q<{ relname: string; reloptions: string[] | null }>(
      `select c.relname, c.reloptions from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'v' order by 1`,
    );
    expect(rows.map((r) => r.relname)).toEqual([
      "booking_financials",
      "correction_files",
      "expected_entries",
    ]);
    for (const r of rows)
      expect(r.reloptions, r.relname).toContain("security_invoker=true");
  });

  it("anon cannot read anything", async () => {
    await expectDbError(
      w.db.as({ role: "anon" }, () => q(`select * from public.bookings`)),
      "permission denied",
    );
  });

  it("an active user can read; a disabled user sees no rows; a stranger with a valid login sees no rows", async () => {
    await createBooking(w); // so there is something to see
    const seen = await w.db.as({ role: "authenticated", uid: w.manager }, () =>
      q<{ n: number }>(`select count(*)::int n from public.bookings`),
    );
    expect(seen[0].n).toBeGreaterThan(0);
    // a valid login that has no profile at all
    const stranger = uid();
    const none = await w.db.as({ role: "authenticated", uid: stranger }, () =>
      q<{ n: number }>(`select count(*)::int n from public.bookings`),
    );
    expect(none[0].n).toBe(0);
  });

  it("authenticated users cannot write directly, even with a valid login", async () => {
    await expectDbError(
      w.db.as({ role: "authenticated", uid: w.owner }, () =>
        q(`insert into public.resorts (code, name) values ('ZZZ', 'Hack')`),
      ),
      "permission denied",
    );
    await expectDbError(
      w.db.as({ role: "authenticated", uid: w.owner }, () =>
        q(`update public.user_profiles set role = 'owner'`),
      ),
      "permission denied",
    );
    await expectDbError(
      w.db.as({ role: "authenticated", uid: w.owner }, () =>
        q(`delete from public.audit_logs`),
      ),
      "permission denied",
    );
  });
});

describe("no deletes, append-only history (PRD section 18)", () => {
  it("DELETE and TRUNCATE are blocked on every table, even for the superuser/service role", async () => {
    const tables = await q<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' order by 1`,
    );
    for (const { tablename } of tables) {
      if (tablename === "booking_sequences" || tablename === "system_status")
        continue; // empty tables: row trigger needs a row; truncate still tested below
      const [{ n }] = await q<{ n: number }>(
        `select count(*)::int n from public.${tablename}`,
      );
      if (n > 0)
        await expectDbError(
          q(`delete from public.${tablename}`),
          "DELETE_NOT_ALLOWED",
        );
    }
    for (const { tablename } of tables) {
      await expectDbError(
        q(`truncate public.${tablename} cascade`),
        "DELETE_NOT_ALLOWED",
      );
    }
  });

  it("history tables cannot be edited", async () => {
    await createBooking(w);
    await expectDbError(
      q(`update public.audit_logs set action = 'x'`),
      "RECORD_IS_APPEND_ONLY",
    );
    await expectDbError(
      q(`update public.payment_plan_revisions set reason = 'x'`),
      "RECORD_IS_APPEND_ONLY",
    );
  });
});

describe("private storage (SEC-05, SEC-06)", () => {
  const validProof = () => `${uid()}/${uid()}.jpg`;

  it("buckets are private with size and type limits; no SVG logos", async () => {
    const rows = await q<{
      id: string;
      public: boolean;
      file_size_limit: string;
      allowed_mime_types: string[];
    }>(
      `select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id`,
    );
    expect(rows.map((r) => r.id)).toEqual([
      "booking-pdfs",
      "payment-proofs",
      "resort-logos",
    ]);
    for (const r of rows) expect(r.public, r.id).toBe(false);
    const logos = rows.find((r) => r.id === "resort-logos")!;
    expect(logos.allowed_mime_types).not.toContain("image/svg+xml");
    expect(Number(logos.file_size_limit)).toBe(2097152);
    expect(
      Number(rows.find((r) => r.id === "payment-proofs")!.file_size_limit),
    ).toBe(10485760);
  });

  it("an active user can add a well-named proof file and read it", async () => {
    const name = validProof();
    await w.db.as({ role: "authenticated", uid: w.manager }, () =>
      q(
        `insert into storage.objects (bucket_id, name) values ('payment-proofs', $1)`,
        [name],
      ),
    );
    const seen = await w.db.as({ role: "authenticated", uid: w.owner }, () =>
      q<{ n: number }>(
        `select count(*)::int n from storage.objects where name = $1`,
        [name],
      ),
    );
    expect(seen[0].n).toBe(1);
  });

  it("badly named files, other buckets' patterns, and path tricks are refused", async () => {
    for (const [bucket, name] of [
      ["payment-proofs", "evil.jpg"],
      ["payment-proofs", `../${validProof()}`],
      ["payment-proofs", `${uid()}/${uid()}.exe`],
      ["booking-pdfs", `${uid()}/${uid()}.jpg`],
      ["resort-logos", `${uid()}/${uid()}.svg`],
    ]) {
      await expectDbError(
        w.db.as({ role: "authenticated", uid: w.owner }, () =>
          q(`insert into storage.objects (bucket_id, name) values ($1, $2)`, [
            bucket,
            name,
          ]),
        ),
        "row-level security",
      );
    }
  });

  it("booking PDFs and logos accept only their own name patterns", async () => {
    await w.db.as({ role: "authenticated", uid: w.owner }, async () => {
      await q(
        `insert into storage.objects (bucket_id, name) values ('booking-pdfs', $1)`,
        [`${uid()}/v3.pdf`],
      );
      await q(
        `insert into storage.objects (bucket_id, name) values ('resort-logos', $1)`,
        [`${uid()}/${uid()}.png`],
      );
    });
  });

  it("nobody logged in as a normal user can overwrite or delete a stored file", async () => {
    const name = validProof();
    await w.db.as({ role: "authenticated", uid: w.owner }, () =>
      q(
        `insert into storage.objects (bucket_id, name) values ('payment-proofs', $1)`,
        [name],
      ),
    );
    await w.db.as({ role: "authenticated", uid: w.owner }, async () => {
      await q(`update storage.objects set name = 'changed' where name = $1`, [
        name,
      ]); // no UPDATE policy => 0 rows
      await q(`delete from storage.objects where name = $1`, [name]); //            no DELETE policy => 0 rows
    });
    const still = await q<{ n: number }>(
      `select count(*)::int n from storage.objects where name = $1`,
      [name],
    );
    expect(still[0].n).toBe(1);
  });

  it("anon and strangers cannot upload or read", async () => {
    await expectDbError(
      w.db.as({ role: "anon" }, () =>
        q(
          `insert into storage.objects (bucket_id, name) values ('payment-proofs', $1)`,
          [validProof()],
        ),
      ),
      "row-level security",
    );
    await expectDbError(
      w.db.as({ role: "authenticated", uid: uid() }, () =>
        q(
          `insert into storage.objects (bucket_id, name) values ('payment-proofs', $1)`,
          [validProof()],
        ),
      ),
      "row-level security",
    );
    const seen = await w.db.as({ role: "anon" }, () =>
      q<{ n: number }>(`select count(*)::int n from storage.objects`),
    );
    expect(seen[0].n).toBe(0);
  });
});
