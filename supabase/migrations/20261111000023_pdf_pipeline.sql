-- =============================================================================
-- 23 BOOKING PDF PIPELINE (M6)
--
-- The tables already exist (migration 05: booking_pdf_versions, pdf_jobs; migration 09: the private "booking-pdfs"
-- bucket) and every write function already queues a pdf_jobs row in its own transaction (migrations 14 and 15). This
-- migration adds only the functions the pipeline needs (TRD 5.6, PRD FR-PDF-1..6):
--
--   pdf_booking_data   everything printed on the PDF, read from the trusted tables and views in one place, so the PDF
--                      code never calculates a figure (money comes from booking_financials, rule D1, unchanged)
--   pdf_prepare        what to do next for a booking: is a new version needed, its number and file name, its hash
--   register_pdf_version  records a rendered and uploaded file as the next version (checks everything again)
--   finish_pdf_jobs    marks the queued jobs of a booking done or failed
--   claim_pdf_jobs     the retry job picks up open jobs (FOR UPDATE SKIP LOCKED); service role only
--   request_pdf_regeneration  the "Regenerate PDF" button queues a job
--
-- Who may call them: an active, signed-in user, or the service role (the retry job). Every function checks that
-- itself (pdf_actor); anonymous callers cannot execute any of them. They never change a booking, a payment, a refund
-- or a balance; the only things they write are PDF versions (append-only, migration 06) and the status of jobs.
-- SECURITY DEFINER with an empty search_path and every name schema-qualified, like the other write functions.
--
-- Content hash: SHA-256 of the canonical text of the printed data, WITHOUT the generation time. If it equals the latest
-- version's hash, no new version is made (FR-PDF-5). A version number is max + 1 under the booking's row lock; the
-- table's UNIQUE (booking_id, version_no) makes a duplicate impossible even so.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Who is calling: a signed-in ACTIVE user (returns their id) or the service role (returns NULL = "the system").
-- `role` is the database role the request runs as (SET ROLE), which a client cannot choose.
-- ---------------------------------------------------------------------------
create function public.pdf_actor()
returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if current_setting('role', true) = 'service_role' then
    return null;
  end if;
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'NOT_ALLOWED' using detail = 'Only an active, logged-in user can do this.';
  end if;
  return auth.uid();
end
$$;
revoke all on function public.pdf_actor() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- pdf_booking_data: the printed content as JSON. Dates and times are IST text; money is whole paise copied from the
-- booking and from booking_financials; lists are in a fixed order, so the same data always gives the same text.
-- ---------------------------------------------------------------------------
create function public.pdf_booking_data(p_booking uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  b     public.bookings;
  f     public.booking_financials;
  r     public.resorts;
  v_out jsonb;
begin
  perform public.pdf_actor();
  select * into b from public.bookings where id = p_booking;
  if not found then
    raise exception 'NOT_FOUND' using detail = 'Booking not found.';
  end if;
  select * into f from public.booking_financials where booking_id = p_booking;
  select * into r from public.resorts where id = b.resort_id;

  v_out := jsonb_build_object(
    'booking', jsonb_build_object(
      'code', b.booking_code,
      'status', b.status::text,
      'resort_name', r.name,
      'resort_code', r.code,
      'logo_path', r.logo_path,
      'booking_date', to_char(b.booking_date, 'YYYY-MM-DD'),
      'check_in', to_char(b.check_in_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI'),
      'check_out', to_char(b.check_out_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI'),
      'nights', b.nights,
      'pax', b.pax,
      'stay_type', b.stay_type_name,
      'co_category', b.co_category_name,
      'co_name', b.co_name,
      'pricing_method', b.pricing_method::text,
      'tariff_paise', b.tariff_per_person_paise,
      'base_paise', b.base_amount_paise,
      'extra_paise', b.extra_charges_paise,
      'extra_note', b.extra_charges_note,
      'total_paise', b.total_amount_paise,
      'discount_paise', b.discount_paise,
      'adjustment_paise', b.manual_adjustment_paise,
      'adjustment_reason', b.manual_adjustment_reason,
      'final_paise', b.final_amount_paise,
      'remarks', b.remarks
    ),
    'guest', jsonb_build_object('name', b.guest_name, 'mobile', b.guest_mobile),
    'cancellation', case when b.status in ('cancelled', 'no_show') then jsonb_build_object(
      'kind', b.status::text,
      'date', to_char(b.cancellation_date, 'YYYY-MM-DD'),
      'reason', b.cancellation_reason,
      'charge_paise', b.cancellation_charge_paise,
      'original_final_paise', b.final_amount_paise,
      'charge_change_reason', b.charge_change_reason) end,
    'plan', coalesce((
      select jsonb_agg(jsonb_build_object('label', s.label, 'due_date', to_char(s.due_date, 'YYYY-MM-DD'), 'amount_paise', s.amount_paise)
                       order by s.due_date, s.line_no, s.id)
        from public.payment_schedules s where s.booking_id = p_booking and s.superseded_at is null), '[]'::jsonb),
    'adjustments', coalesce((
      select jsonb_agg(jsonb_build_object('date', to_char(a.adjustment_date, 'YYYY-MM-DD'), 'amount_paise', a.amount_paise, 'reason', a.reason)
                       order by a.adjustment_date, a.created_at, a.id)
        from public.expected_adjustments a where a.booking_id = p_booking), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', p.payment_code, 'amount_paise', p.amount_paise, 'method', p.method::text,
               'provider', case when pp.name = 'Other' then coalesce(p.provider_other, pp.name) else pp.name end,
               'date', to_char(p.payment_date, 'YYYY-MM-DD'), 'status', p.status::text,
               'self_approved', coalesce(p.is_self_approved, false))
             order by p.payment_date, p.recorded_at, p.id)
        from public.payments p left join public.payment_providers pp on pp.id = p.provider_id
       where p.booking_id = p_booking), '[]'::jsonb),
    'refunds', coalesce((
      select jsonb_agg(jsonb_build_object(
               'code', x.refund_code, 'amount_paise', x.amount_paise, 'method', x.method::text,
               'provider', case when pp.name = 'Other' then coalesce(x.provider_other, pp.name) else pp.name end,
               'date', to_char(x.refund_date, 'YYYY-MM-DD'), 'status', x.status::text, 'reason', x.reason,
               'self_approved', coalesce(x.is_self_approved, false))
             order by x.refund_date, x.recorded_at, x.id)
        from public.refunds x left join public.payment_providers pp on pp.id = x.provider_id
       where x.booking_id = p_booking), '[]'::jsonb),
    'corrections', coalesce((
      select jsonb_agg(jsonb_build_object(
               'record_code', c.record_code, 'kind', c.kind, 'file_name', c.file_name,
               'date', to_char(c.at_ist, 'YYYY-MM-DD'), 'by', c.by_name, 'reason', c.correction_reason)
             order by c.at_ist, c.proof_id)
        from (
          select f2.id as proof_id, f2.original_file_name as file_name, f2.correction_reason,
                 (f2.uploaded_at at time zone 'Asia/Kolkata') as at_ist, u.full_name as by_name,
                 coalesce(p2.payment_code, r2.refund_code) as record_code,
                 case when f2.payment_id is not null then 'payment' else 'refund' end as kind
            from public.proofs f2
            left join public.payments p2 on p2.id = f2.payment_id
            left join public.refunds r2 on r2.id = f2.refund_id
            left join public.user_profiles u on u.id = f2.uploaded_by
           where f2.is_correction and f2.hidden_at is null
             and (p2.booking_id = p_booking or r2.booking_id = p_booking)
        ) c), '[]'::jsonb),
    'totals', jsonb_build_object(
      'amount_due_paise', coalesce(f.due_paise, 0),
      'total_collection_paise', coalesce(f.total_collection_paise, 0),
      'waiting_paise', coalesce(f.waiting_paise, 0),
      'refunds_approved_paise', coalesce(f.refunds_approved_paise, 0),
      'refunds_waiting_paise', coalesce(f.refunds_waiting_paise, 0),
      'net_collection_paise', coalesce(f.net_collection_paise, 0),
      'pending_paise', coalesce(f.pending_paise, 0),
      'verified_remaining_paise', coalesce(f.verified_remaining_paise, 0),
      'extra_paise', coalesce(f.extra_paise, 0),
      'refund_due_paise', coalesce(f.refund_due_paise, 0))
  );
  return v_out;
end
$$;
revoke all on function public.pdf_booking_data(uuid) from public, anon;
grant execute on function public.pdf_booking_data(uuid) to authenticated, service_role;

-- the hash of the printed data (no generation time in it)
create function public.pdf_hash(p_data jsonb)
returns text
language sql immutable
set search_path = ''
as $$ select encode(sha256(convert_to(p_data::text, 'UTF8')), 'hex') $$;
revoke all on function public.pdf_hash(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- pdf_prepare: what the generator should do for a booking right now.
--   needed = false  nothing printed has changed since the latest version (FR-PDF-5): do not render
--   version_no / path  the next version and its object name inside "booking-pdfs": {booking}/v{n}.pdf
-- ---------------------------------------------------------------------------
create function public.pdf_prepare(p_booking uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_data   jsonb;
  v_hash   text;
  v_last   record;
begin
  v_data := public.pdf_booking_data(p_booking);          -- checks the caller
  v_hash := public.pdf_hash(v_data);
  select v.version_no, v.content_hash into v_last
    from public.booking_pdf_versions v where v.booking_id = p_booking order by v.version_no desc limit 1;
  return jsonb_build_object(
    'needed', v_last.version_no is null or v_last.content_hash <> v_hash,
    'version_no', coalesce(v_last.version_no, 0) + 1,
    'path', p_booking::text || '/v' || (coalesce(v_last.version_no, 0) + 1)::text || '.pdf',
    'hash', v_hash,
    'latest_version', v_last.version_no,
    'data', v_data);
end
$$;
revoke all on function public.pdf_prepare(uuid) from public, anon;
grant execute on function public.pdf_prepare(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- register_pdf_version: the file is uploaded; record it as the next version. Everything is checked again under the
-- booking's row lock: the printed data must still hash to what was rendered (else PDF_STALE: render again), the number
-- must be the next one (else PDF_VERSION_CONFLICT), and the file must really be in storage with the size and type that
-- STORAGE recorded. If the data equals the latest version, nothing is created (created = false).
-- ---------------------------------------------------------------------------
create function public.register_pdf_version(p_booking uuid, p_hash text, p_version int, p_reason text, p_size int)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor  uuid := public.pdf_actor();
  v_data   jsonb;
  v_hash   text;
  v_last   record;
  v_path   text;
  v_obj    record;
  v_id     uuid := gen_random_uuid();
  v_reason text := left(btrim(coalesce(p_reason, '')), 200);
begin
  perform 1 from public.bookings where id = p_booking for update;
  if not found then
    raise exception 'NOT_FOUND' using detail = 'Booking not found.';
  end if;
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' or p_version is null or p_version < 1 or p_size is null or p_size not between 1 and 10485760 then
    raise exception 'INVALID_INPUT' using detail = 'The PDF details are not valid.';
  end if;
  if v_reason = '' then
    v_reason := 'generated';
  end if;
  v_data := public.pdf_booking_data(p_booking);
  v_hash := public.pdf_hash(v_data);
  if v_hash <> p_hash then
    raise exception 'PDF_STALE' using detail = 'The booking changed while the PDF was being made. It will be made again.';
  end if;
  select v.version_no, v.content_hash into v_last
    from public.booking_pdf_versions v where v.booking_id = p_booking order by v.version_no desc limit 1;
  if v_last.version_no is not null and v_last.content_hash = v_hash then
    return jsonb_build_object('created', false, 'version_no', v_last.version_no);
  end if;
  if p_version <> coalesce(v_last.version_no, 0) + 1 then
    raise exception 'PDF_VERSION_CONFLICT' using detail = 'Another PDF version was made at the same time. It will be tried again.';
  end if;
  v_path := p_booking::text || '/v' || p_version::text || '.pdf';
  select o.metadata into v_obj from storage.objects o where o.bucket_id = 'booking-pdfs' and o.name = v_path;
  if not found then
    raise exception 'INVALID_FILE' using detail = 'The file was not uploaded.';
  end if;
  if v_obj.metadata is null
     or (v_obj.metadata ->> 'size') is distinct from p_size::text
     or (v_obj.metadata ->> 'mimetype') is distinct from 'application/pdf' then
    raise exception 'INVALID_FILE' using detail = 'The uploaded file does not match its description.';
  end if;
  insert into public.booking_pdf_versions (id, booking_id, version_no, storage_path, content_hash, trigger_reason, summary, size_bytes, generated_by)
  values (v_id, p_booking, p_version, v_path, v_hash, v_reason, v_data -> 'totals', p_size, v_actor);
  return jsonb_build_object('created', true, 'id', v_id, 'version_no', p_version, 'path', v_path);
end
$$;
revoke all on function public.register_pdf_version(uuid, text, int, text, int) from public, anon;
grant execute on function public.register_pdf_version(uuid, text, int, text, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- finish_pdf_jobs: the open jobs of a booking up to a job number are done (p_ok) or failed. Jobs queued while the PDF
-- was being made have a higher number and stay open. Two kinds of caller, two sets of rules:
--
--   the retry job (service role)  may finish jobs it claimed (status running) as well as pending/failed ones, with its
--                                 own error text (cut to 300 characters; it never contains booking data).
--   a person (active session)     may finish only pending or failed jobs, never a running one (that belongs to the
--                                 retry job). "Done" is accepted only when the latest REGISTERED version already
--                                 represents the booking as it is now (its hash equals the hash recomputed here from
--                                 the trusted tables; nothing the caller sends is trusted); otherwise 0 is returned
--                                 and the jobs stay open. "Failed" always stores the fixed text, never the caller's.
-- ---------------------------------------------------------------------------
create function public.finish_pdf_jobs(p_booking uuid, p_up_to bigint, p_ok boolean, p_error text default null)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor  uuid := public.pdf_actor();      -- NULL = the service role (retry job), otherwise the signed-in person
  v_system boolean;
  v_now    text;
  n        int;
begin
  v_system := v_actor is null;
  if not v_system and p_ok then
    v_now := public.pdf_hash(public.pdf_booking_data(p_booking));
    perform 1
       from public.booking_pdf_versions v
      where v.booking_id = p_booking
        and v.version_no = (select max(v2.version_no) from public.booking_pdf_versions v2 where v2.booking_id = p_booking)
        and v.content_hash = v_now;
    if not found then
      return 0;
    end if;
  end if;
  update public.pdf_jobs
     set status = case when p_ok then 'done'::public.pdf_job_status else 'failed'::public.pdf_job_status end,
         last_error = case
                        when p_ok then null
                        when v_system then left(btrim(coalesce(p_error, 'The PDF could not be made.')), 300)
                        else 'The PDF could not be made.' end,
         updated_at = now()
   where booking_id = p_booking and id <= p_up_to
     and ((v_system and status in ('pending', 'running', 'failed'))
          or (not v_system and status in ('pending', 'failed')));
  get diagnostics n = row_count;
  return n;
end
$$;
revoke all on function public.finish_pdf_jobs(uuid, bigint, boolean, text) from public, anon;
grant execute on function public.finish_pdf_jobs(uuid, bigint, boolean, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- claim_pdf_jobs: the retry job (service role only). Open jobs that have not been tried 5 times, plus jobs left
-- "running" for 15 minutes (a crashed attempt). FOR UPDATE SKIP LOCKED so two runs never take the same job.
-- ---------------------------------------------------------------------------
create function public.claim_pdf_jobs(p_max int default 10)
returns table (job_id bigint, booking_id uuid, reason text, attempts int)
language plpgsql security definer
set search_path = ''
as $$
begin
  if current_setting('role', true) <> 'service_role' then
    raise exception 'NOT_ALLOWED' using detail = 'Only the retry job can do this.';
  end if;
  return query
  with picked as (
    select j.id from public.pdf_jobs j
     where (j.status in ('pending', 'failed') and j.attempts < 5)
        or (j.status = 'running' and j.updated_at < now() - interval '15 minutes')
     order by j.id
     limit least(greatest(coalesce(p_max, 10), 1), 50)
       for update skip locked
  )
  update public.pdf_jobs j
     set status = 'running', attempts = j.attempts + 1, updated_at = now()
    from picked
   where j.id = picked.id
  returning j.id, j.booking_id, j.reason, j.attempts;
end
$$;
revoke all on function public.claim_pdf_jobs(int) from public, anon, authenticated;
grant execute on function public.claim_pdf_jobs(int) to service_role;

-- ---------------------------------------------------------------------------
-- request_pdf_regeneration: the "Regenerate PDF" button. Queues a job; the app then makes the PDF. If nothing printed
-- has changed since the latest version, no new version is created (FR-PDF-5).
-- ---------------------------------------------------------------------------
create function public.request_pdf_regeneration(p_booking uuid)
returns bigint
language plpgsql security definer
set search_path = ''
as $$
declare v_id bigint;
begin
  perform public.require_active_user();
  perform 1 from public.bookings where id = p_booking;
  if not found then
    raise exception 'NOT_FOUND' using detail = 'Booking not found.';
  end if;
  insert into public.pdf_jobs (booking_id, reason) values (p_booking, 'regenerate requested') returning id into v_id;
  return v_id;
end
$$;
revoke all on function public.request_pdf_regeneration(uuid) from public, anon;
grant execute on function public.request_pdf_regeneration(uuid) to authenticated;
