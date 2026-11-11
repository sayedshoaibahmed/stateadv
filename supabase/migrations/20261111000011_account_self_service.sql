-- =============================================================================
-- 11 ACCOUNT SELF-SERVICE
-- The first write function an app user may call: "I have changed my temporary
-- password" (PRD FR-AUTH-5).
--
-- Rules for every function added after migration 08:
--   * SECURITY DEFINER with an empty search_path (all names schema-qualified)
--   * the caller is identified ONLY by auth.uid() - never by a parameter
--   * EXECUTE is taken away from PUBLIC, anon and authenticated first, then
--     granted back to exactly the roles that need it. (New functions get
--     EXECUTE for PUBLIC by default in PostgreSQL, so this step is required.)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- complete_password_change(): clears the caller's own "must change password" flag.
--
-- The app calls this only AFTER Supabase Auth has accepted the new password for the
-- logged-in session. The database cannot see the password, so it cannot prove that
-- a change really happened; the flag is a reminder, not a security boundary against
-- the account holder themselves (they could call this directly and keep a temporary
-- password they already know). Everything that protects OTHER people is unchanged:
-- nobody else can clear or set the flag on an Owner account (guard_user_profiles, O1).
-- ---------------------------------------------------------------------------
create function public.complete_password_change()
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_active_user() then
    raise exception 'NOT_ALLOWED' using detail = 'Only an active, logged-in user can do this.';
  end if;

  update public.user_profiles
     set must_change_password = false
   where id = auth.uid()
     and must_change_password;
  -- No row changed = the flag was already off. That is fine (calling twice is harmless).
end
$$;

revoke all on function public.complete_password_change() from public, anon, authenticated;
grant execute on function public.complete_password_change() to authenticated;
