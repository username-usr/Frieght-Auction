-- =============================================================================
-- Migration 0016: Load completion lifecycle.
--
-- Adds 'completed' to the load_status enum and a completed_at timestamp
-- column on loads. Operators mark an awarded load as completed when the
-- delivery wraps up; the action is reversible (reopen returns the load to
-- 'awarded' with completed_at cleared).
--
-- record_audit() gets a tweaked loads branch that emits 'load_completed'
-- and 'load_reopened' actions when the completed_at flips. The rest of the
-- function body is restated verbatim from 0015 so a diff review surfaces
-- any branch regression (we have dropped branches twice before during
-- incremental patches).
--
-- IMPORTANT: ALTER TYPE ADD VALUE has to run in its own transaction in
-- older Postgres, and the new value can't be used in the same transaction
-- it's added. Supabase's SQL editor runs each statement in autocommit mode,
-- so the ALTER TYPE, ALTER TABLE, and CREATE OR REPLACE FUNCTION each
-- commit independently and this migration applies cleanly.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. load_status enum: add 'completed'
-- -----------------------------------------------------------------------------
-- IF NOT EXISTS guards a partial re-run (e.g. if a prior attempt added the
-- value but failed on a later step). The TypeScript LoadStatus union has
-- already included 'completed' since Phase 3d-2 — this brings the DB into
-- alignment.

alter type load_status add value if not exists 'completed';


-- -----------------------------------------------------------------------------
-- 2. loads.completed_at
-- -----------------------------------------------------------------------------
-- Nullable: only set when an operator marks the load completed; cleared
-- when the load is reopened.

alter table loads
  add column if not exists completed_at timestamptz;


-- -----------------------------------------------------------------------------
-- 3. record_audit() — full body, with completed_at handling on the loads branch
-- -----------------------------------------------------------------------------
-- Branches present (8 total, in order): bids, loads, shipments, load_items,
-- truckers, operators, zones, load_trucker_visibility. The trucker session
-- variable lookup at the top is preserved verbatim.
--
-- Only the loads branch is modified vs 0015:
--   * UPDATE checks completed_at first (so the action label is 'load_completed'
--     or 'load_reopened' for those transitions, not the generic 'load_awarded')
--   * Otherwise falls through to the prior status-change / generic-update logic
--
-- Why check completed_at first: when the operator calls completeLoadAction,
-- the SQL is UPDATE ... SET status='completed', completed_at=now(). Both
-- columns change in the same UPDATE, but we want one audit row labeled
-- 'load_completed', not 'load_completed' wrestling with 'load_completed'
-- from the status-change branch (they happen to match here, but the reopen
-- case — status='awarded' + completed_at=null — would produce the wrong
-- label without the explicit check).

create or replace function record_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id    uuid;
  v_actor_role  text;
  v_action      text;
  v_entity_type text;
  v_entity_id   uuid;
  v_load_id     uuid;
  v_before      jsonb;
  v_after       jsonb;
begin
  -- 3a. Actor identity: JWT first, then trucker session var, then system.
  v_actor_id := auth.uid();

  if v_actor_id is null then
    -- Fall back to the trucker session variable that place_trucker_bid()
    -- sets within its transaction. nullif(..., '') handles the case
    -- where the GUC was never SET.
    v_actor_id := nullif(current_setting('app.trucker_id', true), '')::uuid;
    if v_actor_id is not null then
      v_actor_role := 'trucker';
    else
      v_actor_role := 'system';
    end if;
  else
    select role::text into v_actor_role
      from operators where id = v_actor_id;
    if v_actor_role is null then
      v_actor_role := 'trucker';
    end if;
  end if;

  -- 3b. Serialize before/after rows as jsonb.
  if TG_OP = 'INSERT' then
    v_before := null;
    v_after  := to_jsonb(NEW);
  elsif TG_OP = 'UPDATE' then
    v_before := to_jsonb(OLD);
    v_after  := to_jsonb(NEW);
  elsif TG_OP = 'DELETE' then
    v_before := to_jsonb(OLD);
    v_after  := null;
  end if;

  -- 3c. Plural table name → singular entity_type.
  v_entity_type := case TG_TABLE_NAME
    when 'bids'                     then 'bid'
    when 'loads'                    then 'load'
    when 'shipments'                then 'shipment'
    when 'load_items'               then 'load_item'
    when 'truckers'                 then 'trucker'
    when 'operators'                then 'operator'
    when 'zones'                    then 'zone'
    when 'load_trucker_visibility'  then 'load_visibility'
  end;

  -- 3d. Per-table action label, entity_id, and load_id.
  if TG_TABLE_NAME = 'bids' then
    if TG_OP = 'INSERT' then
      v_action := 'bid_placed';
    elsif TG_OP = 'UPDATE' then
      if OLD.status is distinct from NEW.status then
        v_action := 'bid_' || NEW.status::text;
      else
        v_action := 'bid_updated';
      end if;
    elsif TG_OP = 'DELETE' then
      v_action := 'bid_deleted';
    end if;
    v_load_id   := coalesce(NEW.load_id, OLD.load_id);
    v_entity_id := coalesce(NEW.id, OLD.id);

  elsif TG_TABLE_NAME = 'loads' then
    if TG_OP = 'INSERT' then
      v_action := 'load_posted';
    elsif TG_OP = 'UPDATE' then
      -- completed_at transitions take precedence over status changes so
      -- the audit label is descriptive for the complete / reopen flow.
      if OLD.completed_at is null and NEW.completed_at is not null then
        v_action := 'load_completed';
      elsif OLD.completed_at is not null and NEW.completed_at is null then
        v_action := 'load_reopened';
      elsif OLD.status is distinct from NEW.status then
        v_action := 'load_' || NEW.status::text;
      else
        v_action := 'load_updated';
      end if;
    elsif TG_OP = 'DELETE' then
      v_action := 'load_deleted';
    end if;
    v_load_id   := coalesce(NEW.id, OLD.id);
    v_entity_id := v_load_id;

  elsif TG_TABLE_NAME = 'shipments' then
    if TG_OP = 'INSERT' then
      v_action := 'shipment_created';
    elsif TG_OP = 'UPDATE' then
      v_action := 'shipment_updated';
    elsif TG_OP = 'DELETE' then
      v_action := 'shipment_deleted';
    end if;
    v_load_id   := coalesce(NEW.load_id, OLD.load_id);
    v_entity_id := coalesce(NEW.id, OLD.id);

  elsif TG_TABLE_NAME = 'load_items' then
    if TG_OP = 'INSERT' then
      v_action := 'load_item_added';
    elsif TG_OP = 'UPDATE' then
      v_action := 'load_item_updated';
    elsif TG_OP = 'DELETE' then
      v_action := 'load_item_removed';
    end if;
    v_load_id   := coalesce(NEW.load_id, OLD.load_id);
    v_entity_id := coalesce(NEW.id, OLD.id);

  elsif TG_TABLE_NAME = 'truckers' then
    if TG_OP = 'INSERT' then
      v_action := 'trucker_added';
    elsif TG_OP = 'UPDATE' then
      if OLD.archived_at is null and NEW.archived_at is not null then
        v_action := 'trucker_archived';
      elsif OLD.archived_at is not null and NEW.archived_at is null then
        v_action := 'trucker_unarchived';
      elsif OLD.status is distinct from NEW.status then
        v_action := 'trucker_status_' || NEW.status::text;
      else
        v_action := 'trucker_updated';
      end if;
    elsif TG_OP = 'DELETE' then
      v_action := 'trucker_deleted';
    end if;
    v_load_id   := null;
    v_entity_id := coalesce(NEW.id, OLD.id);

  elsif TG_TABLE_NAME = 'operators' then
    if TG_OP = 'INSERT' then
      v_action := 'operator_added';
    elsif TG_OP = 'UPDATE' then
      if OLD.archived_at is null and NEW.archived_at is not null then
        v_action := 'operator_archived';
      elsif OLD.archived_at is not null and NEW.archived_at is null then
        v_action := 'operator_unarchived';
      else
        v_action := 'operator_updated';
      end if;
    elsif TG_OP = 'DELETE' then
      v_action := 'operator_deleted';
    end if;
    v_load_id   := null;
    v_entity_id := coalesce(NEW.id, OLD.id);

  elsif TG_TABLE_NAME = 'zones' then
    if TG_OP = 'INSERT' then
      v_action := 'zone_added';
    elsif TG_OP = 'UPDATE' then
      if OLD.deleted_at is null and NEW.deleted_at is not null then
        v_action := 'zone_archived';
      elsif OLD.deleted_at is not null and NEW.deleted_at is null then
        v_action := 'zone_restored';
      else
        v_action := 'zone_updated';
      end if;
    elsif TG_OP = 'DELETE' then
      v_action := 'zone_deleted';
    end if;
    v_load_id   := null;
    v_entity_id := coalesce(NEW.id, OLD.id);

  elsif TG_TABLE_NAME = 'load_trucker_visibility' then
    if TG_OP = 'INSERT' then
      v_action := 'trucker_invited';
    elsif TG_OP = 'DELETE' then
      v_action := 'trucker_removed';
    else
      v_action := 'visibility_updated';
    end if;
    v_load_id   := coalesce(NEW.load_id, OLD.load_id);
    v_entity_id := coalesce(NEW.trucker_id, OLD.trucker_id);
  end if;

  insert into bid_audit_log (
    entity_type, entity_id, action, actor_id, actor_role,
    before, after, load_id
  ) values (
    v_entity_type, v_entity_id, v_action, v_actor_id, v_actor_role,
    v_before, v_after, v_load_id
  );

  if TG_OP = 'DELETE' then
    return OLD;
  else
    return NEW;
  end if;
end;
$$;
