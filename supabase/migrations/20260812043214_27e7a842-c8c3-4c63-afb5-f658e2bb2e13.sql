DELETE FROM public.checkins WHERE registration_id IN (
  SELECT r.id FROM public.registrations r JOIN public.participants p ON p.id = r.participant_id
  WHERE lower(p.email) IN ('flowtest1@example.com','flowtest2@example.com','bulk1@example.com','single1@example.com')
);
DELETE FROM public.registrations WHERE participant_id IN (
  SELECT id FROM public.participants WHERE lower(email) IN ('flowtest1@example.com','flowtest2@example.com','bulk1@example.com','single1@example.com')
);
DELETE FROM public.participants WHERE lower(email) IN ('flowtest1@example.com','flowtest2@example.com','bulk1@example.com','single1@example.com');