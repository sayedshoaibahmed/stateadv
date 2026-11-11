-- =============================================================================
-- 06 GUARDS AND TRIGGERS
-- The rules that make the data safe even if application code has a bug:
--   * who may do what (accounts, Owner protection)        - guard_user_profiles
--   * what can never change (IDs, decisions, past plan)   - guard_* functions
--   * identity/time columns come from the verified session - stamp_* / guards
--   * history cannot be skipped                           - record_approval_history, audit
--   * the books must balance at COMMIT                    - check_plan_invariant, check_proof_rule
--
-- Trigger order matters: BEFORE triggers run in NAME order, so
--   trg_00 (delete/append-only) -> trg_10 (guard) -> trg_20 (stamp) -> trg_30 (version)
-- Guards therefore see exactly what the caller sent.
--
-- Every guard is SECURITY DEFINER with an empty search_path (all names are
-- schema-qualified), so it behaves the same no matter who triggers it.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- user_profiles: account rules, Owner protection (PRD FR-AUTH-4, 9-15; O1, O2, O5)
-- ---------------------------------------------------------------------------
create function public.guard_user_profiles()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  actor          uuid := auth.uid();
  actor_role     public.user_role;
  actor_active   boolean := false;
  recovery       boolean;
  n_profiles     int;
  n_other_owners int;
  disabling      boolean;
  enabling       boolean;
  owner_target   boolean;
begin
  -- One account change at a time, so the "at least one active Owner" count below
  -- cannot be fooled by two simultaneous changes (two Owners disabling each other).
  perform pg_advisory_xact_lock(hashtextextended('stateadv.user_profiles', 0));

  -- The recovery function (service role only, M2-B) is the only thing that sets this.
  recovery := actor is null and coalesce(current_setting('app.owner_recovery', true), '') = 'on';

  if actor is not null then
    select p.role, p.is_active into actor_role, actor_active
    from public.user_profiles p where p.id = actor;
    actor_active := coalesce(actor_active, false);
  end if;

  if tg_op = 'INSERT' then
    select count(*) into n_profiles from public.user_profiles;
    if n_profiles = 0 then
      -- The very first account (O5): must be the real Owner, created by the one-time script.
      if new.role <> 'owner' then
        raise exception 'FIRST_USER_MUST_BE_OWNER' using detail = 'The first account must be an Owner.';
      end if;
      if not new.is_active then
        raise exception 'NEW_USER_MUST_BE_ACTIVE';
      end if;
      return new;
    end if;
    if not actor_active then
      raise exception 'NOT_ALLOWED' using detail = 'Only an active, logged-in user can add users.';
    end if;
    -- O2: only an Owner can create an Owner.
    if new.role = 'owner' and actor_role <> 'owner' then
      raise exception 'OWNER_ACTION_REQUIRES_OWNER' using detail = 'Only an Owner can add another Owner.';
    end if;
    if not new.is_active then
      raise exception 'NEW_USER_MUST_BE_ACTIVE';
    end if;
    return new;
  end if;

  -- ---- UPDATE ---------------------------------------------------------------
  if not actor_active and not recovery then
    raise exception 'NOT_ALLOWED' using detail = 'Only an active, logged-in user can change accounts.';
  end if;
  if new.id is distinct from old.id
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'IMMUTABLE_FIELD';
  end if;

  disabling    := old.is_active and not new.is_active;
  enabling     := (not old.is_active) and new.is_active;
  owner_target := old.role = 'owner';

  -- Nobody can disable their own account (Q10).
  if disabling and actor = old.id then
    raise exception 'CANNOT_DISABLE_SELF' using detail = 'You cannot disable your own account.';
  end if;

  -- O2: only an Owner can give the Owner role.
  if new.role = 'owner' and old.role <> 'owner' and not recovery and actor_role <> 'owner' then
    raise exception 'OWNER_ACTION_REQUIRES_OWNER' using detail = 'Only an Owner can give the Owner role.';
  end if;

  -- O1: disabling / re-enabling an Owner, changing an Owner's email or role, or
  -- flagging an Owner for a password reset: only ANOTHER active Owner.
  if owner_target and not recovery
     and (disabling or enabling
          or new.email is distinct from old.email
          or new.role  is distinct from old.role
          or (new.must_change_password and not old.must_change_password)) then
    if actor_role <> 'owner' or actor = old.id then
      raise exception 'OWNER_ACTION_REQUIRES_OWNER'
        using detail = 'Only another Owner can do this to an Owner account.';
    end if;
  end if;

  -- At least one active Owner must always exist (never bypassed, not even by recovery).
  if old.role = 'owner' and old.is_active and (new.role <> 'owner' or not new.is_active) then
    select count(*) into n_other_owners
    from public.user_profiles p
    where p.role = 'owner' and p.is_active and p.id <> old.id;
    if n_other_owners = 0 then
      raise exception 'LAST_OWNER_PROTECTED'
        using detail = 'This is the only active Owner. Add another Owner first.';
    end if;
  end if;

  -- Who disabled the account and when comes from the session, not from the caller.
  if disabling then
    new.disabled_at := now();
    new.disabled_by := actor;
  elsif enabling then
    new.disabled_at := null;
    new.disabled_by := null;
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- resorts: the code is part of every Booking ID, so it freezes with the first booking (Q4)
-- ---------------------------------------------------------------------------
create function public.guard_resort_code()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.code is distinct from old.code
     and exists (select 1 from public.bookings b where b.resort_id = old.id) then
    raise exception 'RESORT_CODE_LOCKED'
      using detail = 'The resort code cannot be changed after the resort has bookings.';
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- guests: keep the searchable mobile number in sync
-- ---------------------------------------------------------------------------
create function public.guard_guest()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.mobile_normalized := public.normalize_mobile(new.mobile);
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- bookings
-- ---------------------------------------------------------------------------
create function public.guard_booking()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.resorts r where r.id = new.resort_id and r.is_active) then
      raise exception 'RESORT_INACTIVE' using detail = 'New bookings cannot be added to an inactive resort.';
    end if;
    if new.status <> 'confirmed' then
      raise exception 'BOOKING_MUST_START_CONFIRMED';
    end if;
  end if;

  -- An Agent booking must use an Agent; a Partner booking must use a Partner.
  if new.co_category in ('agent', 'partner')
     and not exists (select 1 from public.agents_partners a
                     where a.id = new.agent_partner_id and a.type::text = new.co_category::text) then
    raise exception 'CO_TYPE_MISMATCH' using detail = 'The selected name does not match the C/O category.';
  end if;

  if tg_op = 'UPDATE' then
    -- Booking ID parts are frozen for ever (Q16): to fix a wrong resort/year, cancel and re-create.
    if new.booking_code is distinct from old.booking_code
       or new.resort_id   is distinct from old.resort_id
       or new.booking_year is distinct from old.booking_year
       or new.booking_seq is distinct from old.booking_seq then
      raise exception 'ID_FIELDS_LOCKED'
        using detail = 'The resort and the booking year cannot be changed after the Booking ID is issued.';
    end if;
    if new.idempotency_key is distinct from old.idempotency_key
       or new.created_at is distinct from old.created_at
       or new.created_by is distinct from old.created_by then
      raise exception 'IMMUTABLE_FIELD';
    end if;

    if old.status in ('cancelled', 'no_show') then
      -- Final. The original booking (amounts, dates, cancellation record) is never overwritten (Q7a).
      if new.status <> old.status then
        raise exception 'STATUS_FINAL' using detail = 'A cancelled or no-show booking cannot be reopened.';
      end if;
      if (new.pax, new.pricing_method, new.tariff_per_person_paise, new.nights, new.base_amount_paise,
          new.extra_charges_paise, new.extra_charges_note, new.discount_paise,
          new.manual_adjustment_paise, new.manual_adjustment_reason,
          new.check_in_at, new.check_out_at)
         is distinct from
         (old.pax, old.pricing_method, old.tariff_per_person_paise, old.nights, old.base_amount_paise,
          old.extra_charges_paise, old.extra_charges_note, old.discount_paise,
          old.manual_adjustment_paise, old.manual_adjustment_reason,
          old.check_in_at, old.check_out_at) then
        raise exception 'CANCELLED_AMOUNTS_LOCKED'
          using detail = 'The original amounts of a cancelled booking cannot be changed.';
      end if;
      if (new.cancellation_reason, new.cancellation_date, new.cancelled_at, new.cancelled_by)
         is distinct from
         (old.cancellation_reason, old.cancellation_date, old.cancelled_at, old.cancelled_by) then
        raise exception 'CANCELLATION_RECORD_LOCKED';
      end if;
      -- Only the charge may be corrected, and only with a new written reason.
      if new.cancellation_charge_paise is distinct from old.cancellation_charge_paise
         and (new.charge_change_reason is not distinct from old.charge_change_reason
              or length(btrim(coalesce(new.charge_change_reason, ''))) = 0) then
        raise exception 'CHARGE_CHANGE_REASON_REQUIRED'
          using detail = 'Please give a reason for changing the cancellation charge.';
      end if;
    elsif new.status in ('cancelled', 'no_show') then
      if actor is null then
        raise exception 'NOT_AUTHENTICATED';
      end if;
      if new.cancellation_date > public.today_ist() then
        raise exception 'CANCELLATION_DATE_FUTURE' using detail = 'The cancellation date cannot be in the future.';
      end if;
      new.cancelled_at := now();
      new.cancelled_by := actor;
    end if;
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- payment_plan_revisions: contiguous numbering, honest snapshots, one writer per booking
-- ---------------------------------------------------------------------------
create function public.guard_plan_revision()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  due        bigint;
  last_no    int;
  prev_after bigint;
  locked     bigint;
begin
  -- Lock the booking row: plan changes for one booking happen one at a time.
  select b.amount_due_paise into due from public.bookings b where b.id = new.booking_id for update;
  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;

  select coalesce(max(r.revision_no), 0) into last_no
  from public.payment_plan_revisions r where r.booking_id = new.booking_id;
  if new.revision_no <> last_no + 1 then
    raise exception 'PLAN_REVISION_ORDER' using detail = 'Plan revisions must be numbered 1, 2, 3 ... without gaps.';
  end if;

  -- The revision records the booking's amount due as it is NOW (the booking row
  -- is always updated before its revision is written).
  if new.amount_due_after is distinct from due then
    raise exception 'PLAN_REVISION_AMOUNT_MISMATCH';
  end if;
  if last_no = 0 then
    if new.amount_due_before is not null then
      raise exception 'PLAN_REVISION_AMOUNT_MISMATCH';
    end if;
  else
    select r.amount_due_after into prev_after
    from public.payment_plan_revisions r where r.booking_id = new.booking_id and r.revision_no = last_no;
    if new.amount_due_before is distinct from prev_after then
      raise exception 'PLAN_REVISION_AMOUNT_MISMATCH';
    end if;
  end if;

  -- "Locked" = rows that are already past due right now.
  select coalesce(sum(s.amount_paise), 0) into locked
  from public.payment_schedules s
  where s.booking_id = new.booking_id and s.superseded_at is null and s.due_date < public.today_ist();
  if new.locked_total_paise is distinct from locked then
    raise exception 'PLAN_REVISION_AMOUNT_MISMATCH' using detail = 'The locked (already due) total is wrong.';
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- payment_schedules: past-due rows are locked for ever (D2)
-- ---------------------------------------------------------------------------
create function public.guard_schedule()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  rev      public.payment_plan_revisions%rowtype;
  latest   int;
  actor    uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    select * into rev from public.payment_plan_revisions r where r.id = new.revision_id;
    if not found then
      raise exception 'PLAN_REVISION_CLOSED' using detail = 'The plan revision does not exist.';
    end if;
    select max(r.revision_no) into latest from public.payment_plan_revisions r where r.booking_id = new.booking_id;
    -- Rows can only be added by the revision written in THIS transaction, and only the latest one.
    if rev.created_at <> now() or rev.revision_no <> latest then
      raise exception 'PLAN_REVISION_CLOSED'
        using detail = 'Plan rows can only be added as part of a new plan revision.';
    end if;
    if new.superseded_at is not null then
      raise exception 'PLAN_ROW_IMMUTABLE';
    end if;
    -- Only the very first plan (booking creation) may contain past dates (PRD FR-SCH-8).
    if rev.revision_no > 1 and new.due_date < public.today_ist() then
      raise exception 'PLAN_DATE_IN_PAST' using detail = 'New plan rows must be due today or later.';
    end if;
    return new;
  end if;

  -- UPDATE: the only change ever allowed is "this row is replaced". The caller names the
  -- replacing revision; the database stamps WHEN and BY WHOM (from the session).
  if old.superseded_at is not null
     or (new.booking_id, new.revision_id, new.kind, new.line_no, new.label, new.due_date, new.amount_paise, new.created_at, new.created_by)
        is distinct from
        (old.booking_id, old.revision_id, old.kind, old.line_no, old.label, old.due_date, old.amount_paise, old.created_at, old.created_by)
     or new.superseded_revision_id is null then
    raise exception 'PLAN_ROW_IMMUTABLE' using detail = 'Plan rows cannot be edited. They can only be replaced by a new revision.';
  end if;
  if old.due_date < public.today_ist() then
    raise exception 'PAST_DUE_ROW_LOCKED'
      using detail = 'A plan row that is already due cannot be changed or replaced.';
  end if;
  if actor is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  select * into rev from public.payment_plan_revisions r where r.id = new.superseded_revision_id;
  select max(r.revision_no) into latest from public.payment_plan_revisions r where r.booking_id = old.booking_id;
  if rev.id is null or rev.created_at <> now() or rev.revision_no <> latest then
    raise exception 'PLAN_REVISION_CLOSED';
  end if;
  new.superseded_at := now();
  new.superseded_by := actor;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- expected_adjustments: always dated today, always part of a new revision (D2)
-- ---------------------------------------------------------------------------
create function public.guard_adjustment()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  rev    public.payment_plan_revisions%rowtype;
  latest int;
  rs     uuid;
begin
  select b.resort_id into rs from public.bookings b where b.id = new.booking_id;
  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;
  new.resort_id := rs;

  select * into rev from public.payment_plan_revisions r where r.id = new.revision_id;
  select max(r.revision_no) into latest from public.payment_plan_revisions r where r.booking_id = new.booking_id;
  if rev.id is null or rev.created_at <> now() or rev.revision_no <> latest then
    raise exception 'PLAN_REVISION_CLOSED'
      using detail = 'Adjustments can only be added as part of a new plan revision.';
  end if;
  if new.adjustment_date <> public.today_ist() then
    raise exception 'ADJUSTMENT_DATE_INVALID' using detail = 'Adjustments are always dated today.';
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- payments: identity from the session, strict status flow, locked after decision
-- ---------------------------------------------------------------------------
create function public.guard_payment()
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
begin
  if tg_op = 'INSERT' then
    if actor is null or not public.is_active_user() then
      raise exception 'NOT_ALLOWED' using detail = 'Only an active, logged-in user can record a payment.';
    end if;
    -- Lock the booking: payment numbers are then handed out one at a time.
    select bk.booking_code, bk.resort_id into b from public.bookings bk where bk.id = new.booking_id for update;
    if not found then
      raise exception 'BOOKING_NOT_FOUND';
    end if;
    if new.status <> 'waiting' then
      raise exception 'PAYMENT_MUST_START_WAITING';
    end if;
    if new.payment_date > public.today_ist() then
      raise exception 'PAYMENT_DATE_IN_FUTURE' using detail = 'The payment date cannot be in the future.';
    end if;
    select count(*) into n from public.payments p where p.booking_id = new.booking_id;
    new.payment_code := b.booking_code || '-P' || (n + 1);
    new.resort_id    := b.resort_id;
    new.recorded_by  := actor;
    new.recorded_at  := now();
    new.version      := 1;
    return new;
  end if;

  -- ---- UPDATE ---------------------------------------------------------------
  if new.id is distinct from old.id
     or new.payment_code is distinct from old.payment_code
     or new.booking_id   is distinct from old.booking_id
     or new.resort_id    is distinct from old.resort_id
     or new.recorded_by  is distinct from old.recorded_by
     or new.recorded_at  is distinct from old.recorded_at
     or new.idempotency_key is distinct from old.idempotency_key then
    raise exception 'IMMUTABLE_FIELD';
  end if;
  if actor is null or not public.is_active_user() then
    raise exception 'NOT_ALLOWED' using detail = 'Only an active, logged-in user can change a payment.';
  end if;

  if old.status = 'waiting' then
    if new.status = 'waiting' then
      if new.payment_date > public.today_ist() then
        raise exception 'PAYMENT_DATE_IN_FUTURE' using detail = 'The payment date cannot be in the future.';
      end if;
    elsif new.status in ('approved', 'rejected') then
      -- A decision never edits the payment at the same time.
      if (new.amount_paise, new.method, new.provider_id, new.provider_other, new.payment_date,
          new.payment_time, new.reference_number, new.remarks)
         is distinct from
         (old.amount_paise, old.method, old.provider_id, old.provider_other, old.payment_date,
          old.payment_time, old.reference_number, old.remarks) then
        raise exception 'PAYMENT_CHANGED_DURING_DECISION';
      end if;
      -- Who decided and when comes from the session. Self-approval is allowed (Q8) and is
      -- visible through is_self_approved and the approval history.
      if new.status = 'approved' then
        new.approved_by := actor;
        new.approved_at := now();
      else
        new.rejected_by := actor;
        new.rejected_at := now();
      end if;
    else
      raise exception 'INVALID_STATUS_CHANGE' using detail = 'A waiting payment can only be approved or rejected.';
    end if;

  elsif old.status = 'approved' then
    if new.status <> 'reversed' then
      raise exception 'PAYMENT_LOCKED' using detail = 'An approved payment can only be reversed.';
    end if;
    if (new.amount_paise, new.method, new.provider_id, new.provider_other, new.payment_date,
        new.payment_time, new.reference_number, new.remarks, new.approved_by, new.approved_at)
       is distinct from
       (old.amount_paise, old.method, old.provider_id, old.provider_other, old.payment_date,
        old.payment_time, old.reference_number, old.remarks, old.approved_by, old.approved_at) then
      raise exception 'PAYMENT_CHANGED_DURING_DECISION';
    end if;
    -- Reversing must not leave refunds larger than the money still held.
    perform 1 from public.bookings bk where bk.id = old.booking_id for update;
    select coalesce(sum(p.amount_paise), 0) into sum_a
      from public.payments p where p.booking_id = old.booking_id and p.status = 'approved';
    select coalesce(sum(r.amount_paise) filter (where r.status = 'approved'), 0),
           coalesce(sum(r.amount_paise) filter (where r.status = 'waiting'), 0)
      into sum_ra, sum_rw
      from public.refunds r where r.booking_id = old.booking_id;
    if sum_a - old.amount_paise - sum_ra - sum_rw < 0 then
      raise exception 'REVERSAL_EXCEEDS_REFUNDS'
        using detail = 'This payment cannot be reversed because refunds depend on it. Reject or reverse the refunds first.';
    end if;
    new.reversed_by := actor;
    new.reversed_at := now();

  else
    raise exception 'PAYMENT_LOCKED' using detail = 'Rejected and reversed payments cannot be changed.';
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- refunds: same flow as payments, plus the limit (never refund more than is held)
-- ---------------------------------------------------------------------------
create function public.guard_refund()
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
begin
  if tg_op = 'INSERT' then
    if actor is null or not public.is_active_user() then
      raise exception 'NOT_ALLOWED' using detail = 'Only an active, logged-in user can record a refund.';
    end if;
    select bk.booking_code, bk.resort_id into b from public.bookings bk where bk.id = new.booking_id for update;
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
    if new.amount_paise > sum_a - sum_ra - sum_rw then
      raise exception 'REFUND_TOO_LARGE'
        using detail = format('The most that can be refunded now is %s paise.', greatest(sum_a - sum_ra - sum_rw, 0));
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
        perform 1 from public.bookings bk where bk.id = old.booking_id for update;
        select coalesce(sum(p.amount_paise), 0) into sum_a
          from public.payments p where p.booking_id = old.booking_id and p.status = 'approved';
        select coalesce(sum(r.amount_paise) filter (where r.status = 'approved'), 0),
               coalesce(sum(r.amount_paise) filter (where r.status = 'waiting'), 0)
          into sum_ra, sum_rw
          from public.refunds r where r.booking_id = old.booking_id;
        if new.amount_paise > sum_a - sum_ra - (sum_rw - old.amount_paise) then
          raise exception 'REFUND_TOO_LARGE';
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

-- ---------------------------------------------------------------------------
-- approval_history: written by the database itself on every status change, so a
-- decision can never happen without leaving its history row (PRD FR-APR-4).
-- ---------------------------------------------------------------------------
create function public.record_approval_history()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  kind   text := tg_argv[0];                 -- 'payment' or 'refund'
  j      jsonb := to_jsonb(new);
  rec    uuid := (j ->> 'recorded_by')::uuid;
  actor  uuid := auth.uid();
  from_s public.approval_status;
  why    text;
begin
  if tg_op = 'INSERT' then
    from_s := null;
    actor  := coalesce(actor, rec);
  else
    if new.status is not distinct from old.status then
      return null;
    end if;
    from_s := old.status;
  end if;
  why := case new.status
           when 'rejected' then j ->> 'rejection_reason'
           when 'reversed' then j ->> 'reversal_reason'
           else null
         end;
  insert into public.approval_history
    (payment_id, refund_id, from_status, to_status, reason, acted_by, is_self_action)
  values
    (case when kind = 'payment' then (j ->> 'id')::uuid end,
     case when kind = 'refund'  then (j ->> 'id')::uuid end,
     from_s, new.status, why, actor, actor = rec);
  return null;
end
$$;

-- ---------------------------------------------------------------------------
-- proofs: add files only while waiting; hide (never delete) only while waiting
-- ---------------------------------------------------------------------------
create function public.guard_proof()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  actor  uuid := auth.uid();
  parent public.approval_status;
begin
  if actor is null or not public.is_active_user() then
    raise exception 'NOT_ALLOWED' using detail = 'Only an active, logged-in user can change payment files.';
  end if;

  if tg_op = 'INSERT' then
    if new.payment_id is not null then
      select p.status into parent from public.payments p where p.id = new.payment_id;
    else
      select r.status into parent from public.refunds r where r.id = new.refund_id;
    end if;
    if parent is distinct from 'waiting' then
      raise exception 'PROOF_LOCKED'
        using detail = 'Files can only be added while the payment or refund is waiting for approval.';
    end if;
    if new.hidden_at is not null then
      raise exception 'PROOF_LOCKED';
    end if;
    new.uploaded_by := actor;
    new.uploaded_at := now();
    return new;
  end if;

  -- UPDATE: the only change ever allowed is hiding the file once.
  if (new.payment_id, new.refund_id, new.storage_path, new.original_file_name, new.mime_type,
      new.size_bytes, new.sha256, new.uploaded_by, new.uploaded_at)
     is distinct from
     (old.payment_id, old.refund_id, old.storage_path, old.original_file_name, old.mime_type,
      old.size_bytes, old.sha256, old.uploaded_by, old.uploaded_at)
     or old.hidden_at is not null
     or new.hidden_at is null then
    raise exception 'PROOF_LOCKED' using detail = 'Files cannot be edited. A file can only be hidden, once.';
  end if;
  if old.payment_id is not null then
    select p.status into parent from public.payments p where p.id = old.payment_id;
  else
    select r.status into parent from public.refunds r where r.id = old.refund_id;
  end if;
  if parent is distinct from 'waiting' then
    raise exception 'PROOF_LOCKED' using detail = 'Files can only be hidden while the payment or refund is waiting for approval.';
  end if;
  new.hidden_at := now();
  new.hidden_by := actor;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- COMMIT-TIME CHECK 1 - the books must balance (D2):
--   sum(active plan rows) + sum(expected adjustments) = amount due
-- Deferred: a transaction may do its steps in any order; the total is checked once at COMMIT.
-- ---------------------------------------------------------------------------
create function public.check_plan_invariant()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  bid   uuid;
  due   bigint;
  sched bigint;
  adj   bigint;
begin
  -- (separate statements: a column that does not exist on this table is never touched)
  if tg_table_name = 'bookings' then
    bid := new.id;
  else
    bid := new.booking_id;
  end if;
  select b.amount_due_paise into due from public.bookings b where b.id = bid;
  select coalesce(sum(s.amount_paise), 0) into sched
    from public.payment_schedules s where s.booking_id = bid and s.superseded_at is null;
  select coalesce(sum(a.amount_paise), 0) into adj
    from public.expected_adjustments a where a.booking_id = bid;
  if due is distinct from sched + adj then
    raise exception 'PLAN_TOTAL_MISMATCH'
      using detail = format('Payment plan (%s) + adjustments (%s) must equal the amount due (%s), in paise.', sched, adj, due);
  end if;
  return null;
end
$$;

-- ---------------------------------------------------------------------------
-- COMMIT-TIME CHECK 2 - proof rule (Q9, D3): UPI / Card / Cheque payments and
-- refunds must keep at least one visible screenshot or receipt. Cash / Other: optional.
-- ---------------------------------------------------------------------------
create function public.check_proof_rule()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  pid uuid;
  rid uuid;
  m   public.payment_method;
begin
  if tg_table_name = 'payments' then
    pid := new.id;
  elsif tg_table_name = 'refunds' then
    rid := new.id;
  else
    pid := new.payment_id;
    rid := new.refund_id;
  end if;

  if pid is not null then
    select p.method into m from public.payments p where p.id = pid;
  else
    select r.method into m from public.refunds r where r.id = rid;
  end if;

  if m in ('upi', 'card', 'cheque')
     and not exists (select 1 from public.proofs f
                     where f.hidden_at is null
                       and ((pid is not null and f.payment_id = pid) or (rid is not null and f.refund_id = rid))) then
    raise exception 'PROOF_REQUIRED'
      using detail = 'A screenshot or receipt is required for UPI, card and cheque payments and refunds.';
  end if;
  return null;
end
$$;

-- =============================================================================
-- ATTACH THE TRIGGERS
-- =============================================================================

do $$
declare
  t text;
begin
  -- No hard deletes, no emptying - on EVERY table (even for the service role).
  foreach t in array array[
    'user_profiles','resorts','guests','agents_partners','stay_types','payment_providers',
    'booking_sequences','bookings','payment_plan_revisions','payment_schedules','expected_adjustments',
    'payments','refunds','proofs','approval_history','booking_pdf_versions','pdf_jobs','audit_logs','system_status']
  loop
    execute format('create trigger trg_00_no_delete   before delete   on public.%I for each row       execute function public.prevent_delete()', t);
    execute format('create trigger trg_00_no_truncate before truncate on public.%I for each statement execute function public.prevent_truncate()', t);
  end loop;

  -- Append-only history: rows can never be changed after they are written.
  foreach t in array array['payment_plan_revisions','expected_adjustments','approval_history','booking_pdf_versions','audit_logs']
  loop
    execute format('create trigger trg_01_append_only before update on public.%I for each row execute function public.prevent_update()', t);
  end loop;

  -- created_at / created_by from the session.
  foreach t in array array[
    'user_profiles','resorts','guests','agents_partners','stay_types','payment_providers',
    'bookings','payment_plan_revisions','payment_schedules','expected_adjustments']
  loop
    execute format('create trigger trg_20_stamp_created before insert on public.%I for each row execute function public.stamp_created()', t);
  end loop;

  -- updated_at / updated_by from the session.
  foreach t in array array[
    'user_profiles','resorts','guests','agents_partners','stay_types','payment_providers',
    'bookings','payments','refunds']
  loop
    execute format('create trigger trg_20_stamp_updated before update on public.%I for each row execute function public.stamp_updated()', t);
  end loop;

  -- Optimistic locking version.
  foreach t in array array['bookings','payments','refunds']
  loop
    execute format('create trigger trg_30_bump_version before update on public.%I for each row execute function public.bump_version()', t);
  end loop;

  -- Audit trail of every meaningful change.
  foreach t in array array[
    'user_profiles','resorts','guests','agents_partners','stay_types','payment_providers',
    'bookings','payment_plan_revisions','payment_schedules','expected_adjustments',
    'payments','refunds','proofs','booking_pdf_versions']
  loop
    execute format('create trigger trg_90_audit after insert or update on public.%I for each row execute function public.audit_row_change()', t);
  end loop;
end
$$;

-- Guards
create trigger trg_10_guard before insert or update on public.user_profiles
  for each row execute function public.guard_user_profiles();
create trigger trg_10_guard before update on public.resorts
  for each row execute function public.guard_resort_code();
create trigger trg_10_guard before insert or update on public.guests
  for each row execute function public.guard_guest();
create trigger trg_10_guard before insert or update on public.bookings
  for each row execute function public.guard_booking();
create trigger trg_10_guard before insert on public.payment_plan_revisions
  for each row execute function public.guard_plan_revision();
create trigger trg_10_guard before insert or update on public.payment_schedules
  for each row execute function public.guard_schedule();
create trigger trg_10_guard before insert on public.expected_adjustments
  for each row execute function public.guard_adjustment();
create trigger trg_10_guard before insert or update on public.payments
  for each row execute function public.guard_payment();
create trigger trg_10_guard before insert or update on public.refunds
  for each row execute function public.guard_refund();
create trigger trg_10_guard before insert or update on public.proofs
  for each row execute function public.guard_proof();

-- Approval history (payments and refunds)
create trigger trg_91_history after insert or update on public.payments
  for each row execute function public.record_approval_history('payment');
create trigger trg_91_history after insert or update on public.refunds
  for each row execute function public.record_approval_history('refund');

-- Commit-time checks (deferred to the end of the transaction)
create constraint trigger trg_99_plan_invariant after insert or update on public.bookings
  deferrable initially deferred for each row execute function public.check_plan_invariant();
create constraint trigger trg_99_plan_invariant after insert or update on public.payment_schedules
  deferrable initially deferred for each row execute function public.check_plan_invariant();
create constraint trigger trg_99_plan_invariant after insert or update on public.expected_adjustments
  deferrable initially deferred for each row execute function public.check_plan_invariant();

create constraint trigger trg_99_proof_rule after insert or update on public.payments
  deferrable initially deferred for each row execute function public.check_proof_rule();
create constraint trigger trg_99_proof_rule after insert or update on public.refunds
  deferrable initially deferred for each row execute function public.check_proof_rule();
create constraint trigger trg_99_proof_rule after insert or update on public.proofs
  deferrable initially deferred for each row execute function public.check_proof_rule();
