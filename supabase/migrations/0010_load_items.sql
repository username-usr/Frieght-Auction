-- =============================================================================
-- Migration 0010: Multi-product loads
--
-- Each load now has 1+ items, where each item carries its own product,
-- container, quantity, and weight. The corresponding columns are removed
-- from `loads` and moved to a new `load_items` table.
--
-- Wipes the single existing test load (and its bids / shipments / audit
-- history) — there is no automatic backfill from the old single-product
-- shape into the new items table.
--
-- Apply once in the Supabase SQL editor. Not idempotent against partial
-- application (uses plain CREATE TABLE / DROP COLUMN, not IF NOT EXISTS).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. load_items table
-- -----------------------------------------------------------------------------
-- One row per product on a load. The (load_id, position) unique index gives
-- a stable display order and lets the operator rearrange items by updating
-- position values. ON DELETE CASCADE on load_id is intentional: deleting a
-- load (which currently only happens via SQL editor) takes its items with it.

create table load_items (
  id                 uuid primary key default gen_random_uuid(),
  load_id            uuid not null references loads(id) on delete cascade,
  position           integer not null,
  product_name_id    uuid not null references product_names(id),
  container_type_id  uuid not null references container_types(id),
  quantity_value     numeric not null check (quantity_value > 0),
  quantity_unit_id   uuid not null references quantity_units(id),
  weight_value       numeric not null check (weight_value > 0),
  weight_unit        text not null check (weight_unit in ('kg', 'liters')),
  created_at         timestamptz not null default now()
);

create index load_items_load_id_idx
  on load_items (load_id);

create unique index load_items_load_id_position_idx
  on load_items (load_id, position);


-- -----------------------------------------------------------------------------
-- 2. Wipe existing data
-- -----------------------------------------------------------------------------
-- FK order: shipments.winning_bid_id references bids.id, so shipments must
-- go before bids. Then bids (which reference loads) before loads.
-- bid_audit_log has no FK constraints but references logical entities.

delete from shipments;
delete from bids;
delete from bid_audit_log;
delete from loads;


-- -----------------------------------------------------------------------------
-- 3. Drop the moved columns from loads
-- -----------------------------------------------------------------------------
-- product/container/quantity/weight all live on load_items now. Done in one
-- ALTER TABLE so it's a single rewrite. Safe because loads is empty (step 2).

alter table loads
  drop column product_name_id,
  drop column container_type_id,
  drop column quantity_value,
  drop column quantity_unit_id,
  drop column weight_value,
  drop column weight_unit;


-- -----------------------------------------------------------------------------
-- 4. Row Level Security
-- -----------------------------------------------------------------------------
-- Mirrors the loads policy: SELECT open to authenticated, writes gated by
-- is_operator(). Service role bypasses RLS automatically.

alter table load_items enable row level security;

create policy load_items_select on load_items
  for select to authenticated using (true);

create policy load_items_insert on load_items
  for insert to authenticated with check (is_operator());

create policy load_items_update on load_items
  for update to authenticated
  using (is_operator()) with check (is_operator());

create policy load_items_delete on load_items
  for delete to authenticated using (is_operator());


-- -----------------------------------------------------------------------------
-- 5. Extend record_audit() to handle load_items
-- -----------------------------------------------------------------------------
-- The function from 0005 only knew about bids / loads / shipments. We add a
-- load_items branch so item adds/removes show up in the per-load activity
-- log. CREATE OR REPLACE keeps existing triggers attached.

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
  -- Resolve actor identity from JWT.
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

  -- Serialize before/after rows as jsonb.
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

  -- Map plural table name → singular entity_type.
  v_entity_type := case TG_TABLE_NAME
    when 'bids'       then 'bid'
    when 'loads'      then 'load'
    when 'shipments'  then 'shipment'
    when 'load_items' then 'load_item'
  end;

  -- Per-table action label, entity_id, and load_id.
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
-- 6. Attach audit trigger to load_items
-- -----------------------------------------------------------------------------

drop trigger if exists record_audit_load_items on load_items;

create trigger record_audit_load_items
  after insert or update or delete on load_items
  for each row execute function record_audit();
