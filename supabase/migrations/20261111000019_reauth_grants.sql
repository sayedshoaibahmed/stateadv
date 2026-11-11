-- =============================================================================
-- 19 RE-AUTHENTICATION GRANTS (owner decision O3, enforced by the database)
--
-- Problem this closes: "re-enter your own password" for protected Owner actions was checked only
-- by the Next.js server action. A signed-in Owner (or anything holding that Owner's session token)
-- could call the database functions directly and skip the password prompt.
--
-- Design (the database never sees a password):
--   1. The server action RESERVES an attempt with reauth_begin() (service role only). At most 5 attempts per
--      Owner in 15 minutes can be reserved, even when many requests arrive at the same moment (advisory lock).
--   2. Only then it verifies the acting Owner's password with Supabase Auth. A wrong password is audited with
--      record_reauth_failure(); the attempt stays counted.
--   3. After a correct password the server calls issue_reauth() (service role only). That records a grant: who (the
--      acting Owner), which action, which target account, WHICH EXACT OPERATION (the new active flag, the new role,
--      the new email), valid for 60 seconds, usable once. A success resets the attempt count.
--   4. The protected function (profile_create for an Owner, profile_update for an Owner role change,
--      profile_set_active / profile_reset_password / profile_change_email on an Owner account) claims that grant in the
--      same transaction through consume_reauth(). No matching grant = REAUTH_REQUIRED.
--   A stolen session token alone cannot mint a grant (issuing needs the secret key), the secret key alone cannot act as
--   an Owner (the grant is bound to auth.uid(), which only a real session has), and a grant cannot be stolen by a
--   concurrent call with different arguments (it is bound to the exact operation).
--
-- Rules for this migration:
--   * grants are bound to the acting user (auth.uid()), the action, the target and the operation; single use; 60 seconds
--   * the table has NO privilege for any app role and no policy: only the functions below touch it
--   * nothing is ever deleted (like every table): old grants simply stay, they are tiny
--   * every attempt, success and failure is audited (reauth_attempt, reauth_verified, reauth_failed); those audit rows are
--     readable by Owners only (restrictive policy), and stay in the table whoever may read them
--   * signatures of the five protected functions do NOT change; non-protected calls behave exactly as before
--   * the error codes already used (OWNER_ACTION_REQUIRES_OWNER ...) are still raised first when the caller
--     is not an Owner; REAUTH_REQUIRED only appears for an Owner who has not re-entered the password
-- =============================================================================

create table public.reauth_grants (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references public.user_profiles (id),
  action     text        not null,
  target_id  uuid        not null,
  -- the exact operation: 'true'/'false' (set_active), 'owner'/'manager' (change_role), the lower-cased email
  -- (change_email, add_owner); null for reset_password
  detail     text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '60 seconds',
  used_at    timestamptz,
  constraint reauth_grants_action check (action in ('add_owner', 'change_role', 'set_active', 'reset_password', 'change_email')),
  constraint reauth_grants_window check (expires_at > created_at),
  constraint reauth_grants_detail check (
    (action = 'reset_password' and detail is null)
    or (action = 'set_active' and coalesce(detail in ('true', 'false'), false))
    or (action = 'change_role' and coalesce(detail in ('owner', 'manager'), false))
    or (action in ('change_email', 'add_owner') and detail is not null and detail = lower(btrim(detail)) and length(detail) between 3 and 320)
  )
);
create index reauth_grants_lookup_idx on public.reauth_grants (user_id, action, target_id, expires_at) where used_at is null;

alter table public.reauth_grants enable row level security;
-- No policy on purpose: with row-level security on and no policy, nobody but the owner role (the functions) can see a row.
revoke all on public.reauth_grants from public, anon, authenticated, service_role;
create trigger trg_00_no_delete   before delete   on public.reauth_grants for each row       execute function public.prevent_delete();
create trigger trg_00_no_truncate before truncate on public.reauth_grants for each statement execute function public.prevent_truncate();

-- ---------------------------------------------------------------------------
-- Audit visibility: reauth_attempt / reauth_verified / reauth_failed rows are readable by active OWNERS only.
-- A RESTRICTIVE policy is combined (AND) with the existing "active users can read" policy, so nothing else changes
-- and no row is removed or altered: the rows stay in audit_logs for the owner role, the service role and Owners.
-- ---------------------------------------------------------------------------
create policy "reauth audit rows are for owners" on public.audit_logs
  as restrictive for select to authenticated
  using (
    left(action, 7) <> 'reauth_'
    or exists (select 1 from public.user_profiles p where p.id = (select auth.uid()) and p.role = 'owner' and p.is_active)
  );

-- ---------------------------------------------------------------------------
-- reauth_begin(actor, action, target): reserve ONE password attempt for the acting Owner, BEFORE the password is tried.
-- At most 5 reservations in 15 minutes since the last successful verification; the advisory lock serializes the
-- count-and-insert per actor, so 20 simultaneous requests still reserve at most 5. REAUTH_LOCKED when used up.
-- service_role only.
-- ---------------------------------------------------------------------------
create function public.reauth_begin(p_actor uuid, p_action text, p_target uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor public.user_profiles;
  v_last  bigint;
  v_n     int;
begin
  if p_actor is null or p_target is null
     or p_action is null or p_action not in ('add_owner', 'change_role', 'set_active', 'reset_password', 'change_email') then
    raise exception 'INVALID_INPUT' using detail = 'The confirmation request is not valid.';
  end if;
  select * into v_actor from public.user_profiles where id = p_actor;
  if not found or not v_actor.is_active or v_actor.role <> 'owner' then
    raise exception 'NOT_ALLOWED' using detail = 'Only an active Owner can confirm this action with a password.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('stateadv.reauth:' || p_actor::text, 0));
  select coalesce(max(v.id), 0) into v_last
    from public.audit_logs v where v.actor_id = p_actor and v.action = 'reauth_verified';
  select count(*) into v_n
    from public.audit_logs a
   where a.actor_id = p_actor and a.action = 'reauth_attempt'
     and a.occurred_at > now() - interval '15 minutes'
     and a.id > v_last;                       -- ids only grow: a success resets the count, even inside one transaction
  if v_n >= 5 then
    raise exception 'REAUTH_LOCKED' using detail = 'Too many wrong passwords. Please wait 15 minutes and try again.';
  end if;
  insert into public.audit_logs (actor_id, actor_name, action, table_name, record_id, target_user_id, changed_fields)
  values (p_actor, v_actor.full_name, 'reauth_attempt', 'user_profiles', p_target::text, p_target, array[p_action]);
end
$$;
revoke all on function public.reauth_begin(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.reauth_begin(uuid, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- issue_reauth(actor, action, target, detail): record that the acting Owner has just proved their password for this
-- exact operation. Called by the server (secret key) after Supabase Auth accepted the password. Returns nothing:
-- the grant is claimed by (user, action, target, detail), never by an id the browser could ever learn.
-- A success resets the attempt count. service_role only.
-- ---------------------------------------------------------------------------
create function public.issue_reauth(p_actor uuid, p_action text, p_target uuid, p_detail text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor public.user_profiles;
begin
  if p_actor is null or p_target is null
     or p_action is null or p_action not in ('add_owner', 'change_role', 'set_active', 'reset_password', 'change_email') then
    raise exception 'INVALID_INPUT' using detail = 'The confirmation request is not valid.';
  end if;
  -- coalesce: a missing detail must be a plain 'no' (three-valued logic would otherwise let a NULL through)
  if not coalesce(   (p_action = 'reset_password' and p_detail is null)
          or (p_action = 'set_active' and coalesce(p_detail in ('true', 'false'), false))
          or (p_action = 'change_role' and coalesce(p_detail in ('owner', 'manager'), false))
          or (p_action in ('change_email', 'add_owner') and p_detail is not null and p_detail = lower(btrim(p_detail))
              and length(p_detail) between 3 and 320), false) then
    raise exception 'INVALID_INPUT' using detail = 'The confirmation does not say what it is for.';
  end if;
  select * into v_actor from public.user_profiles where id = p_actor;
  if not found or not v_actor.is_active or v_actor.role <> 'owner' then
    raise exception 'NOT_ALLOWED' using detail = 'Only an active Owner can confirm this action with a password.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('stateadv.reauth:' || p_actor::text, 0));
  insert into public.reauth_grants (user_id, action, target_id, detail)
  values (p_actor, p_action, p_target, p_detail);
  insert into public.audit_logs (actor_id, actor_name, action, table_name, record_id, target_user_id, changed_fields)
  values (p_actor, v_actor.full_name, 'reauth_verified', 'user_profiles', p_target::text, p_target, array[p_action]);
end
$$;
revoke all on function public.issue_reauth(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.issue_reauth(uuid, text, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- record_reauth_failure(actor, action, target): audit a wrong password (never the password itself).
-- The attempt was already counted by reauth_begin. service_role only. An unknown or non-Owner actor is ignored.
-- ---------------------------------------------------------------------------
create function public.record_reauth_failure(p_actor uuid, p_action text, p_target uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor public.user_profiles;
begin
  if p_actor is null or p_target is null
     or p_action is null or p_action not in ('add_owner', 'change_role', 'set_active', 'reset_password', 'change_email') then
    return;
  end if;
  select * into v_actor from public.user_profiles where id = p_actor and is_active and role = 'owner';
  if not found then
    return;
  end if;
  insert into public.audit_logs (actor_id, actor_name, action, table_name, record_id, target_user_id, changed_fields)
  values (p_actor, v_actor.full_name, 'reauth_failed', 'user_profiles', p_target::text, p_target, array[p_action]);
end
$$;
revoke all on function public.record_reauth_failure(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.record_reauth_failure(uuid, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- consume_reauth(user, action, target, detail): claim ONE unused, unexpired grant for exactly this user, action, target
-- and operation. Internal: callable by nobody, only by the functions below (they run as the table owner).
-- Atomic: two simultaneous claims of one grant give exactly one winner (FOR UPDATE SKIP LOCKED).
-- If the calling function fails later in the same transaction, the claim is rolled back with it.
-- ---------------------------------------------------------------------------
create function public.consume_reauth(p_user uuid, p_action text, p_target uuid, p_detail text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if p_user is not null then
    update public.reauth_grants g
       set used_at = now()
     where g.id = (select x.id from public.reauth_grants x
                    where x.user_id = p_user and x.action = p_action and x.target_id = p_target
                      and x.detail is not distinct from p_detail
                      and x.used_at is null and x.expires_at > now()
                    order by x.created_at desc
                    limit 1
                    for update skip locked)
    returning g.id into v_id;
  end if;
  if v_id is null then
    raise exception 'REAUTH_REQUIRED'
      using detail = 'Please enter your own password to confirm this action.';
  end if;
end
$$;
revoke all on function public.consume_reauth(uuid, text, uuid, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The five protected functions. Same signatures and grants as migration 12; the only changes are marked "O3".
-- A caller who is not an Owner still gets the same OWNER_ACTION_REQUIRES_OWNER as before (checked before the grant).
-- ---------------------------------------------------------------------------
create or replace function public.profile_create(
  p_id uuid, p_full_name text, p_email text, p_role public.user_role, p_phone text default null, p_reason text default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_email      text := lower(btrim(coalesce(p_email, '')));
  v_name       text := btrim(coalesce(p_full_name, ''));
  v_auth_email text;
  v_reason     text;
  v_actor_role public.user_role;
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
    select role into v_actor_role from public.user_profiles where id = auth.uid();
    if v_actor_role is distinct from 'owner' then
      raise exception 'OWNER_ACTION_REQUIRES_OWNER' using detail = 'Only an Owner can add another Owner.';
    end if;
    perform public.consume_reauth(auth.uid(), 'add_owner', p_id, v_email);   -- O3: password re-entered for this very account and email
  else
    v_reason := public.optional_reason(p_reason);
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

create or replace function public.profile_update(
  p_id uuid, p_full_name text default null, p_phone text default null, p_role public.user_role default null, p_reason text default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  cur public.user_profiles;
  v_reason text;
  v_actor_role public.user_role;
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
    if cur.role = 'owner' or p_role = 'owner' then
      -- protected: giving the Owner role, or taking it away from an Owner (O2, O1)
      select role into v_actor_role from public.user_profiles where id = auth.uid();
      if v_actor_role is distinct from 'owner' then
        raise exception 'OWNER_ACTION_REQUIRES_OWNER' using detail = 'Only an Owner can give the Owner role or change an Owner account.';
      end if;
      perform public.consume_reauth(auth.uid(), 'change_role', p_id, p_role::text);   -- O3: for exactly this new role
    end if;
  else
    v_reason := public.optional_reason(p_reason);
  end if;
  perform set_config('app.reason', coalesce(v_reason, ''), true);
  update public.user_profiles
     set full_name = coalesce(nullif(btrim(coalesce(p_full_name, '')), ''), full_name),
         phone     = case when p_phone is null then phone else nullif(btrim(p_phone), '') end,
         role      = coalesce(p_role, role)
   where id = p_id;
end
$$;

create or replace function public.profile_change_email(p_id uuid, p_new_email text, p_reason text)
returns void
language plpgsql security definer set search_path = ''
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
  if cur.role = 'owner' then
    perform public.consume_reauth(auth.uid(), 'change_email', p_id, v_email);   -- O3: for exactly this new email
  end if;
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

create or replace function public.profile_set_active(p_id uuid, p_active boolean, p_reason text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  cur public.user_profiles;
  v_reason text;
  v_actor_role public.user_role;
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
    select role into v_actor_role from public.user_profiles where id = auth.uid();
    if v_actor_role is distinct from 'owner' then
      raise exception 'OWNER_ACTION_REQUIRES_OWNER' using detail = 'Only another Owner can do this to an Owner account.';
    end if;
    perform public.consume_reauth(auth.uid(), 'set_active', p_id, p_active::text);   -- O3: for exactly this switch (on or off)
  else
    v_reason := public.optional_reason(p_reason);
  end if;
  perform set_config('app.reason', coalesce(v_reason, ''), true);
  update public.user_profiles
     set is_active = p_active,
         disabled_at = case when p_active then null else now() end
   where id = p_id;
end
$$;

create or replace function public.profile_reset_password(p_target uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = ''
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
    perform public.consume_reauth(auth.uid(), 'reset_password', p_target, null);   -- O3: password re-entered
  else
    v_reason := public.optional_reason(p_reason);
  end if;
  perform set_config('app.reason', coalesce(v_reason, ''), true);
  update public.user_profiles set must_change_password = true where id = p_target;
  perform public.audit_account_action(p_target, 'password_reset', v_reason);
end
$$;
