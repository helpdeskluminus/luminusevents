ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS position text;
COMMENT ON COLUMN public.profiles.position IS 'Display-only title/Position of Responsibility (e.g. "Head of Logistics"). No bearing on RLS or role checks.';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1), 'Staff'),
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS max_gate_scans integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.events.max_gate_scans IS 'Max times a ticket may be scanned at the main gate. 0 = unlimited (default, matches pre-existing behaviour).';

ALTER TABLE public.competitions ADD COLUMN IF NOT EXISTS max_venue_scans integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.competitions.max_venue_scans IS 'Max times a ticket may be scanned at this competition''s venue entrance. 0 = unlimited.';

CREATE TABLE IF NOT EXISTS public.email_broadcasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  body text NOT NULL,
  audience_type text NOT NULL CHECK (audience_type IN ('all_participants', 'competition_participants', 'all_staff', 'custom')),
  competition_id uuid REFERENCES public.competitions(id) ON DELETE SET NULL,
  recipient_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  sent_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'partial', 'failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.email_broadcasts TO authenticated;
GRANT ALL ON public.email_broadcasts TO service_role;
ALTER TABLE public.email_broadcasts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_broadcasts_admin_select ON public.email_broadcasts;
CREATE POLICY email_broadcasts_admin_select ON public.email_broadcasts
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Event images upload (authenticated)" ON storage.objects;
DROP POLICY IF EXISTS "Event images update (authenticated)" ON storage.objects;

DROP POLICY IF EXISTS event_images_public_read ON storage.objects;
CREATE POLICY event_images_public_read ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'event-images');

DROP POLICY IF EXISTS event_images_admin_write ON storage.objects;
CREATE POLICY event_images_admin_write ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'event-images' AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS event_images_admin_update ON storage.objects;
CREATE POLICY event_images_admin_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'event-images' AND public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS event_images_admin_delete ON storage.objects;
CREATE POLICY event_images_admin_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'event-images' AND public.has_role(auth.uid(), 'admin'));