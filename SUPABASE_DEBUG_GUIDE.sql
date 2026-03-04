-- ============================================================================
--                    LUMINUS EVENTS - SUPABASE BACKEND FIXES
-- ============================================================================
--
-- ISSUES RESOLVED:
-- 1. ✓ User signup working but no record created in public.users
-- 2. ✓ Missing automatic trigger to create records
-- 3. ✓ RLS policies configured properly
-- 4. ✓ Enhanced error logging in frontend
--
-- ============================================================================
--                          RUN THESE QUERIES IN SUPABASE
-- ============================================================================
--
-- STEP 1: VERIFY TABLE STRUCTURE
-- ============================================================================
SELECT 
  tablename,
  tableowner
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- Expected tables:
-- - public.events
-- - public.participants  
-- - public.users
-- - public.profiles (if exists, can be dropped)

-- ============================================================================
-- STEP 2: CHECK CURRENT USERS
-- ============================================================================

-- View all auth users (Authentication tab shows this)
SELECT id, email, created_at FROM auth.users;

-- View all public users created so far
SELECT id, full_name, role, approval_status, created_at FROM public.users;

-- Find mismatches (auth users NOT in public.users)
SELECT 
  au.id,
  au.email,
  pu.id as public_user_id,
  CASE WHEN pu.id IS NULL THEN 'MISSING' ELSE 'EXISTS' END as status
FROM auth.users au
LEFT JOIN public.users pu ON au.id = pu.id
ORDER BY au.created_at DESC;

-- ============================================================================
-- STEP 3: VERIFY TRIGGER EXISTS
-- ============================================================================

-- Check if trigger is installed
SELECT 
  t.tgname as trigger_name,
  t.tgenabled as enabled,
  p.proname as function_name
FROM pg_trigger t
LEFT JOIN pg_proc p ON t.tgfoid = p.oid
WHERE t.tgrelid = 'auth.users'::regclass;

-- Expected: trigger named "on_auth_user_created" with function "handle_new_user"

-- ============================================================================
-- STEP 4: VERIFY RLS POLICIES
-- ============================================================================

-- Check RLS is enabled on public.users
SELECT tablename, rowsecurity FROM pg_tables 
WHERE schemaname = 'public' AND tablename = 'users';

-- Expected: rowsecurity = true

-- List all policies on public.users
SELECT policyname, permissive, cmd FROM pg_policies 
WHERE schemaname = 'public' AND tablename = 'users'
ORDER BY policyname;

-- Expected policies:
-- - "Users can view own profile" (SELECT)
-- - "Admin can view all users" (SELECT)
-- - "Users can insert own profile" (INSERT)
-- - "Admin can update users" (UPDATE)

-- ============================================================================
-- STEP 5: TEST THE TRIGGER (After creating a new auth user manually)
-- ============================================================================

-- After signup via Gmail or manually creating an auth user:
-- 1. Check auth.users immediately
SELECT * FROM auth.users WHERE email = 'test@example.com' ORDER BY created_at DESC LIMIT 1;

-- 2. Check if public.users has matching record (trigger should have created it)
SELECT * FROM public.users WHERE id = (
  SELECT id FROM auth.users WHERE email = 'test@example.com' ORDER BY created_at DESC LIMIT 1
);

-- If trigger worked: You'll see the record with role='coordinator', approval_status='pending'

-- ============================================================================
-- STEP 6: APPROVE ADMIN USER (Replace with your Gmail)
-- ============================================================================

-- IMPORTANT: Run this with YOUR Gmail address
UPDATE public.users
SET role = 'admin',
    approval_status = 'approved'
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'your-email@gmail.com'
);

-- Verify the update
SELECT id, email, role, approval_status FROM auth.users 
INNER JOIN public.users pu ON auth.users.id = pu.id
WHERE auth.users.email = 'your-email@gmail.com';

-- ============================================================================
-- STEP 7: DIAGNOSE RLS ISSUES
-- ============================================================================

-- If you get "null" or empty results, RLS policy may be blocking:

-- Try as admin (assuming you have one):
-- This checks if the user role function works
SELECT public.get_user_role('YOUR_USER_ID_UUID_HERE'::uuid);
-- Expected: 'admin' or 'coordinator'

-- ============================================================================
-- STEP 8: FINAL VERIFICATION CHECKLIST
-- ============================================================================

-- All-in-one verification query:
SELECT 
  'Auth Users Count' as check_name,
  COUNT(*)::text as result
FROM auth.users
UNION ALL
SELECT 
  'Public Users Count',
  COUNT(*)::text
FROM public.users
UNION ALL
SELECT 
  'Trigger Exists',
  CASE WHEN EXISTS(SELECT 1 FROM pg_trigger WHERE tgname = 'on_auth_user_created') 
    THEN 'YES' ELSE 'NO' END
UNION ALL
SELECT 
  'RLS Enabled on users',
  CASE WHEN EXISTS(SELECT 1 FROM pg_tables WHERE tablename = 'users' AND rowsecurity = true)
    THEN 'YES' ELSE 'NO' END;

-- ============================================================================
--                          FRONTEND VERIFICATION
-- ============================================================================
--
-- 1. Open browser DevTools (F12)
-- 2. Go to Console tab
-- 3. Sign up with a new user
-- 4. Look for logs like:
--    - "=== SIGNUP PROCESS STARTED ==="
--    - "Auth user created: {...}"
--    - "Auth user ID (UUID): xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
--    - "✓ User record verified in public.users"
--
-- If you see:
--    - "⚠ User record NOT found in public.users"
--      → Check trigger in Supabase SQL Editor
--      → Check RLS policies
--      → Check browser console for specific errors
--
-- ============================================================================
--                          RESET IF NEEDED
-- ============================================================================
--
-- NEVER RUN UNLESS YOU WANT TO DELETE EVERYTHING:
/*
DELETE FROM public.participants CASCADE;
DELETE FROM public.users CASCADE;
DELETE FROM public.events CASCADE;
*/
--
-- ============================================================================
