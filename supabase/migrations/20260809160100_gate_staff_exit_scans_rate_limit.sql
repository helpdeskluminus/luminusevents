-- ============================================================================
-- Gate staff role, exit scans / real occupancy, and registration rate limiting
-- ----------------------------------------------------------------------------
-- 1) gate_staff: a role scoped to main-gate scanning only, so a device at the
--    door doesn't need to carry full admin/disciplinary privileges. Deliberately
--    NOT per-checkpoint (that's what event_oc already is, scoped by
--    competition_id) - gate_staff always means "main gate only", matching how
--    scan-ticket already separates mode: 'gate' vs mode: 'venue'.
--
-- 2) Occupancy: previously "people inside" was a cumulative count of main-gate
--    checkins with is_duplicate = false, so there was no way to decrement it as
--    people left. We now track live inside/outside state directly on
--    registrations (one row per ticket), flipped by the *scanning staff*
--    marking someone as exited - not a second QR scan. Real occupancy is
--    `count(*) where currently_inside`.
--
-- 3) registration_attempts: lightweight IP-based rate limiting for the public,
--    unauthenticated register-participant endpoint. Stores a salted hash of
--    the client IP, never the raw address.
-- ============================================================================

-- ---- 1) gate_staff role ----
-- Added in the prior migration (20260809160000_add_gate_staff_role.sql) - see
-- that file for why it has to be a separate transaction.

-- ---- 2) Occupancy / exit tracking ----
ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS currently_inside boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_entry_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_exit_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_exit_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_registrations_currently_inside
  ON public.registrations(currently_inside) WHERE currently_inside;

COMMENT ON COLUMN public.registrations.currently_inside IS
  'True from a successful main-gate entry scan until gate staff mark the ticket exited. Drives live occupancy = count(currently_inside).';

-- ---- 3) Rate limiting for public registration ----
CREATE TABLE IF NOT EXISTS public.registration_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_registration_attempts_ip_time
  ON public.registration_attempts(ip_hash, created_at DESC);

ALTER TABLE public.registration_attempts ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.registration_attempts TO service_role;
-- No policies for `authenticated`/`anon` - only the register-participant edge
-- function (service role) ever reads or writes this table.

-- Prune old attempt rows automatically isn't essential (table stays small -
-- one row per registration attempt), but keep queries fast regardless via the
-- index above. Rows older than a day are irrelevant to any rate window we use.

-- ---- Policy updates: gate_staff behaves like disciplinary at the main gate ----
DROP POLICY IF EXISTS checkins_staff_select ON public.checkins;
CREATE POLICY checkins_staff_select ON public.checkins FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR ((public.has_role(auth.uid(), 'disciplinary') OR public.has_role(auth.uid(), 'gate_staff')) AND checkin_type = 'main_gate')
    OR competition_id = public.get_user_competition(auth.uid())
  );

-- registrations already has a staff_select policy scoped to admin/disciplinary/
-- own-competition event_oc. gate_staff needs to see registrations too, to mark
-- exits and look up who's currently inside at the gate.
DROP POLICY IF EXISTS registrations_staff_select ON public.registrations;
CREATE POLICY registrations_staff_select ON public.registrations FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'disciplinary')
    OR public.has_role(auth.uid(), 'gate_staff')
    OR competition_id = public.get_user_competition(auth.uid())
  );
