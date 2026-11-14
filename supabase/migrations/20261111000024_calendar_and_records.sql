-- =============================================================================
-- 24 CALENDAR, OLD RECORDS AND ACTIVITY (M7)
--
-- Four read-only functions behind /calendar, /calendar/[date], /old-records and /activity (UI spec 3.11, 3.14, 3.15;
-- PRD FR-CAL-1..5, FR-AUD-3). They only READ. No table, view, policy, trigger or money rule is created or changed.
--   calendar_month      one row per day of a month: check-ins, check-outs, guests staying, due, collected, waiting, refunds
--   calendar_day        everything on one day: check-ins, check-outs, staying, payments, refunds, payments due
--   old_records_search  bookings, payments and refunds in one list, by any stored date (record, entry, check-in, check-out,
--                       cancellation), newest first
--   activity_list       the audit log with filters, the changed values only, and the codes of the records
--
-- Rules (the same as migrations 20, 21 and 22):
--   * SECURITY INVOKER: they run with the CALLER's rights, so the row-level security of every table still applies. A
--     signed-in, active user sees every resort (Q10); nobody else sees anything, and the functions refuse anyone who is
--     not an active user (NOT_ALLOWED) instead of quietly returning an empty list. The audit log keeps its own rule:
--     the re-entry-of-password rows are readable by Owners only (migration 19), and this function inherits it.
--   * empty search_path; every name schema-qualified; executable by signed-in users only (not anon, not PUBLIC)
--   * no dynamic SQL: every filter is a parameter; search text goes through public.like_safe (migration 21)
--   * all dates are IST calendar dates (Asia/Kolkata, no daylight saving)
--   * money is whole paise exactly as the existing sources give it, and no figure is calculated again here:
--       - "due"       = the expected_entries view (plan rows on their due date + dated adjustments), as the dashboard
--       - "collected" = approved payments by PAYMENT date; "waiting" = waiting payments, separately, never added
--       - "refunds"   = approved refunds by REFUND date
--       - a booking's amount due and pending amount = the booking_financials view (rule D1, unchanged)
--     rejected and reversed payments or refunds are listed with their status and are never counted
--   * a guest is "staying" on a day when the IST check-in date <= the day < the IST check-out date; cancelled and
--     no-show bookings are not shown as arriving, leaving or staying (as on the dashboard)
--   * a page or a day-list is bounded (at most 100 rows per page, at most 300 rows per list on a day)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- calendar_month
--   p_year, p_month  the month (1990 to 2100; there is no other limit on how far one can look back or ahead)
--   p_resort         NULL = all resorts
-- ---------------------------------------------------------------------------
create function public.calendar_month(p_year int, p_month int, p_resort uuid default null)
returns table (
  day_date        date,
  check_ins       int,
  check_outs      int,
  staying         int,
  due_paise       bigint,
  collected_paise bigint,
  waiting_paise   bigint,
  refunds_paise   bigint
)
language plpgsql stable
set search_path = ''
as $$
declare
  v_first date;
  v_last  date;
  v_lo    timestamptz;
  v_hi    timestamptz;
begin
  if not public.is_active_user() then
    raise exception 'NOT_ALLOWED' using detail = 'Only an active, logged-in user can see the calendar.';
  end if;
  if p_year is null or p_month is null or p_year not between 1990 and 2100 or p_month not between 1 and 12 then
    raise exception 'INVALID_INPUT' using detail = 'Please choose a month between 1990 and 2100.';
  end if;
  v_first := make_date(p_year, p_month, 1);
  v_last  := (v_first + interval '1 month' - interval '1 day')::date;
  v_lo    := v_first::timestamp at time zone 'Asia/Kolkata';
  v_hi    := (v_last + 1)::timestamp at time zone 'Asia/Kolkata';

  return query
  with days as (
    select g.d::date as d from generate_series(v_first, v_last, interval '1 day') as g(d)
  ),
  stays as (
    select (b.check_in_at  at time zone 'Asia/Kolkata')::date as in_d,
           (b.check_out_at at time zone 'Asia/Kolkata')::date as out_d
      from public.bookings b
     where b.status not in ('cancelled', 'no_show')
       and (p_resort is null or b.resort_id = p_resort)
       and b.check_in_at < v_hi and b.check_out_at >= v_lo
  ),
  arrivals as (select s.in_d  as d, count(*) as n from stays s group by s.in_d),
  departures as (select s.out_d as d, count(*) as n from stays s group by s.out_d),
  overnight as (
    select dd.d, count(*) as n from days dd join stays s on s.in_d <= dd.d and s.out_d > dd.d group by dd.d
  ),
  due as (
    select e.entry_date as d, sum(e.amount_paise) as s
      from public.expected_entries e
     where e.entry_date between v_first and v_last and (p_resort is null or e.resort_id = p_resort)
     group by e.entry_date
  ),
  pay as (
    select p.payment_date as d,
           sum(p.amount_paise) filter (where p.status = 'approved') as approved,
           sum(p.amount_paise) filter (where p.status = 'waiting')  as waiting
      from public.payments p
     where p.payment_date between v_first and v_last and (p_resort is null or p.resort_id = p_resort)
     group by p.payment_date
  ),
  refs as (
    select r.refund_date as d, sum(r.amount_paise) as s
      from public.refunds r
     where r.status = 'approved' and r.refund_date between v_first and v_last and (p_resort is null or r.resort_id = p_resort)
     group by r.refund_date
  )
  select dd.d,
         coalesce(a.n, 0)::int,
         coalesce(x.n, 0)::int,
         coalesce(o.n, 0)::int,
         coalesce(du.s, 0)::bigint,
         coalesce(py.approved, 0)::bigint,
         coalesce(py.waiting, 0)::bigint,
         coalesce(rf.s, 0)::bigint
    from days dd
    left join arrivals a on a.d = dd.d
    left join departures x on x.d = dd.d
    left join overnight o on o.d = dd.d
    left join due du on du.d = dd.d
    left join pay py on py.d = dd.d
    left join refs rf on rf.d = dd.d
   order by dd.d;
end
$$;
revoke all on function public.calendar_month(int, int, uuid) from public, anon;
grant execute on function public.calendar_month(int, int, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- calendar_day: the lists of one day. `kind` is one of
--   check_in, check_out, staying   bookings (record_* columns are empty)
--   payment, refund                the records dated that day (any status; only approved ones are ever counted)
--   due                            the expected_entries of that day: a plan row (label = its name) or a dated adjustment
-- `kind_total` is how many rows that kind has in all; at most 300 rows of a kind are returned.
-- `backdated` = the date written on the payment/refund is before the day it was typed in (IST).
-- ---------------------------------------------------------------------------
create function public.calendar_day(p_date date, p_resort uuid default null)
returns table (
  kind            text,
  booking_id      uuid,
  booking_code    text,
  resort_id       uuid,
  guest_name      text,
  guest_mobile    text,
  booking_status  public.booking_status,
  check_in_at     timestamptz,
  check_out_at    timestamptz,
  pax             int,
  record_id       uuid,
  record_code     text,
  amount_paise    bigint,
  record_status   public.approval_status,
  method          text,
  label           text,
  record_date     date,
  entered_on      date,
  backdated       boolean,
  pending_paise   bigint,
  kind_total      bigint
)
language plpgsql stable
set search_path = ''
as $$
begin
  if not public.is_active_user() then
    raise exception 'NOT_ALLOWED' using detail = 'Only an active, logged-in user can see the calendar.';
  end if;
  if p_date is null or p_date < date '1990-01-01' or p_date > date '2100-12-31' then
    raise exception 'INVALID_INPUT' using detail = 'Please choose a date between 1990 and 2100.';
  end if;

  return query
  (select 'check_in'::text, b.id, b.booking_code, b.resort_id, b.guest_name, b.guest_mobile, b.status,
          b.check_in_at, b.check_out_at, b.pax,
          null::uuid, null::text, null::bigint, null::public.approval_status, null::text, null::text,
          null::date, null::date, false, coalesce(f.pending_paise, 0)::bigint, count(*) over ()
     from public.bookings b left join public.booking_financials f on f.booking_id = b.id
    where b.status not in ('cancelled', 'no_show') and (p_resort is null or b.resort_id = p_resort)
      and b.check_in_at >= (p_date::timestamp at time zone 'Asia/Kolkata')
      and b.check_in_at <  ((p_date + 1)::timestamp at time zone 'Asia/Kolkata')
    order by b.check_in_at, b.booking_code limit 300)
  union all
  (select 'check_out'::text, b.id, b.booking_code, b.resort_id, b.guest_name, b.guest_mobile, b.status,
          b.check_in_at, b.check_out_at, b.pax,
          null::uuid, null::text, null::bigint, null::public.approval_status, null::text, null::text,
          null::date, null::date, false, coalesce(f.pending_paise, 0)::bigint, count(*) over ()
     from public.bookings b left join public.booking_financials f on f.booking_id = b.id
    where b.status not in ('cancelled', 'no_show') and (p_resort is null or b.resort_id = p_resort)
      and b.check_out_at >= (p_date::timestamp at time zone 'Asia/Kolkata')
      and b.check_out_at <  ((p_date + 1)::timestamp at time zone 'Asia/Kolkata')
    order by b.check_out_at, b.booking_code limit 300)
  union all
  (select 'staying'::text, b.id, b.booking_code, b.resort_id, b.guest_name, b.guest_mobile, b.status,
          b.check_in_at, b.check_out_at, b.pax,
          null::uuid, null::text, null::bigint, null::public.approval_status, null::text, null::text,
          null::date, null::date, false, coalesce(f.pending_paise, 0)::bigint, count(*) over ()
     from public.bookings b left join public.booking_financials f on f.booking_id = b.id
    where b.status not in ('cancelled', 'no_show') and (p_resort is null or b.resort_id = p_resort)
      and b.check_in_at  <  ((p_date + 1)::timestamp at time zone 'Asia/Kolkata')
      and b.check_out_at >= ((p_date + 1)::timestamp at time zone 'Asia/Kolkata')
      and (b.check_in_at at time zone 'Asia/Kolkata')::date <= p_date
      and (b.check_out_at at time zone 'Asia/Kolkata')::date > p_date
    order by b.check_in_at, b.booking_code limit 300)
  union all
  (select 'payment'::text, b.id, b.booking_code, p.resort_id, b.guest_name, b.guest_mobile, b.status,
          b.check_in_at, b.check_out_at, b.pax,
          p.id, p.payment_code, p.amount_paise::bigint, p.status, p.method::text,
          case when pp.name = 'Other' then coalesce(p.provider_other, pp.name) else pp.name end,
          p.payment_date, (p.recorded_at at time zone 'Asia/Kolkata')::date,
          p.payment_date < (p.recorded_at at time zone 'Asia/Kolkata')::date,
          coalesce(f.pending_paise, 0)::bigint, count(*) over ()
     from public.payments p
     join public.bookings b on b.id = p.booking_id
     left join public.booking_financials f on f.booking_id = b.id
     left join public.payment_providers pp on pp.id = p.provider_id
    where p.payment_date = p_date and (p_resort is null or p.resort_id = p_resort)
    order by p.recorded_at, p.id limit 300)
  union all
  (select 'refund'::text, b.id, b.booking_code, x.resort_id, b.guest_name, b.guest_mobile, b.status,
          b.check_in_at, b.check_out_at, b.pax,
          x.id, x.refund_code, x.amount_paise::bigint, x.status, x.method::text,
          case when pp.name = 'Other' then coalesce(x.provider_other, pp.name) else pp.name end,
          x.refund_date, (x.recorded_at at time zone 'Asia/Kolkata')::date,
          x.refund_date < (x.recorded_at at time zone 'Asia/Kolkata')::date,
          coalesce(f.pending_paise, 0)::bigint, count(*) over ()
     from public.refunds x
     join public.bookings b on b.id = x.booking_id
     left join public.booking_financials f on f.booking_id = b.id
     left join public.payment_providers pp on pp.id = x.provider_id
    where x.refund_date = p_date and (p_resort is null or x.resort_id = p_resort)
    order by x.recorded_at, x.id limit 300)
  union all
  (select 'due'::text, b.id, b.booking_code, e.resort_id, b.guest_name, b.guest_mobile, b.status,
          b.check_in_at, b.check_out_at, b.pax,
          e.source_id, null::text, e.amount_paise::bigint, null::public.approval_status, e.kind,
          case when e.kind = 'plan' then s.label else a.reason end,
          e.entry_date, null::date, false, coalesce(f.pending_paise, 0)::bigint, count(*) over ()
     from public.expected_entries e
     join public.bookings b on b.id = e.booking_id
     left join public.booking_financials f on f.booking_id = b.id
     left join public.payment_schedules s on e.kind = 'plan' and s.id = e.source_id
     left join public.expected_adjustments a on e.kind = 'adjustment' and a.id = e.source_id
    where e.entry_date = p_date and (p_resort is null or e.resort_id = p_resort)
    order by b.booking_code, e.amount_paise desc, e.source_id limit 300);
end
$$;
revoke all on function public.calendar_day(date, uuid) from public, anon;
grant execute on function public.calendar_day(date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- old_records_search: bookings, payments and refunds in one list, newest first
--   p_q       Booking ID, guest name, mobile number, C/O name (bookings); also the payment/refund number, a payment's
--             reference number and a refund's reason
--   p_types   NULL or empty = all; otherwise any of 'booking', 'payment', 'refund'
--   p_basis   which stored date the range applies to (PRD FR-CAL-3):
--             'record'       the date written on the record: booking date, payment date, refund date
--             'entry'        the IST day it was typed in: bookings created, payments and refunds recorded
--             'check_in'     the IST check-in day of the booking
--             'check_out'    the IST check-out day of the booking
--             'cancellation' the cancellation date written on a cancelled or no-show booking
--             The last three are dates of the BOOKING. A payment or refund is matched by the date of its booking and is
--             listed with it; with 'cancellation' only cancelled and no-show bookings (and their payments and refunds)
--             are listed, whether or not a range is given, because only they have that date. With 'check_in' and
--             'check_out' every booking has the date, so no range simply means no restriction.
--   matched_date  the date the range was applied to for that row (so the screen can show why it matched)
--   file_count  payments and refunds: files not hidden; bookings: PDF versions
-- IST boundaries: a check-in or check-out moment belongs to its IST calendar day, so the range is compared with the
-- instants [IST midnight of p_from, IST midnight after p_to) and an index on the check-in/check-out time can be used.
-- ---------------------------------------------------------------------------
create function public.old_records_search(
  p_q       text default null,
  p_resort  uuid default null,
  p_types   text[] default null,
  p_basis   text default 'record',
  p_from    date default null,
  p_to      date default null,
  p_limit   int default 25,
  p_offset  int default 0
)
returns table (
  record_type   text,
  record_id     uuid,
  record_code   text,
  booking_id    uuid,
  booking_code  text,
  resort_id     uuid,
  guest_name    text,
  guest_mobile  text,
  status        text,
  amount_paise  bigint,
  record_date   date,
  entered_on    date,
  matched_date  date,
  backdated     boolean,
  file_count    bigint,
  total_rows    bigint
)
language plpgsql stable
set search_path = ''
as $$
declare
  v_q      text := public.like_safe(p_q);
  v_digits text := regexp_replace(coalesce(p_q, ''), '[^0-9]', '', 'g');
  v_all    boolean := coalesce(cardinality(p_types), 0) = 0;
  v_bk     boolean;
  v_pay    boolean;
  v_ref    boolean;
  v_limit  int;
  v_offset int;
  v_lo     timestamptz;
  v_hi     timestamptz;
begin
  if not public.is_active_user() then
    raise exception 'NOT_ALLOWED' using detail = 'Only an active, logged-in user can see old records.';
  end if;
  if p_basis is null or p_basis not in ('record', 'entry', 'check_in', 'check_out', 'cancellation') then
    raise exception 'INVALID_INPUT' using detail = 'Please choose which date to search by.';
  end if;
  if not v_all and exists (select 1 from unnest(p_types) t where t is null or t not in ('booking', 'payment', 'refund')) then
    raise exception 'INVALID_INPUT' using detail = 'Please choose bookings, payments or refunds.';
  end if;
  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'INVALID_INPUT' using detail = 'The end date cannot be before the start date.';
  end if;
  if length(coalesce(p_q, '')) > 100 then
    raise exception 'INVALID_INPUT' using detail = 'The search text is too long.';
  end if;
  v_bk  := v_all or 'booking' = any(p_types);
  v_pay := v_all or 'payment' = any(p_types);
  v_ref := v_all or 'refund'  = any(p_types);
  v_limit  := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);
  v_lo := case when p_from is null then '-infinity'::timestamptz else p_from::timestamp at time zone 'Asia/Kolkata' end;
  v_hi := case when p_to   is null then 'infinity'::timestamptz  else (p_to + 1)::timestamp at time zone 'Asia/Kolkata' end;

  return query
  with hits as (
    select 'booking'::text as rt, b.id as rid, b.booking_code as rcode, b.id as bid, b.booking_code as bcode, b.resort_id as rsid,
           b.guest_name as gname, b.guest_mobile as gmob, b.status::text as st,
           coalesce(f.due_paise, 0)::bigint as amt, b.booking_date as rdate,
           (b.created_at at time zone 'Asia/Kolkata')::date as edate,
           case p_basis when 'record' then b.booking_date
                        when 'entry' then (b.created_at at time zone 'Asia/Kolkata')::date
                        when 'check_in' then (b.check_in_at at time zone 'Asia/Kolkata')::date
                        when 'check_out' then (b.check_out_at at time zone 'Asia/Kolkata')::date
                        else b.cancellation_date end as mdate,
           false as bd,
           (select count(*) from public.booking_pdf_versions v where v.booking_id = b.id) as files
      from public.bookings b
      left join public.booking_financials f on f.booking_id = b.id
     where v_bk and (p_resort is null or b.resort_id = p_resort)
       and (v_q = '' or b.booking_code ilike '%' || v_q || '%' escape '\'
            or b.guest_name ilike '%' || v_q || '%' escape '\'
            or coalesce(b.co_name, '') ilike '%' || v_q || '%' escape '\'
            or (length(v_digits) >= 3 and regexp_replace(b.guest_mobile, '[^0-9]', '', 'g') like '%' || v_digits || '%'))
       and (p_basis <> 'record' or ((p_from is null or b.booking_date >= p_from) and (p_to is null or b.booking_date <= p_to)))
       and (p_basis <> 'entry' or ((p_from is null or (b.created_at at time zone 'Asia/Kolkata')::date >= p_from)
                                   and (p_to is null or (b.created_at at time zone 'Asia/Kolkata')::date <= p_to)))
       and (p_basis <> 'check_in' or (b.check_in_at >= v_lo and b.check_in_at < v_hi))
       and (p_basis <> 'check_out' or (b.check_out_at >= v_lo and b.check_out_at < v_hi))
       and (p_basis <> 'cancellation' or (b.cancellation_date is not null
                                          and (p_from is null or b.cancellation_date >= p_from)
                                          and (p_to is null or b.cancellation_date <= p_to)))
    union all
    select 'payment', p.id, p.payment_code, b.id, b.booking_code, p.resort_id,
           b.guest_name, b.guest_mobile, p.status::text, p.amount_paise::bigint, p.payment_date,
           (p.recorded_at at time zone 'Asia/Kolkata')::date,
           case p_basis when 'record' then p.payment_date
                        when 'entry' then (p.recorded_at at time zone 'Asia/Kolkata')::date
                        when 'check_in' then (b.check_in_at at time zone 'Asia/Kolkata')::date
                        when 'check_out' then (b.check_out_at at time zone 'Asia/Kolkata')::date
                        else b.cancellation_date end,
           p.payment_date < (p.recorded_at at time zone 'Asia/Kolkata')::date,
           (select count(*) from public.proofs x where x.payment_id = p.id and x.hidden_at is null)
      from public.payments p
      join public.bookings b on b.id = p.booking_id
     where v_pay and (p_resort is null or p.resort_id = p_resort)
       and (v_q = '' or p.payment_code ilike '%' || v_q || '%' escape '\'
            or b.booking_code ilike '%' || v_q || '%' escape '\'
            or b.guest_name ilike '%' || v_q || '%' escape '\'
            or coalesce(p.reference_number, '') ilike '%' || v_q || '%' escape '\'
            or (length(v_digits) >= 3 and regexp_replace(b.guest_mobile, '[^0-9]', '', 'g') like '%' || v_digits || '%'))
       and (p_basis <> 'record' or ((p_from is null or p.payment_date >= p_from) and (p_to is null or p.payment_date <= p_to)))
       and (p_basis <> 'entry' or ((p_from is null or (p.recorded_at at time zone 'Asia/Kolkata')::date >= p_from)
                                   and (p_to is null or (p.recorded_at at time zone 'Asia/Kolkata')::date <= p_to)))
       and (p_basis <> 'check_in' or (b.check_in_at >= v_lo and b.check_in_at < v_hi))
       and (p_basis <> 'check_out' or (b.check_out_at >= v_lo and b.check_out_at < v_hi))
       and (p_basis <> 'cancellation' or (b.cancellation_date is not null
                                          and (p_from is null or b.cancellation_date >= p_from)
                                          and (p_to is null or b.cancellation_date <= p_to)))
    union all
    select 'refund', r.id, r.refund_code, b.id, b.booking_code, r.resort_id,
           b.guest_name, b.guest_mobile, r.status::text, r.amount_paise::bigint, r.refund_date,
           (r.recorded_at at time zone 'Asia/Kolkata')::date,
           case p_basis when 'record' then r.refund_date
                        when 'entry' then (r.recorded_at at time zone 'Asia/Kolkata')::date
                        when 'check_in' then (b.check_in_at at time zone 'Asia/Kolkata')::date
                        when 'check_out' then (b.check_out_at at time zone 'Asia/Kolkata')::date
                        else b.cancellation_date end,
           r.refund_date < (r.recorded_at at time zone 'Asia/Kolkata')::date,
           (select count(*) from public.proofs x where x.refund_id = r.id and x.hidden_at is null)
      from public.refunds r
      join public.bookings b on b.id = r.booking_id
     where v_ref and (p_resort is null or r.resort_id = p_resort)
       and (v_q = '' or r.refund_code ilike '%' || v_q || '%' escape '\'
            or b.booking_code ilike '%' || v_q || '%' escape '\'
            or b.guest_name ilike '%' || v_q || '%' escape '\'
            or coalesce(r.reason, '') ilike '%' || v_q || '%' escape '\'
            or (length(v_digits) >= 3 and regexp_replace(b.guest_mobile, '[^0-9]', '', 'g') like '%' || v_digits || '%'))
       and (p_basis <> 'record' or ((p_from is null or r.refund_date >= p_from) and (p_to is null or r.refund_date <= p_to)))
       and (p_basis <> 'entry' or ((p_from is null or (r.recorded_at at time zone 'Asia/Kolkata')::date >= p_from)
                                   and (p_to is null or (r.recorded_at at time zone 'Asia/Kolkata')::date <= p_to)))
       and (p_basis <> 'check_in' or (b.check_in_at >= v_lo and b.check_in_at < v_hi))
       and (p_basis <> 'check_out' or (b.check_out_at >= v_lo and b.check_out_at < v_hi))
       and (p_basis <> 'cancellation' or (b.cancellation_date is not null
                                          and (p_from is null or b.cancellation_date >= p_from)
                                          and (p_to is null or b.cancellation_date <= p_to)))
  )
  select h.rt, h.rid, h.rcode, h.bid, h.bcode, h.rsid, h.gname, h.gmob, h.st, h.amt, h.rdate, h.edate, h.mdate, h.bd, h.files,
         count(*) over ()
    from hits h
   order by h.mdate desc, h.rdate desc, h.edate desc, h.rt, h.rid
   limit v_limit offset v_offset;
end
$$;
revoke all on function public.old_records_search(text, uuid, text[], text, date, date, int, int) from public, anon;
grant execute on function public.old_records_search(text, uuid, text[], text, date, date, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- activity_list: the audit log (append-only, migration 05) with filters
--   p_actor        who did it
--   p_action       'insert' (added), 'update' (changed) or 'account' (an account action such as a password reset)
--   p_record_type  booking, payment, refund, file, plan, guest, resort, setting, user, approval, pdf
--   p_booking      one booking's history
--   p_from, p_to   IST dates of the moment it happened
--   p_corrections  TRUE = only files added after approval (Q9a)
-- old_values / new_values hold only the fields that changed (all fields for a new record), and never the technical
-- keys storage_path, sha256 and idempotency_key. record_code is the Booking ID / payment number / refund number.
-- ---------------------------------------------------------------------------
create function public.activity_list(
  p_actor        uuid default null,
  p_action       text default null,
  p_record_type  text default null,
  p_resort       uuid default null,
  p_booking      uuid default null,
  p_from         date default null,
  p_to           date default null,
  p_corrections  boolean default null,
  p_limit        int default 25,
  p_offset       int default 0
)
returns table (
  id                bigint,
  occurred_at       timestamptz,
  actor_id          uuid,
  actor_name        text,
  action            text,
  record_type       text,
  table_name        text,
  record_id         text,
  record_code       text,
  booking_id        uuid,
  booking_code      text,
  resort_id         uuid,
  target_user_id    uuid,
  target_user_name  text,
  changed_fields    text[],
  old_values        jsonb,
  new_values        jsonb,
  reason            text,
  total_rows        bigint
)
language plpgsql stable
set search_path = ''
as $$
declare
  v_limit  int;
  v_offset int;
  v_lo     timestamptz;
  v_hi     timestamptz;
begin
  if not public.is_active_user() then
    raise exception 'NOT_ALLOWED' using detail = 'Only an active, logged-in user can see the activity.';
  end if;
  if p_action is not null and p_action not in ('insert', 'update', 'account') then
    raise exception 'INVALID_INPUT' using detail = 'Please choose what happened.';
  end if;
  if p_record_type is not null and p_record_type not in
     ('booking', 'payment', 'refund', 'file', 'plan', 'guest', 'resort', 'setting', 'user', 'approval', 'pdf') then
    raise exception 'INVALID_INPUT' using detail = 'Please choose a kind of record.';
  end if;
  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'INVALID_INPUT' using detail = 'The end date cannot be before the start date.';
  end if;
  v_limit  := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);
  v_lo := case when p_from is null then null else p_from::timestamp at time zone 'Asia/Kolkata' end;
  v_hi := case when p_to   is null then null else (p_to + 1)::timestamp at time zone 'Asia/Kolkata' end;

  return query
  with page as (
    select a.*, m.rt, count(*) over () as total
      from public.audit_logs a
     cross join lateral (select case a.table_name
              when 'bookings' then 'booking'
              when 'payments' then 'payment'
              when 'refunds' then 'refund'
              when 'proofs' then 'file'
              when 'payment_plan_revisions' then 'plan'
              when 'payment_schedules' then 'plan'
              when 'expected_adjustments' then 'plan'
              when 'guests' then 'guest'
              when 'resorts' then 'resort'
              when 'stay_types' then 'setting'
              when 'payment_providers' then 'setting'
              when 'co_categories' then 'setting'
              when 'co_entries' then 'setting'
              when 'agents_partners' then 'setting'
              when 'user_profiles' then 'user'
              when 'approval_history' then 'approval'
              when 'booking_pdf_versions' then 'pdf'
              else 'other' end) as m(rt)
     where (p_actor is null or a.actor_id = p_actor)
       and (p_action is null
            or (p_action in ('insert', 'update') and a.action = p_action)
            or (p_action = 'account' and a.action not in ('insert', 'update')))
       and (p_record_type is null or m.rt = p_record_type)
       and (p_resort is null or a.resort_id = p_resort)
       and (p_booking is null or a.booking_id = p_booking)
       and (v_lo is null or a.occurred_at >= v_lo)
       and (v_hi is null or a.occurred_at < v_hi)
       and (p_corrections is not true
            or (a.table_name = 'proofs' and a.action = 'insert' and coalesce((a.new_data ->> 'is_correction')::boolean, false)))
     order by a.id desc
     limit v_limit offset v_offset
  )
  select pg.id, pg.occurred_at, pg.actor_id, pg.actor_name, pg.action, pg.rt, pg.table_name, pg.record_id,
         case pg.table_name when 'bookings' then bk.booking_code
                            when 'payments' then pay.payment_code
                            when 'refunds' then ref.refund_code end,
         pg.booking_id, bk.booking_code, pg.resort_id, pg.target_user_id, tu.full_name, pg.changed_fields,
         case when pg.action = 'update' and pg.changed_fields is not null then
                (select jsonb_object_agg(k, pg.old_data -> k) from unnest(pg.changed_fields) as k
                  where k not in ('storage_path', 'sha256', 'idempotency_key'))
              else pg.old_data - 'storage_path' - 'sha256' - 'idempotency_key' end,
         case when pg.action = 'update' and pg.changed_fields is not null then
                (select jsonb_object_agg(k, pg.new_data -> k) from unnest(pg.changed_fields) as k
                  where k not in ('storage_path', 'sha256', 'idempotency_key'))
              else pg.new_data - 'storage_path' - 'sha256' - 'idempotency_key' end,
         pg.reason, pg.total
    from page pg
    left join public.bookings bk on bk.id = pg.booking_id
    left join public.payments pay on pg.table_name = 'payments' and pay.id::text = pg.record_id
    left join public.refunds ref on pg.table_name = 'refunds' and ref.id::text = pg.record_id
    left join public.user_profiles tu on tu.id = pg.target_user_id
   order by pg.id desc;
end
$$;
revoke all on function public.activity_list(uuid, text, text, uuid, uuid, date, date, boolean, int, int) from public, anon;
grant execute on function public.activity_list(uuid, text, text, uuid, uuid, date, date, boolean, int, int) to authenticated;
