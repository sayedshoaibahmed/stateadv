-- =============================================================================
-- 16 REFUND LIMITS (owner decision 2026-11-11, DATABASE_SCHEMA 5a item 5)
--
-- Replaces guard_refund() from migration 06 (that migration is already applied, so it is not edited).
-- Only the LIMIT changes; every other rule in the function is exactly as it was.
--
--   A = approved payments   D = amount due   RA = approved refunds   RW = waiting refunds
--   Cancelled / no-show booking :  a refund may be at most  max(A - RA - RW, 0)       (the approved money held)
--   Active booking              :  a refund may be at most  max(A - D - RA - RW, 0)   (genuine overpayment only)
--
-- Waiting refunds use up the room for further requests but change NO financial balance (D1).
-- The check runs inside the guard trigger, under the booking row lock that both add_refund and the
-- guard take, so simultaneous requests take turns and can never exceed either limit.
-- It applies to a new refund and to raising the amount of a waiting refund.
-- CREATE OR REPLACE keeps the trigger, owner and privileges; nothing is dropped, no data is touched.
-- =============================================================================

create or replace function public.guard_refund()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  actor   uuid := auth.uid();
  b       record;
  n       int;
  sum_a   bigint;
  sum_ra  bigint;
  sum_rw  bigint;
  v_due   bigint;
  v_status public.booking_status;
  v_max   bigint;
begin
  if tg_op = 'INSERT' then
    if actor is null or not public.is_active_user() then
      raise exception 'NOT_ALLOWED' using detail = 'Only an active, logged-in user can record a refund.';
    end if;
    select bk.booking_code, bk.resort_id, bk.amount_due_paise, bk.status into b from public.bookings bk where bk.id = new.booking_id for update;
    if not found then
      raise exception 'BOOKING_NOT_FOUND';
    end if;
    if new.status <> 'waiting' then
      raise exception 'REFUND_MUST_START_WAITING';
    end if;
    if new.refund_date > public.today_ist() then
      raise exception 'REFUND_DATE_IN_FUTURE' using detail = 'The refund date cannot be in the future.';
    end if;
    -- Limit: approved payments - approved refunds - waiting refunds (booking row is locked).
    select coalesce(sum(p.amount_paise), 0) into sum_a
      from public.payments p where p.booking_id = new.booking_id and p.status = 'approved';
    select coalesce(sum(r.amount_paise) filter (where r.status = 'approved'), 0),
           coalesce(sum(r.amount_paise) filter (where r.status = 'waiting'), 0)
      into sum_ra, sum_rw
      from public.refunds r where r.booking_id = new.booking_id;
    -- The two limits (owner decision 2026-11-11), with A approved payments, D amount due,
    -- RA approved refunds, RW waiting refunds (waiting refunds use up the room but change no balance, D1):
    --   cancelled / no-show :  max(A - RA - RW, 0)        the approved money held
    --   active booking      :  max(A - D - RA - RW, 0)    genuine overpayment only (Q12)
    if b.status in ('cancelled', 'no_show') then
      v_max := greatest(sum_a - sum_ra - sum_rw, 0);
    else
      v_max := greatest(sum_a - b.amount_due_paise - sum_ra - sum_rw, 0);
    end if;
    if new.amount_paise > v_max then
      raise exception 'REFUND_TOO_LARGE'
        using detail = format('The most that can be refunded now is %s paise.', v_max);
    end if;
    select count(*) into n from public.refunds r where r.booking_id = new.booking_id;
    new.refund_code := b.booking_code || '-R' || (n + 1);
    new.resort_id   := b.resort_id;
    new.recorded_by := actor;
    new.recorded_at := now();
    new.version     := 1;
    return new;
  end if;

  -- ---- UPDATE ---------------------------------------------------------------
  if new.id is distinct from old.id
     or new.refund_code is distinct from old.refund_code
     or new.booking_id  is distinct from old.booking_id
     or new.resort_id   is distinct from old.resort_id
     or new.recorded_by is distinct from old.recorded_by
     or new.recorded_at is distinct from old.recorded_at
     or new.idempotency_key is distinct from old.idempotency_key then
    raise exception 'IMMUTABLE_FIELD';
  end if;
  if actor is null or not public.is_active_user() then
    raise exception 'NOT_ALLOWED' using detail = 'Only an active, logged-in user can change a refund.';
  end if;

  if old.status = 'waiting' then
    if new.status = 'waiting' then
      if new.refund_date > public.today_ist() then
        raise exception 'REFUND_DATE_IN_FUTURE';
      end if;
      if new.amount_paise is distinct from old.amount_paise then
        select bk.amount_due_paise, bk.status into v_due, v_status from public.bookings bk where bk.id = old.booking_id for update;
        select coalesce(sum(p.amount_paise), 0) into sum_a
          from public.payments p where p.booking_id = old.booking_id and p.status = 'approved';
        select coalesce(sum(r.amount_paise) filter (where r.status = 'approved'), 0),
               coalesce(sum(r.amount_paise) filter (where r.status = 'waiting'), 0)
          into sum_ra, sum_rw
          from public.refunds r where r.booking_id = old.booking_id;
        if v_status in ('cancelled', 'no_show') then
          v_max := greatest(sum_a - sum_ra - (sum_rw - old.amount_paise), 0);
        else
          v_max := greatest(sum_a - v_due - sum_ra - (sum_rw - old.amount_paise), 0);
        end if;
        if new.amount_paise > v_max then
          raise exception 'REFUND_TOO_LARGE'
            using detail = format('The most that can be refunded now is %s paise.', v_max);
        end if;
      end if;
    elsif new.status in ('approved', 'rejected') then
      if (new.amount_paise, new.method, new.provider_id, new.provider_other, new.refund_date,
          new.refund_time, new.reference_number, new.reason, new.remarks)
         is distinct from
         (old.amount_paise, old.method, old.provider_id, old.provider_other, old.refund_date,
          old.refund_time, old.reference_number, old.reason, old.remarks) then
        raise exception 'REFUND_CHANGED_DURING_DECISION';
      end if;
      if new.status = 'approved' then
        new.approved_by := actor;
        new.approved_at := now();
      else
        new.rejected_by := actor;
        new.rejected_at := now();
      end if;
    else
      raise exception 'INVALID_STATUS_CHANGE' using detail = 'A waiting refund can only be approved or rejected.';
    end if;

  elsif old.status = 'approved' then
    if new.status <> 'reversed' then
      raise exception 'REFUND_LOCKED' using detail = 'An approved refund can only be reversed.';
    end if;
    if (new.amount_paise, new.method, new.provider_id, new.provider_other, new.refund_date,
        new.refund_time, new.reference_number, new.reason, new.remarks, new.approved_by, new.approved_at)
       is distinct from
       (old.amount_paise, old.method, old.provider_id, old.provider_other, old.refund_date,
        old.refund_time, old.reference_number, old.reason, old.remarks, old.approved_by, old.approved_at) then
      raise exception 'REFUND_CHANGED_DURING_DECISION';
    end if;
    new.reversed_by := actor;
    new.reversed_at := now();

  else
    raise exception 'REFUND_LOCKED' using detail = 'Rejected and reversed refunds cannot be changed.';
  end if;
  return new;
end
$$;
