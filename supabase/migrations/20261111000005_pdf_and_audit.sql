-- =============================================================================
-- 05 PDF VERSIONS / JOBS, AUDIT LOG, SYSTEM STATUS
-- =============================================================================

-- ---------------------------------------------------------------------------
-- booking_pdf_versions (append-only): every PDF ever generated is kept.
-- ---------------------------------------------------------------------------
create table public.booking_pdf_versions (
  id             uuid primary key default gen_random_uuid(),
  booking_id     uuid not null references public.bookings (id) on delete restrict,
  version_no     int  not null,
  storage_path   text not null,       -- object name inside bucket "booking-pdfs"
  content_hash   text not null,       -- hash of the printed data; same data => no new version
  trigger_reason text not null,
  summary        jsonb not null,      -- the money figures printed on this version
  size_bytes     int,
  generated_by   uuid references public.user_profiles (id),
  generated_at   timestamptz not null default now(),

  constraint booking_pdf_versions_no_key   unique (booking_id, version_no),
  constraint booking_pdf_versions_path_key unique (storage_path),
  constraint booking_pdf_versions_no_min   check (version_no >= 1),
  constraint booking_pdf_versions_size     check (size_bytes is null or size_bytes between 1 and 10485760)
);

-- ---------------------------------------------------------------------------
-- pdf_jobs: queue so a PDF failure never loses or blocks a booking/payment.
-- ---------------------------------------------------------------------------
create table public.pdf_jobs (
  id         bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings (id) on delete restrict,
  reason     text not null,
  status     public.pdf_job_status not null default 'pending',
  attempts   int  not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pdf_jobs_attempts check (attempts >= 0)
);
create index pdf_jobs_open_idx on public.pdf_jobs (id) where status in ('pending', 'failed');

-- ---------------------------------------------------------------------------
-- audit_logs (append-only): who did what to which record, with old/new values.
-- booking_id / resort_id / target_user_id are plain columns (no foreign keys)
-- so the log can never block, or be broken by, a schema change.
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id             bigint generated always as identity primary key,
  occurred_at    timestamptz not null default now(),
  actor_id       uuid,               -- auth.uid(); null = system / maintenance
  actor_name     text,               -- name at that time
  action         text not null,
  table_name     text not null,
  record_id      text not null,
  booking_id     uuid,
  resort_id      uuid,
  target_user_id uuid,
  old_data       jsonb,
  new_data       jsonb,
  changed_fields text[],
  reason         text
);
create index audit_logs_time_idx    on public.audit_logs (occurred_at desc);
create index audit_logs_record_idx  on public.audit_logs (table_name, record_id);
create index audit_logs_booking_idx on public.audit_logs (booking_id) where booking_id is not null;
create index audit_logs_actor_idx   on public.audit_logs (actor_id, occurred_at desc);
create index audit_logs_target_idx  on public.audit_logs (target_user_id) where target_user_id is not null;

-- ---------------------------------------------------------------------------
-- system_status: last backup time, integrity-check results, ...
-- ---------------------------------------------------------------------------
create table public.system_status (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Generic row-change audit trigger (attached in migration 06).
-- SECURITY DEFINER: the audit table has no write grants for app users.
-- Passwords never exist in these tables, so nothing sensitive is copied.
-- ---------------------------------------------------------------------------
create function public.audit_row_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  j_new   jsonb := to_jsonb(new);
  j_old   jsonb;
  changed text[];
  act     text;
  bk      uuid;
  rs      uuid;
  tgt     uuid;
  who     text;
begin
  if tg_op = 'INSERT' then
    act := 'insert';
  else
    j_old := to_jsonb(old);
    act := 'update';
    select array_agg(k order by k) into changed
    from jsonb_object_keys(j_new) as keys(k)
    where j_new -> k is distinct from j_old -> k
      and k not in ('updated_at', 'updated_by', 'version');
    if changed is null then
      return null;                       -- nothing meaningful changed
    end if;
  end if;

  bk := coalesce(
          nullif(j_new ->> 'booking_id', '')::uuid,
          case when tg_table_name = 'bookings' then (j_new ->> 'id')::uuid end);
  if bk is null and tg_table_name = 'proofs' then
    select p.booking_id into bk from public.payments p where p.id = nullif(j_new ->> 'payment_id', '')::uuid;
    if bk is null then
      select r.booking_id into bk from public.refunds r where r.id = nullif(j_new ->> 'refund_id', '')::uuid;
    end if;
  end if;
  rs  := coalesce(
          nullif(j_new ->> 'resort_id', '')::uuid,
          case when tg_table_name = 'resorts' then (j_new ->> 'id')::uuid end);
  tgt := case when tg_table_name = 'user_profiles' then (j_new ->> 'id')::uuid end;

  select p.full_name into who from public.user_profiles p where p.id = auth.uid();

  insert into public.audit_logs
    (actor_id, actor_name, action, table_name, record_id, booking_id, resort_id, target_user_id, old_data, new_data, changed_fields)
  values
    (auth.uid(), who, act, tg_table_name, coalesce(j_new ->> 'id', ''), bk, rs, tgt, j_old, j_new, changed);
  return null;
end
$$;
