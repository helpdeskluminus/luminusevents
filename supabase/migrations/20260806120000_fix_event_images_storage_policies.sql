-- ============================================================================
-- FIX: leftover permissive storage policies on the event-images bucket
-- ----------------------------------------------------------------------------
-- Migrations 20251020122841 and 20251020122859 created:
--   "Event images upload (authenticated)"  -- WITH CHECK (bucket_id = 'event-images')
--   "Event images update (authenticated)"  -- USING/WITH CHECK (bucket_id = 'event-images')
-- with no restriction beyond "you're logged in". A later migration
-- (20251022111522) added stricter admin-or-own-folder policies, but never
-- dropped these two. Postgres RLS OR's all applicable permissive policies
-- together, so the loose ones were still silently winning: any authenticated
-- staff account (including a scoped event_oc account) could overwrite ANY
-- file in the public bucket, including other competitions' posters or
-- another registration's QR code image.
--
-- This migration removes the loose policies. The stricter ones created in
-- 20251022111522 ("Users can upload event images" / "Users can update event
-- images" / "Users can delete event images") remain in force: admins can
-- write anywhere in the bucket, everyone else only inside their own
-- auth.uid()-named folder.
-- ============================================================================

DROP POLICY IF EXISTS "Event images upload (authenticated)" ON storage.objects;
DROP POLICY IF EXISTS "Event images update (authenticated)" ON storage.objects;

-- Belt-and-suspenders: the QR ticket PNGs written by the send-ticket-email
-- edge function go through the service_role key, which bypasses RLS
-- entirely, so tightening the authenticated-role policies above does not
-- affect ticket delivery.
