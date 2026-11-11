-- =============================================================================
-- 07 VIEWS AND READ FUNCTIONS - the single source of every money figure
--
-- Screens, PDFs and reports read these; none of them recalculates money.
-- The same formulas live in src/lib/calc.ts and are cross-checked against these
-- views in tests/db (TEST_PLAN section 2.9).
--
-- security_invoker = true: the view runs with the CALLER's rights, so Row Level
-- Security still applies to whoever reads it.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- booking_financials: one row per booking (PRD 5.11)
--   A  approved payments        W  waiting payments
--   RA approved refunds         RW waiting refunds        D  amount due
--
-- Waiting refunds (RW) never change a balance (D1): they appear only in
-- refund_waiting_paise, refund_still_to_record_paise and refundable_limit_paise.
-- ---------------------------------------------------------------------------
create view public.booking_financials
with (security_invoker = true) as
select
  x.booking_id,
  x.resort_id,
  x.status,
  x.final_paise,
  x.due_paise,
  x.approved_paise,
  x.waiting_paise,
  x.rejected_paise,
  x.reversed_paise,
  x.refunds_approved_paise,
  x.refunds_waiting_paise,
  x.approved_paise + x.waiting_paise                                    as total_recorded_paise,
  x.approved_paise                                                      as total_collection_paise,   -- approved only (Q5)
  x.approved_paise - x.refunds_approved_paise                           as net_collection_paise,     -- Q7d
  greatest(x.due_paise - (x.approved_paise + x.waiting_paise - x.refunds_approved_paise), 0)  as pending_paise,
  greatest(x.due_paise - (x.approved_paise - x.refunds_approved_paise), 0)                    as verified_remaining_paise,
  greatest((x.approved_paise + x.waiting_paise - x.refunds_approved_paise) - x.due_paise, 0)  as extra_paise,
  greatest((x.approved_paise - x.refunds_approved_paise) - x.due_paise, 0)                    as refund_due_paise,
  x.refunds_waiting_paise                                               as refund_waiting_paise,
  greatest(greatest((x.approved_paise - x.refunds_approved_paise) - x.due_paise, 0) - x.refunds_waiting_paise, 0)
                                                                        as refund_still_to_record_paise,
  x.approved_paise - x.refunds_approved_paise - x.refunds_waiting_paise as refundable_limit_paise
from (
  select
    b.id                          as booking_id,
    b.resort_id,
    b.status,
    b.final_amount_paise          as final_paise,
    b.amount_due_paise            as due_paise,
    coalesce(p.approved, 0)::bigint as approved_paise,
    coalesce(p.waiting,  0)::bigint as waiting_paise,
    coalesce(p.rejected, 0)::bigint as rejected_paise,
    coalesce(p.reversed, 0)::bigint as reversed_paise,
    coalesce(r.approved, 0)::bigint as refunds_approved_paise,
    coalesce(r.waiting,  0)::bigint as refunds_waiting_paise
  from public.bookings b
  left join lateral (
    select sum(amount_paise) filter (where status = 'approved') as approved,
           sum(amount_paise) filter (where status = 'waiting')  as waiting,
           sum(amount_paise) filter (where status = 'rejected') as rejected,
           sum(amount_paise) filter (where status = 'reversed') as reversed
    from public.payments where booking_id = b.id
  ) p on true
  left join lateral (
    select sum(amount_paise) filter (where status = 'approved') as approved,
           sum(amount_paise) filter (where status = 'waiting')  as waiting
    from public.refunds where booking_id = b.id
  ) r on true
) x;

-- ---------------------------------------------------------------------------
-- expected_entries: everything that is "expected" - active plan rows (on their
-- due date) plus dated adjustments (on the day they were made). Superseded rows
-- never appear, so nothing is counted twice, and past months never change (D2).
-- Per booking the amounts add up to the amount due (checked at commit).
-- ---------------------------------------------------------------------------
create view public.expected_entries
with (security_invoker = true) as
select ps.booking_id, b.resort_id, ps.due_date as entry_date, ps.amount_paise, 'plan'::text as kind, ps.id as source_id
from public.payment_schedules ps
join public.bookings b on b.id = ps.booking_id
where ps.superseded_at is null
union all
select a.booking_id, a.resort_id, a.adjustment_date, a.amount_paise, 'adjustment'::text, a.id
from public.expected_adjustments a;

-- ---------------------------------------------------------------------------
-- correction_files: every file added AFTER approval (Q9a), for the owner to review.
-- Shown on the booking page, in the PDF and in the Activity filter. Changes no figure.
-- ---------------------------------------------------------------------------
create view public.correction_files
with (security_invoker = true) as
select f.id                                              as proof_id,
       case when f.payment_id is not null then 'payment' else 'refund' end as kind,
       coalesce(f.payment_id, f.refund_id)               as record_id,
       coalesce(p.payment_code, r.refund_code)           as record_code,
       coalesce(p.booking_id, r.booking_id)              as booking_id,
       coalesce(p.resort_id, r.resort_id)                as resort_id,
       f.storage_path,
       f.correction_reason,
       f.uploaded_by,
       u.full_name                                       as uploaded_by_name,
       f.uploaded_at
from public.proofs f
left join public.payments p on p.id = f.payment_id
left join public.refunds  r on r.id = f.refund_id
left join public.user_profiles u on u.id = f.uploaded_by
where f.is_correction;

-- ---------------------------------------------------------------------------
-- booking_overdue(as_of): money that should have arrived by that date but has not.
--   overdue = max( expected up to the date - net collected up to the date, 0 )
-- (net collected = approved payments - approved refunds, by their actual dates)
-- ---------------------------------------------------------------------------
create function public.booking_overdue(p_as_of date default null)
returns table (
  booking_id                  uuid,
  resort_id                   uuid,
  expected_to_date_paise      bigint,
  net_collected_to_date_paise bigint,
  overdue_paise               bigint
)
language sql stable
set search_path = ''
as $$
  with d as (select coalesce(p_as_of, public.today_ist()) as as_of),
  ex as (
    select e.booking_id, sum(e.amount_paise)::bigint as amt
    from public.expected_entries e, d where e.entry_date <= d.as_of group by e.booking_id
  ),
  pa as (
    select p.booking_id, sum(p.amount_paise)::bigint as amt
    from public.payments p, d where p.status = 'approved' and p.payment_date <= d.as_of group by p.booking_id
  ),
  re as (
    select r.booking_id, sum(r.amount_paise)::bigint as amt
    from public.refunds r, d where r.status = 'approved' and r.refund_date <= d.as_of group by r.booking_id
  )
  select b.id,
         b.resort_id,
         coalesce(ex.amt, 0),
         coalesce(pa.amt, 0) - coalesce(re.amt, 0),
         greatest(coalesce(ex.amt, 0) - (coalesce(pa.amt, 0) - coalesce(re.amt, 0)), 0)
  from public.bookings b
  left join ex on ex.booking_id = b.id
  left join pa on pa.booking_id = b.id
  left join re on re.booking_id = b.id
$$;
