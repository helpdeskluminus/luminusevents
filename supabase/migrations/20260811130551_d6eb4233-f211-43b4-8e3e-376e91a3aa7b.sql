ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS currently_inside boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_entry_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_exit_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_exit_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_registrations_currently_inside
  ON public.registrations(currently_inside) WHERE currently_inside;

COMMENT ON COLUMN public.registrations.currently_inside IS
  'True from a successful main-gate entry scan until gate staff mark the ticket exited. Drives live occupancy = count(currently_inside).';

CREATE TABLE IF NOT EXISTS public.registration_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_registration_attempts_ip_time
  ON public.registration_attempts(ip_hash, created_at DESC);

ALTER TABLE public.registration_attempts ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.registration_attempts TO service_role;

DROP POLICY IF EXISTS checkins_staff_select ON public.checkins;
CREATE POLICY checkins_staff_select ON public.checkins FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR ((public.has_role(auth.uid(), 'disciplinary') OR public.has_role(auth.uid(), 'gate_staff')) AND checkin_type = 'main_gate')
    OR competition_id = public.get_user_competition(auth.uid())
  );

DROP POLICY IF EXISTS registrations_staff_select ON public.registrations;
CREATE POLICY registrations_staff_select ON public.registrations FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'disciplinary')
    OR public.has_role(auth.uid(), 'gate_staff')
    OR competition_id = public.get_user_competition(auth.uid())
  );

DROP POLICY IF EXISTS participants_staff_select ON public.participants;
CREATE POLICY participants_staff_select ON public.participants FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'disciplinary')
    OR public.has_role(auth.uid(), 'gate_staff')
    OR EXISTS (
      SELECT 1 FROM public.registrations r
      WHERE r.participant_id = participants.id
        AND r.competition_id = public.get_user_competition(auth.uid())
    )
  );

DELETE FROM public.participants a
USING public.participants b
WHERE lower(a.email) = lower(b.email)
  AND a.created_at > b.created_at
  AND NOT EXISTS (SELECT 1 FROM public.registrations r WHERE r.participant_id = a.id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_participants_email_lower
  ON public.participants (lower(email));