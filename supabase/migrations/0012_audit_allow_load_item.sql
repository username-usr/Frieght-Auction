-- =============================================================================
-- Migration 0012: Allow 'load_item' in bid_audit_log.entity_type
--
-- Migration 0010 extended record_audit() to fire for load_items inserts /
-- updates / deletes, emitting entity_type='load_item'. The CHECK constraint
-- on bid_audit_log.entity_type still only allows the original three values
-- ('bid', 'load', 'shipment'), so any load_items write blows up the whole
-- transaction with a 23514 error.
--
-- Drop and re-add the constraint with the expanded whitelist.
-- =============================================================================

alter table bid_audit_log
  drop constraint bid_audit_log_entity_type_check;

alter table bid_audit_log
  add constraint bid_audit_log_entity_type_check
  check (entity_type in ('bid', 'load', 'shipment', 'load_item'));
