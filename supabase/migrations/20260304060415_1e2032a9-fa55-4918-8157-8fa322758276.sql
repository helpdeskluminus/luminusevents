
-- Drop existing tables and functions
DROP TABLE IF EXISTS public.event_registrations CASCADE;
DROP TABLE IF EXISTS public.user_roles CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;
DROP TABLE IF EXISTS public.events CASCADE;
DROP FUNCTION IF EXISTS public.has_role CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user CASCADE;
DROP FUNCTION IF EXISTS public.update_updated_at_column CASCADE;
DROP TYPE IF EXISTS public.app_role CASCADE;

-- ========================
-- EVENTS TABLE (created first for FK reference)
-- ========================
CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  date timestamptz NOT NULL,
  location text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- ========================
-- USERS TABLE (Organizing Team Only)
-- ========================
CREATE TABLE public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  role text NOT NULL DEFAULT 'coordinator' CHECK (role IN ('admin', 'coordinator')),
  assigned_event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  approval_status text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz DEFAULT now()
);

-- ========================
-- PARTICIPANTS TABLE
-- ========================
CREATE TABLE public.participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text,
  phone text,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  qr_token text UNIQUE NOT NULL,
  checked_in boolean DEFAULT false,
  checked_in_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_participants_event_id ON public.participants(event_id);
CREATE INDEX idx_participants_qr_token ON public.participants(qr_token);

-- ========================
-- ENABLE RLS
-- ========================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;

-- ========================
-- SECURITY DEFINER FUNCTIONS (prevent recursive RLS)
-- ========================
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT role FROM public.users WHERE id = _user_id $$;

CREATE OR REPLACE FUNCTION public.get_user_assigned_event(_user_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT assigned_event_id FROM public.users WHERE id = _user_id $$;

CREATE OR REPLACE FUNCTION public.get_user_approval_status(_user_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT approval_status FROM public.users WHERE id = _user_id $$;

-- ========================
-- USERS POLICIES
-- ========================
CREATE POLICY "Users can view own profile" ON public.users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Admin can view all users" ON public.users FOR SELECT USING (public.get_user_role(auth.uid()) = 'admin');
CREATE POLICY "Users can insert own profile" ON public.users FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Admin can update users" ON public.users FOR UPDATE USING (public.get_user_role(auth.uid()) = 'admin');

-- ========================
-- EVENTS POLICIES
-- ========================
CREATE POLICY "Admin insert events" ON public.events FOR INSERT WITH CHECK (public.get_user_role(auth.uid()) = 'admin');
CREATE POLICY "Admin select events" ON public.events FOR SELECT USING (public.get_user_role(auth.uid()) = 'admin');
CREATE POLICY "Admin update events" ON public.events FOR UPDATE USING (public.get_user_role(auth.uid()) = 'admin');
CREATE POLICY "Admin delete events" ON public.events FOR DELETE USING (public.get_user_role(auth.uid()) = 'admin');
CREATE POLICY "Coordinator view assigned event" ON public.events FOR SELECT USING (id = public.get_user_assigned_event(auth.uid()));

-- ========================
-- PARTICIPANTS POLICIES
-- ========================
CREATE POLICY "Admin insert participants" ON public.participants FOR INSERT WITH CHECK (public.get_user_role(auth.uid()) = 'admin');
CREATE POLICY "Admin select participants" ON public.participants FOR SELECT USING (public.get_user_role(auth.uid()) = 'admin');
CREATE POLICY "Admin update participants" ON public.participants FOR UPDATE USING (public.get_user_role(auth.uid()) = 'admin');
CREATE POLICY "Admin delete participants" ON public.participants FOR DELETE USING (public.get_user_role(auth.uid()) = 'admin');
CREATE POLICY "Coordinator select assigned participants" ON public.participants FOR SELECT USING (event_id = public.get_user_assigned_event(auth.uid()));
CREATE POLICY "Coordinator update checkin" ON public.participants FOR UPDATE USING (event_id = public.get_user_assigned_event(auth.uid()));

-- ========================
-- REALTIME
-- ========================
ALTER PUBLICATION supabase_realtime ADD TABLE public.participants;

-- ========================
-- QR CHECK-IN FUNCTION (race condition safe)
-- ========================
CREATE OR REPLACE FUNCTION public.checkin_participant(_participant_id uuid, _event_id uuid, _qr_token text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  result json;
  affected int;
BEGIN
  UPDATE public.participants
  SET checked_in = true, checked_in_at = now()
  WHERE id = _participant_id AND event_id = _event_id AND qr_token = _qr_token AND checked_in = false;
  
  GET DIAGNOSTICS affected = ROW_COUNT;
  
  IF affected = 0 THEN
    IF NOT EXISTS (SELECT 1 FROM public.participants WHERE id = _participant_id AND event_id = _event_id AND qr_token = _qr_token) THEN
      result := json_build_object('success', false, 'error', 'Invalid QR code');
    ELSE
      result := json_build_object('success', false, 'error', 'Already checked in');
    END IF;
  ELSE
    SELECT json_build_object('success', true, 'name', p.name, 'email', p.email)
    INTO result FROM public.participants p WHERE p.id = _participant_id;
  END IF;
  
  RETURN result;
END;
$$;
