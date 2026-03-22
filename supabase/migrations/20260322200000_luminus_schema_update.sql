-- ============================================================================
-- LUMINUS EVENTS - TRACKS AND REVENUE SCHEMA UPDATE
-- ============================================================================
-- 
-- COPY ALL CONTENT BELOW AND RUN IN SUPABASE SQL EDITOR
-- This will:
-- 1. Add registration_fee to events
-- 2. Create tracks table
-- 3. Update participants with USN, College, Track, and Payment Status
-- 4. Enable RLS and create policies for tracks
--
-- ============================================================================

-- 1. Update events table
ALTER TABLE public.events
ADD COLUMN IF NOT EXISTS registration_fee numeric DEFAULT 0;

-- 2. Create tracks table
CREATE TABLE IF NOT EXISTS public.tracks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

-- 3. Update participants table
ALTER TABLE public.participants
ADD COLUMN IF NOT EXISTS usn text,
ADD COLUMN IF NOT EXISTS college text,
ADD COLUMN IF NOT EXISTS track_id uuid REFERENCES public.tracks(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS amount_paid numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'PENDING';

-- 4. Set up RLS for tracks
ALTER TABLE public.tracks ENABLE ROW LEVEL SECURITY;

-- Allow read access to authenticated users
CREATE POLICY "Enable read access for authenticated users on tracks"
ON public.tracks FOR SELECT
TO authenticated
USING (true);

-- Allow all operations for admins on tracks
CREATE POLICY "Enable all access for admins on tracks"
ON public.tracks FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid() AND users.role = 'admin'
  )
);
