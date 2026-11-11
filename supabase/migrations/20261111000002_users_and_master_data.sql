-- =============================================================================
-- 02 USERS AND MASTER DATA
-- user_profiles, resorts, guests, agents_partners, stay_types, payment_providers
-- =============================================================================

-- ---------------------------------------------------------------------------
-- user_profiles: one row per login (id = Supabase Auth user id).
-- role matters ONLY for Owner-account protection (PRD FR-AUTH-9..15).
-- ---------------------------------------------------------------------------
create table public.user_profiles (
  id                   uuid primary key references auth.users (id) on delete restrict,
  full_name            text        not null,
  email                text        not null,
  phone                text,
  role                 public.user_role not null default 'manager',
  is_active            boolean     not null default true,
  must_change_password boolean     not null default true,
  disabled_at          timestamptz,
  disabled_by          uuid references public.user_profiles (id),
  created_at           timestamptz not null default now(),
  created_by           uuid references public.user_profiles (id),
  updated_at           timestamptz not null default now(),
  updated_by           uuid references public.user_profiles (id),

  constraint user_profiles_name_len  check (length(btrim(full_name)) between 1 and 120),
  constraint user_profiles_email_fmt check (email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint user_profiles_email_key unique (email),
  -- A disabled account must say when. Active accounts carry no disable marks.
  constraint user_profiles_disabled_consistency check (
    (is_active and disabled_at is null and disabled_by is null)
    or (not is_active and disabled_at is not null)
  ),
  -- Nobody can disable themselves (Q10) - also enforced in the guard trigger.
  constraint user_profiles_no_self_disable check (disabled_by is distinct from id)
);
create index user_profiles_active_role_idx on public.user_profiles (role) where is_active;

-- True when the caller has a valid session AND an active profile. Every RLS
-- policy and every write function starts from this. SECURITY DEFINER so the
-- lookup itself is not blocked by RLS on user_profiles (no recursion).
create function public.is_active_user()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_profiles p
    where p.id = auth.uid() and p.is_active
  )
$$;

-- ---------------------------------------------------------------------------
-- resorts
-- ---------------------------------------------------------------------------
create table public.resorts (
  id             uuid primary key default gen_random_uuid(),
  code           text        not null,
  name           text        not null,
  location       text,
  contact_number text,
  logo_path      text,
  is_active      boolean     not null default true,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.user_profiles (id),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.user_profiles (id),

  -- Stored upper-case: the code is the Booking ID prefix.
  constraint resorts_code_fmt  check (code ~ '^[A-Z0-9]{2,10}$'),
  constraint resorts_code_key  unique (code),
  constraint resorts_name_len  check (length(btrim(name)) between 1 and 120)
);
create unique index resorts_name_ci_key on public.resorts (lower(name));

-- ---------------------------------------------------------------------------
-- guests (mobile is NOT unique: families share phones; the UI suggests matches)
-- ---------------------------------------------------------------------------
create table public.guests (
  id                uuid primary key default gen_random_uuid(),
  full_name         text        not null,
  mobile            text        not null,
  mobile_normalized text        not null,       -- set by trigger
  email             text,
  address           text,
  notes             text,
  created_at        timestamptz not null default now(),
  created_by        uuid references public.user_profiles (id),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.user_profiles (id),

  constraint guests_name_len   check (length(btrim(full_name)) between 1 and 120),
  constraint guests_mobile_len check (length(btrim(mobile)) between 5 and 20),
  constraint guests_norm_len   check (length(mobile_normalized) between 5 and 20)
);
create index guests_mobile_idx   on public.guests (mobile_normalized);
create index guests_name_trgm_idx on public.guests using gin (lower(full_name) extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- agents_partners: reusable C/O names (Agent / Partner)
-- ---------------------------------------------------------------------------
create table public.agents_partners (
  id         uuid primary key default gen_random_uuid(),
  type       public.partner_type not null,
  name       text        not null,
  mobile     text,
  notes      text,
  is_active  boolean     not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.user_profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles (id),

  constraint agents_partners_name_len check (length(btrim(name)) between 1 and 120)
);
create unique index agents_partners_type_name_key on public.agents_partners (type, lower(name));

-- ---------------------------------------------------------------------------
-- stay_types: editable list (seeded in migration 10: Resort Stay, Day Outing, Package)
-- ---------------------------------------------------------------------------
create table public.stay_types (
  id         smallint generated always as identity primary key,
  name       text        not null,
  is_active  boolean     not null default true,
  sort_order int         not null default 100,
  created_at timestamptz not null default now(),
  created_by uuid references public.user_profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles (id),

  constraint stay_types_name_len check (length(btrim(name)) between 1 and 60)
);
create unique index stay_types_name_ci_key on public.stay_types (lower(name));

-- ---------------------------------------------------------------------------
-- payment_providers: UPI apps, card networks, ...
-- (id, method) is unique so payments can reference BOTH (composite FK) and a
-- provider can never be attached to the wrong payment method.
-- ---------------------------------------------------------------------------
create table public.payment_providers (
  id         smallint generated always as identity primary key,
  method     public.payment_method not null,
  name       text        not null,
  is_active  boolean     not null default true,
  sort_order int         not null default 100,
  created_at timestamptz not null default now(),
  created_by uuid references public.user_profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.user_profiles (id),

  constraint payment_providers_name_len check (length(btrim(name)) between 1 and 60),
  constraint payment_providers_method_name_key unique (method, name),
  constraint payment_providers_id_method_key unique (id, method)
);
