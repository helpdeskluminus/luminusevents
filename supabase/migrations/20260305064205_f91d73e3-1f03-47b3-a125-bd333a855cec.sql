
-- Drop existing users policies
DROP POLICY IF EXISTS "Users can view own profile" ON public.users;
DROP POLICY IF EXISTS "Admin can view all users" ON public.users;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;
DROP POLICY IF EXISTS "Admin can update users" ON public.users;

-- Drop existing events policies
DROP POLICY IF EXISTS "Admin insert events" ON public.events;
DROP POLICY IF EXISTS "Admin select events" ON public.events;
DROP POLICY IF EXISTS "Admin update events" ON public.events;
DROP POLICY IF EXISTS "Admin delete events" ON public.events;
DROP POLICY IF EXISTS "Coordinator view assigned event" ON public.events;

-- Drop existing participants policies
DROP POLICY IF EXISTS "Admin insert participants" ON public.participants;
DROP POLICY IF EXISTS "Admin select participants" ON public.participants;
DROP POLICY IF EXISTS "Admin update participants" ON public.participants;
DROP POLICY IF EXISTS "Admin delete participants" ON public.participants;
DROP POLICY IF EXISTS "Coordinator select assigned participants" ON public.participants;
DROP POLICY IF EXISTS "Coordinator update checkin" ON public.participants;

-- USERS TABLE - PERMISSIVE policies
CREATE POLICY "Users can view own profile"
ON public.users FOR SELECT TO authenticated
USING (auth.uid() = id);

CREATE POLICY "Admin can view all users"
ON public.users FOR SELECT TO authenticated
USING (public.get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Users can insert own profile"
ON public.users FOR INSERT TO authenticated
WITH CHECK (auth.uid() = id);

CREATE POLICY "Admin can update users"
ON public.users FOR UPDATE TO authenticated
USING (public.get_user_role(auth.uid()) = 'admin');

-- EVENTS TABLE - PERMISSIVE policies
CREATE POLICY "Admin select events"
ON public.events FOR SELECT TO authenticated
USING (public.get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Admin insert events"
ON public.events FOR INSERT TO authenticated
WITH CHECK (public.get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Admin update events"
ON public.events FOR UPDATE TO authenticated
USING (public.get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Admin delete events"
ON public.events FOR DELETE TO authenticated
USING (public.get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Coordinator view assigned event"
ON public.events FOR SELECT TO authenticated
USING (id = public.get_user_assigned_event(auth.uid()));

-- PARTICIPANTS TABLE - PERMISSIVE policies
CREATE POLICY "Admin select participants"
ON public.participants FOR SELECT TO authenticated
USING (public.get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Admin insert participants"
ON public.participants FOR INSERT TO authenticated
WITH CHECK (public.get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Admin update participants"
ON public.participants FOR UPDATE TO authenticated
USING (public.get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Admin delete participants"
ON public.participants FOR DELETE TO authenticated
USING (public.get_user_role(auth.uid()) = 'admin');

CREATE POLICY "Coordinator select assigned participants"
ON public.participants FOR SELECT TO authenticated
USING (event_id = public.get_user_assigned_event(auth.uid()));

CREATE POLICY "Coordinator update checkin"
ON public.participants FOR UPDATE TO authenticated
USING (event_id = public.get_user_assigned_event(auth.uid()));

-- TRIGGER: Auto-create user record on signup
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();
