-- =============================================================================
-- 03 BOOKINGS AND PAYMENT PLAN
-- booking_sequences, bookings, payment_plan_revisions, payment_schedules,
-- expected_adjustments
--
-- All money is bigint PAISE (1 rupee = 100 paise). Upper bound 1e15 paise
-- (= 1e13 rupees) mirrors MAX_PAISE in src/lib/money.ts.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- booking_sequences: one counter per resort per booking-date year (Q4).
-- Written only by next_booking_code() (M2-B). A row lock on this row is what
-- makes simultaneous bookings safe: two writers take turns.
-- ---------------------------------------------------------------------------
create table public.booking_sequences (
  resort_id  uuid not null references public.resorts (id) on delete restrict,
  year       int  not null,
  last_value int  not null default 0,
  primary key (resort_id, year),
  constraint booking_sequences_year  check (year between 2000 and 2100),
  constraint booking_sequences_value check (last_value between 0 and 999999)
);

-- ---------------------------------------------------------------------------
-- bookings
-- ---------------------------------------------------------------------------
create table public.bookings (
  id                       uuid primary key default gen_random_uuid(),
  booking_code             text   not null,                 -- e.g. RSA-2026-000001
  resort_id                uuid   not null references public.resorts (id) on delete restrict,
  booking_year             int    not null,                 -- year of booking_date, frozen
  booking_seq              int    not null,
  guest_id                 uuid   not null references public.guests (id) on delete restrict,
  guest_name               text   not null,                 -- snapshot at booking time
  guest_mobile             text   not null,                 -- snapshot at booking time
  pax                      int    not null,
  co_category              public.co_category not null,
  agent_partner_id         uuid references public.agents_partners (id) on delete restrict,
  co_name                  text,                            -- snapshot / "Own" source name
  stay_type_id             smallint not null references public.stay_types (id),
  booking_date             date   not null,
  check_in_at              timestamptz not null,
  check_out_at             timestamptz not null,
  nights                   int    not null,                 -- IST calendar days (D4)
  pricing_method           public.pricing_method not null,
  tariff_per_person_paise  bigint not null,
  base_amount_paise        bigint not null,                 -- pax x tariff (x nights if per night)
  extra_charges_paise      bigint not null default 0,
  extra_charges_note       text,
  total_amount_paise       bigint generated always as (base_amount_paise + extra_charges_paise) stored,
  discount_paise           bigint not null default 0,       -- rupee discount only (Q14)
  manual_adjustment_paise  bigint not null default 0,       -- signed; reason mandatory (Q1)
  manual_adjustment_reason text,
  final_amount_paise       bigint generated always as
                             (base_amount_paise + extra_charges_paise - discount_paise + manual_adjustment_paise) stored,
  status                   public.booking_status not null default 'confirmed',
  cancellation_date        date,
  cancellation_charge_paise bigint,
  cancellation_reason      text,
  charge_change_reason     text,
  cancelled_at             timestamptz,
  cancelled_by             uuid references public.user_profiles (id),
  -- What the guest finally owes: the final amount, or the cancellation charge (Q7a).
  -- (A generated column cannot read another generated column, so the formula is repeated.)
  amount_due_paise         bigint generated always as (
                             case when status in ('cancelled', 'no_show')
                                  then cancellation_charge_paise
                                  else base_amount_paise + extra_charges_paise - discount_paise + manual_adjustment_paise
                             end) stored,
  remarks                  text,
  idempotency_key          uuid   not null,
  version                  int    not null default 1,
  created_at               timestamptz not null default now(),
  created_by               uuid references public.user_profiles (id),
  updated_at               timestamptz not null default now(),
  updated_by               uuid references public.user_profiles (id),

  -- Booking ID: unique, well-formed, and consistent with its own year/sequence.
  constraint bookings_code_key        unique (booking_code),
  constraint bookings_seq_key         unique (resort_id, booking_year, booking_seq),
  constraint bookings_idem_key        unique (idempotency_key),
  constraint bookings_code_fmt        check (booking_code ~ '^[A-Z0-9]{2,10}-[0-9]{4}-[0-9]{6}$'),
  constraint bookings_code_matches    check (booking_code ~ ('-' || booking_year::text || '-' || lpad(booking_seq::text, 6, '0') || '$')),
  constraint bookings_year_range      check (booking_year between 2000 and 2100),
  constraint bookings_seq_range       check (booking_seq between 1 and 999999),
  -- The Booking ID year is the year of the Booking Date and can never drift (Q4, Q16).
  constraint bookings_year_is_date    check (extract(year from booking_date)::int = booking_year),

  constraint bookings_names_len       check (length(btrim(guest_name)) between 1 and 120 and length(btrim(guest_mobile)) between 5 and 20),
  constraint bookings_pax_range       check (pax between 1 and 1000),

  -- C/O rules (Q3): Agent/Partner need a listed name; Own needs a name; Direct has none.
  constraint bookings_co_rules check (
    (co_category in ('agent', 'partner') and agent_partner_id is not null and co_name is not null)
    or (co_category = 'own'    and agent_partner_id is null and co_name is not null)
    or (co_category = 'direct' and agent_partner_id is null and co_name is null)
  ),

  -- Dates and nights (D4): nights = IST date of check-out minus IST date of check-in.
  constraint bookings_checkout_after_checkin check (check_out_at > check_in_at),
  constraint bookings_nights_match check (
    nights = ((check_out_at at time zone 'Asia/Kolkata')::date - (check_in_at at time zone 'Asia/Kolkata')::date)
  ),

  -- Pricing (Q1). The formula is enforced here as well as in the RPC, so a
  -- wrong amount can never be stored even by a buggy caller.
  constraint bookings_per_night_needs_night check (pricing_method <> 'per_person_per_night' or nights >= 1),
  constraint bookings_base_formula check (
    base_amount_paise = pax * tariff_per_person_paise *
      (case when pricing_method = 'per_person_per_night' then nights else 1 end)
  ),
  constraint bookings_money_ranges check (
    tariff_per_person_paise between 0 and 1000000000000000
    and base_amount_paise    between 0 and 1000000000000000
    and extra_charges_paise  between 0 and 1000000000000000
    and manual_adjustment_paise between -1000000000000000 and 1000000000000000
  ),
  -- Discount: rupees only, never more than the Total Amount (Q14).
  constraint bookings_discount_range check (discount_paise >= 0 and discount_paise <= base_amount_paise + extra_charges_paise),
  -- A manual change of the final amount always carries a written reason (Q1).
  constraint bookings_adjustment_reason check (
    manual_adjustment_paise = 0 or length(btrim(coalesce(manual_adjustment_reason, ''))) > 0
  ),
  constraint bookings_final_nonneg check (final_amount_paise >= 0),

  -- Cancellation / no-show (Q7, Q7a, Q7c). Original amounts are never touched.
  constraint bookings_cancellation_fields check (
    (status in ('cancelled', 'no_show')
       and cancellation_reason is not null and length(btrim(cancellation_reason)) > 0
       and cancellation_date is not null
       and cancellation_charge_paise is not null
       and cancelled_at is not null and cancelled_by is not null)
    or (status not in ('cancelled', 'no_show')
       and cancellation_reason is null and cancellation_date is null
       and cancellation_charge_paise is null and charge_change_reason is null
       and cancelled_at is null and cancelled_by is null)
  ),
  constraint bookings_charge_range check (
    cancellation_charge_paise is null
    or (cancellation_charge_paise >= 0 and cancellation_charge_paise <= final_amount_paise)
  ),
  -- A no-show is pre-filled with the full amount; a different charge needs its own reason (Q7c).
  constraint bookings_noshow_charge check (
    status <> 'no_show'
    or cancellation_charge_paise = final_amount_paise
    or length(btrim(coalesce(charge_change_reason, ''))) > 0
  ),
  constraint bookings_version_min check (version >= 1)
);

create index bookings_resort_date_idx    on public.bookings (resort_id, booking_date);
create index bookings_resort_checkin_idx on public.bookings (resort_id, check_in_at);
create index bookings_checkout_idx       on public.bookings (check_out_at);
create index bookings_guest_idx          on public.bookings (guest_id);
create index bookings_status_idx         on public.bookings (status);
create index bookings_agent_partner_idx  on public.bookings (agent_partner_id) where agent_partner_id is not null;
create index bookings_cancel_date_idx    on public.bookings (cancellation_date) where status in ('cancelled', 'no_show');
create index bookings_mobile_idx         on public.bookings (guest_mobile);
create index bookings_name_trgm_idx      on public.bookings using gin (lower(guest_name) extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- payment_plan_revisions (append-only, D2): one row per plan-changing event.
-- ---------------------------------------------------------------------------
create table public.payment_plan_revisions (
  id                 uuid primary key default gen_random_uuid(),
  booking_id         uuid   not null references public.bookings (id) on delete restrict,
  revision_no        int    not null,
  source             text   not null,
  reason             text,
  amount_due_before  bigint,
  amount_due_after   bigint not null,
  locked_total_paise bigint not null default 0,   -- sum of past-due rows at that moment
  created_at         timestamptz not null default now(),
  created_by         uuid references public.user_profiles (id),

  constraint plan_revisions_no_key   unique (booking_id, revision_no),
  constraint plan_revisions_id_booking_key unique (id, booking_id),   -- target of composite FKs
  constraint plan_revisions_no_min   check (revision_no >= 1),
  constraint plan_revisions_source   check (source in ('created', 'plan_change', 'amount_change', 'cancellation', 'no_show', 'charge_change', 'move_overdue')),
  -- Revision 1 is the creation; every later revision says why.
  constraint plan_revisions_first    check ((revision_no = 1) = (source = 'created')),
  constraint plan_revisions_reason   check (revision_no = 1 or length(btrim(coalesce(reason, ''))) > 0),
  constraint plan_revisions_amounts  check (amount_due_after >= 0 and locked_total_paise >= 0)
);

-- ---------------------------------------------------------------------------
-- payment_schedules: the payment plan rows. A row is ACTIVE while superseded_at
-- is null. Past-due rows are locked for ever (trigger, migration 06).
-- ---------------------------------------------------------------------------
create table public.payment_schedules (
  id                     uuid primary key default gen_random_uuid(),
  booking_id             uuid not null references public.bookings (id) on delete restrict,
  revision_id            uuid not null,
  kind                   public.plan_kind not null default 'booking',
  line_no                int  not null,
  label                  text not null,
  due_date               date not null,
  amount_paise           bigint not null,
  superseded_at          timestamptz,
  superseded_by          uuid references public.user_profiles (id),
  superseded_revision_id uuid,
  created_at             timestamptz not null default now(),
  created_by             uuid references public.user_profiles (id),

  -- A plan row can only belong to a revision of the SAME booking.
  constraint payment_schedules_revision_fk foreign key (revision_id, booking_id)
    references public.payment_plan_revisions (id, booking_id) on delete restrict,
  constraint payment_schedules_superseding_fk foreign key (superseded_revision_id, booking_id)
    references public.payment_plan_revisions (id, booking_id) on delete restrict,
  constraint payment_schedules_line_min  check (line_no >= 1),
  constraint payment_schedules_label_len check (length(btrim(label)) between 1 and 60),
  constraint payment_schedules_amount    check (amount_paise > 0 and amount_paise <= 1000000000000000),
  constraint payment_schedules_due_min   check (due_date >= date '2000-01-01'),
  constraint payment_schedules_superseded check ((superseded_at is null) = (superseded_revision_id is null))
);
create unique index payment_schedules_active_line_key on public.payment_schedules (booking_id, line_no) where superseded_at is null;
create index payment_schedules_active_booking_idx on public.payment_schedules (booking_id) where superseded_at is null;
create index payment_schedules_active_due_idx     on public.payment_schedules (due_date)   where superseded_at is null;
create index payment_schedules_revision_idx       on public.payment_schedules (revision_id);

-- ---------------------------------------------------------------------------
-- expected_adjustments (append-only, D2): dated, reasoned corrections to what
-- is expected. They make history stable: past months never change; a later
-- cancellation shows up on the day it happened.
-- ---------------------------------------------------------------------------
create table public.expected_adjustments (
  id              uuid primary key default gen_random_uuid(),
  booking_id      uuid not null references public.bookings (id) on delete restrict,
  resort_id       uuid not null references public.resorts (id) on delete restrict,  -- copied from booking
  revision_id     uuid not null,
  adjustment_date date not null,
  amount_paise    bigint not null,
  source          public.adjustment_source not null,
  reason          text not null,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.user_profiles (id),

  constraint expected_adjustments_revision_fk foreign key (revision_id, booking_id)
    references public.payment_plan_revisions (id, booking_id) on delete restrict,
  constraint expected_adjustments_amount check (amount_paise <> 0 and abs(amount_paise) <= 1000000000000000),
  constraint expected_adjustments_reason check (length(btrim(reason)) > 0),
  constraint expected_adjustments_date   check (adjustment_date >= date '2000-01-01')
);
create index expected_adjustments_resort_date_idx on public.expected_adjustments (resort_id, adjustment_date);
create index expected_adjustments_booking_idx     on public.expected_adjustments (booking_id);
