-- ========================
-- CRITICAL FIX: AUTO-CREATE USER RECORDS ON AUTH SIGNUP
-- ========================
-- This trigger ensures that whenever a user is created in auth.users,
-- a corresponding record is automatically created in public.users.
-- This removes the dependency on frontend code succeeding.

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

-- Create the trigger function with SECURITY DEFINER to bypass RLS
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, full_name, role, approval_status)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'New User'),
    'coordinator',
    'pending'
  )
  ON CONFLICT (id) DO NOTHING;
  
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Log any errors but don't fail the auth operation
  RAISE WARNING 'Error in handle_new_user: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- Attach the trigger to auth.users table
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

-- ========================
-- VERIFICATION HELPER (Run after testing)
-- ========================
-- Use these queries to verify everything is working:
-- SELECT 'Auth users:' as check_, COUNT(*) as count FROM auth.users;
-- SELECT 'Public users:' as check_, COUNT(*) as count FROM public.users;
-- SELECT id, email FROM auth.users;
-- SELECT id, full_name, role, approval_status FROM public.users;
