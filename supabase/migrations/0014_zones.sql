-- =============================================================================
-- Migration 0014: Zones — regional segmentation for operators and loads.
--
-- Adds a zones lookup (admin-managed) and zone_id columns on operators and
-- loads. Both columns are nullable; a NULL zone is the "no restriction"
-- sentinel:
--   * Operator with zone_id IS NULL  → sees every load (treated like admin)
--   * Load with zone_id IS NULL      → visible regardless of viewer's zone
--
-- loads.zone_id is auto-populated on INSERT from the posting operator's
-- zone_id via a BEFORE INSERT trigger, so callers (create_load_with_items,
-- ad-hoc SQL editor inserts, future RPCs) can't forget to set it.
--
-- record_audit() and bid_audit_log.entity_type are extended to cover zones.
-- The function body below is a FULL restatement carrying all branches added
-- through 0013 plus the new zones branch — it has regressed twice in past
-- migrations, so the whole body is re-asserted here for easy diff review.
--
-- Apply once in the Supabase SQL editor. Not idempotent for the entity_type
-- CHECK swap or the seed inserts (uses plain DROP CONSTRAINT and bare
-- INSERTs; re-running the seed will hit the UNIQUE on name).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. zones lookup table
-- -----------------------------------------------------------------------------
-- Matches the pattern from product_names / container_types / quantity_units
-- (migration 0008): UNIQUE on name, soft delete via deleted_at.

create table zones (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz null
);

create index zones_active_idx
  on zones (name)
  where deleted_at is null;


-- -----------------------------------------------------------------------------
-- 2. operators.zone_id
-- -----------------------------------------------------------------------------
-- NULL is meaningful: an admin without a zone can manage everything, and an
-- operator without a zone falls back to admin-style visibility (see Part I).

alter table operators
  add column if not exists zone_id uuid references zones(id);

create index if not exists operators_zone_id_idx
  on operators (zone_id)
  where zone_id is not null;


-- -----------------------------------------------------------------------------
-- 3. loads.zone_id
-- -----------------------------------------------------------------------------
-- Auto-filled by the trigger in section 4. NULL means "no zone restriction"
-- (visible to all viewers).

alter table loads
  add column if not exists zone_id uuid references zones(id);

create index if not exists loads_zone_id_idx
  on loads (zone_id)
  where zone_id is not null;


-- -----------------------------------------------------------------------------
-- 4. Auto-populate loads.zone_id from the posting operator
-- -----------------------------------------------------------------------------
-- BEFORE INSERT so the assignment lands before the row is written (and before
-- the AFTER INSERT audit trigger captures to_jsonb(NEW)). Only fires when the
-- caller didn't already specify a zone — this leaves create_load_with_items()
-- (or any future RPC) free to override the default if a stronger invariant
-- ever applies.
--
-- security definer so the SELECT against operators works regardless of the
-- caller's role; the function only reads, never writes.
--
-- If posted_by doesn't match any operator row, the SELECT...INTO leaves
-- NEW.zone_id at NULL (non-STRICT). That's the same as "no zone", and the
-- loads.posted_by FK will reject the row separately on its own merits.

create or replace function set_load_zone_from_poster()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if TG_OP = 'INSERT' and NEW.zone_id is null then
    select zone_id into NEW.zone_id
      from operators
      where id = NEW.posted_by;
  end if;
  return NEW;
end;
$$;

drop trigger if exists set_load_zone_from_poster_trigger on loads;
create trigger set_load_zone_from_poster_trigger
  before insert on loads
  for each row execute function set_load_zone_from_poster();


-- -----------------------------------------------------------------------------
-- 5. Seed initial zones
-- -----------------------------------------------------------------------------

insert into zones (name) values
  ('Northern Zone'),
  ('Southern Zone'),
  ('Eastern Zone'),
  ('Western Zone'),
  ('Central Zone');


-- -----------------------------------------------------------------------------
-- 6. Row Level Security
-- -----------------------------------------------------------------------------
-- Reads are open to authenticated (operators need to populate dropdowns and
-- see zone names). Writes are gated by is_admin() — only admins manage the
-- zones list, distinct from the rest of the lookups which use is_operator().

alter table zones enable row level security;

create policy zones_select on zones
  for select to authenticated using (true);

create policy zones_insert on zones
  for insert to authenticated with check (is_admin());

create policy zones_update on zones
  for update to authenticated
  using (is_admin()) with check (is_admin());


-- -----------------------------------------------------------------------------
-- 7. bid_audit_log.entity_type CHECK — allow 'zone'
-- -----------------------------------------------------------------------------

alter table bid_audit_log
  drop constraint bid_audit_log_entity_type_check;

alter table bid_audit_log
  add constraint bid_audit_log_entity_type_check
  check (entity_type in (
    'bid', 'load', 'shipment', 'load_item', 'trucker', 'operator', 'zone'
  ));


-- -----------------------------------------------------------------------------
-- 8. record_audit() — full body with all 7 branches
-- -----------------------------------------------------------------------------
-- Branches present, in order: bids, loads, shipments, load_items, truckers,
-- operators, zones. Actor resolution unchanged: JWT auth.uid() first, then
-- the trucker session variable set by place_trucker_bid(), then 'system'.
--
-- Full restatement (not an incremental patch) because previous migrations
-- 0010 and 0011 each silently dropped a branch when they tried to patch
-- incrementally. Re-asserting the whole body makes regressions obvious in
-- diff review.

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
  -- 8a. Actor identity: JWT first, then trucker session var, then system.
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

  -- 8b. Serialize before/after rows as jsonb.
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

  -- 8c. Plural table name → singular entity_type.
  v_entity_type := case TG_TABLE_NAME
    when 'bids'       then 'bid'
    when 'loads'      then 'load'
    when 'shipments'  then 'shipment'
    when 'load_items' then 'load_item'
    when 'truckers'   then 'trucker'
    when 'operators'  then 'operator'
    when 'zones'      then 'zone'
  end;

  -- 8d. Per-table action label, entity_id, and load_id.
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
      if OLD.status is distinct from NEW.status then
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


-- -----------------------------------------------------------------------------
-- 9. Audit trigger on zones
-- -----------------------------------------------------------------------------

drop trigger if exists record_audit_zones on zones;
create trigger record_audit_zones
  after insert or update or delete on zones
  for each row execute function record_audit();
