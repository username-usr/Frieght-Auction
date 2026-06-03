-- =============================================================================
-- Migration 0017: Post-award shipment details + trucker secondary phone.
--
-- Operational data captured by the operator AFTER a load is awarded and
-- BEFORE it's marked completed. None of these gate the lifecycle — they're
-- for record-keeping and downstream reference. The user explicitly opted
-- out of audit-log changes for this migration, so record_audit() is NOT
-- touched: the existing 8 branches and trucker-session-var lookup from
-- 0016 stay in place.
--
-- Fields added:
--   loads.invoice_number   text       — optional, free-form
--   loads.truck_number     text       — optional, alphanumeric only (DB check)
--   loads.driver_name      text       — optional, free-form
--   loads.driver_phone     text       — optional, free-form (no format check yet)
--   truckers.secondary_phone text     — optional, E.164 format (DB check)
--
-- All columns are nullable + IF NOT EXISTS so re-applying the migration is
-- a no-op against an already-migrated database. CHECK constraints are
-- added separately (not idempotent — adding the same named constraint
-- twice would error). Re-application requires `drop constraint if exists`
-- around the add, which we omit because Supabase migrations don't replay.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. loads: 4 new shipment-detail columns
-- -----------------------------------------------------------------------------

alter table loads
  add column if not exists invoice_number text,
  add column if not exists truck_number   text,
  add column if not exists driver_name    text,
  add column if not exists driver_phone   text;


-- -----------------------------------------------------------------------------
-- 2. loads.truck_number — alphanumeric only
-- -----------------------------------------------------------------------------
-- The empty-string case is covered by the NULL branch because the action
-- normalizes '' → NULL before writing. If a raw INSERT did pass '' through,
-- the regex would fail (^[A-Z0-9]+$ requires at least one character), so the
-- constraint catches it either way.

alter table loads
  add constraint loads_truck_number_alphanumeric
  check (truck_number is null or truck_number ~ '^[A-Z0-9]+$');


-- -----------------------------------------------------------------------------
-- 3. truckers.secondary_phone — optional, E.164
-- -----------------------------------------------------------------------------
-- Same E.164 shape as phone_e164 (starts with +, 10–15 digits). No
-- uniqueness constraint — that's a deliberate omission; if you want to
-- forbid two truckers sharing a secondary phone, add a unique index in a
-- follow-up migration.

alter table truckers
  add column if not exists secondary_phone text;

alter table truckers
  add constraint truckers_secondary_phone_e164
  check (secondary_phone is null or secondary_phone ~ '^\+\d{10,15}$');
