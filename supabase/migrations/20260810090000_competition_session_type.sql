-- Not every "competition" row is actually a competition - some are webinars,
-- workshops, or something else entirely. Add a type so the UI and ticket
-- email can label/word things correctly instead of always saying
-- "competition". Table/column names elsewhere (competition_id, competitions,
-- event_oc scoped "to their competition", etc.) are left as-is deliberately -
-- renaming them is a much bigger, separate refactor and doesn't change any
-- behaviour; this migration only adds a display-layer field.

ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS session_type text NOT NULL DEFAULT 'competition',
  ADD COLUMN IF NOT EXISTS type_label text;

ALTER TABLE public.competitions
  ADD CONSTRAINT competitions_session_type_check
  CHECK (session_type IN ('competition', 'webinar', 'workshop', 'other'));

COMMENT ON COLUMN public.competitions.session_type IS
  'What kind of session this is - drives labelling in the UI and ticket email. Entry/check-in mechanics (QR at gate + venue) are identical for every type.';
COMMENT ON COLUMN public.competitions.type_label IS
  'Custom display label, used when session_type = ''other'' (e.g. "Panel Discussion", "Hackathon Kickoff"). Ignored for the other types, which use a fixed label.';
