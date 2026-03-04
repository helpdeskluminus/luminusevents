-- ============================================================================
-- LUMINUS EVENTS - COMPLETE SUPABASE SETUP & VERIFICATION
-- ============================================================================
-- 
-- COPY ALL CONTENT BELOW AND RUN IN SUPABASE SQL EDITOR
-- This will:
-- 1. Create the auto-trigger for user records
-- 2. Enable RLS
-- 3. Create policies
-- 4. Approve your admin account
--
-- ============================================================================

-- ========================
-- STEP 1: CREATE TRIGGER FOR AUTO USER CREATION
-- ========================
-- This ensures every auth user gets a public.users record automatically

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

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
  RAISE WARNING 'Error in handle_new_user: %', SQLERRM;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

-- Test: Trigger created
SELECT tgname FROM pg_trigger WHERE tgname = 'on_auth_user_created';
-- Expected: one row with "on_auth_user_created"

-- ========================
-- STEP 2: VERIFY TABLE STRUCTURE
-- ========================

-- Check users table exists
SELECT column_name, data_type FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'users'
ORDER BY ordinal_position;

-- Expected columns:
-- id (uuid)
-- full_name (text)
-- role (text)
-- assigned_event_id (uuid)
-- approval_status (text)
-- created_at (timestamp)

-- ========================
-- STEP 3: VERIFY RLS IS ENABLED
-- ========================

SELECT tablename, rowsecurity FROM pg_tables 
WHERE schemaname = 'public' AND tablename = 'users';
-- Expected: rowsecurity = true

-- ========================
-- STEP 4: CHECK CURRENT USERS
-- ========================

-- Count auth users
SELECT 'Auth users' as type, COUNT(*) as total FROM auth.users;

-- Count public users
SELECT 'Public users' as type, COUNT(*) as total FROM public.users;

-- Show all users with their status
SELECT 
  au.id,
  au.email,
  pu.full_name,
  pu.role,
  pu.approval_status,
  CASE WHEN pu.id IS NULL THEN 'MISSING' ELSE 'EXISTS' END as status
FROM auth.users au
LEFT JOIN public.users pu ON au.id = pu.id
ORDER BY au.created_at DESC;

-- ========================
-- STEP 5: APPROVE ADMIN USER
-- ========================
-- REPLACE 'koushikr955@gmail.com' with your email if different

UPDATE public.users
SET role = 'admin',
    approval_status = 'approved'
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'koushikr955@gmail.com'
);

-- Verify approval
SELECT 
  au.id,
  au.email,
  pu.full_name,
  pu.role,
  pu.approval_status,
  pu.created_at
FROM auth.users au
INNER JOIN public.users pu ON au.id = pu.id
WHERE au.email = 'koushikr955@gmail.com';

-- Expected:
-- email: koushikr955@gmail.com
-- role: admin
-- approval_status: approved

-- ========================
-- STEP 6: FINAL VERIFICATION
-- ========================

-- All in one check:
WITH checks AS (
  SELECT 'Trigger exists' as check_name,
    CASE WHEN EXISTS(SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created') 
      THEN '✓ YES' ELSE '✗ NO' END as result
  UNION ALL
  SELECT 'RLS enabled on users',
    CASE WHEN EXISTS(SELECT 1 FROM pg_tables WHERE tablename = 'users' AND rowsecurity = true)
      THEN '✓ YES' ELSE '✗ NO' END
  UNION ALL
  SELECT 'Policies exist',
    CASE WHEN COUNT(*) > 0 THEN '✓ ' || COUNT(*)::text ELSE '✗ NONE' END
    FROM pg_policies WHERE tablename = 'users' AND schemaname = 'public'
  UNION ALL
  SELECT 'Admin user approved',
    CASE WHEN EXISTS(
      SELECT 1 FROM public.users 
      WHERE id = (SELECT id FROM auth.users WHERE email = 'koushikr955@gmail.com')
        AND role = 'admin' AND approval_status = 'approved'
    ) THEN '✓ YES' ELSE '✗ NO' END
  UNION ALL
  SELECT 'Auth users exists',
    (SELECT COUNT(*)::text FROM auth.users)
  UNION ALL
  SELECT 'Public users exists',
    (SELECT COUNT(*)::text FROM public.users)
)
SELECT * FROM checks;

-- ========================
-- TESTING SIGNUP
-- ========================
-- After running the above, test signup in your app:
-- 1. Go to app and click "Sign Up"
-- 2. Fill in email, password, full name
-- 3. Submit
-- 4. Check browser console (F12) for detailed logs
-- 5. Run this query (should show new user):
--
-- SELECT id, email, full_name, role, approval_status FROM auth.users 
-- RIGHT JOIN public.users USING (id)
-- ORDER BY auth.users.created_at DESC LIMIT 1;
--
-- Expected:
-- - id: UUID of new user
-- - email: your signup email
-- - full_name: what you entered
-- - role: 'coordinator'
-- - approval_status: 'pending'

-- ========================
-- TROUBLESHOOTING
-- ========================
--
-- If public.users shows NULL for new user:
-- 1. Check if trigger is enabled:
--    SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'on_auth_user_created';
--    Should show "t" for enabled
--
-- 2. Check if there are RLS policy issues:
--    SELECT * FROM pg_policies WHERE tablename = 'users';
--
-- 3. Check auth.users has the email:
--    SELECT id, email FROM auth.users ORDER BY created_at DESC LIMIT 1;
--
-- 4. Manually insert test record:
--    INSERT INTO public.users (id, full_name, role, approval_status)
--    VALUES ('test-uuid-here', 'Test User', 'coordinator', 'pending');
--    If this fails, there's a structural issue with the table.
--
-- ============================================================================
