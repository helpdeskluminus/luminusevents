-- ============================================================================
-- APPROVE koushikr955@gmail.com AS ADMIN
-- ============================================================================
-- Run this in Supabase Dashboard → SQL Editor

-- Step 1: Approve the user
UPDATE public.users
SET role = 'admin',
    approval_status = 'approved'
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'koushikr955@gmail.com'
);

-- Step 2: Verify the update (run this after Step 1)
SELECT 
  au.id,
  au.email,
  pu.role,
  pu.approval_status,
  pu.created_at
FROM auth.users au
INNER JOIN public.users pu ON au.id = pu.id
WHERE au.email = 'koushikr955@gmail.com';

-- Expected output:
-- id: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
-- email: koushikr955@gmail.com
-- role: admin
-- approval_status: approved
-- created_at: 2026-03-04...
