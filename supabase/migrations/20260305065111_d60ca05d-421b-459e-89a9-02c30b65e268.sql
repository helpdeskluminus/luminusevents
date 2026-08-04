
-- Fix: Drop all RESTRICTIVE policies and recreate as PERMISSIVE

-- USERS
DROP POLICY IF EXISTS "Users can view own profile" ON public.users;
DROP POLICY IF EXISTS "Admin can view all users" ON public.users;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;
DROP POLICY IF EXISTS "Admin can update users" ON public.users;

CREATE POLICY "users_select_own" ON public.users FOR SELECT TO authenticated
USING (auth.uid() = id);

CREATE POLICY "admin_select_all_users" ON public.users FOR SELECT TO authenticated
USING (public.get_user_role(auth.uid()) = 'admin');

CREATE POLICY "users_insert_own" ON public.users FOR INSERT TO authenticated
WITH CHECK (auth.uid() = id);

CREATE POLICY "admin_update_users" ON public.users FOR UPDATE TO authenticated
USING (public.get_user_role(auth.uid()) = 'admin');

-- EVENTS
DROP POLICY IF EXISTS "Admin select events" ON public.events;
DROP POLICY IF EXISTS "Admin insert events" ON public.events;
DROP POLICY IF EXISTS "Admin update events" ON public.events;
DROP POLICY IF EXISTS "Admin delete events" ON public.events;
DROP POLICY IF EXISTS "Coordinator view assigned event" ON public.events;

CREATE POLICY "admin_select_events" ON public.events FOR SELECT TO authenticated
USING (public.get_user_role(auth.uid()) = 'admin');

CREATE POLICY "admin_insert_events" ON public.events FOR INSERT TO authenticated
WITH CHECK (public.get_user_role(auth.uid()) = 'admin');

CREATE POLICY "admin_update_events" ON public.events FOR UPDATE TO authenticated
USING (public.get_user_role(auth.uid()) = 'admin');

CREATE POLICY "admin_delete_events" ON public.events FOR DELETE TO authenticated
USING (public.get_user_role(auth.uid()) = 'admin');

CREATE POLICY "coord_select_assigned_event" ON public.events FOR SELECT TO authenticated
USING (id = public.get_user_assigned_event(auth.uid()));

-- PARTICIPANTS
DROP POLICY IF EXISTS "Admin select participants" ON public.participants;
DROP POLICY IF EXISTS "Admin insert participants" ON public.participants;
DROP POLICY IF EXISTS "Admin update participants" ON public.participants;
DROP POLICY IF EXISTS "Admin delete participants" ON public.participants;
DROP POLICY IF EXISTS "Coordinator select assigned participants" ON public.participants;
DROP POLICY IF EXISTS "Coordinator update checkin" ON public.participants;

CREATE POLICY "admin_select_participants" ON public.participants FOR SELECT TO authenticated
USING (public.get_user_role(auth.uid()) = 'admin');

CREATE POLICY "admin_insert_participants" ON public.participants FOR INSERT TO authenticated
WITH CHECK (public.get_user_role(auth.uid()) = 'admin');

CREATE POLICY "admin_update_participants" ON public.participants FOR UPDATE TO authenticated
USING (public.get_user_role(auth.uid()) = 'admin');

CREATE POLICY "admin_delete_participants" ON public.participants FOR DELETE TO authenticated
USING (public.get_user_role(auth.uid()) = 'admin');

CREATE POLICY "coord_select_assigned_participants" ON public.participants FOR SELECT TO authenticated
USING (event_id = public.get_user_assigned_event(auth.uid()));

CREATE POLICY "coord_update_checkin" ON public.participants FOR UPDATE TO authenticated
USING (event_id = public.get_user_assigned_event(auth.uid()));

-- Recreate the trigger (it's missing)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

-- Approve koushikr955@gmail.com as admin
UPDATE public.users
SET role = 'admin', approval_status = 'approved'
WHERE id = (SELECT id FROM auth.users WHERE email = 'koushikr955@gmail.com');
