-- =============================================================================
-- 22 PAYMENT AND REFUND LISTS (M5: the Payments, Refunds and Waiting-for-Approval screens)
--
-- Read-only functions behind /payments, /refunds, /approvals and the booking page's Payments & Refunds tab
-- (UI spec 3.9, 3.10, 3.5; PRD FR-PAY, FR-REF, FR-APR). They only READ. All money rules (D1, D5, Q8, Q9a) stay where they
-- are: in migrations 06 and 15. Nothing here changes a balance, a status or a file.
--   payment_list  one page of payments with the booking, guest, resort, provider, who recorded them and how many files
--   refund_list   the same for refunds
--
-- Rules (the same as migrations 20 and 21):
--   * SECURITY INVOKER: they run with the CALLER's rights, so the row-level security of every table still applies. A
--     signed-in, active user sees every resort (Q10); nobody else sees anything, and the functions refuse anyone who is
--     not an active user (NOT_ALLOWED) instead of quietly returning an empty list.
--   * empty search_path; every name schema-qualified; executable by signed-in users only (not anon, not PUBLIC)
--   * no dynamic SQL: every filter is a parameter; search text goes through public.like_safe (migration 21)
--   * a page is at most 100 rows; the total number of matching rows comes with every row
--   * amounts are whole paise exactly as stored; a list never adds, subtracts or reinterprets them. A rejected or
--     reversed row is listed with its status and is never counted anywhere by this function.
--   * p_date_type: 'payment' / 'refund' = the date written on the record, 'entry' = the IST date it was typed in
--   * p_oldest_first = TRUE is the approval queue order (oldest first)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- payment_list
-- ---------------------------------------------------------------------------
create function public.payment_list(
  p_q              text default null,
  p_status         public.approval_status default null,
  p_method         public.payment_method default null,
  p_provider       smallint default null,
  p_resort         uuid default null,
  p_booking        uuid default null,
  p_date_type      text default 'payment',
  p_from           date default null,
  p_to             date default null,
  p_recorded_by    uuid default null,
  p_self_approved  boolean default null,
  p_oldest_first   boolean default false,
  p_limit          int default 25,
  p_offset         int default 0
)
returns table (
  payment_id         uuid,
  payment_code       text,
  booking_id         uuid,
  booking_code       text,
  resort_id          uuid,
  guest_name         text,
  guest_mobile       text,
  amount_paise       bigint,
  method             public.payment_method,
  provider_name      text,
  provider_other     text,
  reference_number   text,
  payment_date       date,
  payment_time       time,
  status             public.approval_status,
  is_self_approved   boolean,
  recorded_by        uuid,
  recorded_by_name   text,
  recorded_at        timestamptz,
  decided_by_name    text,
  rejection_reason   text,
  reversal_reason    text,
  proof_count        bigint,
  version            int,
  total_rows         bigint
)
language plpgsql stable
set search_path = ''
as $$
declare
  v_q      text := public.like_safe(p_q);
  v_limit  int;
  v_offset int;
begin
  if not public.is_active_user() then
    raise exception 'NOT_ALLOWED' using detail = 'Only an active, logged-in user can see payments.';
  end if;
  if p_date_type is null or p_date_type not in ('payment', 'entry') then
    raise exception 'INVALID_INPUT' using detail = 'Please choose which date to filter by.';
  end if;
  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'INVALID_INPUT' using detail = 'The end date cannot be before the start date.';
  end if;
  if length(coalesce(p_q, '')) > 100 then
    raise exception 'INVALID_INPUT' using detail = 'The search text is too long.';
  end if;
  v_limit  := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  return query
  select p.id, p.payment_code, p.booking_id, b.booking_code, p.resort_id, b.guest_name, b.guest_mobile,
         p.amount_paise::bigint, p.method, pp.name, p.provider_other, p.reference_number, p.payment_date, p.payment_time,
         p.status, coalesce(p.is_self_approved, false), p.recorded_by, ru.full_name, p.recorded_at,
         du.full_name, p.rejection_reason, p.reversal_reason,
         (select count(*) from public.proofs f where f.payment_id = p.id and f.hidden_at is null),
         p.version, count(*) over ()
    from public.payments p
    join public.bookings b on b.id = p.booking_id
    left join public.payment_providers pp on pp.id = p.provider_id
    left join public.user_profiles ru on ru.id = p.recorded_by
    left join public.user_profiles du on du.id = coalesce(p.approved_by, p.rejected_by, p.reversed_by)
   where (p_status is null or p.status = p_status)
     and (p_method is null or p.method = p_method)
     and (p_provider is null or p.provider_id = p_provider)
     and (p_resort is null or p.resort_id = p_resort)
     and (p_booking is null or p.booking_id = p_booking)
     and (p_recorded_by is null or p.recorded_by = p_recorded_by)
     and (p_self_approved is not true or coalesce(p.is_self_approved, false))
     and (v_q = '' or p.payment_code ilike '%' || v_q || '%' escape '\'
          or b.booking_code ilike '%' || v_q || '%' escape '\'
          or b.guest_name ilike '%' || v_q || '%' escape '\'
          or coalesce(p.reference_number, '') ilike '%' || v_q || '%' escape '\')
     and (p_from is null or (case p_date_type when 'payment' then p.payment_date
                                  else (p.recorded_at at time zone 'Asia/Kolkata')::date end) >= p_from)
     and (p_to is null or (case p_date_type when 'payment' then p.payment_date
                                else (p.recorded_at at time zone 'Asia/Kolkata')::date end) <= p_to)
   order by case when p_oldest_first then p.recorded_at end asc,
            case when not coalesce(p_oldest_first, false) then p.payment_date end desc,
            case when not coalesce(p_oldest_first, false) then p.recorded_at end desc,
            p.id
   limit v_limit offset v_offset;
end
$$;
revoke all on function public.payment_list(text, public.approval_status, public.payment_method, smallint, uuid, uuid, text, date, date, uuid, boolean, boolean, int, int) from public, anon;
grant execute on function public.payment_list(text, public.approval_status, public.payment_method, smallint, uuid, uuid, text, date, date, uuid, boolean, boolean, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- refund_list: the same for refunds (adds the reason)
-- ---------------------------------------------------------------------------
create function public.refund_list(
  p_q              text default null,
  p_status         public.approval_status default null,
  p_method         public.payment_method default null,
  p_provider       smallint default null,
  p_resort         uuid default null,
  p_booking        uuid default null,
  p_date_type      text default 'refund',
  p_from           date default null,
  p_to             date default null,
  p_recorded_by    uuid default null,
  p_self_approved  boolean default null,
  p_oldest_first   boolean default false,
  p_limit          int default 25,
  p_offset         int default 0
)
returns table (
  refund_id          uuid,
  refund_code        text,
  booking_id         uuid,
  booking_code       text,
  resort_id          uuid,
  guest_name         text,
  guest_mobile       text,
  amount_paise       bigint,
  method             public.payment_method,
  provider_name      text,
  provider_other     text,
  reference_number   text,
  refund_date        date,
  refund_time        time,
  reason             text,
  status             public.approval_status,
  is_self_approved   boolean,
  recorded_by        uuid,
  recorded_by_name   text,
  recorded_at        timestamptz,
  decided_by_name    text,
  rejection_reason   text,
  reversal_reason    text,
  proof_count        bigint,
  version            int,
  total_rows         bigint
)
language plpgsql stable
set search_path = ''
as $$
declare
  v_q      text := public.like_safe(p_q);
  v_limit  int;
  v_offset int;
begin
  if not public.is_active_user() then
    raise exception 'NOT_ALLOWED' using detail = 'Only an active, logged-in user can see refunds.';
  end if;
  if p_date_type is null or p_date_type not in ('refund', 'entry') then
    raise exception 'INVALID_INPUT' using detail = 'Please choose which date to filter by.';
  end if;
  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'INVALID_INPUT' using detail = 'The end date cannot be before the start date.';
  end if;
  if length(coalesce(p_q, '')) > 100 then
    raise exception 'INVALID_INPUT' using detail = 'The search text is too long.';
  end if;
  v_limit  := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  return query
  select r.id, r.refund_code, r.booking_id, b.booking_code, r.resort_id, b.guest_name, b.guest_mobile,
         r.amount_paise::bigint, r.method, pp.name, r.provider_other, r.reference_number, r.refund_date, r.refund_time,
         r.reason, r.status, coalesce(r.is_self_approved, false), r.recorded_by, ru.full_name, r.recorded_at,
         du.full_name, r.rejection_reason, r.reversal_reason,
         (select count(*) from public.proofs f where f.refund_id = r.id and f.hidden_at is null),
         r.version, count(*) over ()
    from public.refunds r
    join public.bookings b on b.id = r.booking_id
    left join public.payment_providers pp on pp.id = r.provider_id
    left join public.user_profiles ru on ru.id = r.recorded_by
    left join public.user_profiles du on du.id = coalesce(r.approved_by, r.rejected_by, r.reversed_by)
   where (p_status is null or r.status = p_status)
     and (p_method is null or r.method = p_method)
     and (p_provider is null or r.provider_id = p_provider)
     and (p_resort is null or r.resort_id = p_resort)
     and (p_booking is null or r.booking_id = p_booking)
     and (p_recorded_by is null or r.recorded_by = p_recorded_by)
     and (p_self_approved is not true or coalesce(r.is_self_approved, false))
     and (v_q = '' or r.refund_code ilike '%' || v_q || '%' escape '\'
          or b.booking_code ilike '%' || v_q || '%' escape '\'
          or b.guest_name ilike '%' || v_q || '%' escape '\'
          or coalesce(r.reference_number, '') ilike '%' || v_q || '%' escape '\')
     and (p_from is null or (case p_date_type when 'refund' then r.refund_date
                                  else (r.recorded_at at time zone 'Asia/Kolkata')::date end) >= p_from)
     and (p_to is null or (case p_date_type when 'refund' then r.refund_date
                                else (r.recorded_at at time zone 'Asia/Kolkata')::date end) <= p_to)
   order by case when p_oldest_first then r.recorded_at end asc,
            case when not coalesce(p_oldest_first, false) then r.refund_date end desc,
            case when not coalesce(p_oldest_first, false) then r.recorded_at end desc,
            r.id
   limit v_limit offset v_offset;
end
$$;
revoke all on function public.refund_list(text, public.approval_status, public.payment_method, smallint, uuid, uuid, text, date, date, uuid, boolean, boolean, int, int) from public, anon;
grant execute on function public.refund_list(text, public.approval_status, public.payment_method, smallint, uuid, uuid, text, date, date, uuid, boolean, boolean, int, int) to authenticated;
