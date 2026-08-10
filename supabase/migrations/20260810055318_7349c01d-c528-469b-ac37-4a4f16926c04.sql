ALTER TABLE public.competitions
  ADD COLUMN IF NOT EXISTS session_type text NOT NULL DEFAULT 'competition',
  ADD COLUMN IF NOT EXISTS type_label text;

ALTER TABLE public.registrations
  ADD COLUMN IF NOT EXISTS currently_inside boolean NOT NULL DEFAULT false;