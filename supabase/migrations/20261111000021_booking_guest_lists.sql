-- =============================================================================
-- 21 BOOKING AND GUEST LISTS (M4: the lists, the search and the guest history)
--
-- Read-only functions behind the Bookings list, the Guests list and the search box (UI spec 3.3, 3.12; PRD FR-BK, FR-GST).
-- They only READ.
--   booking_list  one page of bookings with their money figures, filtered and counted in the database
--   guest_list    one page of guests with how many bookings they have, their last stay and their money totals
--
-- Rules (the same as migration 20):
--   * SECURITY INVOKER: they run with the CALLER's rights, so the row-level security of every table still applies. A
--     signed-in, active user sees every resort (Q10); nobody else sees anything, and the functions refuse anyone who
--     is not an active user (NOT_ALLOWED) instead of quietly returning an empty list.
--   * empty search_path; every name schema-qualified; executable by signed-in users only (not anon, not PUBLIC)
--   * no dynamic SQL: every filter is a parameter, so nothing typed by a person is ever part of the SQL text
--   * the search text is matched with LIKE after "%", "_" and "\" are made harmless
--   * a page is at most 100 rows; the total number of matching rows is returned with every row
--   * money is whole paise (bigint), taken from the booking_financials view (the same source as the booking page)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Makes a person's search text safe for LIKE: "50%" must find "50%", not everything.
-- ---------------------------------------------------------------------------
create function public.like_safe(p_text text)
returns text
language sql immutable
set search_path = ''
as $$
  select replace(replace(replace(btrim(coalesce(p_text, '')), '\', '\\'), '%', '\%'), '_', '\_')
$$;
revoke all on function public.like_safe(text) from public, anon;
grant execute on function public.like_safe(text) to authenticated;

-- ---------------------------------------------------------------------------
-- booking_list
--   p_q          Booking ID, guest name, mobile number or C/O name (any part; capitals do not matter)
--   p_date_type  which date the range applies to: 'booking', 'check_in' or 'check_out' (IST calendar dates)
--   p_has_*      NULL = do not filter; TRUE = only bookings that have it
--   p_adjusted   TRUE = only bookings whose final amount was changed by hand
-- ---------------------------------------------------------------------------
create function public.booking_list(
  p_q            text default null,
  p_resort       uuid default null,
  p_status       public.booking_status default null,
  p_date_type    text default 'booking',
  p_from         date default null,
  p_to           date default null,
  p_co_category  smallint default null,
  p_method       public.pricing_method default null,
  p_has_pending  boolean default null,
  p_has_waiting  boolean default null,
  p_refund_due   boolean default null,
  p_adjusted     boolean default null,
  p_limit        int default 25,
  p_offset       int default 0
)
returns table (
  booking_id        uuid,
  booking_code      text,
  resort_id         uuid,
  guest_id          uuid,
  guest_name        text,
  guest_mobile      text,
  co_category_name  text,
  co_name           text,
  status            public.booking_status,
  booking_date      date,
  check_in_at       timestamptz,
  check_out_at      timestamptz,
  pax               int,
  adjusted          boolean,
  amount_due_paise  bigint,
  approved_paise    bigint,
  waiting_paise     bigint,
  pending_paise     bigint,
  refund_due_paise  bigint,
  total_rows        bigint
)
language plpgsql stable
set search_path = ''
as $$
declare
  v_q      text := public.like_safe(p_q);
  v_digits text := regexp_replace(coalesce(p_q, ''), '[^0-9]', '', 'g');
  v_limit  int;
  v_offset int;
begin
  if not public.is_active_user() then
    raise exception 'NOT_ALLOWED' using detail = 'Only an active, logged-in user can see bookings.';
  end if;
  if p_date_type is null or p_date_type not in ('booking', 'check_in', 'check_out') then
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
  select b.id, b.booking_code, b.resort_id, b.guest_id, b.guest_name, b.guest_mobile,
         b.co_category_name, b.co_name, b.status, b.booking_date, b.check_in_at, b.check_out_at, b.pax,
         (b.manual_adjustment_paise <> 0),
         coalesce(f.due_paise, 0)::bigint, coalesce(f.total_collection_paise, 0)::bigint, coalesce(f.waiting_paise, 0)::bigint,
         coalesce(f.pending_paise, 0)::bigint, coalesce(f.refund_due_paise, 0)::bigint,
         count(*) over ()
    from public.bookings b
    left join public.booking_financials f on f.booking_id = b.id
   where (p_resort is null or b.resort_id = p_resort)
     and (p_status is null or b.status = p_status)
     and (p_co_category is null or b.co_category_id = p_co_category)
     and (p_method is null or b.pricing_method = p_method)
     and (v_q = '' or b.booking_code ilike '%' || v_q || '%' escape '\'
          or b.guest_name ilike '%' || v_q || '%' escape '\'
          or coalesce(b.co_name, '') ilike '%' || v_q || '%' escape '\'
          or (length(v_digits) >= 3 and regexp_replace(b.guest_mobile, '[^0-9]', '', 'g') like '%' || v_digits || '%'))
     and (p_from is null or (case p_date_type
            when 'booking'   then b.booking_date
            when 'check_in'  then (b.check_in_at at time zone 'Asia/Kolkata')::date
            else                  (b.check_out_at at time zone 'Asia/Kolkata')::date end) >= p_from)
     and (p_to is null or (case p_date_type
            when 'booking'   then b.booking_date
            when 'check_in'  then (b.check_in_at at time zone 'Asia/Kolkata')::date
            else                  (b.check_out_at at time zone 'Asia/Kolkata')::date end) <= p_to)
     and (p_has_pending is not true or coalesce(f.pending_paise, 0) > 0)
     and (p_has_waiting is not true or coalesce(f.waiting_paise, 0) > 0 or coalesce(f.refund_waiting_paise, 0) > 0)
     and (p_refund_due  is not true or coalesce(f.refund_due_paise, 0) > 0)
     and (p_adjusted    is not true or b.manual_adjustment_paise <> 0)
   order by b.booking_date desc, b.created_at desc, b.id
   limit v_limit offset v_offset;
end
$$;
revoke all on function public.booking_list(text, uuid, public.booking_status, text, date, date, smallint, public.pricing_method, boolean, boolean, boolean, boolean, int, int) from public, anon;
grant execute on function public.booking_list(text, uuid, public.booking_status, text, date, date, smallint, public.pricing_method, boolean, boolean, boolean, boolean, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- guest_list: one page of guests, with their history in numbers
--   bookings        every booking of the guest, whatever its status
--   last_check_in   the latest check-in date (IST)
--   net_collection  approved payments less approved refunds, over all their bookings
--   pending         the sum of booking_financials.pending_paise over ALL their bookings (rule D1: the amount due less approved
--                   and waiting payments, plus approved refunds). An unpaid cancellation or no-show charge is the amount due
--                   of that booking, so it is included
-- ---------------------------------------------------------------------------
create function public.guest_list(
  p_q      text default null,
  p_limit  int default 25,
  p_offset int default 0
)
returns table (
  guest_id            uuid,
  full_name           text,
  mobile              text,
  email               text,
  bookings            bigint,
  last_check_in       date,
  net_collection_paise bigint,
  pending_paise       bigint,
  total_rows          bigint
)
language plpgsql stable
set search_path = ''
as $$
declare
  v_q      text := public.like_safe(p_q);
  v_digits text := regexp_replace(coalesce(p_q, ''), '[^0-9]', '', 'g');
  v_limit  int;
  v_offset int;
begin
  if not public.is_active_user() then
    raise exception 'NOT_ALLOWED' using detail = 'Only an active, logged-in user can see guests.';
  end if;
  if length(coalesce(p_q, '')) > 100 then
    raise exception 'INVALID_INPUT' using detail = 'The search text is too long.';
  end if;
  v_limit  := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  return query
  select g.id, g.full_name, g.mobile, g.email,
         count(b.id),
         max((b.check_in_at at time zone 'Asia/Kolkata')::date),
         coalesce(sum(f.net_collection_paise), 0)::bigint,
         coalesce(sum(f.pending_paise), 0)::bigint,
         count(*) over ()
    from public.guests g
    left join public.bookings b on b.guest_id = g.id
    left join public.booking_financials f on f.booking_id = b.id
   where (v_q = '' or g.full_name ilike '%' || v_q || '%' escape '\'
          or coalesce(g.email, '') ilike '%' || v_q || '%' escape '\'
          or (length(v_digits) >= 3 and g.mobile_normalized like '%' || v_digits || '%'))
   group by g.id
   order by g.full_name, g.id
   limit v_limit offset v_offset;
end
$$;
revoke all on function public.guest_list(text, int, int) from public, anon;
grant execute on function public.guest_list(text, int, int) to authenticated;
