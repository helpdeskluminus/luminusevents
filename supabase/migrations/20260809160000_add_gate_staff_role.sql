-- Adding an enum value must be its own migration/transaction - Postgres does
-- not allow a newly added enum value to be referenced in the same transaction
-- that added it. The next migration (…_gate_staff_exit_scans_rate_limit.sql)
-- is what actually uses 'gate_staff' in policies.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'gate_staff';
