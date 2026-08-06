-- ============================================================================
-- Bootstrap the first super-admin account
-- ----------------------------------------------------------------------------
-- Run this in the Supabase Dashboard -> SQL Editor AFTER the target person
-- has an auth.users row — either by signing up themselves at /auth
-- (Create account tab) or via Authentication -> Users -> Add user.
--
-- Replace the email below, then run.
-- ============================================================================

do $$
declare
  target_email text := 'REPLACE_WITH_ADMIN_EMAIL@example.com';
  target_id uuid;
begin
  select id into target_id from auth.users where email = target_email;

  if target_id is null then
    raise exception 'No auth.users row for %. Create the account first (Auth -> Users -> Add user), then re-run this script.', target_email;
  end if;

  insert into public.profiles (id, full_name, email)
  values (target_id, 'Admin', target_email)
  on conflict (id) do update set email = excluded.email;

  insert into public.user_roles (user_id, role)
  values (target_id, 'admin')
  on conflict (user_id, role) do nothing;

  raise notice 'Admin role granted to % (%).', target_email, target_id;
end $$;

-- Verify:
-- select au.email, ur.role
-- from auth.users au
-- join public.user_roles ur on ur.user_id = au.id
-- where au.email = 'REPLACE_WITH_ADMIN_EMAIL@example.com';
