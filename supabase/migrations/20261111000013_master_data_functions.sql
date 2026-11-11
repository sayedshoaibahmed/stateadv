-- =============================================================================
-- 13 MASTER DATA FUNCTIONS
-- Resorts, guests, agents/partners, stay types, payment providers.
-- Same rules as every function since migration 11: SECURITY DEFINER, empty search_path,
-- caller identified only by auth.uid(), EXECUTE taken from PUBLIC then granted to
-- `authenticated` only. Any active user may use them (Q10: same operational access).
-- The audit trigger on each table records who changed what.
-- =============================================================================

-- Shared check used at the top of every function below.
create function public.require_active_user()
returns void
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'NOT_ALLOWED' using detail = 'Only an active, logged-in user can do this.';
  end if;
end
$$;
revoke all on function public.require_active_user() from public, anon, authenticated;

-- Trim; empty text becomes NULL.
create function public.clean_text(p text)
returns text
language sql immutable
set search_path = ''
as $$ select nullif(btrim(coalesce(p, '')), '') $$;
revoke all on function public.clean_text(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- upsert_resort: p_id NULL = add. The code is stored in capitals and is locked once the resort has
-- bookings (guard_resort_code). A logo path is only accepted if it has the shape the storage policy
-- allows: {resort id}/{uuid}.png|jpg|webp, and the file already exists in the private bucket.
-- p_logo_path: NULL = unchanged, '' = remove.
-- ---------------------------------------------------------------------------
create function public.upsert_resort(
  p_id uuid,
  p_code text,
  p_name text,
  p_location text default null,
  p_contact_number text default null,
  p_logo_path text default null
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id   uuid := coalesce(p_id, gen_random_uuid());
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_logo text;
begin
  perform public.require_active_user();
  if v_code !~ '^[A-Z0-9]{2,10}$' then
    raise exception 'INVALID_INPUT' using detail = 'The resort code must be 2 to 10 letters or numbers.';
  end if;
  if length(v_name) not between 1 and 120 then
    raise exception 'INVALID_INPUT' using detail = 'Please enter the resort name.';
  end if;

  if p_logo_path is not null and btrim(p_logo_path) <> '' then
    v_logo := btrim(p_logo_path);
    if v_logo !~ ('^' || v_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$') then
      raise exception 'INVALID_INPUT' using detail = 'That logo file does not belong to this resort.';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'resort-logos' and o.name = v_logo) then
      raise exception 'INVALID_INPUT' using detail = 'The logo file was not uploaded.';
    end if;
  end if;

  begin
    if p_id is null then
      insert into public.resorts (id, code, name, location, contact_number, logo_path)
      values (v_id, v_code, v_name, public.clean_text(p_location), public.clean_text(p_contact_number), v_logo);
    else
      update public.resorts
         set code = v_code,
             name = v_name,
             location = public.clean_text(p_location),
             contact_number = public.clean_text(p_contact_number),
             logo_path = case when p_logo_path is null then logo_path else v_logo end
       where id = p_id;
      if not found then
        raise exception 'NOT_FOUND' using detail = 'Resort not found.';
      end if;
    end if;
  exception when unique_violation then
    raise exception 'DUPLICATE' using detail = 'A resort with this code or name already exists.';
  end;
  return v_id;
end
$$;
revoke all on function public.upsert_resort(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.upsert_resort(uuid, text, text, text, text, text) to authenticated;

create function public.set_resort_active(p_id uuid, p_active boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform public.require_active_user();
  if p_active is null then raise exception 'INVALID_INPUT'; end if;
  update public.resorts set is_active = p_active where id = p_id;
  if not found then
    raise exception 'NOT_FOUND' using detail = 'Resort not found.';
  end if;
end
$$;
revoke all on function public.set_resort_active(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_resort_active(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- upsert_guest
-- ---------------------------------------------------------------------------
create function public.upsert_guest(
  p_id uuid,
  p_full_name text,
  p_mobile text,
  p_email text default null,
  p_address text default null,
  p_notes text default null
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id     uuid := coalesce(p_id, gen_random_uuid());
  v_name   text := btrim(coalesce(p_full_name, ''));
  v_mobile text := btrim(coalesce(p_mobile, ''));
  v_email  text := lower(public.clean_text(p_email));
begin
  perform public.require_active_user();
  if length(v_name) not between 1 and 120 then
    raise exception 'INVALID_INPUT' using detail = 'Please enter the guest name.';
  end if;
  if length(public.normalize_mobile(v_mobile)) not between 5 and 20 then
    raise exception 'INVALID_INPUT' using detail = 'Please enter a valid mobile number.';
  end if;
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'INVALID_INPUT' using detail = 'That does not look like an email address.';
  end if;

  if p_id is null then
    insert into public.guests (id, full_name, mobile, email, address, notes)
    values (v_id, v_name, v_mobile, v_email, public.clean_text(p_address), public.clean_text(p_notes));
  else
    update public.guests
       set full_name = v_name, mobile = v_mobile, email = v_email,
           address = public.clean_text(p_address), notes = public.clean_text(p_notes)
     where id = p_id;
    if not found then
      raise exception 'NOT_FOUND' using detail = 'Guest not found.';
    end if;
  end if;
  return v_id;
end
$$;
revoke all on function public.upsert_guest(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.upsert_guest(uuid, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- upsert_agent_partner (type cannot be changed after it is created: bookings may refer to it)
-- ---------------------------------------------------------------------------
create function public.upsert_agent_partner(
  p_id uuid,
  p_type public.partner_type,
  p_name text,
  p_mobile text default null,
  p_notes text default null,
  p_is_active boolean default true
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id   uuid := coalesce(p_id, gen_random_uuid());
  v_name text := btrim(coalesce(p_name, ''));
begin
  perform public.require_active_user();
  if p_type is null or length(v_name) not between 1 and 120 then
    raise exception 'INVALID_INPUT' using detail = 'Please choose Agent or Partner and enter the name.';
  end if;
  begin
    if p_id is null then
      insert into public.agents_partners (id, type, name, mobile, notes, is_active)
      values (v_id, p_type, v_name, public.clean_text(p_mobile), public.clean_text(p_notes), coalesce(p_is_active, true));
    else
      if exists (select 1 from public.agents_partners a where a.id = p_id and a.type <> p_type) then
        raise exception 'INVALID_INPUT' using detail = 'An Agent cannot be changed into a Partner, or the other way round.';
      end if;
      update public.agents_partners
         set name = v_name, mobile = public.clean_text(p_mobile), notes = public.clean_text(p_notes),
             is_active = coalesce(p_is_active, is_active)
       where id = p_id;
      if not found then
        raise exception 'NOT_FOUND' using detail = 'Agent or partner not found.';
      end if;
    end if;
  exception when unique_violation then
    raise exception 'DUPLICATE' using detail = 'This name already exists.';
  end;
  return v_id;
end
$$;
revoke all on function public.upsert_agent_partner(uuid, public.partner_type, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.upsert_agent_partner(uuid, public.partner_type, text, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- upsert_stay_type
-- ---------------------------------------------------------------------------
create function public.upsert_stay_type(
  p_id smallint,
  p_name text,
  p_is_active boolean default true,
  p_sort_order int default 100
)
returns smallint
language plpgsql security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_id   smallint;
begin
  perform public.require_active_user();
  if length(v_name) not between 1 and 60 then
    raise exception 'INVALID_INPUT' using detail = 'Please enter the name.';
  end if;
  begin
    if p_id is null then
      insert into public.stay_types (name, is_active, sort_order)
      values (v_name, coalesce(p_is_active, true), coalesce(p_sort_order, 100))
      returning id into v_id;
    else
      update public.stay_types
         set name = v_name, is_active = coalesce(p_is_active, is_active), sort_order = coalesce(p_sort_order, sort_order)
       where id = p_id returning id into v_id;
      if v_id is null then
        raise exception 'NOT_FOUND' using detail = 'Stay type not found.';
      end if;
    end if;
  exception when unique_violation then
    raise exception 'DUPLICATE' using detail = 'This name already exists.';
  end;
  return v_id;
end
$$;
revoke all on function public.upsert_stay_type(smallint, text, boolean, int) from public, anon, authenticated;
grant execute on function public.upsert_stay_type(smallint, text, boolean, int) to authenticated;

-- ---------------------------------------------------------------------------
-- upsert_provider (the payment method of an existing provider cannot change)
-- ---------------------------------------------------------------------------
create function public.upsert_provider(
  p_id smallint,
  p_method public.payment_method,
  p_name text,
  p_is_active boolean default true,
  p_sort_order int default 100
)
returns smallint
language plpgsql security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_id   smallint;
begin
  perform public.require_active_user();
  if p_method is null or p_method not in ('upi', 'card') or length(v_name) not between 1 and 60 then
    raise exception 'INVALID_INPUT' using detail = 'Please choose a payment type and enter the name.';
  end if;
  -- the table rule is case-sensitive; "Phonepe" and "PhonePe" are the same app to a person
  if exists (select 1 from public.payment_providers x
              where x.method = p_method and lower(x.name) = lower(v_name) and x.id is distinct from p_id) then
    raise exception 'DUPLICATE' using detail = 'This name already exists for this payment type.';
  end if;
  begin
    if p_id is null then
      insert into public.payment_providers (method, name, is_active, sort_order)
      values (p_method, v_name, coalesce(p_is_active, true), coalesce(p_sort_order, 100))
      returning id into v_id;
    else
      if exists (select 1 from public.payment_providers x where x.id = p_id and x.method <> p_method) then
        raise exception 'INVALID_INPUT' using detail = 'The payment type of an existing app cannot be changed.';
      end if;
      update public.payment_providers
         set name = v_name, is_active = coalesce(p_is_active, is_active), sort_order = coalesce(p_sort_order, sort_order)
       where id = p_id returning id into v_id;
      if v_id is null then
        raise exception 'NOT_FOUND' using detail = 'Payment app not found.';
      end if;
    end if;
  exception when unique_violation then
    raise exception 'DUPLICATE' using detail = 'This name already exists for this payment type.';
  end;
  return v_id;
end
$$;
revoke all on function public.upsert_provider(smallint, public.payment_method, text, boolean, int) from public, anon, authenticated;
grant execute on function public.upsert_provider(smallint, public.payment_method, text, boolean, int) to authenticated;
