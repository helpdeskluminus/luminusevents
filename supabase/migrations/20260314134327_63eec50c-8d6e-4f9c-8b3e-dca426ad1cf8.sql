
-- Create checkins table for scan history logging
CREATE TABLE public.checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES public.participants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  scanned_by uuid NOT NULL,
  scanned_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.checkins ENABLE ROW LEVEL SECURITY;

-- Admins can view all checkins
CREATE POLICY "admin_select_checkins" ON public.checkins
  FOR SELECT TO authenticated
  USING (get_user_role(auth.uid()) = 'admin');

-- Coordinators can view checkins for their assigned event
CREATE POLICY "coord_select_checkins" ON public.checkins
  FOR SELECT TO authenticated
  USING (event_id = get_user_assigned_event(auth.uid()));

-- Coordinators can insert checkins for their assigned event
CREATE POLICY "coord_insert_checkins" ON public.checkins
  FOR INSERT TO authenticated
  WITH CHECK (event_id = get_user_assigned_event(auth.uid()));

-- Admins can insert checkins
CREATE POLICY "admin_insert_checkins" ON public.checkins
  FOR INSERT TO authenticated
  WITH CHECK (get_user_role(auth.uid()) = 'admin');

-- Enable realtime for checkins
ALTER PUBLICATION supabase_realtime ADD TABLE public.checkins;
