-- ============================================================================
-- Add a display-only "Position of Responsibility" title to staff profiles.
-- Purely cosmetic (e.g. "Head of Logistics", "Sponsorship Lead") — it does
-- NOT affect access control. Permissions still come entirely from
-- public.user_roles / has_role() / get_user_competition(), unchanged.
-- ============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS position text;

COMMENT ON COLUMN public.profiles.position IS
  'Display-only title/Position of Responsibility (e.g. "Head of Logistics"). No bearing on RLS or role checks.';
