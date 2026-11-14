-- =============================================================================
-- 25 REPORTS (M8: the Collection Reports screens and their CSV and PDF files)
--
-- Eleven read-only functions behind /reports and /api/export/[report] (PRD section 5.16 and 5.12, DATABASE_SCHEMA 3.4,
-- UI spec 3.13, TRD 5.8). They only READ. No table, view, policy, trigger or money rule is created or changed, and no
-- figure is calculated in a new way: every number is a plain sum or count of figures that already exist, taken from the
-- same sources as the dashboard (migration 20) and the booking page (booking_financials, rule D1).
--   report_check               validates the caller and the dates; the report functions call it
--   report_collection          Daily / Weekly / Monthly / Yearly Collection, optionally split by resort or by method
--   report_expected_vs_actual  Resort-wise Collection: Originally Expected, Expected Adjustments, Expected, Total Collection
--                              (Approved), Waiting, Refunds, Net Collection and the Difference, one row per resort
--   report_payment_methods     Payment Method Report: by method and app/bank
--   report_bookings            Booking Report (by booking date or check-in date)
--   report_pending             Pending Amount Report (Pending, Verified Remaining and Overdue as of a date)
--   report_waiting             Waiting for Approval Report, with the age in days
--   report_refunds             Refund Report
--   report_cancellations       Cancellation Report (cancelled and no-show bookings)
--   report_expected_adjustments  Expected Adjustments Report
--   report_manual_adjustments  Manual Adjustment Report (bookings whose amount or cancellation charge was changed by hand)
--
-- Rules (the same as migrations 20, 21, 22 and 24):
--   * SECURITY INVOKER: they run with the CALLER's rights, so the row-level security of every table still applies. A
--     signed-in, active user sees every resort (Q10); nobody else sees anything, and the functions refuse anyone who is
--     not an active user (NOT_ALLOWED) instead of quietly returning an empty report.
--   * empty search_path; every name schema-qualified; executable by signed-in users only (not anon, not PUBLIC)
--   * no dynamic SQL: every choice is a parameter
--   * all dates are IST calendar dates (Asia/Kolkata); money is whole paise (bigint)
--   * "Total Collection (Approved)" is approved payments by PAYMENT date; "Waiting" is waiting payments by payment date,
--     always shown apart and never added; "Refunds" is approved refunds by REFUND date; Net = Total Collection - Refunds;
--     rejected and reversed items are never counted (COL-09). The approval date never matters (COL-02, COL-08).
--   * the period reports (collection, resort-wise, methods) take at most 3,660 days (ten years); the list reports take any
--     range, or none, and are paged (at most 1,000 rows a page)
--   * the totals of a list report come with every row as window sums over ALL matching rows (not just the page), so the
--     summary row never depends on the page; an empty report has no rows
-- =============================================================================

-- ---------------------------------------------------------------------------
-- report_check: who is asking, and are the dates usable (a start without an end or the other way round is allowed for
-- the list reports; the period reports pass p_max_days and then need both dates)
-- ---------------------------------------------------------------------------
create function public.report_check(p_from date, p_to date, p_max_days int default null)
returns void
language plpgsql stable
set search_path = ''
as $$
begin
  if not public.is_active_user() then
    raise exception 'NOT_ALLOWED' using detail = 'Only an active, logged-in user can see reports.';
  end if;
  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'INVALID_INPUT' using detail = 'The end date cannot be before the start date.';
  end if;
  if p_max_days is not null then
    if p_from is null or p_to is null then
      raise exception 'INVALID_INPUT' using detail = 'Please choose a start date and an end date.';
    end if;
    if p_to - p_from > p_max_days then
      raise exception 'INVALID_INPUT' using detail = 'Please choose a period of at most ten years.';
    end if;
  end if;
end
$$;
revoke all on function public.report_check(date, date, int) from public, anon;
grant execute on function public.report_check(date, date, int) to authenticated;

-- ---------------------------------------------------------------------------
-- report_collection
--   p_group  'day', 'week' (Monday to Sunday), 'month' or 'year'
--   p_split  'none', 'resort' or 'method'
-- One row per period (and per resort or method) that has any payment or refund; periods with nothing are not listed.
-- period_start / period_end are the first and last day of the period, cut to the chosen dates.
-- ---------------------------------------------------------------------------
create function public.report_collection(
  p_from   date,
  p_to     date,
  p_resort uuid default null,
  p_group  text default 'day',
  p_split  text default 'none'
)
returns table (
  period_start         date,
  period_end           date,
  resort_id            uuid,
  resort_name          text,
  method               text,
  approved_paise       bigint,
  approved_count       int,
  waiting_paise        bigint,
  waiting_count        int,
  refunds_paise        bigint,
  refunds_count        int,
  net_paise            bigint,
  total_approved_paise bigint,
  total_waiting_paise  bigint,
  total_refunds_paise  bigint,
  total_net_paise      bigint,
  total_rows           bigint
)
language plpgsql stable
set search_path = ''
as $$
begin
  perform public.report_check(p_from, p_to, 3660);
  if p_group is null or p_group not in ('day', 'week', 'month', 'year') then
    raise exception 'INVALID_INPUT' using detail = 'Please choose day, week, month or year.';
  end if;
  if p_split is null or p_split not in ('none', 'resort', 'method') then
    raise exception 'INVALID_INPUT' using detail = 'Please choose how to split the figures.';
  end if;

  return query
  with money as (
    select case p_group when 'day' then p.payment_date
                        when 'week' then date_trunc('week', p.payment_date::timestamp)::date
                        when 'month' then date_trunc('month', p.payment_date::timestamp)::date
                        else date_trunc('year', p.payment_date::timestamp)::date end as b,
           case p_split when 'resort' then p.resort_id end as rs,
           case p_split when 'method' then p.method end as mt,
           coalesce(sum(p.amount_paise) filter (where p.status = 'approved'), 0)::bigint as ap,
           (count(*) filter (where p.status = 'approved'))::int as apc,
           coalesce(sum(p.amount_paise) filter (where p.status = 'waiting'), 0)::bigint as wa,
           (count(*) filter (where p.status = 'waiting'))::int as wac,
           0::bigint as rf,
           0::int as rfc
      from public.payments p
     where p.payment_date between p_from and p_to
       and p.status in ('approved', 'waiting')
       and (p_resort is null or p.resort_id = p_resort)
     group by 1, 2, 3
    union all
    select case p_group when 'day' then x.refund_date
                        when 'week' then date_trunc('week', x.refund_date::timestamp)::date
                        when 'month' then date_trunc('month', x.refund_date::timestamp)::date
                        else date_trunc('year', x.refund_date::timestamp)::date end,
           case p_split when 'resort' then x.resort_id end,
           case p_split when 'method' then x.method end,
           0, 0, 0, 0,
           coalesce(sum(x.amount_paise), 0)::bigint,
           (count(*))::int
      from public.refunds x
     where x.refund_date between p_from and p_to
       and x.status = 'approved'
       and (p_resort is null or x.resort_id = p_resort)
     group by 1, 2, 3
  ),
  agg as (
    select m.b, m.rs, m.mt,
           sum(m.ap)::bigint as ap, sum(m.apc)::int as apc, sum(m.wa)::bigint as wa, sum(m.wac)::int as wac,
           sum(m.rf)::bigint as rf, sum(m.rfc)::int as rfc
      from money m
     group by m.b, m.rs, m.mt
  )
  select greatest(a.b, p_from),
         least(case p_group when 'day' then a.b
                            when 'week' then a.b + 6
                            when 'month' then (a.b + interval '1 month' - interval '1 day')::date
                            else (a.b + interval '1 year' - interval '1 day')::date end, p_to),
         a.rs, r.name, a.mt::text,
         a.ap, a.apc, a.wa, a.wac, a.rf, a.rfc, a.ap - a.rf,
         (sum(a.ap) over ())::bigint, (sum(a.wa) over ())::bigint, (sum(a.rf) over ())::bigint, (sum(a.ap) over () - sum(a.rf) over ())::bigint,
         count(*) over ()
    from agg a
    left join public.resorts r on r.id = a.rs
   order by a.b, r.name nulls first, a.mt nulls first;
end
$$;
revoke all on function public.report_collection(date, date, uuid, text, text) from public, anon;
grant execute on function public.report_collection(date, date, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- report_expected_vs_actual: Resort-wise Collection. One row for every resort (also those with nothing), in name order.
--   Originally Expected = plan rows due in the period; Expected Adjustments = adjustments dated in the period (PRD 5.12)
--   Expected = the two added; Difference = Expected - Total Collection (Approved); Net Collection is shown next to it
-- ---------------------------------------------------------------------------
create function public.report_expected_vs_actual(p_from date, p_to date, p_resort uuid default null)
returns table (
  resort_id                  uuid,
  resort_name                text,
  is_active                  boolean,
  originally_expected_paise  bigint,
  expected_adjustments_paise bigint,
  expected_paise             bigint,
  approved_paise             bigint,
  waiting_paise              bigint,
  refunds_paise              bigint,
  net_paise                  bigint,
  difference_paise           bigint,
  total_originally_expected_paise  bigint,
  total_expected_adjustments_paise bigint,
  total_expected_paise       bigint,
  total_approved_paise       bigint,
  total_waiting_paise        bigint,
  total_refunds_paise        bigint,
  total_net_paise            bigint,
  total_difference_paise     bigint,
  total_rows                 bigint
)
language plpgsql stable
set search_path = ''
as $$
begin
  perform public.report_check(p_from, p_to, 3660);
  return query
  with ex as (
    select e.resort_id as rs,
           coalesce(sum(e.amount_paise) filter (where e.kind = 'plan'), 0)::bigint as op,
           coalesce(sum(e.amount_paise) filter (where e.kind = 'adjustment'), 0)::bigint as adj
      from public.expected_entries e
     where e.entry_date between p_from and p_to
     group by e.resort_id
  ),
  pay as (
    select p.resort_id as rs,
           coalesce(sum(p.amount_paise) filter (where p.status = 'approved'), 0)::bigint as ap,
           coalesce(sum(p.amount_paise) filter (where p.status = 'waiting'), 0)::bigint as wa
      from public.payments p
     where p.payment_date between p_from and p_to
     group by p.resort_id
  ),
  refs as (
    select x.resort_id as rs, coalesce(sum(x.amount_paise), 0)::bigint as rf
      from public.refunds x
     where x.status = 'approved' and x.refund_date between p_from and p_to
     group by x.resort_id
  ),
  rows_ as (
    select r.id as rid, r.name as rname, r.is_active as ract,
           coalesce(ex.op, 0) as op, coalesce(ex.adj, 0) as adj, coalesce(ex.op, 0) + coalesce(ex.adj, 0) as exp_,
           coalesce(pay.ap, 0) as ap, coalesce(pay.wa, 0) as wa, coalesce(refs.rf, 0) as rf
      from public.resorts r
      left join ex on ex.rs = r.id
      left join pay on pay.rs = r.id
      left join refs on refs.rs = r.id
     where (p_resort is null or r.id = p_resort)
  )
  select q.rid, q.rname, q.ract, q.op, q.adj, q.exp_, q.ap, q.wa, q.rf, q.ap - q.rf, q.exp_ - q.ap,
         (sum(q.op) over ())::bigint, (sum(q.adj) over ())::bigint, (sum(q.exp_) over ())::bigint,
         (sum(q.ap) over ())::bigint, (sum(q.wa) over ())::bigint, (sum(q.rf) over ())::bigint,
         (sum(q.ap) over () - sum(q.rf) over ())::bigint, (sum(q.exp_) over () - sum(q.ap) over ())::bigint,
         count(*) over ()
    from rows_ q
   order by q.rname, q.rid;
end
$$;
revoke all on function public.report_expected_vs_actual(date, date, uuid) from public, anon;
grant execute on function public.report_expected_vs_actual(date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- report_payment_methods: by method and app/bank (a payment with no app, such as cash, has an empty provider_name)
-- ---------------------------------------------------------------------------
create function public.report_payment_methods(p_from date, p_to date, p_resort uuid default null)
returns table (
  method               text,
  provider_name        text,
  approved_paise       bigint,
  approved_count       int,
  waiting_paise        bigint,
  waiting_count        int,
  refunds_paise        bigint,
  refunds_count        int,
  net_paise            bigint,
  total_approved_paise bigint,
  total_waiting_paise  bigint,
  total_refunds_paise  bigint,
  total_net_paise      bigint,
  total_rows           bigint
)
language plpgsql stable
set search_path = ''
as $$
begin
  perform public.report_check(p_from, p_to, 3660);
  return query
  with money as (
    select p.method as mt, pp.name as pn,
           coalesce(sum(p.amount_paise) filter (where p.status = 'approved'), 0)::bigint as ap,
           (count(*) filter (where p.status = 'approved'))::int as apc,
           coalesce(sum(p.amount_paise) filter (where p.status = 'waiting'), 0)::bigint as wa,
           (count(*) filter (where p.status = 'waiting'))::int as wac,
           0::bigint as rf, 0::int as rfc
      from public.payments p
      left join public.payment_providers pp on pp.id = p.provider_id
     where p.payment_date between p_from and p_to and p.status in ('approved', 'waiting')
       and (p_resort is null or p.resort_id = p_resort)
     group by p.method, pp.name
    union all
    select x.method, pp.name, 0, 0, 0, 0,
           coalesce(sum(x.amount_paise), 0)::bigint, (count(*))::int
      from public.refunds x
      left join public.payment_providers pp on pp.id = x.provider_id
     where x.refund_date between p_from and p_to and x.status = 'approved'
       and (p_resort is null or x.resort_id = p_resort)
     group by x.method, pp.name
  ),
  agg as (
    select m.mt, m.pn, sum(m.ap)::bigint as ap, sum(m.apc)::int as apc, sum(m.wa)::bigint as wa, sum(m.wac)::int as wac,
           sum(m.rf)::bigint as rf, sum(m.rfc)::int as rfc
      from money m
     group by m.mt, m.pn
  )
  select a.mt::text, a.pn, a.ap, a.apc, a.wa, a.wac, a.rf, a.rfc, a.ap - a.rf,
         (sum(a.ap) over ())::bigint, (sum(a.wa) over ())::bigint, (sum(a.rf) over ())::bigint,
         (sum(a.ap) over () - sum(a.rf) over ())::bigint, count(*) over ()
    from agg a
   order by a.mt, a.pn nulls first;
end
$$;
revoke all on function public.report_payment_methods(date, date, uuid) from public, anon;
grant execute on function public.report_payment_methods(date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- report_bookings: Booking Report.
--   p_date_field  'booking' (the booking date) or 'check_in' (the IST check-in day)
--   Final Amount = the booking's final amount; Amount Due = booking_financials.due_paise (the cancellation charge once cancelled)
-- ---------------------------------------------------------------------------
create function public.report_bookings(
  p_date_field text default 'booking',
  p_from       date default null,
  p_to         date default null,
  p_resort     uuid default null,
  p_status     public.booking_status default null,
  p_limit      int default 100,
  p_offset     int default 0
)
returns table (
  booking_id        uuid,
  booking_code      text,
  resort_id         uuid,
  guest_name        text,
  booking_date      date,
  check_in_at       timestamptz,
  check_out_at      timestamptz,
  pax               int,
  pricing_method    text,
  co_category_name  text,
  co_name           text,
  status            public.booking_status,
  final_paise       bigint,
  due_paise         bigint,
  total_pax         bigint,
  total_final_paise bigint,
  total_due_paise   bigint,
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
  perform public.report_check(p_from, p_to);
  if p_date_field is null or p_date_field not in ('booking', 'check_in') then
    raise exception 'INVALID_INPUT' using detail = 'Please choose the booking date or the check-in date.';
  end if;
  v_limit  := least(greatest(coalesce(p_limit, 100), 1), 1000);
  v_offset := greatest(coalesce(p_offset, 0), 0);
  v_lo := case when p_from is null then '-infinity'::timestamptz else p_from::timestamp at time zone 'Asia/Kolkata' end;
  v_hi := case when p_to   is null then 'infinity'::timestamptz  else (p_to + 1)::timestamp at time zone 'Asia/Kolkata' end;

  return query
  select b.id, b.booking_code, b.resort_id, b.guest_name, b.booking_date, b.check_in_at, b.check_out_at, b.pax,
         b.pricing_method::text, b.co_category_name, b.co_name, b.status,
         b.final_amount_paise::bigint, coalesce(f.due_paise, 0)::bigint,
         (sum(b.pax) over ())::bigint, (sum(b.final_amount_paise) over ())::bigint, (sum(coalesce(f.due_paise, 0)) over ())::bigint,
         count(*) over ()
    from public.bookings b
    left join public.booking_financials f on f.booking_id = b.id
   where (p_resort is null or b.resort_id = p_resort)
     and (p_status is null or b.status = p_status)
     and (p_date_field <> 'booking' or ((p_from is null or b.booking_date >= p_from) and (p_to is null or b.booking_date <= p_to)))
     and (p_date_field <> 'check_in' or (b.check_in_at >= v_lo and b.check_in_at < v_hi))
   order by case p_date_field when 'booking' then b.booking_date else (b.check_in_at at time zone 'Asia/Kolkata')::date end desc,
            b.booking_code
   limit v_limit offset v_offset;
end
$$;
revoke all on function public.report_bookings(text, date, date, uuid, public.booking_status, int, int) from public, anon;
grant execute on function public.report_bookings(text, date, date, uuid, public.booking_status, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- report_pending: Pending Amount Report.
--   Lists bookings with Pending > 0 or Verified Remaining > 0 (both exactly as booking_financials gives them, which is
--   the position NOW: rule D1 has no past-dated version). Overdue is as of p_as_of (booking_overdue, migration 07).
-- ---------------------------------------------------------------------------
create function public.report_pending(
  p_as_of  date default null,
  p_resort uuid default null,
  p_limit  int default 100,
  p_offset int default 0
)
returns table (
  booking_id               uuid,
  booking_code             text,
  resort_id                uuid,
  guest_name               text,
  guest_mobile             text,
  check_in_at              timestamptz,
  status                   public.booking_status,
  due_paise                bigint,
  approved_paise           bigint,
  waiting_paise            bigint,
  pending_paise            bigint,
  verified_remaining_paise bigint,
  overdue_paise            bigint,
  as_of                    date,
  total_pending_paise      bigint,
  total_verified_remaining_paise bigint,
  total_overdue_paise      bigint,
  total_rows               bigint
)
language plpgsql stable
set search_path = ''
as $$
declare
  v_limit  int;
  v_offset int;
  v_as_of  date := coalesce(p_as_of, public.today_ist());
begin
  perform public.report_check(null, null);
  v_limit  := least(greatest(coalesce(p_limit, 100), 1), 1000);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  return query
  select b.id, b.booking_code, b.resort_id, b.guest_name, b.guest_mobile, b.check_in_at, b.status,
         f.due_paise::bigint, f.total_collection_paise::bigint, f.waiting_paise::bigint, f.pending_paise::bigint,
         f.verified_remaining_paise::bigint, o.overdue_paise::bigint, v_as_of,
         (sum(f.pending_paise) over ())::bigint, (sum(f.verified_remaining_paise) over ())::bigint,
         (sum(o.overdue_paise) over ())::bigint, count(*) over ()
    from public.bookings b
    join public.booking_financials f on f.booking_id = b.id
    join public.booking_overdue(v_as_of) o on o.booking_id = b.id
   where (p_resort is null or b.resort_id = p_resort)
     and (f.pending_paise > 0 or f.verified_remaining_paise > 0)
   order by o.overdue_paise desc, f.pending_paise desc, b.booking_code
   limit v_limit offset v_offset;
end
$$;
revoke all on function public.report_pending(date, uuid, int, int) from public, anon;
grant execute on function public.report_pending(date, uuid, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- report_waiting: Waiting for Approval Report: waiting payments and refunds, oldest first, with the age in days
--   p_date_type  'entry' (the IST day it was typed in) or 'record' (the payment or refund date)
--   p_kind       NULL = both, or 'payment' / 'refund'
--   age_days     today (IST) minus the day it was typed in
-- ---------------------------------------------------------------------------
create function public.report_waiting(
  p_date_type text default 'entry',
  p_from      date default null,
  p_to        date default null,
  p_resort    uuid default null,
  p_kind      text default null,
  p_limit     int default 100,
  p_offset    int default 0
)
returns table (
  kind            text,
  record_id       uuid,
  record_code     text,
  booking_id      uuid,
  booking_code    text,
  resort_id       uuid,
  guest_name      text,
  amount_paise    bigint,
  method          text,
  provider_name   text,
  record_date     date,
  entered_on      date,
  recorded_by_name text,
  age_days        int,
  total_payments_paise bigint,
  total_refunds_paise  bigint,
  total_payments_count int,
  total_refunds_count  int,
  total_rows      bigint
)
language plpgsql stable
set search_path = ''
as $$
declare
  v_limit  int;
  v_offset int;
  v_today  date := public.today_ist();
begin
  perform public.report_check(p_from, p_to);
  if p_date_type is null or p_date_type not in ('entry', 'record') then
    raise exception 'INVALID_INPUT' using detail = 'Please choose the date it was typed in or the payment or refund date.';
  end if;
  if p_kind is not null and p_kind not in ('payment', 'refund') then
    raise exception 'INVALID_INPUT' using detail = 'Please choose payments or refunds.';
  end if;
  v_limit  := least(greatest(coalesce(p_limit, 100), 1), 1000);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  return query
  with w as (
    select 'payment'::text as k, p.id as rid, p.payment_code as rcode, p.booking_id as bid, p.resort_id as rsid,
           p.amount_paise::bigint as amt, p.method::text as mt, pp.name as pn, p.payment_date as rdate,
           (p.recorded_at at time zone 'Asia/Kolkata')::date as edate, p.recorded_at as rat, p.recorded_by as rby
      from public.payments p
      left join public.payment_providers pp on pp.id = p.provider_id
     where p.status = 'waiting' and (p_kind is null or p_kind = 'payment') and (p_resort is null or p.resort_id = p_resort)
    union all
    select 'refund', x.id, x.refund_code, x.booking_id, x.resort_id, x.amount_paise::bigint, x.method::text, pp.name,
           x.refund_date, (x.recorded_at at time zone 'Asia/Kolkata')::date, x.recorded_at, x.recorded_by
      from public.refunds x
      left join public.payment_providers pp on pp.id = x.provider_id
     where x.status = 'waiting' and (p_kind is null or p_kind = 'refund') and (p_resort is null or x.resort_id = p_resort)
  ),
  f as (
    select * from w
     where (p_from is null or (case p_date_type when 'entry' then w.edate else w.rdate end) >= p_from)
       and (p_to is null or (case p_date_type when 'entry' then w.edate else w.rdate end) <= p_to)
  )
  select f.k, f.rid, f.rcode, f.bid, b.booking_code, f.rsid, b.guest_name, f.amt, f.mt, f.pn, f.rdate, f.edate, u.full_name,
         (v_today - f.edate)::int,
         (sum(f.amt) filter (where f.k = 'payment') over ())::bigint,
         (sum(f.amt) filter (where f.k = 'refund') over ())::bigint,
         (count(*) filter (where f.k = 'payment') over ())::int,
         (count(*) filter (where f.k = 'refund') over ())::int,
         count(*) over ()
    from f
    join public.bookings b on b.id = f.bid
    left join public.user_profiles u on u.id = f.rby
   order by f.rat, f.rid
   limit v_limit offset v_offset;
end
$$;
revoke all on function public.report_waiting(text, date, date, uuid, text, int, int) from public, anon;
grant execute on function public.report_waiting(text, date, date, uuid, text, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- report_refunds: Refund Report, by the refund date, with the status, method, app/bank and reason
-- ---------------------------------------------------------------------------
create function public.report_refunds(
  p_from   date default null,
  p_to     date default null,
  p_resort uuid default null,
  p_status public.approval_status default null,
  p_method public.payment_method default null,
  p_limit  int default 100,
  p_offset int default 0
)
returns table (
  refund_id        uuid,
  refund_code      text,
  booking_id       uuid,
  booking_code     text,
  resort_id        uuid,
  guest_name       text,
  amount_paise     bigint,
  method           text,
  provider_name    text,
  status           public.approval_status,
  reason           text,
  refund_date      date,
  entered_on       date,
  recorded_by_name text,
  total_approved_paise bigint,
  total_waiting_paise  bigint,
  total_rejected_paise bigint,
  total_reversed_paise bigint,
  total_rows       bigint
)
language plpgsql stable
set search_path = ''
as $$
declare
  v_limit  int;
  v_offset int;
begin
  perform public.report_check(p_from, p_to);
  v_limit  := least(greatest(coalesce(p_limit, 100), 1), 1000);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  return query
  select x.id, x.refund_code, x.booking_id, b.booking_code, x.resort_id, b.guest_name, x.amount_paise::bigint, x.method::text,
         pp.name, x.status, x.reason, x.refund_date, (x.recorded_at at time zone 'Asia/Kolkata')::date, u.full_name,
         (coalesce(sum(x.amount_paise) filter (where x.status = 'approved') over (), 0))::bigint,
         (coalesce(sum(x.amount_paise) filter (where x.status = 'waiting') over (), 0))::bigint,
         (coalesce(sum(x.amount_paise) filter (where x.status = 'rejected') over (), 0))::bigint,
         (coalesce(sum(x.amount_paise) filter (where x.status = 'reversed') over (), 0))::bigint,
         count(*) over ()
    from public.refunds x
    join public.bookings b on b.id = x.booking_id
    left join public.payment_providers pp on pp.id = x.provider_id
    left join public.user_profiles u on u.id = x.recorded_by
   where (p_resort is null or x.resort_id = p_resort)
     and (p_status is null or x.status = p_status)
     and (p_method is null or x.method = p_method)
     and (p_from is null or x.refund_date >= p_from)
     and (p_to is null or x.refund_date <= p_to)
   order by x.refund_date desc, x.recorded_at desc, x.id
   limit v_limit offset v_offset;
end
$$;
revoke all on function public.report_refunds(date, date, uuid, public.approval_status, public.payment_method, int, int) from public, anon;
grant execute on function public.report_refunds(date, date, uuid, public.approval_status, public.payment_method, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- report_cancellations: Cancellation Report: cancelled and no-show bookings by the cancellation date.
--   original_paise = the booking's final amount (never overwritten); charge_paise = the cancellation charge;
--   refund_due_paise = booking_financials.refund_due_paise (rule D1)
-- ---------------------------------------------------------------------------
create function public.report_cancellations(
  p_from   date default null,
  p_to     date default null,
  p_resort uuid default null,
  p_status public.booking_status default null,
  p_limit  int default 100,
  p_offset int default 0
)
returns table (
  booking_id          uuid,
  booking_code        text,
  resort_id           uuid,
  guest_name          text,
  status              public.booking_status,
  cancellation_date   date,
  check_in_at         timestamptz,
  original_paise      bigint,
  charge_paise        bigint,
  approved_paise      bigint,
  refund_due_paise    bigint,
  reason              text,
  charge_change_reason text,
  total_original_paise bigint,
  total_charge_paise  bigint,
  total_refund_due_paise bigint,
  total_rows          bigint
)
language plpgsql stable
set search_path = ''
as $$
declare
  v_limit  int;
  v_offset int;
begin
  perform public.report_check(p_from, p_to);
  if p_status is not null and p_status not in ('cancelled', 'no_show') then
    raise exception 'INVALID_INPUT' using detail = 'Please choose cancelled or no-show.';
  end if;
  v_limit  := least(greatest(coalesce(p_limit, 100), 1), 1000);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  return query
  select b.id, b.booking_code, b.resort_id, b.guest_name, b.status, b.cancellation_date, b.check_in_at,
         b.final_amount_paise::bigint, coalesce(b.cancellation_charge_paise, 0)::bigint,
         coalesce(f.total_collection_paise, 0)::bigint, coalesce(f.refund_due_paise, 0)::bigint,
         b.cancellation_reason, b.charge_change_reason,
         (sum(b.final_amount_paise) over ())::bigint, (sum(coalesce(b.cancellation_charge_paise, 0)) over ())::bigint,
         (sum(coalesce(f.refund_due_paise, 0)) over ())::bigint, count(*) over ()
    from public.bookings b
    left join public.booking_financials f on f.booking_id = b.id
   where b.status in ('cancelled', 'no_show')
     and (p_resort is null or b.resort_id = p_resort)
     and (p_status is null or b.status = p_status)
     and (p_from is null or b.cancellation_date >= p_from)
     and (p_to is null or b.cancellation_date <= p_to)
   order by b.cancellation_date desc, b.booking_code
   limit v_limit offset v_offset;
end
$$;
revoke all on function public.report_cancellations(date, date, uuid, public.booking_status, int, int) from public, anon;
grant execute on function public.report_cancellations(date, date, uuid, public.booking_status, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- report_expected_adjustments: Expected Adjustments Report: every adjustment, by its own date (decided D2)
-- ---------------------------------------------------------------------------
create function public.report_expected_adjustments(
  p_from   date default null,
  p_to     date default null,
  p_resort uuid default null,
  p_source public.adjustment_source default null,
  p_limit  int default 100,
  p_offset int default 0
)
returns table (
  adjustment_id   uuid,
  adjustment_date date,
  booking_id      uuid,
  booking_code    text,
  resort_id       uuid,
  guest_name      text,
  amount_paise    bigint,
  source          public.adjustment_source,
  reason          text,
  created_by_name text,
  total_paise     bigint,
  total_rows      bigint
)
language plpgsql stable
set search_path = ''
as $$
declare
  v_limit  int;
  v_offset int;
begin
  perform public.report_check(p_from, p_to);
  v_limit  := least(greatest(coalesce(p_limit, 100), 1), 1000);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  return query
  select a.id, a.adjustment_date, a.booking_id, b.booking_code, a.resort_id, b.guest_name, a.amount_paise::bigint, a.source,
         a.reason, u.full_name, (sum(a.amount_paise) over ())::bigint, count(*) over ()
    from public.expected_adjustments a
    join public.bookings b on b.id = a.booking_id
    left join public.user_profiles u on u.id = a.created_by
   where (p_resort is null or a.resort_id = p_resort)
     and (p_source is null or a.source = p_source)
     and (p_from is null or a.adjustment_date >= p_from)
     and (p_to is null or a.adjustment_date <= p_to)
   order by a.adjustment_date desc, a.created_at desc, a.id
   limit v_limit offset v_offset;
end
$$;
revoke all on function public.report_expected_adjustments(date, date, uuid, public.adjustment_source, int, int) from public, anon;
grant execute on function public.report_expected_adjustments(date, date, uuid, public.adjustment_source, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- report_manual_adjustments: Manual Adjustment Report: bookings whose final amount was changed by hand (manual
-- adjustment, with its reason) or whose cancellation charge was changed (with its reason), by the booking date.
-- The stored figures are shown as they are; nothing is derived.
-- ---------------------------------------------------------------------------
create function public.report_manual_adjustments(
  p_from   date default null,
  p_to     date default null,
  p_resort uuid default null,
  p_limit  int default 100,
  p_offset int default 0
)
returns table (
  booking_id          uuid,
  booking_code        text,
  resort_id           uuid,
  guest_name          text,
  booking_date        date,
  status              public.booking_status,
  total_paise         bigint,
  discount_paise      bigint,
  adjustment_paise    bigint,
  adjustment_reason   text,
  final_paise         bigint,
  charge_paise        bigint,
  charge_change_reason text,
  total_adjustment_paise bigint,
  total_rows          bigint
)
language plpgsql stable
set search_path = ''
as $$
declare
  v_limit  int;
  v_offset int;
begin
  perform public.report_check(p_from, p_to);
  v_limit  := least(greatest(coalesce(p_limit, 100), 1), 1000);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  return query
  select b.id, b.booking_code, b.resort_id, b.guest_name, b.booking_date, b.status, b.total_amount_paise::bigint,
         b.discount_paise::bigint, b.manual_adjustment_paise::bigint, b.manual_adjustment_reason, b.final_amount_paise::bigint,
         b.cancellation_charge_paise::bigint, b.charge_change_reason,
         (sum(b.manual_adjustment_paise) over ())::bigint, count(*) over ()
    from public.bookings b
   where (b.manual_adjustment_paise <> 0 or b.charge_change_reason is not null)
     and (p_resort is null or b.resort_id = p_resort)
     and (p_from is null or b.booking_date >= p_from)
     and (p_to is null or b.booking_date <= p_to)
   order by b.booking_date desc, b.booking_code
   limit v_limit offset v_offset;
end
$$;
revoke all on function public.report_manual_adjustments(date, date, uuid, int, int) from public, anon;
grant execute on function public.report_manual_adjustments(date, date, uuid, int, int) to authenticated;
