-- Migration 0007: Fix pgcrypto search_path in trucker password functions.
--
-- Background: trucker_set_password() and trucker_verify_password() both use
-- crypt() and gen_salt() from the pgcrypto extension. In Supabase, pgcrypto
-- is installed in the 'extensions' schema, not 'public'. The original 0006
-- migration set search_path to 'public', 'pg_temp' only — so calls like
-- gen_salt('bf', 10) failed with:
--   "function gen_salt(unknown, integer) does not exist"
--
-- Fix: add 'extensions' to the search_path on both functions. Using ALTER
-- FUNCTION ... SET search_path keeps the function bodies untouched.
--
-- Idempotent: ALTER FUNCTION ... SET is safe to re-run.

ALTER FUNCTION public.trucker_set_password(text, text)
  SET search_path TO 'public', 'extensions', 'pg_temp';

ALTER FUNCTION public.trucker_verify_password(text, text)
  SET search_path TO 'public', 'extensions', 'pg_temp';
