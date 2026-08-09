-- ============================================================================
-- Configurable scan limits + admin broadcast email log
-- ----------------------------------------------------------------------------
-- 1) Scan limits: previously every re-scan of an already-scanned ticket was
--    silently allowed and just flagged is_duplicate=true. That's fine for a
--    "log everything" audit trail, but doesn't let an organiser actually cap
--    entries (e.g. single-entry gate passes, or a competition that allows at
--    most 2 re-entries for a multi-round event). 0 = unlimited, preserving
--    today's behaviour for every existing event/competition by default.
--
-- 2) email_broadcasts: audit log for the admin "send instructions to
--    everyone" feature. All writes happen through the send-broadcast-email
--    edge function (service role) — RLS only grants admins read access, so
--    there is no client-side write path (consistent with checkins/user_roles).
-- ============================================================================

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS max_gate_scans integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.events.max_gate_scans IS
  'Max times a ticket may be scanned at the main gate. 0 = unlimited (default, matches pre-existing behaviour).';

ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS max_venue_scans integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.competitions.max_venue_scans IS
  'Max times a ticket may be scanned at this competition''s venue entrance. 0 = unlimited.';

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

ALTER TABLE public.email_broadcasts ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.email_broadcasts TO authenticated;

CREATE POLICY email_broadcasts_admin_select ON public.email_broadcasts
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- No INSERT/UPDATE/DELETE policy for `authenticated` — every write goes
-- through send-broadcast-email using the service-role key, same pattern as
-- checkins and user_roles.
