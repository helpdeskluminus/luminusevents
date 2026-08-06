-- ============================================================================
-- Self-service signup support
-- ----------------------------------------------------------------------------
-- public.profiles has GRANT INSERT for authenticated but intentionally no
-- INSERT policy (RLS default-denies), so a client can never insert its own
-- profile row directly. That's fine for admin-created staff accounts (the
-- create-staff-user edge function does it server-side with the service-role
-- key), but self-signup needs a profile row to exist too, with no client-side
-- write path required at all.
--
-- Standard Supabase pattern: a SECURITY DEFINER trigger function on
-- auth.users that runs as the function owner (bypassing RLS entirely, not
-- via a policy), so no new INSERT policy is needed and nothing client-facing
-- changes.
--
-- Signing up grants no role by itself — a fresh profiles row is not matched
-- by any public.user_roles row, so RequireRole / StaffHome already show the
-- "no role assigned" / pending screen until an admin approves the account
-- via the create-staff-user edge function's new 'approve' action.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1), 'Staff'),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
