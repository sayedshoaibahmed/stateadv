-- =============================================================================
-- 14 BOOKING AND PAYMENT-PLAN FUNCTIONS
-- create_booking, update_booking, set_booking_status, cancel_booking,
-- change_cancellation_charge, set_payment_schedule, plan_preview
-- (+ internal helpers). PRD 5.5-5.7, 5.10; DECISIONS Q1-Q7, Q13, Q16, D2, D4.
--
-- Principles
--  * The database recalculates EVERY amount; the browser sends only inputs (pax, tariff, extras,
--    discount, adjustment) - never nights, base, total or final (FR-BK-5).
--  * Each function is one transaction. A refusal anywhere undoes everything in it.
--  * Booking numbers come from a locked counter row, so two simultaneous bookings take turns.
--  * Plan changes follow TRD 5.2a exactly; the guards from migration 06 re-check each step.
--  * Same function rules as migration 11: SECURITY DEFINER, empty search_path, caller from
--    auth.uid() only, EXECUTE removed from PUBLIC first and given to `authenticated` only.
--  * Error codes (RAISE EXCEPTION 'CODE') are mapped to plain English by the app.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Input readers. A JSON payload is data from the browser: every value is checked.
-- ---------------------------------------------------------------------------
create function public.pl_text(p jsonb, k text)
returns text language sql immutable set search_path = ''
as $$ select nullif(btrim(p ->> k), '') $$;

create function public.pl_bigint(p jsonb, k text, p_default bigint default null)
returns bigint language plpgsql immutable set search_path = ''
as $$
declare v text := nullif(btrim(p ->> k), '');
begin
  if v is null then return p_default; end if;
  if v !~ '^-?[0-9]{1,16}$' then
    raise exception 'INVALID_INPUT' using detail = format('"%s" must be a whole number.', k);
  end if;
  return v::bigint;
end
$$;

create function public.pl_uuid(p jsonb, k text)
returns uuid language plpgsql immutable set search_path = ''
as $$
declare v text := nullif(btrim(p ->> k), '');
begin
  if v is null then return null; end if;
  if v !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'INVALID_INPUT' using detail = format('"%s" is not valid.', k);
  end if;
  return v::uuid;
end
$$;

create function public.pl_date(p jsonb, k text)
returns date language plpgsql immutable set search_path = ''
as $$
declare v text := nullif(btrim(p ->> k), '');
begin
  if v is null then return null; end if;
  if v !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'INVALID_INPUT' using detail = format('"%s" must be a date (YYYY-MM-DD).', k);
  end if;
  begin
    return v::date;
  exception when others then
    raise exception 'INVALID_INPUT' using detail = format('"%s" is not a real date.', k);
  end;
end
$$;

-- A date and time MUST carry its time zone, so the result never depends on a server setting.
create function public.pl_timestamptz(p jsonb, k text)
returns timestamptz language plpgsql immutable set search_path = ''
as $$
declare v text := nullif(btrim(p ->> k), '');
begin
  if v is null then return null; end if;
  if v !~ '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$' then
    raise exception 'INVALID_INPUT' using detail = format('"%s" needs a time zone.', k);
  end if;
  begin
    return v::timestamptz;
  exception when others then
    raise exception 'INVALID_INPUT' using detail = format('"%s" is not a valid date and time.', k);
  end;
end
$$;

revoke all on function public.pl_text(jsonb, text), public.pl_bigint(jsonb, text, bigint),
  public.pl_uuid(jsonb, text), public.pl_date(jsonb, text), public.pl_timestamptz(jsonb, text)
  from public, anon, authenticated;

-- Payment-plan rows: [{"label":"Advance","due_date":"2026-12-01","amount_paise":500000}, ...]
create function public.parse_plan(p_rows jsonb)
returns table (line_no int, label text, due_date date, amount_paise bigint)
language plpgsql immutable set search_path = ''
as $$
declare r jsonb; i int := 0; v_label text; v_due date; v_amt bigint;
begin
  if p_rows is null or p_rows = 'null'::jsonb then return; end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'INVALID_INPUT' using detail = 'The payment plan must be a list of rows.';
  end if;
  if jsonb_array_length(p_rows) > 24 then
    raise exception 'INVALID_INPUT' using detail = 'A payment plan can have at most 24 rows.';
  end if;
  for r in select e from jsonb_array_elements(p_rows) as t(e) loop
    i := i + 1;
    if jsonb_typeof(r) <> 'object' then
      raise exception 'INVALID_INPUT' using detail = 'Each plan row must have a label, a due date and an amount.';
    end if;
    v_label := public.pl_text(r, 'label');
    v_due   := public.pl_date(r, 'due_date');
    v_amt   := public.pl_bigint(r, 'amount_paise');
    if v_label is null or length(v_label) > 60 or v_due is null or v_due < date '2000-01-01' then
      raise exception 'INVALID_INPUT' using detail = format('Plan row %s needs a label (up to 60 letters) and a due date.', i);
    end if;
    if v_amt is null or v_amt <= 0 or v_amt > 1000000000000000 then
      raise exception 'INVALID_INPUT' using detail = format('Plan row %s needs an amount above zero.', i);
    end if;
    line_no := i; label := v_label; due_date := v_due; amount_paise := v_amt;
    return next;
  end loop;
end
$$;
revoke all on function public.parse_plan(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- next_booking_code: the Booking ID (Q4, Q16). One counter row per resort and booking-date year.
-- The ON CONFLICT update takes a row lock, so concurrent callers for the same resort and year
-- queue up; if the booking later fails, this increment is rolled back with it (no gaps, no reuse).
-- ---------------------------------------------------------------------------
create function public.next_booking_code(p_resort uuid, p_booking_date date)
returns table (booking_code text, booking_year int, booking_seq int)
language plpgsql security definer set search_path = ''
as $$
declare v_code text; v_year int := extract(year from p_booking_date)::int; v_seq int;
begin
  select r.code into v_code from public.resorts r where r.id = p_resort;
  if v_code is null then
    raise exception 'NOT_FOUND' using detail = 'Resort not found.';
  end if;
  insert into public.booking_sequences as s (resort_id, year, last_value)
  values (p_resort, v_year, 1)
  on conflict (resort_id, year) do update set last_value = s.last_value + 1
  returning s.last_value into v_seq;
  booking_code := v_code || '-' || v_year::text || '-' || lpad(v_seq::text, 6, '0');
  booking_year := v_year; booking_seq := v_seq;
  return next;
exception when check_violation then
  raise exception 'BOOKING_NUMBER_LIMIT' using detail = 'No more booking numbers are available for this resort and year.';
end
$$;
revoke all on function public.next_booking_code(uuid, date) from public, anon, authenticated;

create function public.queue_pdf_job(p_booking uuid, p_reason text)
returns void language sql security definer set search_path = ''
as $$ insert into public.pdf_jobs (booking_id, reason) values (p_booking, p_reason) $$;
revoke all on function public.queue_pdf_job(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- apply_plan_change: the single place where a booking's plan is revised (TRD 5.2a, D2).
-- The caller has ALREADY locked the booking and updated it to the new Amount Due.
--   locked  = active rows already past due (never touched)
--   to_plan = Amount Due - locked - earlier adjustments  (+ any overdue amount being moved)
--   to_plan < 0  -> a dated Expected Adjustment records the difference; no new rows allowed
--   otherwise    -> rows due today or later are replaced by the new rows, which must add up to to_plan
-- ---------------------------------------------------------------------------
create function public.apply_plan_change(
  p_booking    uuid,
  p_source     text,                       -- revision source
  p_adj_source public.adjustment_source,   -- source of an automatic adjustment
  p_reason     text,
  p_rows       jsonb,
  p_kind       public.plan_kind,
  p_move       bigint default 0
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_today   date := public.today_ist();
  v_due     bigint;
  v_prev    bigint;
  v_prev_no int;
  v_locked  bigint;
  v_adj     bigint;
  v_to_plan bigint;
  v_rows_sum bigint;
  v_rev     uuid := gen_random_uuid();
  v_unpaid  bigint;
  v_line0   int;
  v_reason  text := public.require_reason(p_reason, 1);
  v_move    bigint := coalesce(p_move, 0);
begin
  select b.amount_due_paise into v_due from public.bookings b where b.id = p_booking;
  select r.revision_no, r.amount_due_after into v_prev_no, v_prev
    from public.payment_plan_revisions r where r.booking_id = p_booking order by r.revision_no desc limit 1;
  select coalesce(sum(s.amount_paise), 0) into v_locked
    from public.payment_schedules s where s.booking_id = p_booking and s.superseded_at is null and s.due_date < v_today;
  select coalesce(sum(a.amount_paise), 0) into v_adj from public.expected_adjustments a where a.booking_id = p_booking;

  if v_move < 0 then
    raise exception 'INVALID_INPUT' using detail = 'The amount to move cannot be negative.';
  end if;
  if v_move > 0 then
    -- the unpaid amount that was due before today: expected up to yesterday - net collected up to yesterday
    select greatest(
             coalesce((select sum(e.amount_paise) from public.expected_entries e where e.booking_id = p_booking and e.entry_date < v_today), 0)
             - (coalesce((select sum(p.amount_paise) from public.payments p where p.booking_id = p_booking and p.status = 'approved' and p.payment_date < v_today), 0)
                - coalesce((select sum(f.amount_paise) from public.refunds f where f.booking_id = p_booking and f.status = 'approved' and f.refund_date < v_today), 0)),
             0)
      into v_unpaid;
    if v_move > v_unpaid then
      raise exception 'MOVE_OVERDUE_TOO_LARGE'
        using detail = format('Only %s paise is overdue and unpaid.', v_unpaid);
    end if;
  end if;

  v_to_plan := v_due - v_locked - v_adj + v_move;

  insert into public.payment_plan_revisions (id, booking_id, revision_no, source, reason, amount_due_before, amount_due_after, locked_total_paise)
  values (v_rev, p_booking, v_prev_no + 1, p_source, v_reason, v_prev, v_due, v_locked);

  if v_move > 0 then
    insert into public.expected_adjustments (booking_id, revision_id, adjustment_date, amount_paise, source, reason)
    values (p_booking, v_rev, v_today, -v_move, 'move_overdue', v_reason);
  end if;
  if v_to_plan < 0 then
    insert into public.expected_adjustments (booking_id, revision_id, adjustment_date, amount_paise, source, reason)
    values (p_booking, v_rev, v_today, v_to_plan, p_adj_source, v_reason);
  end if;

  select coalesce(sum(x.amount_paise), 0) into v_rows_sum from public.parse_plan(p_rows) x;
  if v_rows_sum <> greatest(v_to_plan, 0) then
    raise exception 'PLAN_TOTAL_MISMATCH'
      using detail = format('The new plan rows add up to %s paise but %s paise still has to be planned.', v_rows_sum, greatest(v_to_plan, 0));
  end if;

  -- rows due today or later are replaced (they are kept as history marked "Replaced")
  update public.payment_schedules
     set superseded_revision_id = v_rev
   where booking_id = p_booking and superseded_at is null and due_date >= v_today;

  select coalesce(max(s.line_no), 0) into v_line0 from public.payment_schedules s where s.booking_id = p_booking;
  insert into public.payment_schedules (booking_id, revision_id, kind, line_no, label, due_date, amount_paise)
  select p_booking, v_rev, p_kind, v_line0 + x.line_no, x.label, x.due_date, x.amount_paise
  from public.parse_plan(p_rows) x;

  -- early, readable check (a deferred constraint trigger re-checks this at commit)
  if (select coalesce(sum(s.amount_paise), 0) from public.payment_schedules s where s.booking_id = p_booking and s.superseded_at is null)
     + (select coalesce(sum(a.amount_paise), 0) from public.expected_adjustments a where a.booking_id = p_booking) <> v_due then
    raise exception 'PLAN_TOTAL_MISMATCH';
  end if;
  return v_rev;
end
$$;
revoke all on function public.apply_plan_change(uuid, text, public.adjustment_source, text, jsonb, public.plan_kind, bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Shared calculation: every amount from the inputs. Used by create and update so they cannot differ.
-- ---------------------------------------------------------------------------
create function public.calc_booking_amounts(
  p_method public.pricing_method, p_pax bigint, p_tariff bigint, p_extra bigint, p_discount bigint,
  p_adjustment bigint, p_adjustment_reason text, p_in timestamptz, p_out timestamptz
)
returns table (nights int, base_paise bigint, final_paise bigint)
language plpgsql immutable set search_path = ''
as $$
declare
  v_nights int; v_base numeric; v_final numeric;
  v_cap constant numeric := 1000000000000000;
begin
  if p_in is null or p_out is null or p_out <= p_in then
    raise exception 'INVALID_DATES' using detail = 'Check-out must be after check-in.';
  end if;
  v_nights := (p_out at time zone 'Asia/Kolkata')::date - (p_in at time zone 'Asia/Kolkata')::date;   -- D4
  if p_method = 'per_person_per_night' and v_nights < 1 then
    raise exception 'INVALID_DATES' using detail = 'A per-night stay needs at least one night.';
  end if;
  if p_pax is null or p_pax not between 1 and 1000 then
    raise exception 'INVALID_INPUT' using detail = 'The number of guests (PAX) must be between 1 and 1000.';
  end if;
  if p_tariff is null or p_tariff not between 0 and 1000000000000000
     or p_extra not between 0 and 1000000000000000 or p_discount < 0
     or p_adjustment not between -1000000000000000 and 1000000000000000 then
    raise exception 'INVALID_INPUT' using detail = 'An amount is out of range.';
  end if;
  v_base := p_pax::numeric * p_tariff::numeric * (case when p_method = 'per_person_per_night' then v_nights else 1 end);
  if v_base > v_cap then
    raise exception 'AMOUNT_TOO_LARGE';
  end if;
  if p_discount > v_base + p_extra then
    raise exception 'DISCOUNT_TOO_LARGE' using detail = 'The discount cannot be more than the total amount.';
  end if;
  if p_adjustment <> 0 and public.pl_text(jsonb_build_object('r', p_adjustment_reason), 'r') is null then
    raise exception 'ADJUSTMENT_REASON_REQUIRED' using detail = 'Please give a reason for changing the final amount.';
  end if;
  v_final := v_base + p_extra - p_discount + p_adjustment;
  if v_final < 0 then
    raise exception 'FINAL_NEGATIVE' using detail = 'The final amount cannot be below zero.';
  end if;
  nights := v_nights; base_paise := v_base::bigint; final_paise := v_final::bigint;
  return next;
end
$$;
revoke all on function public.calc_booking_amounts(public.pricing_method, bigint, bigint, bigint, bigint, bigint, text, timestamptz, timestamptz) from public, anon, authenticated;

-- Validates C/O fields and returns the name to store.
create function public.resolve_co(p_category public.co_category, p_partner uuid, p_own_name text, p_require_active boolean)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare a public.agents_partners;
begin
  if p_category in ('agent', 'partner') then
    select * into a from public.agents_partners x where x.id = p_partner;
    if not found or a.type::text <> p_category::text then
      raise exception 'CO_TYPE_MISMATCH' using detail = 'Please choose a name from the matching Agent or Partner list.';
    end if;
    if p_require_active and not a.is_active then
      raise exception 'CO_INACTIVE' using detail = 'This agent or partner is switched off.';
    end if;
    return a.name;
  elsif p_category = 'own' then
    if p_own_name is null then
      raise exception 'INVALID_INPUT' using detail = 'Please enter the name for an Own booking.';
    end if;
    return left(p_own_name, 120);
  end if;
  return null;   -- direct
end
$$;
revoke all on function public.resolve_co(public.co_category, uuid, text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_booking
-- payload: resort_id, guest_id | (guest_name, guest_mobile[, guest_email]), pax, co_category,
--          agent_partner_id, co_name, stay_type_id, booking_date, check_in_at, check_out_at,
--          pricing_method, tariff_paise, extra_charges_paise, extra_charges_note, discount_paise,
--          manual_adjustment_paise, manual_adjustment_reason, remarks
-- plan:    [{label, due_date, amount_paise}, ...]  - must add up to the Final Amount exactly (Q6b)
-- p_idem:  a key made by the form; pressing Save twice returns the same booking (FR-BK-11)
-- ---------------------------------------------------------------------------
create function public.create_booking(p_payload jsonb, p_plan jsonb, p_idem uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  ex        record;
  v_resort  public.resorts;
  v_guest   public.guests;
  v_guest_id uuid := public.pl_uuid(p_payload, 'guest_id');
  v_cat     public.co_category;
  v_method  public.pricing_method;
  v_in      timestamptz := public.pl_timestamptz(p_payload, 'check_in_at');
  v_out     timestamptz := public.pl_timestamptz(p_payload, 'check_out_at');
  v_date    date := coalesce(public.pl_date(p_payload, 'booking_date'), public.today_ist());
  v_pax     bigint := public.pl_bigint(p_payload, 'pax');
  v_tariff  bigint := public.pl_bigint(p_payload, 'tariff_paise');
  v_extra   bigint := public.pl_bigint(p_payload, 'extra_charges_paise', 0);
  v_disc    bigint := public.pl_bigint(p_payload, 'discount_paise', 0);
  v_adj     bigint := public.pl_bigint(p_payload, 'manual_adjustment_paise', 0);
  v_adj_why text   := public.pl_text(p_payload, 'manual_adjustment_reason');
  v_stay    smallint := public.pl_bigint(p_payload, 'stay_type_id');
  v_co_name text;
  c         record;
  v_code    record;
  v_id      uuid := gen_random_uuid();
  v_rev     uuid := gen_random_uuid();
  v_plan_sum bigint;
begin
  perform public.require_active_user();
  if p_idem is null then
    raise exception 'INVALID_INPUT' using detail = 'The form did not send its save key.';
  end if;

  -- Pressing Save twice: return the booking that already exists for this key.
  select b.id, b.booking_code into ex from public.bookings b where b.idempotency_key = p_idem;
  if found then
    return jsonb_build_object('id', ex.id, 'booking_code', ex.booking_code, 'duplicate', true);
  end if;

  select * into v_resort from public.resorts where id = public.pl_uuid(p_payload, 'resort_id');
  if not found then
    raise exception 'NOT_FOUND' using detail = 'Please choose a resort.';
  end if;

  if v_guest_id is not null then
    select * into v_guest from public.guests where id = v_guest_id;
    if not found then raise exception 'NOT_FOUND' using detail = 'Guest not found.'; end if;
  else
    v_guest_id := public.upsert_guest(null, public.pl_text(p_payload, 'guest_name'), public.pl_text(p_payload, 'guest_mobile'),
                                      public.pl_text(p_payload, 'guest_email'));
    select * into v_guest from public.guests where id = v_guest_id;
  end if;

  begin
    v_cat := public.pl_text(p_payload, 'co_category')::public.co_category;
    v_method := public.pl_text(p_payload, 'pricing_method')::public.pricing_method;
  exception when invalid_text_representation then
    raise exception 'INVALID_INPUT' using detail = 'Please choose the C/O category and the pricing method.';
  end;
  if v_date not between date '2000-01-01' and date '2100-12-31' then
    raise exception 'INVALID_INPUT' using detail = 'The booking date is not valid.';
  end if;
  if not exists (select 1 from public.stay_types s where s.id = v_stay and s.is_active) then
    raise exception 'INVALID_INPUT' using detail = 'Please choose a stay type.';
  end if;
  v_co_name := public.resolve_co(v_cat, public.pl_uuid(p_payload, 'agent_partner_id'), public.pl_text(p_payload, 'co_name'), true);

  select * into c from public.calc_booking_amounts(v_method, v_pax, v_tariff, v_extra, v_disc, v_adj, v_adj_why, v_in, v_out);

  select sum(x.amount_paise) into v_plan_sum from public.parse_plan(p_plan) x;
  if coalesce(v_plan_sum, 0) <> c.final_paise then
    raise exception 'PLAN_TOTAL_MISMATCH'
      using detail = format('The payment plan adds up to %s paise but the final amount is %s paise.', coalesce(v_plan_sum, 0), c.final_paise);
  end if;

  select * into v_code from public.next_booking_code(v_resort.id, v_date);

  begin
    insert into public.bookings
      (id, booking_code, resort_id, booking_year, booking_seq, guest_id, guest_name, guest_mobile, pax,
       co_category, agent_partner_id, co_name, stay_type_id, booking_date, check_in_at, check_out_at, nights,
       pricing_method, tariff_per_person_paise, base_amount_paise, extra_charges_paise, extra_charges_note,
       discount_paise, manual_adjustment_paise, manual_adjustment_reason, remarks, idempotency_key)
    values
      (v_id, v_code.booking_code, v_resort.id, v_code.booking_year, v_code.booking_seq, v_guest.id, v_guest.full_name, v_guest.mobile, v_pax::int,
       v_cat, case when v_cat in ('agent', 'partner') then public.pl_uuid(p_payload, 'agent_partner_id') end, v_co_name, v_stay,
       v_date, v_in, v_out, c.nights,
       v_method, v_tariff, c.base_paise, v_extra, public.pl_text(p_payload, 'extra_charges_note'),
       v_disc, v_adj, v_adj_why, public.pl_text(p_payload, 'remarks'), p_idem);
  exception when unique_violation then
    -- a second request with the same key arrived at the same moment
    select b.id, b.booking_code into ex from public.bookings b where b.idempotency_key = p_idem;
    if found then
      return jsonb_build_object('id', ex.id, 'booking_code', ex.booking_code, 'duplicate', true);
    end if;
    raise;
  end;

  insert into public.payment_plan_revisions (id, booking_id, revision_no, source, amount_due_before, amount_due_after, locked_total_paise)
  values (v_rev, v_id, 1, 'created', null, c.final_paise, 0);
  insert into public.payment_schedules (booking_id, revision_id, line_no, label, due_date, amount_paise)
  select v_id, v_rev, x.line_no, x.label, x.due_date, x.amount_paise from public.parse_plan(p_plan) x;

  perform public.queue_pdf_job(v_id, 'booking created');
  return jsonb_build_object('id', v_id, 'booking_code', v_code.booking_code, 'duplicate', false);
end
$$;
revoke all on function public.create_booking(jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.create_booking(jsonb, jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- update_booking (FR-BK-7): any field except the resort and the YEAR of the booking date.
-- Keys not present in the payload stay as they are. A change to any amount input needs a reason
-- and, if the Amount Due changes, a plan that follows TRD 5.2a. Payments/refunds are never touched (Q13).
-- ---------------------------------------------------------------------------
create function public.update_booking(
  p_id uuid, p_expected_version int, p_payload jsonb, p_plan jsonb default null,
  p_move_overdue bigint default 0, p_reason text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  cur       public.bookings;
  v_guest   public.guests;
  v_cat     public.co_category;
  v_method  public.pricing_method;
  v_in      timestamptz;
  v_out     timestamptz;
  v_date    date;
  v_pax     bigint;
  v_tariff  bigint;
  v_extra   bigint;
  v_disc    bigint;
  v_adj     bigint;
  v_adj_why text;
  v_stay    smallint;
  v_partner uuid;
  v_co_name text;
  c         record;
  v_inputs_changed boolean;
  v_due_after bigint;
  v_rev     uuid;
begin
  perform public.require_active_user();
  select * into cur from public.bookings where id = p_id for update;
  if not found then
    raise exception 'NOT_FOUND' using detail = 'Booking not found.';
  end if;
  if cur.version <> p_expected_version then
    raise exception 'STALE_RECORD' using detail = 'Someone else changed this booking. Please reload.';
  end if;

  if public.pl_uuid(p_payload, 'resort_id') is not null and public.pl_uuid(p_payload, 'resort_id') <> cur.resort_id then
    raise exception 'ID_FIELDS_LOCKED' using detail = 'The resort cannot be changed after the Booking ID is issued.';
  end if;
  v_date := coalesce(public.pl_date(p_payload, 'booking_date'), cur.booking_date);
  if extract(year from v_date)::int <> cur.booking_year then
    raise exception 'ID_FIELDS_LOCKED' using detail = 'The year of the booking date cannot be changed after the Booking ID is issued.';
  end if;

  v_in     := coalesce(public.pl_timestamptz(p_payload, 'check_in_at'), cur.check_in_at);
  v_out    := coalesce(public.pl_timestamptz(p_payload, 'check_out_at'), cur.check_out_at);
  v_pax    := coalesce(public.pl_bigint(p_payload, 'pax'), cur.pax);
  v_tariff := coalesce(public.pl_bigint(p_payload, 'tariff_paise'), cur.tariff_per_person_paise);
  v_extra  := coalesce(public.pl_bigint(p_payload, 'extra_charges_paise'), cur.extra_charges_paise);
  v_disc   := coalesce(public.pl_bigint(p_payload, 'discount_paise'), cur.discount_paise);
  v_adj    := coalesce(public.pl_bigint(p_payload, 'manual_adjustment_paise'), cur.manual_adjustment_paise);
  v_adj_why := case when p_payload ? 'manual_adjustment_reason' then public.pl_text(p_payload, 'manual_adjustment_reason') else cur.manual_adjustment_reason end;
  v_stay   := coalesce(public.pl_bigint(p_payload, 'stay_type_id'), cur.stay_type_id);
  begin
    v_cat    := coalesce(public.pl_text(p_payload, 'co_category')::public.co_category, cur.co_category);
    v_method := coalesce(public.pl_text(p_payload, 'pricing_method')::public.pricing_method, cur.pricing_method);
  exception when invalid_text_representation then
    raise exception 'INVALID_INPUT' using detail = 'Please choose the C/O category and the pricing method.';
  end;
  if v_stay is distinct from cur.stay_type_id and not exists (select 1 from public.stay_types s where s.id = v_stay and s.is_active) then
    raise exception 'INVALID_INPUT' using detail = 'Please choose a stay type.';
  end if;

  -- C/O: re-resolve only if it changed (an old, now switched-off agent may stay on old bookings)
  v_partner := case when p_payload ? 'agent_partner_id' then public.pl_uuid(p_payload, 'agent_partner_id') else cur.agent_partner_id end;
  if v_cat in ('agent', 'partner') then
    v_co_name := public.resolve_co(v_cat, v_partner, null, v_cat is distinct from cur.co_category or v_partner is distinct from cur.agent_partner_id);
  else
    v_partner := null;
    v_co_name := public.resolve_co(v_cat, null, case when p_payload ? 'co_name' then public.pl_text(p_payload, 'co_name') else cur.co_name end, true);
  end if;

  if public.pl_uuid(p_payload, 'guest_id') is not null and public.pl_uuid(p_payload, 'guest_id') <> cur.guest_id then
    select * into v_guest from public.guests where id = public.pl_uuid(p_payload, 'guest_id');
    if not found then raise exception 'NOT_FOUND' using detail = 'Guest not found.'; end if;
  end if;

  select * into c from public.calc_booking_amounts(v_method, v_pax, v_tariff, v_extra, v_disc, v_adj, v_adj_why, v_in, v_out);

  v_inputs_changed := (v_method, v_pax, v_tariff, c.nights, v_extra, v_disc, v_adj)
                      is distinct from
                      (cur.pricing_method, cur.pax::bigint, cur.tariff_per_person_paise, cur.nights, cur.extra_charges_paise, cur.discount_paise, cur.manual_adjustment_paise);
  if v_inputs_changed and cur.status not in ('cancelled', 'no_show') then
    perform public.require_reason(p_reason, 5);
  end if;

  update public.bookings set
    guest_id = coalesce(v_guest.id, guest_id),
    guest_name = coalesce(v_guest.full_name, guest_name),
    guest_mobile = coalesce(v_guest.mobile, guest_mobile),
    pax = v_pax::int, co_category = v_cat, agent_partner_id = v_partner, co_name = v_co_name,
    stay_type_id = v_stay, booking_date = v_date, check_in_at = v_in, check_out_at = v_out, nights = c.nights,
    pricing_method = v_method, tariff_per_person_paise = v_tariff, base_amount_paise = c.base_paise,
    extra_charges_paise = v_extra,
    extra_charges_note = case when p_payload ? 'extra_charges_note' then public.pl_text(p_payload, 'extra_charges_note') else extra_charges_note end,
    discount_paise = v_disc, manual_adjustment_paise = v_adj, manual_adjustment_reason = v_adj_why,
    remarks = case when p_payload ? 'remarks' then public.pl_text(p_payload, 'remarks') else remarks end
  where id = p_id;

  select b.amount_due_paise into v_due_after from public.bookings b where b.id = p_id;
  if cur.status not in ('cancelled', 'no_show') and (v_due_after <> cur.amount_due_paise or p_plan is not null or coalesce(p_move_overdue, 0) > 0) then
    v_rev := public.apply_plan_change(
      p_id, case when v_due_after <> cur.amount_due_paise then 'amount_change' when coalesce(p_move_overdue, 0) > 0 then 'move_overdue' else 'plan_change' end,
      case when v_due_after <> cur.amount_due_paise then 'amount_change'::public.adjustment_source else 'plan_change'::public.adjustment_source end,
      coalesce(p_reason, 'Booking updated'), p_plan, 'booking', p_move_overdue);
  end if;

  perform public.queue_pdf_job(p_id, 'booking updated');
  return jsonb_build_object('id', p_id, 'version', (select b.version from public.bookings b where b.id = p_id), 'revision_id', v_rev);
end
$$;
revoke all on function public.update_booking(uuid, int, jsonb, jsonb, bigint, text) from public, anon, authenticated;
grant execute on function public.update_booking(uuid, int, jsonb, jsonb, bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- set_booking_status: check-in / check-out and undoing one step by mistake.
-- Cancelled and No-show are final and only reachable through cancel_booking.
-- ---------------------------------------------------------------------------
create function public.set_booking_status(p_id uuid, p_expected_version int, p_status public.booking_status)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare cur public.bookings;
begin
  perform public.require_active_user();
  select * into cur from public.bookings where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using detail = 'Booking not found.'; end if;
  if cur.version <> p_expected_version then
    raise exception 'STALE_RECORD' using detail = 'Someone else changed this booking. Please reload.';
  end if;
  if not ((cur.status, p_status) in (
        ('confirmed', 'checked_in'), ('checked_in', 'checked_out'),
        ('checked_in', 'confirmed'), ('checked_out', 'checked_in'))) then
    raise exception 'STATUS_NOT_ALLOWED' using detail = 'This status change is not allowed.';
  end if;
  update public.bookings set status = p_status where id = p_id;
  perform public.queue_pdf_job(p_id, 'status changed');
  return jsonb_build_object('id', p_id, 'version', cur.version + 1);
end
$$;
revoke all on function public.set_booking_status(uuid, int, public.booking_status) from public, anon, authenticated;
grant execute on function public.set_booking_status(uuid, int, public.booking_status) to authenticated;

-- ---------------------------------------------------------------------------
-- cancel_booking (Q7, Q7a, Q7c). The original amounts are never touched; the charge becomes the Amount Due.
--  Cancelled: the charge must be given (no default).  No-show: no charge given = the full Final Amount;
--  any other charge needs charge_change_reason.
-- ---------------------------------------------------------------------------
create function public.cancel_booking(
  p_id uuid, p_expected_version int, p_kind public.booking_status, p_date date,
  p_charge bigint, p_reason text, p_charge_change_reason text default null, p_plan jsonb default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  cur public.bookings;
  v_charge bigint;
  v_reason text := public.require_reason(p_reason, 1);
  v_date date := coalesce(p_date, public.today_ist());
  v_rev uuid;
begin
  perform public.require_active_user();
  if p_kind not in ('cancelled', 'no_show') then
    raise exception 'INVALID_INPUT' using detail = 'Choose Cancelled or No-show.';
  end if;
  select * into cur from public.bookings where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using detail = 'Booking not found.'; end if;
  if cur.version <> p_expected_version then
    raise exception 'STALE_RECORD' using detail = 'Someone else changed this booking. Please reload.';
  end if;
  if cur.status in ('cancelled', 'no_show') then
    raise exception 'STATUS_FINAL' using detail = 'This booking is already cancelled.';
  end if;
  if v_date > public.today_ist() then
    raise exception 'CANCELLATION_DATE_FUTURE' using detail = 'The cancellation date cannot be in the future.';
  end if;

  if p_charge is null and p_kind = 'cancelled' then
    raise exception 'CHARGE_REQUIRED' using detail = 'Please enter the cancellation charge (it can be zero).';
  end if;
  v_charge := coalesce(p_charge, cur.final_amount_paise);
  if v_charge < 0 or v_charge > cur.final_amount_paise then
    raise exception 'CHARGE_OUT_OF_RANGE' using detail = 'The charge must be between zero and the final booking amount.';
  end if;
  if p_kind = 'no_show' and v_charge <> cur.final_amount_paise then
    perform public.require_reason(p_charge_change_reason, 1);
  end if;

  update public.bookings set
    status = p_kind, cancellation_date = v_date, cancellation_charge_paise = v_charge,
    cancellation_reason = v_reason,
    charge_change_reason = case when p_kind = 'no_show' and v_charge <> cur.final_amount_paise then public.pl_text(jsonb_build_object('r', p_charge_change_reason), 'r') end
  where id = p_id;

  v_rev := public.apply_plan_change(p_id, case when p_kind = 'no_show' then 'no_show' else 'cancellation' end,
                                    case when p_kind = 'no_show' then 'no_show'::public.adjustment_source else 'cancellation'::public.adjustment_source end,
                                    v_reason, p_plan, 'cancellation', 0);
  perform public.queue_pdf_job(p_id, case when p_kind = 'no_show' then 'marked no-show' else 'cancelled' end);
  return jsonb_build_object('id', p_id, 'version', cur.version + 1, 'revision_id', v_rev, 'amount_due_paise', v_charge);
end
$$;
revoke all on function public.cancel_booking(uuid, int, public.booking_status, date, bigint, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.cancel_booking(uuid, int, public.booking_status, date, bigint, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- change_cancellation_charge: a correction, always with a reason
-- ---------------------------------------------------------------------------
create function public.change_cancellation_charge(
  p_id uuid, p_expected_version int, p_charge bigint, p_reason text, p_plan jsonb default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  cur public.bookings;
  v_reason text := public.require_reason(p_reason, 1);
  v_rev uuid;
begin
  perform public.require_active_user();
  select * into cur from public.bookings where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using detail = 'Booking not found.'; end if;
  if cur.version <> p_expected_version then
    raise exception 'STALE_RECORD' using detail = 'Someone else changed this booking. Please reload.';
  end if;
  if cur.status not in ('cancelled', 'no_show') then
    raise exception 'STATUS_NOT_ALLOWED' using detail = 'Only a cancelled or no-show booking has a cancellation charge.';
  end if;
  if p_charge is null or p_charge < 0 or p_charge > cur.final_amount_paise then
    raise exception 'CHARGE_OUT_OF_RANGE' using detail = 'The charge must be between zero and the final booking amount.';
  end if;
  update public.bookings set cancellation_charge_paise = p_charge, charge_change_reason = v_reason where id = p_id;
  v_rev := public.apply_plan_change(p_id, 'charge_change', 'charge_change', v_reason, p_plan, 'cancellation', 0);
  perform public.queue_pdf_job(p_id, 'cancellation charge changed');
  return jsonb_build_object('id', p_id, 'version', cur.version + 1, 'revision_id', v_rev, 'amount_due_paise', p_charge);
end
$$;
revoke all on function public.change_cancellation_charge(uuid, int, bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.change_cancellation_charge(uuid, int, bigint, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- set_payment_schedule: change the plan only (same Amount Due). Optionally move an overdue amount.
-- ---------------------------------------------------------------------------
create function public.set_payment_schedule(
  p_id uuid, p_expected_version int, p_plan jsonb, p_move_overdue bigint default 0, p_reason text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  cur public.bookings;
  v_rev uuid;
begin
  perform public.require_active_user();
  select * into cur from public.bookings where id = p_id for update;
  if not found then raise exception 'NOT_FOUND' using detail = 'Booking not found.'; end if;
  if cur.version <> p_expected_version then
    raise exception 'STALE_RECORD' using detail = 'Someone else changed this booking. Please reload.';
  end if;
  v_rev := public.apply_plan_change(
    p_id, case when coalesce(p_move_overdue, 0) > 0 then 'move_overdue' else 'plan_change' end, 'plan_change',
    public.require_reason(p_reason, 1), p_plan,
    case when cur.status in ('cancelled', 'no_show') then 'cancellation'::public.plan_kind else 'booking'::public.plan_kind end,
    p_move_overdue);
  update public.bookings set updated_at = now() where id = p_id;   -- bumps the version
  perform public.queue_pdf_job(p_id, 'payment plan changed');
  return jsonb_build_object('id', p_id, 'version', cur.version + 1, 'revision_id', v_rev);
end
$$;
revoke all on function public.set_payment_schedule(uuid, int, jsonb, bigint, text) from public, anon, authenticated;
grant execute on function public.set_payment_schedule(uuid, int, jsonb, bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- plan_preview: read-only figures for "Already due (locked) / Adjustments / Amount still to plan"
-- ---------------------------------------------------------------------------
create function public.plan_preview(p_id uuid, p_new_amount_due bigint default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_today date := public.today_ist();
  v_due bigint; v_locked bigint; v_adj bigint; v_unpaid bigint;
begin
  perform public.require_active_user();
  select b.amount_due_paise into v_due from public.bookings b where b.id = p_id;
  if v_due is null then raise exception 'NOT_FOUND' using detail = 'Booking not found.'; end if;
  v_due := coalesce(p_new_amount_due, v_due);
  select coalesce(sum(s.amount_paise), 0) into v_locked
    from public.payment_schedules s where s.booking_id = p_id and s.superseded_at is null and s.due_date < v_today;
  select coalesce(sum(a.amount_paise), 0) into v_adj from public.expected_adjustments a where a.booking_id = p_id;
  select greatest(
           coalesce((select sum(e.amount_paise) from public.expected_entries e where e.booking_id = p_id and e.entry_date < v_today), 0)
           - (coalesce((select sum(p.amount_paise) from public.payments p where p.booking_id = p_id and p.status = 'approved' and p.payment_date < v_today), 0)
              - coalesce((select sum(f.amount_paise) from public.refunds f where f.booking_id = p_id and f.status = 'approved' and f.refund_date < v_today), 0)),
           0) into v_unpaid;
  return jsonb_build_object(
    'amount_due_paise', v_due, 'locked_paise', v_locked, 'adjustments_paise', v_adj,
    'to_plan_paise', v_due - v_locked - v_adj, 'unpaid_past_paise', v_unpaid, 'today', v_today);
end
$$;
revoke all on function public.plan_preview(uuid, bigint) from public, anon, authenticated;
grant execute on function public.plan_preview(uuid, bigint) to authenticated;
