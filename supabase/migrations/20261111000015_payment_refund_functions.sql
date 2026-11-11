-- =============================================================================
-- 15 PAYMENTS, REFUNDS, APPROVALS, PROOF FILES AND CORRECTION FILES
-- PRD 5.8 (payments), 5.9 (approval), 5.10 (refunds); decisions Q7b, Q8, Q9, Q9a, D1, D3, D5.
--
-- What is NOT done here, because the guard triggers from migration 06 already do it and
-- cannot be bypassed: the refund limit (D1), reversal protection (D5), who decided and when,
-- locked decided records, the proof rule at COMMIT (D3), correction-file rules (Q9a),
-- approval history, payment/refund numbers.
--
-- What these functions add: input checks, "press Save twice" safety (idempotency), warnings that
-- do not block saving (FR-PAY-6), the stored-file checks, one fixed lock order (see below),
-- and "who already decided" messages (FR-APR-6).
--
-- LOCK ORDER (prevents deadlocks): every money-changing function locks the BOOKING row first,
-- then the payment/refund row. Two people acting on the same booking therefore take turns.
-- =============================================================================

create function public.pl_time(p jsonb, k text)
returns time language plpgsql immutable set search_path = ''
as $$
declare v text := nullif(btrim(p ->> k), '');
begin
  if v is null then return null; end if;
  if v !~ '^[0-9]{2}:[0-9]{2}(:[0-9]{2})?$' then
    raise exception 'INVALID_INPUT' using detail = format('"%s" must be a time (HH:MM).', k);
  end if;
  begin return v::time; exception when others then
    raise exception 'INVALID_INPUT' using detail = format('"%s" is not a real time.', k);
  end;
end
$$;
revoke all on function public.pl_time(jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Money held for a booking (D1): A approved payments, W waiting payments,
-- RA approved refunds, RW waiting refunds. Waiting refunds never change balances.
-- ---------------------------------------------------------------------------
create function public.money_position(p_booking uuid)
returns table (due_paise bigint, approved_paise bigint, waiting_paise bigint, refunded_paise bigint, refund_waiting_paise bigint)
language sql stable security definer set search_path = ''
as $$
  select b.amount_due_paise,
         coalesce((select sum(p.amount_paise) from public.payments p where p.booking_id = b.id and p.status = 'approved'), 0)::bigint,
         coalesce((select sum(p.amount_paise) from public.payments p where p.booking_id = b.id and p.status = 'waiting'), 0)::bigint,
         coalesce((select sum(r.amount_paise) from public.refunds r where r.booking_id = b.id and r.status = 'approved'), 0)::bigint,
         coalesce((select sum(r.amount_paise) from public.refunds r where r.booking_id = b.id and r.status = 'waiting'), 0)::bigint
  from public.bookings b where b.id = p_booking
$$;
revoke all on function public.money_position(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Stored-file input: [{storage_path, original_file_name, mime_type, size_bytes, sha256}, ...]
-- p_prefix is where this booking's files must live: '{booking}/' for payments, 'refunds/{booking}/' for refunds.
-- The browser uploaded each file straight to private storage; here we make sure the database row
-- describes a REAL stored file of the right booking, the size and type storage itself recorded.
-- ---------------------------------------------------------------------------
create function public.parse_files(p_files jsonb, p_prefix text, p_max int default 5)
returns table (storage_path text, original_file_name text, mime_type text, size_bytes int, sha256 text)
language plpgsql stable security definer set search_path = ''
as $$
declare r jsonb; v_path text; v_mime text; v_size bigint; v_sha text; v_n int := 0; obj record;
begin
  if p_files is null or p_files = 'null'::jsonb then return; end if;
  if jsonb_typeof(p_files) <> 'array' then
    raise exception 'INVALID_INPUT' using detail = 'The files must be a list.';
  end if;
  if jsonb_array_length(p_files) > p_max then
    raise exception 'TOO_MANY_FILES' using detail = format('At most %s files can be added at a time.', p_max);
  end if;
  for r in select e from jsonb_array_elements(p_files) as t(e) loop
    v_n := v_n + 1;
    if jsonb_typeof(r) <> 'object' then
      raise exception 'INVALID_INPUT' using detail = 'Each file needs its details.';
    end if;
    v_path := public.pl_text(r, 'storage_path');
    v_mime := public.pl_text(r, 'mime_type');
    v_size := public.pl_bigint(r, 'size_bytes');
    v_sha  := lower(public.pl_text(r, 'sha256'));
    if v_path is null or left(v_path, length(p_prefix)) <> p_prefix
       or v_path !~ '^(refunds/)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$' then
      raise exception 'INVALID_FILE' using detail = 'That file does not belong to this booking.';
    end if;
    if v_mime is null or v_mime not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf') then
      raise exception 'INVALID_FILE' using detail = 'Only JPG, PNG, WEBP and PDF files are allowed.';
    end if;
    if v_size is null or v_size not between 1 and 10485760 then
      raise exception 'INVALID_FILE' using detail = 'A file can be at most 10 MB.';
    end if;
    if v_sha is null or v_sha !~ '^[0-9a-f]{64}$' then
      raise exception 'INVALID_FILE' using detail = 'The file fingerprint is missing.';
    end if;
    -- the file must really be in storage, with the size and type that STORAGE recorded
    select o.metadata into obj from storage.objects o where o.bucket_id = 'payment-proofs' and o.name = v_path;
    if not found then
      raise exception 'INVALID_FILE' using detail = 'The file was not uploaded.';
    end if;
    if obj.metadata is null
       or (obj.metadata ->> 'size') is distinct from v_size::text
       or (obj.metadata ->> 'mimetype') is distinct from v_mime then
      raise exception 'INVALID_FILE' using detail = 'The uploaded file does not match its description.';
    end if;
    storage_path := v_path;
    original_file_name := left(public.pl_text(r, 'original_file_name'), 200);
    mime_type := v_mime; size_bytes := v_size::int; sha256 := v_sha;
    return next;
  end loop;
end
$$;
revoke all on function public.parse_files(jsonb, text, int) from public, anon, authenticated;

-- provider rules shared by payments and refunds
create function public.check_provider(p_method public.payment_method, p_provider smallint, p_other text)
returns void language plpgsql stable security definer set search_path = ''
as $$
declare v_name text;
begin
  if p_method in ('upi', 'card') then
    if p_provider is null then
      raise exception 'INVALID_INPUT' using detail = 'Please choose the payment app or card type.';
    end if;
    select pp.name into v_name from public.payment_providers pp where pp.id = p_provider and pp.method = p_method and pp.is_active;
    if v_name is null then
      raise exception 'INVALID_INPUT' using detail = 'That payment app is not available.';
    end if;
    if v_name = 'Other' and p_other is null then
      raise exception 'INVALID_INPUT' using detail = 'Please write the name of the payment app.';
    end if;
  elsif p_provider is not null then
    raise exception 'INVALID_INPUT' using detail = 'A payment app can only be chosen for UPI and card.';
  end if;
end
$$;
revoke all on function public.check_provider(public.payment_method, smallint, text) from public, anon, authenticated;

create function public.insert_proofs(p_kind text, p_parent uuid, p_files jsonb, p_prefix text, p_correction boolean, p_reason text)
returns int
language plpgsql security definer set search_path = ''
as $$
declare n int := 0; f record;
begin
  for f in select * from public.parse_files(p_files, p_prefix) loop
    insert into public.proofs (payment_id, refund_id, storage_path, original_file_name, mime_type, size_bytes, sha256, is_correction, correction_reason)
    values (case when p_kind = 'payment' then p_parent end, case when p_kind = 'refund' then p_parent end,
            f.storage_path, f.original_file_name, f.mime_type, f.size_bytes, f.sha256, p_correction,
            case when p_correction then p_reason end);
    n := n + 1;
  end loop;
  return n;
end
$$;
revoke all on function public.insert_proofs(text, uuid, jsonb, text, boolean, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- add_payment (FR-PAY-1..6, 10, 11)
-- ---------------------------------------------------------------------------
create function public.add_payment(p_payload jsonb, p_files jsonb, p_idem uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  ex       record;
  b        public.bookings;
  pos      record;
  v_method public.payment_method;
  v_amount bigint := public.pl_bigint(p_payload, 'amount_paise');
  v_prov   smallint := public.pl_bigint(p_payload, 'provider_id');
  v_other  text := left(public.pl_text(p_payload, 'provider_other'), 60);
  v_ref    text := left(public.pl_text(p_payload, 'reference_number'), 100);
  v_date   date := public.pl_date(p_payload, 'payment_date');
  v_id     uuid := gen_random_uuid();
  v_warn   jsonb := '[]'::jsonb;
  v_files  int;
  v_pending bigint;
begin
  perform public.require_active_user();
  if p_idem is null then
    raise exception 'INVALID_INPUT' using detail = 'The form did not send its save key.';
  end if;
  select p.id, p.payment_code into ex from public.payments p where p.idempotency_key = p_idem;
  if found then
    return jsonb_build_object('id', ex.id, 'payment_code', ex.payment_code, 'duplicate', true, 'warnings', '[]'::jsonb);
  end if;

  select * into b from public.bookings where id = public.pl_uuid(p_payload, 'booking_id') for update;   -- lock order: booking first
  if not found then
    raise exception 'NOT_FOUND' using detail = 'Booking not found.';
  end if;
  begin
    v_method := public.pl_text(p_payload, 'method')::public.payment_method;
  exception when invalid_text_representation then
    raise exception 'INVALID_INPUT' using detail = 'Please choose how the money was paid.';
  end;
  if v_amount is null or v_amount <= 0 or v_amount > 1000000000000000 then
    raise exception 'INVALID_INPUT' using detail = 'Please enter an amount above zero.';
  end if;
  if v_date is null then
    raise exception 'INVALID_INPUT' using detail = 'Please enter the payment date.';
  end if;
  perform public.check_provider(v_method, v_prov, v_other);

  select * into pos from public.money_position(b.id);
  if b.status in ('cancelled', 'no_show') then            -- FR-PAY-11
    v_pending := greatest(pos.due_paise - (pos.approved_paise + pos.waiting_paise - pos.refunded_paise), 0);
    if v_pending = 0 then
      raise exception 'PAYMENT_ON_CANCELLED' using detail = 'There is no unpaid cancellation charge to collect on this booking.';
    end if;
  end if;

  if v_method in ('upi', 'card', 'cheque') and coalesce(jsonb_array_length(case when jsonb_typeof(p_files) = 'array' then p_files end), 0) = 0 then
    raise exception 'PROOF_REQUIRED' using detail = 'A screenshot or receipt is required for UPI, card and cheque payments.';
  end if;

  begin
    insert into public.payments (id, booking_id, amount_paise, method, provider_id, provider_other, payment_date, payment_time, reference_number, remarks, idempotency_key)
    values (v_id, b.id, v_amount, v_method, v_prov, v_other, v_date, public.pl_time(p_payload, 'payment_time'), v_ref,
            left(public.pl_text(p_payload, 'remarks'), 500), p_idem);
  exception when unique_violation then
    select p.id, p.payment_code into ex from public.payments p where p.idempotency_key = p_idem;
    if found then
      return jsonb_build_object('id', ex.id, 'payment_code', ex.payment_code, 'duplicate', true, 'warnings', '[]'::jsonb);
    end if;
    raise;
  end;
  v_files := public.insert_proofs('payment', v_id, p_files, b.id::text || '/', false, null);

  -- warnings never block saving (FR-PAY-6)
  if v_ref is not null and exists (select 1 from public.payments o where o.id <> v_id and o.reference_number = v_ref and o.status <> 'rejected') then
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'DUPLICATE_REFERENCE'));
  end if;
  if exists (select 1 from public.proofs f join public.proofs g on g.sha256 = f.sha256 and g.id <> f.id where f.payment_id = v_id) then
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'DUPLICATE_FILE'));
  end if;
  if pos.approved_paise + pos.waiting_paise - pos.refunded_paise + v_amount > pos.due_paise then
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'ABOVE_AMOUNT_DUE'));
  end if;

  perform public.queue_pdf_job(b.id, 'payment added');
  return jsonb_build_object('id', v_id, 'payment_code', (select p.payment_code from public.payments p where p.id = v_id),
                            'duplicate', false, 'warnings', v_warn);
end
$$;
revoke all on function public.add_payment(jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.add_payment(jsonb, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- update_waiting_payment (FR-PAY-7): only while waiting, with a reason
-- ---------------------------------------------------------------------------
create function public.update_waiting_payment(p_id uuid, p_expected_version int, p_payload jsonb, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  cur public.payments;
  v_method public.payment_method;
  v_amount bigint;
  v_prov smallint;
  v_other text;
  v_reason text;
begin
  perform public.require_active_user();
  select p.booking_id into cur.booking_id from public.payments p where p.id = p_id;
  if cur.booking_id is null then raise exception 'NOT_FOUND' using detail = 'Payment not found.'; end if;
  perform 1 from public.bookings where id = cur.booking_id for update;          -- booking first
  select * into cur from public.payments where id = p_id for update;
  if cur.status <> 'waiting' then
    raise exception 'ALREADY_DECIDED' using detail = format('This payment is already %s.', cur.status);
  end if;
  if cur.version <> p_expected_version then
    raise exception 'STALE_RECORD' using detail = 'Someone else changed this payment. Please reload.';
  end if;
  v_reason := public.require_reason(p_reason, 1);
  perform set_config('app.reason', v_reason, true);

  begin
    v_method := coalesce(public.pl_text(p_payload, 'method')::public.payment_method, cur.method);
  exception when invalid_text_representation then
    raise exception 'INVALID_INPUT' using detail = 'Please choose how the money was paid.';
  end;
  v_amount := coalesce(public.pl_bigint(p_payload, 'amount_paise'), cur.amount_paise);
  v_prov := case when p_payload ? 'provider_id' then public.pl_bigint(p_payload, 'provider_id') else cur.provider_id end;
  v_other := case when p_payload ? 'provider_other' then left(public.pl_text(p_payload, 'provider_other'), 60) else cur.provider_other end;
  if v_amount <= 0 or v_amount > 1000000000000000 then
    raise exception 'INVALID_INPUT' using detail = 'Please enter an amount above zero.';
  end if;
  perform public.check_provider(v_method, v_prov, v_other);

  update public.payments set
    amount_paise = v_amount, method = v_method, provider_id = v_prov, provider_other = v_other,
    payment_date = coalesce(public.pl_date(p_payload, 'payment_date'), payment_date),
    payment_time = case when p_payload ? 'payment_time' then public.pl_time(p_payload, 'payment_time') else payment_time end,
    reference_number = case when p_payload ? 'reference_number' then left(public.pl_text(p_payload, 'reference_number'), 100) else reference_number end,
    remarks = case when p_payload ? 'remarks' then left(public.pl_text(p_payload, 'remarks'), 500) else remarks end
  where id = p_id;
  perform public.queue_pdf_job(cur.booking_id, 'payment edited');
  return jsonb_build_object('id', p_id, 'version', cur.version + 1);
end
$$;
revoke all on function public.update_waiting_payment(uuid, int, jsonb, text) from public, anon, authenticated;
grant execute on function public.update_waiting_payment(uuid, int, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Approve / reject / reverse a payment (FR-APR-3..6). One internal routine, three public wrappers.
-- ---------------------------------------------------------------------------
create function public.decide_payment(p_id uuid, p_expected_version int, p_from public.approval_status, p_to public.approval_status, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  cur public.payments;
  who text;
begin
  perform public.require_active_user();
  select p.booking_id into cur.booking_id from public.payments p where p.id = p_id;
  if cur.booking_id is null then raise exception 'NOT_FOUND' using detail = 'Payment not found.'; end if;
  perform 1 from public.bookings where id = cur.booking_id for update;          -- booking first
  select * into cur from public.payments where id = p_id for update;
  if cur.status <> p_from then
    -- the second person sees who already acted (FR-APR-6)
    select u.full_name into who from public.user_profiles u
      where u.id = coalesce(cur.approved_by, cur.rejected_by, cur.reversed_by);
    raise exception 'ALREADY_DECIDED' using detail = format('This payment is already %s%s.', cur.status, case when who is not null then ' by ' || who else '' end);
  end if;
  if cur.version <> p_expected_version then
    raise exception 'STALE_RECORD' using detail = 'Someone else changed this payment. Please reload.';
  end if;
  if p_to in ('rejected', 'reversed') then
    p_reason := public.require_reason(p_reason, 1);
  end if;
  perform set_config('app.reason', coalesce(p_reason, ''), true);

  update public.payments set
    status = p_to,
    rejection_reason = case when p_to = 'rejected' then p_reason else rejection_reason end,
    reversal_reason  = case when p_to = 'reversed' then p_reason else reversal_reason end
  where id = p_id;
  perform public.queue_pdf_job(cur.booking_id, 'payment ' || p_to::text);
  return jsonb_build_object('id', p_id, 'status', p_to, 'version', cur.version + 1);
end
$$;
revoke all on function public.decide_payment(uuid, int, public.approval_status, public.approval_status, text) from public, anon, authenticated;

create function public.approve_payment(p_id uuid, p_expected_version int)
returns jsonb language sql security definer set search_path = ''
as $$ select public.decide_payment(p_id, p_expected_version, 'waiting', 'approved', null) $$;
create function public.reject_payment(p_id uuid, p_expected_version int, p_reason text)
returns jsonb language sql security definer set search_path = ''
as $$ select public.decide_payment(p_id, p_expected_version, 'waiting', 'rejected', p_reason) $$;
create function public.reverse_payment(p_id uuid, p_expected_version int, p_reason text)
returns jsonb language sql security definer set search_path = ''
as $$ select public.decide_payment(p_id, p_expected_version, 'approved', 'reversed', p_reason) $$;
revoke all on function public.approve_payment(uuid, int), public.reject_payment(uuid, int, text), public.reverse_payment(uuid, int, text) from public, anon, authenticated;
grant execute on function public.approve_payment(uuid, int), public.reject_payment(uuid, int, text), public.reverse_payment(uuid, int, text) to authenticated;

-- ---------------------------------------------------------------------------
-- add_refund (FR-REF-1..5; Q12, D1)
-- Active bookings: only when the guest has paid more than is due (Q12). Cancelled / no-show: allowed.
-- The hard limit (never more than the approved money still held) is enforced by the guard under the booking lock.
-- ---------------------------------------------------------------------------
create function public.add_refund(p_payload jsonb, p_files jsonb, p_idem uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  ex       record;
  b        public.bookings;
  pos      record;
  v_method public.payment_method;
  v_amount bigint := public.pl_bigint(p_payload, 'amount_paise');
  v_prov   smallint := public.pl_bigint(p_payload, 'provider_id');
  v_other  text := left(public.pl_text(p_payload, 'provider_other'), 60);
  v_ref    text := left(public.pl_text(p_payload, 'reference_number'), 100);
  v_date   date := public.pl_date(p_payload, 'refund_date');
  v_reason text := left(public.pl_text(p_payload, 'reason'), 500);
  v_id     uuid := gen_random_uuid();
  v_warn   jsonb := '[]'::jsonb;
  v_refund_due bigint;
begin
  perform public.require_active_user();
  if p_idem is null then
    raise exception 'INVALID_INPUT' using detail = 'The form did not send its save key.';
  end if;
  select r.id, r.refund_code into ex from public.refunds r where r.idempotency_key = p_idem;
  if found then
    return jsonb_build_object('id', ex.id, 'refund_code', ex.refund_code, 'duplicate', true, 'warnings', '[]'::jsonb);
  end if;

  select * into b from public.bookings where id = public.pl_uuid(p_payload, 'booking_id') for update;   -- booking first
  if not found then
    raise exception 'NOT_FOUND' using detail = 'Booking not found.';
  end if;
  begin
    v_method := public.pl_text(p_payload, 'method')::public.payment_method;
  exception when invalid_text_representation then
    raise exception 'INVALID_INPUT' using detail = 'Please choose how the money was sent back.';
  end;
  if v_amount is null or v_amount <= 0 or v_amount > 1000000000000000 then
    raise exception 'INVALID_INPUT' using detail = 'Please enter an amount above zero.';
  end if;
  if v_date is null then
    raise exception 'INVALID_INPUT' using detail = 'Please enter the refund date.';
  end if;
  if v_reason is null then
    raise exception 'REASON_REQUIRED' using detail = 'Please write the reason for the refund.';
  end if;
  perform public.check_provider(v_method, v_prov, v_other);
  if v_method in ('upi', 'card', 'cheque') and coalesce(jsonb_array_length(case when jsonb_typeof(p_files) = 'array' then p_files end), 0) = 0 then
    raise exception 'PROOF_REQUIRED' using detail = 'A screenshot or receipt is required for UPI, card and cheque refunds.';
  end if;

  select * into pos from public.money_position(b.id);
  v_refund_due := greatest((pos.approved_paise - pos.refunded_paise) - pos.due_paise, 0);
  if b.status not in ('cancelled', 'no_show') and v_refund_due = 0 then      -- Q12
    raise exception 'REFUND_NOT_ALLOWED' using detail = 'This booking has not been overpaid, so there is nothing to refund.';
  end if;

  begin
    insert into public.refunds (id, booking_id, amount_paise, method, provider_id, provider_other, refund_date, refund_time, reference_number, reason, remarks, idempotency_key)
    values (v_id, b.id, v_amount, v_method, v_prov, v_other, v_date, public.pl_time(p_payload, 'refund_time'), v_ref, v_reason,
            left(public.pl_text(p_payload, 'remarks'), 500), p_idem);
  exception when unique_violation then
    select r.id, r.refund_code into ex from public.refunds r where r.idempotency_key = p_idem;
    if found then
      return jsonb_build_object('id', ex.id, 'refund_code', ex.refund_code, 'duplicate', true, 'warnings', '[]'::jsonb);
    end if;
    raise;
  end;
  perform public.insert_proofs('refund', v_id, p_files, 'refunds/' || b.id::text || '/', false, null);

  if v_ref is not null and exists (select 1 from public.refunds o where o.id <> v_id and o.reference_number = v_ref and o.status <> 'rejected') then
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'DUPLICATE_REFERENCE'));
  end if;
  if exists (select 1 from public.proofs f join public.proofs g on g.sha256 = f.sha256 and g.id <> f.id where f.refund_id = v_id) then
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'DUPLICATE_FILE'));
  end if;
  if v_amount > greatest(v_refund_due - pos.refund_waiting_paise, 0) then
    v_warn := v_warn || jsonb_build_array(jsonb_build_object('code', 'ABOVE_REFUND_DUE'));
  end if;

  perform public.queue_pdf_job(b.id, 'refund added');
  return jsonb_build_object('id', v_id, 'refund_code', (select r.refund_code from public.refunds r where r.id = v_id),
                            'duplicate', false, 'warnings', v_warn);
end
$$;
revoke all on function public.add_refund(jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.add_refund(jsonb, jsonb, uuid) to authenticated;

create function public.update_waiting_refund(p_id uuid, p_expected_version int, p_payload jsonb, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  cur public.refunds;
  v_method public.payment_method;
  v_amount bigint; v_prov smallint; v_other text; v_reason text;
begin
  perform public.require_active_user();
  select r.booking_id into cur.booking_id from public.refunds r where r.id = p_id;
  if cur.booking_id is null then raise exception 'NOT_FOUND' using detail = 'Refund not found.'; end if;
  perform 1 from public.bookings where id = cur.booking_id for update;          -- booking first
  select * into cur from public.refunds where id = p_id for update;
  if cur.status <> 'waiting' then
    raise exception 'ALREADY_DECIDED' using detail = format('This refund is already %s.', cur.status);
  end if;
  if cur.version <> p_expected_version then
    raise exception 'STALE_RECORD' using detail = 'Someone else changed this refund. Please reload.';
  end if;
  v_reason := public.require_reason(p_reason, 1);
  perform set_config('app.reason', v_reason, true);
  begin
    v_method := coalesce(public.pl_text(p_payload, 'method')::public.payment_method, cur.method);
  exception when invalid_text_representation then
    raise exception 'INVALID_INPUT' using detail = 'Please choose how the money was sent back.';
  end;
  v_amount := coalesce(public.pl_bigint(p_payload, 'amount_paise'), cur.amount_paise);
  v_prov := case when p_payload ? 'provider_id' then public.pl_bigint(p_payload, 'provider_id') else cur.provider_id end;
  v_other := case when p_payload ? 'provider_other' then left(public.pl_text(p_payload, 'provider_other'), 60) else cur.provider_other end;
  if v_amount <= 0 or v_amount > 1000000000000000 then
    raise exception 'INVALID_INPUT' using detail = 'Please enter an amount above zero.';
  end if;
  perform public.check_provider(v_method, v_prov, v_other);
  update public.refunds set
    amount_paise = v_amount, method = v_method, provider_id = v_prov, provider_other = v_other,
    refund_date = coalesce(public.pl_date(p_payload, 'refund_date'), refund_date),
    refund_time = case when p_payload ? 'refund_time' then public.pl_time(p_payload, 'refund_time') else refund_time end,
    reference_number = case when p_payload ? 'reference_number' then left(public.pl_text(p_payload, 'reference_number'), 100) else reference_number end,
    reason = coalesce(left(public.pl_text(p_payload, 'reason'), 500), reason),
    remarks = case when p_payload ? 'remarks' then left(public.pl_text(p_payload, 'remarks'), 500) else remarks end
  where id = p_id;
  perform public.queue_pdf_job(cur.booking_id, 'refund edited');
  return jsonb_build_object('id', p_id, 'version', cur.version + 1);
end
$$;
revoke all on function public.update_waiting_refund(uuid, int, jsonb, text) from public, anon, authenticated;
grant execute on function public.update_waiting_refund(uuid, int, jsonb, text) to authenticated;

create function public.decide_refund(p_id uuid, p_expected_version int, p_from public.approval_status, p_to public.approval_status, p_reason text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  cur public.refunds;
  who text;
begin
  perform public.require_active_user();
  select r.booking_id into cur.booking_id from public.refunds r where r.id = p_id;
  if cur.booking_id is null then raise exception 'NOT_FOUND' using detail = 'Refund not found.'; end if;
  perform 1 from public.bookings where id = cur.booking_id for update;          -- booking first
  select * into cur from public.refunds where id = p_id for update;
  if cur.status <> p_from then
    select u.full_name into who from public.user_profiles u
      where u.id = coalesce(cur.approved_by, cur.rejected_by, cur.reversed_by);
    raise exception 'ALREADY_DECIDED' using detail = format('This refund is already %s%s.', cur.status, case when who is not null then ' by ' || who else '' end);
  end if;
  if cur.version <> p_expected_version then
    raise exception 'STALE_RECORD' using detail = 'Someone else changed this refund. Please reload.';
  end if;
  if p_to in ('rejected', 'reversed') then
    p_reason := public.require_reason(p_reason, 1);
  end if;
  perform set_config('app.reason', coalesce(p_reason, ''), true);
  update public.refunds set
    status = p_to,
    rejection_reason = case when p_to = 'rejected' then p_reason else rejection_reason end,
    reversal_reason  = case when p_to = 'reversed' then p_reason else reversal_reason end
  where id = p_id;
  perform public.queue_pdf_job(cur.booking_id, 'refund ' || p_to::text);
  return jsonb_build_object('id', p_id, 'status', p_to, 'version', cur.version + 1);
end
$$;
revoke all on function public.decide_refund(uuid, int, public.approval_status, public.approval_status, text) from public, anon, authenticated;

create function public.approve_refund(p_id uuid, p_expected_version int)
returns jsonb language sql security definer set search_path = ''
as $$ select public.decide_refund(p_id, p_expected_version, 'waiting', 'approved', null) $$;
create function public.reject_refund(p_id uuid, p_expected_version int, p_reason text)
returns jsonb language sql security definer set search_path = ''
as $$ select public.decide_refund(p_id, p_expected_version, 'waiting', 'rejected', p_reason) $$;
create function public.reverse_refund(p_id uuid, p_expected_version int, p_reason text)
returns jsonb language sql security definer set search_path = ''
as $$ select public.decide_refund(p_id, p_expected_version, 'approved', 'reversed', p_reason) $$;
revoke all on function public.approve_refund(uuid, int), public.reject_refund(uuid, int, text), public.reverse_refund(uuid, int, text) from public, anon, authenticated;
grant execute on function public.approve_refund(uuid, int), public.reject_refund(uuid, int, text), public.reverse_refund(uuid, int, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Proof files. A resolver finds the booking and the (payment or refund) parent for locking and prefixes.
-- ---------------------------------------------------------------------------
create function public.proof_parent(p_kind text, p_parent uuid)
returns table (booking_id uuid, status public.approval_status, prefix text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_kind = 'payment' then
    return query select p.booking_id, p.status, p.booking_id::text || '/' from public.payments p where p.id = p_parent;
  elsif p_kind = 'refund' then
    return query select r.booking_id, r.status, 'refunds/' || r.booking_id::text || '/' from public.refunds r where r.id = p_parent;
  else
    raise exception 'INVALID_INPUT' using detail = 'Choose payment or refund.';
  end if;
  if not found then
    raise exception 'NOT_FOUND' using detail = 'Payment or refund not found.';
  end if;
end
$$;
revoke all on function public.proof_parent(text, uuid) from public, anon, authenticated;

-- add_proofs: normal files, only while waiting; at most 5 visible files in total (FR-PAY-3)
create function public.add_proofs(p_kind text, p_parent uuid, p_files jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare pr record; v_visible int; v_new int;
begin
  perform public.require_active_user();
  select * into pr from public.proof_parent(p_kind, p_parent);
  perform 1 from public.bookings where id = pr.booking_id for update;
  select * into pr from public.proof_parent(p_kind, p_parent);     -- status as of now, after the lock
  if pr.status <> 'waiting' then
    raise exception 'PROOF_LOCKED' using detail = 'An approved payment or refund is locked. Use "Add correction file" and give a reason.';
  end if;
  select count(*) into v_visible from public.proofs f
    where f.hidden_at is null and ((p_kind = 'payment' and f.payment_id = p_parent) or (p_kind = 'refund' and f.refund_id = p_parent));
  v_new := public.insert_proofs(p_kind, p_parent, p_files, pr.prefix, false, null);
  if v_visible + v_new > 5 then
    raise exception 'TOO_MANY_FILES' using detail = 'A payment or refund can have at most 5 files.';
  end if;
  perform public.queue_pdf_job(pr.booking_id, 'file added');
  return jsonb_build_object('added', v_new);
end
$$;
revoke all on function public.add_proofs(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.add_proofs(text, uuid, jsonb) to authenticated;

-- hide_proof: hide (never delete) a wrong file while waiting. The LAST file of a UPI/card/cheque item cannot be hidden
-- (checked again at COMMIT by the proof rule, so it cannot be skipped).
create function public.hide_proof(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare f public.proofs; v_booking uuid; v_reason text := public.require_reason(p_reason, 1);
begin
  perform public.require_active_user();
  select * into f from public.proofs where id = p_id;
  if not found then raise exception 'NOT_FOUND' using detail = 'File not found.'; end if;
  if f.is_correction then
    raise exception 'PROOF_LOCKED' using detail = 'A correction file cannot be hidden.';
  end if;
  select coalesce((select p.booking_id from public.payments p where p.id = f.payment_id),
                  (select r.booking_id from public.refunds r where r.id = f.refund_id)) into v_booking;
  perform 1 from public.bookings where id = v_booking for update;
  perform set_config('app.reason', v_reason, true);
  update public.proofs set hidden_at = now(), hidden_reason = v_reason where id = p_id;
  perform public.queue_pdf_job(v_booking, 'file hidden');
end
$$;
revoke all on function public.hide_proof(uuid, text) from public, anon, authenticated;
grant execute on function public.hide_proof(uuid, text) to authenticated;

-- add_correction_files (Q9a): approved items only; reason of 10+ characters; originals untouched; no money changes.
create function public.add_correction_files(p_kind text, p_parent uuid, p_reason text, p_files jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare pr record; v_reason text; v_new int;
begin
  perform public.require_active_user();
  v_reason := public.require_reason(p_reason, 10);
  select * into pr from public.proof_parent(p_kind, p_parent);
  perform 1 from public.bookings where id = pr.booking_id for update;
  select * into pr from public.proof_parent(p_kind, p_parent);
  if pr.status <> 'approved' then
    raise exception 'PROOF_CORRECTION_NOT_ALLOWED'
      using detail = 'Correction files are only for approved payments and refunds.';
  end if;
  if coalesce(jsonb_array_length(case when jsonb_typeof(p_files) = 'array' then p_files end), 0) = 0 then
    raise exception 'INVALID_INPUT' using detail = 'Please add at least one file.';
  end if;
  perform set_config('app.reason', v_reason, true);
  v_new := public.insert_proofs(p_kind, p_parent, p_files, pr.prefix, true, v_reason);
  perform public.queue_pdf_job(pr.booking_id, 'correction file added');
  return jsonb_build_object('added', v_new);
end
$$;
revoke all on function public.add_correction_files(text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.add_correction_files(text, uuid, text, jsonb) to authenticated;
