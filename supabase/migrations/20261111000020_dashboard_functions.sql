-- =============================================================================
-- 20 DASHBOARD FUNCTIONS (M3: the dashboard's aggregate numbers)
--
-- Four read-only functions behind the dashboard (PRD FR-DSH-2..4, UI spec 3.2). They only READ.
--   dashboard_summary   the cards: resorts, bookings, today's check-ins/outs, Expected, Total Collection (Approved),
--                       Waiting for Approval, Refunds, Net Collection, Pending Amount
--   dashboard_by_resort the resort-wise table
--   dashboard_by_date   the date-wise chart (approved and waiting stacked, expected line)
--   dashboard_alerts    old waiting items, overdue plans, self-approved count, failed PDFs, backup age
--
-- Rules for these functions:
--   * SECURITY INVOKER: they run with the CALLER's rights, so the row-level security of every table still applies. A
--     signed-in, active user sees every resort (Q10: everybody has the same access); nobody else sees anything, and the
--     functions refuse anyone who is not an active user (NOT_ALLOWED) instead of quietly returning zeros.
--   * empty search_path; every name is schema-qualified; executable by signed-in users only (not anon, not PUBLIC)
--   * every money figure is whole paise (bigint) and is calculated from the same sources as the reports will use:
--       - Total Collection (Approved)  = approved payments, by PAYMENT date
--       - Waiting for Approval         = waiting payments, by payment date (separate figure, never added to the above)
--       - Refunds                      = approved refunds, by REFUND date; Net Collection = Total Collection - Refunds
--       - Expected Collection          = the expected_entries view (plan rows on their due date + dated adjustments)
--       - Pending Amount               = booking_financials.pending_paise (as of now, every booking of the filter)
--     rejected and reversed payments never count (COL-09).
--   * the date range is inclusive and in IST calendar dates; at most 3660 days; no range = today
--   * the resort filter is optional (NULL = all resorts)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A range and a resort, checked the same way by every dashboard function. Returns the usable dates.
-- ---------------------------------------------------------------------------
create function public.dashboard_range(p_from date, p_to date)
returns table (d_from date, d_to date)
language plpgsql stable
set search_path = ''
as $$
declare v_from date := coalesce(p_from, p_to, public.today_ist());
        v_to   date := coalesce(p_to, p_from, public.today_ist());
begin
  if not public.is_active_user() then
    raise exception 'NOT_ALLOWED' using detail = 'Only an active, logged-in user can see the dashboard.';
  end if;
  if v_to < v_from then
    raise exception 'INVALID_INPUT' using detail = 'The end date cannot be before the start date.';
  end if;
  if v_to - v_from > 3660 then
    raise exception 'INVALID_INPUT' using detail = 'Please choose a period of at most ten years.';
  end if;
  d_from := v_from;
  d_to := v_to;
  return next;
end
$$;
revoke all on function public.dashboard_range(date, date) from public, anon;
-- Read-only validator the four functions below call as the signed-in user (a function needs EXECUTE for its caller).
grant execute on function public.dashboard_range(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- dashboard_summary: the cards (one row)
-- ---------------------------------------------------------------------------
create function public.dashboard_summary(p_resort uuid default null, p_from date default null, p_to date default null)
returns table (
  total_resorts          int,      -- active resorts (all, or 1 / 0 for the chosen one)
  total_bookings         int,      -- bookings MADE in the period (booking date), every status
  checkins_today         int,      -- not cancelled / no-show, check-in on today's IST date (not the period)
  checkouts_today        int,      -- same for check-out
  expected_paise         bigint,   -- by due date / adjustment date, in the period
  total_collection_paise bigint,   -- approved payments by payment date, in the period
  waiting_paise          bigint,   -- waiting payments by payment date, in the period
  waiting_items          int,      -- every waiting payment and refund, whatever its date (the approval queue)
  refunds_paise          bigint,   -- approved refunds by refund date, in the period
  net_collection_paise   bigint,   -- total collection - refunds
  pending_paise          bigint,   -- not yet recorded against what is due, as of now (not the period)
  period_from            date,
  period_to              date
)
language plpgsql stable
set search_path = ''
as $$
declare r record; v_today date := public.today_ist();
begin
  select * into r from public.dashboard_range(p_from, p_to);
  period_from := r.d_from;
  period_to := r.d_to;
  select count(*)::int into total_resorts
    from public.resorts x where x.is_active and (p_resort is null or x.id = p_resort);
  select count(*)::int into total_bookings
    from public.bookings b
   where (p_resort is null or b.resort_id = p_resort) and b.booking_date between r.d_from and r.d_to;
  select count(*) filter (where (b.check_in_at at time zone 'Asia/Kolkata')::date = v_today)::int,
         count(*) filter (where (b.check_out_at at time zone 'Asia/Kolkata')::date = v_today)::int
    into checkins_today, checkouts_today
    from public.bookings b
   where (p_resort is null or b.resort_id = p_resort) and b.status not in ('cancelled', 'no_show');
  select coalesce(sum(e.amount_paise), 0)::bigint into expected_paise
    from public.expected_entries e
   where (p_resort is null or e.resort_id = p_resort) and e.entry_date between r.d_from and r.d_to;
  select coalesce(sum(p.amount_paise) filter (where p.status = 'approved'), 0)::bigint,
         coalesce(sum(p.amount_paise) filter (where p.status = 'waiting'), 0)::bigint
    into total_collection_paise, waiting_paise
    from public.payments p
   where (p_resort is null or p.resort_id = p_resort) and p.payment_date between r.d_from and r.d_to;
  select coalesce(sum(f.amount_paise), 0)::bigint into refunds_paise
    from public.refunds f
   where (p_resort is null or f.resort_id = p_resort) and f.status = 'approved' and f.refund_date between r.d_from and r.d_to;
  select (select count(*) from public.payments p where p.status = 'waiting' and (p_resort is null or p.resort_id = p_resort))::int
       + (select count(*) from public.refunds f where f.status = 'waiting' and (p_resort is null or f.resort_id = p_resort))::int
    into waiting_items;
  net_collection_paise := total_collection_paise - refunds_paise;
  select coalesce(sum(x.pending_paise), 0)::bigint into pending_paise
    from public.booking_financials x where (p_resort is null or x.resort_id = p_resort);
  return next;
end
$$;
revoke all on function public.dashboard_summary(uuid, date, date) from public, anon;
grant execute on function public.dashboard_summary(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- dashboard_by_resort: the resort-wise table (every resort, also those without any booking)
-- ---------------------------------------------------------------------------
create function public.dashboard_by_resort(p_resort uuid default null, p_from date default null, p_to date default null)
returns table (
  resort_id              uuid,
  resort_code            text,
  resort_name            text,
  is_active              boolean,
  bookings               int,
  expected_paise         bigint,
  total_collection_paise bigint,
  waiting_paise          bigint,
  refunds_paise          bigint,
  net_collection_paise   bigint,
  pending_paise          bigint
)
language plpgsql stable
set search_path = ''
as $$
declare r record;
begin
  select * into r from public.dashboard_range(p_from, p_to);
  return query
  select x.id, x.code, x.name, x.is_active,
         (select count(*)::int from public.bookings b
           where b.resort_id = x.id and b.booking_date between r.d_from and r.d_to),
         (select coalesce(sum(e.amount_paise), 0)::bigint from public.expected_entries e
           where e.resort_id = x.id and e.entry_date between r.d_from and r.d_to),
         (select coalesce(sum(p.amount_paise) filter (where p.status = 'approved'), 0)::bigint from public.payments p
           where p.resort_id = x.id and p.payment_date between r.d_from and r.d_to),
         (select coalesce(sum(p.amount_paise) filter (where p.status = 'waiting'), 0)::bigint from public.payments p
           where p.resort_id = x.id and p.payment_date between r.d_from and r.d_to),
         (select coalesce(sum(f.amount_paise), 0)::bigint from public.refunds f
           where f.resort_id = x.id and f.status = 'approved' and f.refund_date between r.d_from and r.d_to),
         (select coalesce(sum(p.amount_paise) filter (where p.status = 'approved'), 0)::bigint from public.payments p
           where p.resort_id = x.id and p.payment_date between r.d_from and r.d_to)
         - (select coalesce(sum(f.amount_paise), 0)::bigint from public.refunds f
             where f.resort_id = x.id and f.status = 'approved' and f.refund_date between r.d_from and r.d_to),
         (select coalesce(sum(bf.pending_paise), 0)::bigint from public.booking_financials bf where bf.resort_id = x.id)
    from public.resorts x
   where p_resort is null or x.id = p_resort
   order by x.is_active desc, x.name, x.id;
end
$$;
revoke all on function public.dashboard_by_resort(uuid, date, date) from public, anon;
grant execute on function public.dashboard_by_resort(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- dashboard_by_date: the chart. p_grain 'day' or 'month'. One row per day (or month) of the period, also empty ones.
-- ---------------------------------------------------------------------------
create function public.dashboard_by_date(
  p_resort uuid default null, p_from date default null, p_to date default null, p_grain text default 'day'
)
returns table (
  bucket_start           date,
  total_collection_paise bigint,
  waiting_paise          bigint,
  expected_paise         bigint
)
language plpgsql stable
set search_path = ''
as $$
declare r record;
begin
  select * into r from public.dashboard_range(p_from, p_to);
  if p_grain is null or p_grain not in ('day', 'month') then
    raise exception 'INVALID_INPUT' using detail = 'The chart can group by day or by month.';
  end if;
  return query
  with b as (
    select (case when p_grain = 'month' then date_trunc('month', g.d::timestamp) else g.d::timestamp end)::date as s
      from generate_series(r.d_from::timestamp, r.d_to::timestamp, interval '1 day') g(d)
     group by 1
  ),
  pay as (
    select (case when p_grain = 'month' then date_trunc('month', p.payment_date::timestamp) else p.payment_date::timestamp end)::date as s,
           sum(p.amount_paise) filter (where p.status = 'approved') as a,
           sum(p.amount_paise) filter (where p.status = 'waiting')  as w
      from public.payments p
     where (p_resort is null or p.resort_id = p_resort) and p.payment_date between r.d_from and r.d_to
     group by 1
  ),
  ex as (
    select (case when p_grain = 'month' then date_trunc('month', e.entry_date::timestamp) else e.entry_date::timestamp end)::date as s,
           sum(e.amount_paise) as x
      from public.expected_entries e
     where (p_resort is null or e.resort_id = p_resort) and e.entry_date between r.d_from and r.d_to
     group by 1
  )
  select b.s, coalesce(pay.a, 0)::bigint, coalesce(pay.w, 0)::bigint, coalesce(ex.x, 0)::bigint
    from b left join pay on pay.s = b.s left join ex on ex.s = b.s
   order by b.s;
end
$$;
revoke all on function public.dashboard_by_date(uuid, date, date, text) from public, anon;
grant execute on function public.dashboard_by_date(uuid, date, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- dashboard_alerts: one row
-- ---------------------------------------------------------------------------
create function public.dashboard_alerts(p_resort uuid default null, p_from date default null, p_to date default null)
returns table (
  waiting_old_items  int,          -- waiting payments and refunds entered more than 3 days ago
  overdue_bookings   int,          -- bookings whose plan is overdue today
  overdue_paise      bigint,
  self_approved      int,          -- approved by the person who recorded them, approved in the period
  failed_pdfs        int,
  backup_at          timestamptz,  -- last recorded backup (null = none recorded yet)
  backup_old         boolean       -- a backup is recorded and it is older than 36 hours
)
language plpgsql stable
set search_path = ''
as $$
declare r record; v_backup text;
begin
  select * into r from public.dashboard_range(p_from, p_to);
  select (select count(*) from public.payments p
           where p.status = 'waiting' and p.recorded_at < now() - interval '3 days' and (p_resort is null or p.resort_id = p_resort))::int
       + (select count(*) from public.refunds f
           where f.status = 'waiting' and f.recorded_at < now() - interval '3 days' and (p_resort is null or f.resort_id = p_resort))::int
    into waiting_old_items;
  select count(*)::int, coalesce(sum(o.overdue_paise), 0)::bigint into overdue_bookings, overdue_paise
    from public.booking_overdue(public.today_ist()) o
   where o.overdue_paise > 0 and (p_resort is null or o.resort_id = p_resort);
  select (select count(*) from public.payments p
           where p.status = 'approved' and p.is_self_approved and (p_resort is null or p.resort_id = p_resort)
             and (p.approved_at at time zone 'Asia/Kolkata')::date between r.d_from and r.d_to)::int
       + (select count(*) from public.refunds f
           where f.status = 'approved' and f.is_self_approved and (p_resort is null or f.resort_id = p_resort)
             and (f.approved_at at time zone 'Asia/Kolkata')::date between r.d_from and r.d_to)::int
    into self_approved;
  select count(*)::int into failed_pdfs
    from public.pdf_jobs j join public.bookings b on b.id = j.booking_id
   where j.status = 'failed' and (p_resort is null or b.resort_id = p_resort);
  select s.value ->> 'at' into v_backup from public.system_status s where s.key = 'last_backup';
  begin
    backup_at := v_backup::timestamptz;
  exception when others then
    backup_at := null;          -- an unreadable value is treated as "none recorded"
  end;
  backup_old := backup_at is not null and backup_at < now() - interval '36 hours';
  return next;
end
$$;
revoke all on function public.dashboard_alerts(uuid, date, date) from public, anon;
grant execute on function public.dashboard_alerts(uuid, date, date) to authenticated;
