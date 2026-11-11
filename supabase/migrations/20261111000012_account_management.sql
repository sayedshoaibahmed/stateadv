-- =============================================================================
-- 12 ACCOUNT MANAGEMENT
-- The write functions for user accounts (PRD FR-AUTH-3..16; decisions O1..O7).
--
-- How the pieces fit together (TRD 5.7):
--   * the app first asks Supabase Auth to create / change the login (secret key, server only);
--   * these functions then record the profile and enforce every rule;
--   * guard_user_profiles (migration 06) remains the final safety net underneath.
--
-- What the database CANNOT do, and the server action does instead:
--   * re-check the acting Owner's PASSWORD (O3). The database never sees passwords.
--
-- Every function: SECURITY DEFINER, empty search_path, the caller is identified only by
-- auth.uid() (never by a parameter), EXECUTE taken from PUBLIC first, then granted back.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- The audit trigger now also copies the reason that the calling function placed in the
-- transaction-local setting 'app.reason'. (Replaces the function from migration 05; same
-- behaviour as before when no reason is set.)
-- ---------------------------------------------------------------------------
create or replace function public.audit_row_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  j_new   jsonb := to_jsonb(new);
  j_old   jsonb;
  changed text[];
  act     text;
  bk      uuid;
  rs      uuid;
  tgt     uuid;
  who     text;
  why     text := nullif(btrim(coalesce(current_setting('app.reason', true), '')), '');
begin
  if tg_op = 'INSERT' then
    act := 'insert';
  else
    j_old := to_jsonb(old);
    act := 'update';
    select array_agg(k order by k) into changed
    from jsonb_object_keys(j_new) as keys(k)
    where j_new -> k is distinct from j_old -> k
      and k not in ('updated_at', 'updated_by', 'version');
    if changed is null then
      return null;                       -- nothing meaningful changed
    end if;
  end if;

  bk := coalesce(
          nullif(j_new ->> 'booking_id', '')::uuid,
          case when tg_table_name = 'bookings' then (j_new ->> 'id')::uuid end);
  if bk is null and tg_table_name = 'proofs' then
    select p.booking_id into bk from public.payments p where p.id = nullif(j_new ->> 'payment_id', '')::uuid;
    if bk is null then
      select r.booking_id into bk from public.refunds r where r.id = nullif(j_new ->> 'refund_id', '')::uuid;
    end if;
  end if;
  rs  := coalesce(
          nullif(j_new ->> 'resort_id', '')::uuid,
          case when tg_table_name = 'resorts' then (j_new ->> 'id')::uuid end);
  tgt := case when tg_table_name = 'user_profiles' then (j_new ->> 'id')::uuid end;

  select p.full_name into who from public.user_profiles p where p.id = auth.uid();

  insert into public.audit_logs
    (actor_id, actor_name, action, table_name, record_id, booking_id, resort_id, target_user_id, old_data, new_data, changed_fields, reason)
  values
    (auth.uid(), who, act, tg_table_name, coalesce(j_new ->> 'id', ''), bk, rs, tgt, j_old, j_new, changed, why);
  return null;
end
$$;

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable by app users)
-- ---------------------------------------------------------------------------

-- A written reason of at least p_min characters, trimmed.
create function public.require_reason(p_reason text, p_min int)
returns text
language plpgsql immutable
set search_path = ''
as $$
declare r text := btrim(coalesce(p_reason, ''));
begin
  if length(r) < p_min then
    raise exception 'REASON_REQUIRED'
      using detail = format('Please write a reason of at least %s characters.', p_min);
  end if;
  return r;
end
$$;
revoke all on function public.require_reason(text, int) from public, anon, authenticated;

-- Writes one explicit audit entry for an account action that does not (always) change a row.
create function public.audit_account_action(p_target uuid, p_action text, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare who text;
begin
  select p.full_name into who from public.user_profiles p where p.id = auth.uid();
  insert into public.audit_logs (actor_id, actor_name, action, table_name, record_id, target_user_id, reason)
  values (auth.uid(), who, p_action, 'user_profiles', p_target::text, p_target, nullif(btrim(coalesce(p_reason, '')), ''));
end
$$;
revoke all on function public.audit_account_action(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- active_owner_count(): used by the app to show "only one Owner exists" (FR-AUTH-14.3).
-- ---------------------------------------------------------------------------
create function public.active_owner_count()
returns int
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.is_active_user() then
    raise exception 'NOT_ALLOWED';
  end if;
  return (select count(*)::int from public.user_profiles p where p.role = 'owner' and p.is_active);
end
$$;
revoke all on function public.active_owner_count() from public, anon, authenticated;
grant execute on function public.active_owner_count() to authenticated;

-- ---------------------------------------------------------------------------
-- profile_create: record a new account whose login Supabase Auth has just created.
-- O2/O6: only an Owner can create an Owner, and that needs a written reason.
-- ---------------------------------------------------------------------------
create function public.profile_create(
  p_id        uuid,
  p_full_name text,
  p_email     text,
  p_role      public.user_role,
  p_phone     text default null,
  p_reason    text default null
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_email      text := lower(btrim(coalesce(p_email, '')));
  v_name       text := btrim(coalesce(p_full_name, ''));
  v_auth_email text;
  v_reason     text;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'NOT_ALLOWED' using detail = 'Only an active, logged-in user can add users.';
  end if;
  if p_id is null or p_role is null or v_name = '' or v_email = '' then
    raise exception 'INVALID_INPUT' using detail = 'Name, email and role are required.';
  end if;

  -- The profile must belong to a real login with the SAME email.
  select lower(u.email) into v_auth_email from auth.users u where u.id = p_id;
  if v_auth_email is null then
    raise exception 'AUTH_USER_MISSING' using detail = 'The login for this person was not created.';
  end if;
  if v_auth_email <> v_email then
    raise exception 'AUTH_EMAIL_MISMATCH' using detail = 'The email does not match the login.';
  end if;

  if p_role = 'owner' then
    v_reason := public.require_reason(p_reason, 10);   -- O6
  else
    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  end if;
  perform set_config('app.reason', coalesce(v_reason, ''), true);

  begin
    insert into public.user_profiles (id, full_name, email, phone, role)
    values (p_id, v_name, v_email, nullif(btrim(coalesce(p_phone, '')), ''), p_role);
  exception when unique_violation then
    raise exception 'DUPLICATE_ACCOUNT' using detail = 'An account with this email already exists.';
  end;
  return p_id;
end
$$;
revoke all on function public.profile_create(uuid, text, text, public.user_role, text, text) from public, anon, authenticated;
grant execute on function public.profile_create(uuid, text, text, public.user_role, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- profile_update: change name, phone or role label. NEVER the email (see profile_change_email
-- and the verified own-email process, O7) and never one's own role (FR-AUTH-10).
-- NULL = leave unchanged; for the phone, an empty text clears it.
-- ---------------------------------------------------------------------------
create function public.profile_update(
  p_id        uuid,
  p_full_name text default null,
  p_phone     text default null,
  p_role      public.user_role default null,
  p_reason    text default null
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  cur public.user_profiles;
  v_reason text;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'NOT_ALLOWED' using detail = 'Only an active, logged-in user can change accounts.';
  end if;
  select * into cur from public.user_profiles where id = p_id;
  if not found then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  if p_role is not null and p_role is distinct from cur.role then
    if p_id = auth.uid() then
      raise exception 'CANNOT_CHANGE_OWN_ROLE' using detail = 'You cannot change your own role.';
    end if;
    v_reason := public.require_reason(p_reason, 10);
  else
    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  end if;
  perform set_config('app.reason', coalesce(v_reason, ''), true);

  update public.user_profiles
     set full_name = coalesce(nullif(btrim(coalesce(p_full_name, '')), ''), full_name),
         phone     = case when p_phone is null then phone else nullif(btrim(p_phone), '') end,
         role      = coalesce(p_role, role)
   where id = p_id;
end
$$;
revoke all on function public.profile_update(uuid, text, text, public.user_role, text) from public, anon, authenticated;
grant execute on function public.profile_update(uuid, text, text, public.user_role, text) to authenticated;

-- ---------------------------------------------------------------------------
-- profile_change_email: change ANOTHER person's login email (own email: verified process only, O7).
-- The app changes the login in Supabase Auth right after this succeeds.
-- ---------------------------------------------------------------------------
create function public.profile_change_email(p_id uuid, p_new_email text, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  cur public.user_profiles;
  v_email text := lower(btrim(coalesce(p_new_email, '')));
  v_actor_role public.user_role;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'NOT_ALLOWED' using detail = 'Only an active, logged-in user can change accounts.';
  end if;
  if p_id = auth.uid() then
    raise exception 'EMAIL_CHANGE_REQUIRES_VERIFICATION'
      using detail = 'To change your own email, use My Account and confirm the link sent to your email.';
  end if;
  select * into cur from public.user_profiles where id = p_id;
  if not found then
    raise exception 'PROFILE_NOT_FOUND';
  end if;
  select role into v_actor_role from public.user_profiles where id = auth.uid();
  if cur.role = 'owner' and v_actor_role <> 'owner' then
    raise exception 'OWNER_ACTION_REQUIRES_OWNER' using detail = 'Only another Owner can do this to an Owner account.';
  end if;
  perform set_config('app.reason', public.require_reason(p_reason, 10), true);
  begin
    update public.user_profiles set email = v_email where id = p_id;
  exception
    when unique_violation then
      raise exception 'DUPLICATE_ACCOUNT' using detail = 'An account with this email already exists.';
    when check_violation then
      raise exception 'INVALID_INPUT' using detail = 'That does not look like an email address.';
  end;
end
$$;
revoke all on function public.profile_change_email(uuid, text, text) from public, anon, authenticated;
grant execute on function public.profile_change_email(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- profile_set_active: switch an account off or on. Self-disable, the last active Owner and
-- Owner targets are enforced by guard_user_profiles; the reason rule is enforced here.
-- ---------------------------------------------------------------------------
create function public.profile_set_active(p_id uuid, p_active boolean, p_reason text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  cur public.user_profiles;
  v_reason text;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'NOT_ALLOWED' using detail = 'Only an active, logged-in user can change accounts.';
  end if;
  if p_active is null then
    raise exception 'INVALID_INPUT';
  end if;
  select * into cur from public.user_profiles where id = p_id;
  if not found then
    raise exception 'PROFILE_NOT_FOUND';
  end if;
  if cur.is_active = p_active then
    return;                                   -- nothing to do
  end if;
  if cur.role = 'owner' then
    v_reason := public.require_reason(p_reason, 10);   -- O3
  else
    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  end if;
  perform set_config('app.reason', coalesce(v_reason, ''), true);

  update public.user_profiles
     set is_active = p_active,
         disabled_at = case when p_active then null else now() end
   where id = p_id;
end
$$;
revoke all on function public.profile_set_active(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.profile_set_active(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- profile_reset_password: record that someone else's password was reset (the app sets the
-- temporary password in Supabase Auth right after). Marks "must change password" and writes
-- an audit entry that always exists, even if the flag was already on.
-- O1: for an Owner account only ANOTHER Owner may do this - checked explicitly here,
-- because a flag that is already on would not trip the table guard.
-- ---------------------------------------------------------------------------
create function public.profile_reset_password(p_target uuid, p_reason text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  cur public.user_profiles;
  v_actor_role public.user_role;
  v_reason text;
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'NOT_ALLOWED' using detail = 'Only an active, logged-in user can reset passwords.';
  end if;
  if p_target = auth.uid() then
    raise exception 'CANNOT_RESET_OWN_PASSWORD'
      using detail = 'To change your own password, use My Account.';
  end if;
  select * into cur from public.user_profiles where id = p_target;
  if not found then
    raise exception 'PROFILE_NOT_FOUND';
  end if;
  if not cur.is_active then
    raise exception 'ACCOUNT_DISABLED' using detail = 'Switch the account on before resetting its password.';
  end if;
  select role into v_actor_role from public.user_profiles where id = auth.uid();
  if cur.role = 'owner' then
    if v_actor_role <> 'owner' then
      raise exception 'OWNER_ACTION_REQUIRES_OWNER' using detail = 'Only another Owner can do this to an Owner account.';
    end if;
    v_reason := public.require_reason(p_reason, 10);   -- O3
  else
    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  end if;
  perform set_config('app.reason', coalesce(v_reason, ''), true);

  update public.user_profiles set must_change_password = true where id = p_target;
  perform public.audit_account_action(p_target, 'password_reset', v_reason);
end
$$;
revoke all on function public.profile_reset_password(uuid, text) from public, anon, authenticated;
grant execute on function public.profile_reset_password(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- recover_owner_account: LAST RESORT (O4, FR-AUTH-13.2). Service role only - run from the
-- one-time script on the business owner's own computer. Re-enables an Owner account and forces a
-- password change. It cannot create an Owner or change anyone else, and the "at least one
-- active Owner" rule is never bypassed.
-- ---------------------------------------------------------------------------
create function public.recover_owner_account(p_target uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  cur public.user_profiles;
  v_reason text := public.require_reason(p_reason, 10);
begin
  if auth.uid() is not null then
    raise exception 'NOT_ALLOWED' using detail = 'Recovery is only possible from the server script.';
  end if;
  select * into cur from public.user_profiles where id = p_target;
  if not found or cur.role <> 'owner' then
    raise exception 'PROFILE_NOT_FOUND' using detail = 'No Owner account with this id.';
  end if;
  perform set_config('app.reason', v_reason, true);
  perform set_config('app.owner_recovery', 'on', true);
  update public.user_profiles
     set is_active = true, disabled_at = null, disabled_by = null, must_change_password = true
   where id = p_target;
  perform set_config('app.owner_recovery', 'off', true);
  perform public.audit_account_action(p_target, 'owner_recovered', v_reason);
end
$$;
revoke all on function public.recover_owner_account(uuid, text) from public, anon, authenticated;
grant execute on function public.recover_owner_account(uuid, text) to service_role;
