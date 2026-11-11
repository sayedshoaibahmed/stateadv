-- =============================================================================
-- 08 SECURITY: privileges and Row Level Security
--
-- Model (SECURITY.md section 3):
--   * anon (not logged in)  : nothing at all.
--   * authenticated         : may READ everything, but only while is_active_user().
--                             Has NO insert/update/delete on any table.
--   * ALL writes go through SECURITY DEFINER functions (M2-B) that check
--     is_active_user() first, validate, and let the guard triggers do the rest.
--   * service_role (secret key) keeps its default rights but the guard triggers
--     still apply to it; it is used only for Auth admin work and the PDF cron.
--
-- Supabase gives anon/authenticated broad default rights on every new object in
-- schema public. We remove that FIRST, then grant back only what is needed.
-- =============================================================================

-- 1. Future objects are private by default.
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;

-- 2. Existing objects: take everything away (including the implicit PUBLIC execute on functions).
revoke all on all tables    in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

-- 3. Row Level Security on EVERY table. (A test fails if any table is missing it.)
alter table public.user_profiles          enable row level security;
alter table public.resorts                enable row level security;
alter table public.guests                 enable row level security;
alter table public.agents_partners        enable row level security;
alter table public.stay_types             enable row level security;
alter table public.payment_providers      enable row level security;
alter table public.booking_sequences      enable row level security;   -- no policy, no grant: internal only
alter table public.bookings               enable row level security;
alter table public.payment_plan_revisions enable row level security;
alter table public.payment_schedules      enable row level security;
alter table public.expected_adjustments   enable row level security;
alter table public.payments               enable row level security;
alter table public.refunds                enable row level security;
alter table public.proofs                 enable row level security;
alter table public.approval_history       enable row level security;
alter table public.booking_pdf_versions   enable row level security;
alter table public.pdf_jobs               enable row level security;
alter table public.audit_logs             enable row level security;
alter table public.system_status          enable row level security;

-- 4. Read access: logged-in AND active. One policy per table; no write policies exist.
do $$
declare
  t text;
begin
  foreach t in array array[
    'user_profiles','resorts','guests','agents_partners','stay_types','payment_providers',
    'bookings','payment_plan_revisions','payment_schedules','expected_adjustments',
    'payments','refunds','proofs','approval_history','booking_pdf_versions','pdf_jobs',
    'audit_logs','system_status']
  loop
    execute format(
      'create policy "active users can read" on public.%I for select to authenticated using (public.is_active_user())', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end
$$;

-- 5. Views (they run with the caller's rights, so the policies above still apply).
grant select on public.booking_financials to authenticated;
grant select on public.expected_entries   to authenticated;

-- 6. The only functions the app's users may call directly.
--    Everything else (guards, audit, internal helpers) is not executable by them.
grant usage on schema public to authenticated;
grant execute on function public.is_active_user()          to authenticated;  -- used inside the policies
grant execute on function public.today_ist()               to authenticated;
grant execute on function public.normalize_mobile(text)    to authenticated;
grant execute on function public.booking_overdue(date)     to authenticated;
