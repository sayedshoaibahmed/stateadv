-- =============================================================================
-- 01 FOUNDATION
-- Extensions, enum types, generic helper/trigger functions.
-- Additive only. Nothing here touches data.
--
-- Error convention: business-rule violations are raised as
--     RAISE EXCEPTION 'SOME_CODE' USING DETAIL = '<human explanation>'
-- The app maps SOME_CODE to a plain-English message (src/lib/errors.ts).
-- =============================================================================

create schema if not exists extensions;
-- Trigram search for guest names (M4). The only extension we need.
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Enum types (values the business fixed; lists that may grow are lookup tables)
-- ---------------------------------------------------------------------------
create type public.user_role         as enum ('owner', 'manager');
create type public.co_category       as enum ('agent', 'partner', 'own', 'direct');       -- exactly four (PRD 5.5)
create type public.partner_type      as enum ('agent', 'partner');
create type public.pricing_method    as enum ('per_person_per_night', 'per_person_per_stay'); -- Q1
create type public.booking_status    as enum ('confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show');
create type public.payment_method    as enum ('cash', 'upi', 'card', 'cheque', 'other');
create type public.approval_status   as enum ('waiting', 'approved', 'rejected', 'reversed'); -- payments AND refunds
create type public.plan_kind         as enum ('booking', 'cancellation');
create type public.adjustment_source as enum ('cancellation', 'no_show', 'amount_change', 'plan_change', 'charge_change', 'move_overdue'); -- D2
create type public.pdf_job_status    as enum ('pending', 'running', 'done', 'failed');

-- ---------------------------------------------------------------------------
-- Pure helper functions
-- ---------------------------------------------------------------------------

-- Today's business date in India. The ONLY definition of "today" used by the
-- database (past-due locks, future-date checks, adjustments).
create function public.today_ist()
returns date
language sql stable
set search_path = ''
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- Digits only; strips a leading 91 (12 digits) or 0 (11 digits) for Indian numbers.
create function public.normalize_mobile(p_mobile text)
returns text
language sql immutable
set search_path = ''
as $$
  select case
           when d ~ '^91[0-9]{10}$' then substr(d, 3)
           when d ~ '^0[0-9]{10}$'  then substr(d, 2)
           else d
         end
  from (select regexp_replace(coalesce(p_mobile, ''), '[^0-9]', '', 'g') as d) s
$$;

-- ---------------------------------------------------------------------------
-- Generic trigger functions (attached table by table in later migrations)
-- ---------------------------------------------------------------------------

-- No ordinary hard deletion of business/financial records (PRD section 18).
create function public.prevent_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'DELETE_NOT_ALLOWED'
    using detail = format('Rows in %s cannot be deleted.', tg_table_name);
end
$$;

create function public.prevent_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'DELETE_NOT_ALLOWED'
    using detail = format('%s cannot be emptied.', tg_table_name);
end
$$;

-- Append-only tables: history can never be rewritten.
create function public.prevent_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'RECORD_IS_APPEND_ONLY'
    using detail = format('Rows in %s cannot be changed after they are written.', tg_table_name);
end
$$;

-- "Who and when" are taken from the verified database session, never from the
-- caller. auth.uid() is the user id inside the JWT that PostgREST verified.
create function public.stamp_created()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := now();
  new.created_by := coalesce(auth.uid(), new.created_by);
  return new;
end
$$;

create function public.stamp_updated()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), old.updated_by);
  return new;
end
$$;

-- Optimistic locking: every UPDATE bumps the version. RPCs update with
-- "WHERE id = $1 AND version = $expected" so a stale save changes 0 rows.
create function public.bump_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  return new;
end
$$;
