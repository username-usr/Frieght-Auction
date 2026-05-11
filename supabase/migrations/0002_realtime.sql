-- =============================================================================
-- Migration 0002: Enable Supabase Realtime on the dashboard tables
--
-- Supabase Realtime is opt-in per table — you have to add tables to the
-- `supabase_realtime` publication for the dashboard's `supabase.channel()`
-- subscriptions to receive change events.
--
-- REPLICA IDENTITY FULL makes UPDATE events include the entire pre-image of
-- the row. Without it, the OLD record only contains the primary key, which
-- breaks RLS-aware filtering on UPDATE/DELETE events.
-- =============================================================================

alter publication supabase_realtime add table loads;
alter publication supabase_realtime add table bids;
alter publication supabase_realtime add table shipments;

alter table loads     replica identity full;
alter table bids      replica identity full;
alter table shipments replica identity full;
