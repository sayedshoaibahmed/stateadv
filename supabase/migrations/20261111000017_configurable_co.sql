-- =============================================================================
-- 17 CONFIGURABLE C/O CATEGORIES AND ENTRIES, STAY-TYPE SNAPSHOT
-- (owner requirement 2026-11-11: Managers configure C/O categories, C/O names, resorts and stay types
--  themselves; nothing is a fixed list in the code or the database.)
--
-- BEFORE: bookings.co_category was an enum of exactly four values, agents_partners.type an enum of two.
-- AFTER:
--   co_categories  Any number of categories, each with a NAME and a NAME MODE:
--                    listed = the booking must pick a name from the category's list (like Agent, Partner)
--                    typed  = the booking carries a typed name (like Own)
--                    none   = no name (like Direct)
--                  Seeded with the four old ones as STARTING EXAMPLES; renamable, switch-off-able, extendable.
--   co_entries     (was agents_partners) The names in a 'listed' category. Belongs to a category.
--   bookings       co_category_id + co_entry_id, plus COPIES of the names at booking time:
--                    co_category_name, co_mode, co_name, stay_type_name
--                  The copies are set by the guard from the master data and never move, so renaming or
--                  switching off a category, name or stay type cannot rewrite or hide an old booking.
--
-- Data: any existing booking is converted first (the hosted project has none). The old columns and the two
-- enum types are removed only after that. Run order inside this file matters; see the comments.
-- Hosted project at the time of writing: 0 bookings, 0 agents/partners, so nothing is lost; the DROP statements
-- below still need the project owner's approval at apply time (see MIGRATION_REVIEW 14).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. the categories
-- ---------------------------------------------------------------------------
create table public.co_categories (
  id         smallint generated always as identity primary key,
  name       text        not null,
  name_mode  text        not null default 'listed',
  is_active  boolean     not null default true,
  sort_order int         not null default 100,
  created_at timestamptz not null default now(),
  created_by uuid references public.user_profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles (id),

  constraint co_categories_name_len check (length(btrim(name)) between 1 and 60),
  constraint co_categories_mode     check (name_mode in ('listed', 'typed', 'none'))
);
create unique index co_categories_name_ci_key on public.co_categories (lower(btrim(name)));

-- The four categories the business started with, as EXAMPLES only (rename, extend or switch off freely).
insert into public.co_categories (name, name_mode, sort_order) values
  ('Agent',   'listed', 10),
  ('Partner', 'listed', 20),
  ('Own',     'typed',  30),
  ('Direct',  'none',   40);

-- ---------------------------------------------------------------------------
-- B. bookings: new columns (empty for now), converted from the old ones
-- ---------------------------------------------------------------------------
alter table public.bookings
  add column co_category_id   smallint references public.co_categories (id) on delete restrict,
  add column co_category_name text,
  add column co_mode          text,
  add column stay_type_name   text;

-- (the old guard is still in place here, so these conversions are checked by the old rules too)
-- one statement, so each booking is touched exactly once (its version goes up by one, nothing else changes)
update public.bookings b
   set co_category_id = c.id, co_category_name = c.name, co_mode = c.name_mode, stay_type_name = s.name
  from public.co_categories c, public.stay_types s
 where lower(c.name) = b.co_category::text and s.id = b.stay_type_id;

-- ---------------------------------------------------------------------------
-- C. agents_partners -> co_entries (the old 'type' becomes a category)
-- ---------------------------------------------------------------------------
alter table public.agents_partners add column category_id smallint;

update public.agents_partners a
   set category_id = c.id
  from public.co_categories c
 where lower(c.name) = a.type::text;

-- ---------------------------------------------------------------------------
-- D. the booking guard for the new design (replaces the function from migration 06)
-- ---------------------------------------------------------------------------
create or replace function public.guard_booking()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  cat   record;
  ent   record;
  stay  record;
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.resorts r where r.id = new.resort_id and r.is_active) then
      raise exception 'RESORT_INACTIVE' using detail = 'New bookings cannot be added to an inactive resort.';
    end if;
    if new.status <> 'confirmed' then
      raise exception 'BOOKING_MUST_START_CONFIRMED';
    end if;
  end if;

  -- C/O category, C/O name and stay type: the booking keeps a COPY of the names as they were when the choice was
  -- made (co_category_name, co_mode, co_name, stay_type_name). The copies are set HERE, from the master data, never
  -- by the caller, and they do not move when a category, entry or stay type is renamed later.
  -- A choice that is new or changed must be active; an old, now switched-off choice may stay on an old booking.
  if tg_op = 'INSERT' or new.co_category_id is distinct from old.co_category_id then
    select c.name, c.name_mode, c.is_active into cat from public.co_categories c where c.id = new.co_category_id;
    if not found then
      raise exception 'CO_TYPE_MISMATCH' using detail = 'Please choose a C/O category.';
    end if;
    if not cat.is_active then
      raise exception 'CO_INACTIVE' using detail = 'This C/O category is switched off.';
    end if;
    new.co_category_name := cat.name;
    new.co_mode := cat.name_mode;
  else
    new.co_category_name := old.co_category_name;
    new.co_mode := old.co_mode;
  end if;

  if new.co_mode = 'listed' then
    if tg_op = 'INSERT' or new.co_entry_id is distinct from old.co_entry_id
       or new.co_category_id is distinct from old.co_category_id then
      select e.name, e.is_active, e.category_id into ent from public.co_entries e where e.id = new.co_entry_id;
      if not found or ent.category_id <> new.co_category_id then
        raise exception 'CO_TYPE_MISMATCH' using detail = 'The selected name does not belong to the C/O category.';
      end if;
      if not ent.is_active then
        raise exception 'CO_INACTIVE' using detail = 'This C/O name is switched off.';
      end if;
      new.co_name := ent.name;
    else
      new.co_name := old.co_name;
    end if;
  end if;

  if tg_op = 'INSERT' or new.stay_type_id is distinct from old.stay_type_id then
    select s.name, s.is_active into stay from public.stay_types s where s.id = new.stay_type_id;
    if not found or not stay.is_active then
      raise exception 'STAY_TYPE_INACTIVE' using detail = 'Please choose a stay type that is switched on.';
    end if;
    new.stay_type_name := stay.name;
  else
    new.stay_type_name := old.stay_type_name;
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

-- The conversions above (when there are bookings) queued the end-of-transaction checks "plan = amount due" and
-- "proof rule". PostgreSQL does not allow ALTER TABLE while such checks are waiting, so they are run NOW. They pass:
-- no amount, plan row or proof was touched. Then the normal end-of-transaction mode is restored.
set constraints all immediate;
set constraints all deferred;

-- ---------------------------------------------------------------------------
-- E. the structural switch (everything is converted by now)
-- ---------------------------------------------------------------------------
alter table public.agents_partners rename to co_entries;

-- keep names tidy: indexes and constraints that carried the old table name
do $$
declare r record;
begin
  for r in
    select c.conname as name, 'constraint' as kind, c.conrelid::regclass::text as tbl
      from pg_constraint c
     where c.conrelid = 'public.co_entries'::regclass and c.conname like 'agents\_partners%'
    union all
    select i.indexname, 'index', null
      from pg_indexes i
     where i.schemaname = 'public' and i.tablename = 'co_entries' and i.indexname like 'agents\_partners%'
       and i.indexname not in (select k.conname from pg_constraint k where k.conrelid = 'public.co_entries'::regclass)  -- those follow their constraint
  loop
    if r.kind = 'constraint' then
      execute format('alter table public.co_entries rename constraint %I to %I', r.name, replace(r.name, 'agents_partners', 'co_entries'));
    else
      execute format('alter index public.%I rename to %I', r.name, replace(r.name, 'agents_partners', 'co_entries'));
    end if;
  end loop;
end
$$;

-- DESTRUCTIVE-APPROVED: replaced by co_entries_category_name_key a few lines below (the same rule, per category)
drop index public.co_entries_type_name_key;
-- DESTRUCTIVE-APPROVED: 'type' is replaced by category_id, which was filled for every row just above; hosted table is empty
alter table public.co_entries drop column type;
alter table public.co_entries
  alter column category_id set not null,
  add constraint co_entries_category_fk foreign key (category_id) references public.co_categories (id) on delete restrict,
  add constraint co_entries_id_category_key unique (id, category_id);
create unique index co_entries_category_name_key on public.co_entries (category_id, lower(btrim(name)));
create index co_entries_category_idx on public.co_entries (category_id);
-- fast "type to search" over names (pg_trgm is installed by migration 01)
create index co_entries_name_trgm_idx on public.co_entries using gin (lower(name) extensions.gin_trgm_ops);

alter table public.bookings rename column agent_partner_id to co_entry_id;
alter index public.bookings_agent_partner_idx rename to bookings_co_entry_idx;
alter table public.bookings rename constraint bookings_agent_partner_id_fkey to bookings_co_entry_id_fkey;

-- DESTRUCTIVE-APPROVED: replaced by the new bookings_co_rules below (same idea, now driven by co_mode)
alter table public.bookings drop constraint bookings_co_rules;
-- DESTRUCTIVE-APPROVED: the enum column is replaced by co_category_id / co_category_name / co_mode (converted above); hosted table is empty
alter table public.bookings drop column co_category;

alter table public.bookings
  alter column co_category_id   set not null,
  alter column co_category_name set not null,
  alter column co_mode          set not null,
  alter column stay_type_name   set not null,
  add constraint bookings_co_mode_valid check (co_mode in ('listed', 'typed', 'none')),
  add constraint bookings_co_names_len  check (
    length(btrim(co_category_name)) between 1 and 60 and length(btrim(stay_type_name)) between 1 and 60),
  -- C/O rules, driven by the mode the category had WHEN THE BOOKING WAS MADE (Q3, made configurable):
  --   listed: a name from the category's list;  typed: a typed name, no list entry;  none: no name at all
  add constraint bookings_co_rules check (
    (co_mode = 'listed' and co_entry_id is not null and co_name is not null)
    or (co_mode = 'typed' and co_entry_id is null and co_name is not null)
    or (co_mode = 'none'  and co_entry_id is null and co_name is null)
  ),
  -- A listed name can only be one that really belongs to the booking's category (cannot be bypassed)
  add constraint bookings_co_entry_category_fk foreign key (co_entry_id, co_category_id)
    references public.co_entries (id, category_id) on delete restrict;
create index bookings_co_category_idx on public.bookings (co_category_id);

-- DESTRUCTIVE-APPROVED: the fixed C/O lists are replaced by configurable master data; no column uses these types any more
drop type public.co_category;
-- DESTRUCTIVE-APPROVED: replaced by co_entries.category_id; no column uses this type any more
drop type public.partner_type;

-- ---------------------------------------------------------------------------
-- F. the new table follows the same rules as every other table
--    (read-only for app users; changes only through the functions of migration 13; no deletes; audited)
-- ---------------------------------------------------------------------------
alter table public.co_categories enable row level security;
create policy "active users can read" on public.co_categories
  for select to authenticated using ((select public.is_active_user()));
revoke all on public.co_categories from public, anon, authenticated;
grant select on public.co_categories to authenticated;

create trigger trg_00_no_delete   before delete   on public.co_categories for each row       execute function public.prevent_delete();
create trigger trg_00_no_truncate before truncate on public.co_categories for each statement execute function public.prevent_truncate();
create trigger trg_20_stamp_created before insert on public.co_categories for each row execute function public.stamp_created();
create trigger trg_20_stamp_updated before update on public.co_categories for each row execute function public.stamp_updated();
create trigger trg_90_audit after insert or update on public.co_categories for each row execute function public.audit_row_change();
