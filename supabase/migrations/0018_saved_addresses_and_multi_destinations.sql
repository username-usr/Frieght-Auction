-- =============================================================================
-- Migration 0018: Saved addresses + multi-destination loads.
--
-- Two related additions:
--   1. saved_addresses — operator-typed addresses captured at load-post
--      time and surfaced as <datalist> suggestions on the new-load form.
--      Shared pool, no per-operator scoping yet (Ramnath's team is small).
--   2. load_destinations — additional destination stops beyond the primary
--      destination_address (which stays on loads). Position is a 1-indexed
--      ordering suggested by the operator; the trucker can deviate.
--
-- The create_load_with_items RPC gets a 9th parameter, p_additional_destinations,
-- and the old 8-arg signature is dropped. Server actions that called the old
-- shape will fail at runtime until updated — that's by design; the new-load
-- form is updated in the same change set.
--
-- record_audit() is INTENTIONALLY NOT TOUCHED. These tables don't generate
-- audit-log entries (operational data, not security-sensitive). The 8
-- branches from 0016 stay in place.
--
-- Apply once in the Supabase SQL editor. Not idempotent against partial
-- application (CREATE TABLE without IF NOT EXISTS, named constraints).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. saved_addresses
-- -----------------------------------------------------------------------------
-- UNIQUE(address) lets the create-load action upsert idempotently. The
-- additional lower(address) functional index supports a future case-insensitive
-- "have we seen this before?" lookup; we don't use it yet, but the index is
-- cheap and saves a migration later.

create table saved_addresses (
  id          uuid primary key default gen_random_uuid(),
  address     text not null unique,
  created_at  timestamptz not null default now()
);

create index saved_addresses_address_idx
  on saved_addresses (lower(address));

alter table saved_addresses enable row level security;

create policy saved_addresses_select on saved_addresses
  for select to authenticated using (true);

create policy saved_addresses_insert on saved_addresses
  for insert to authenticated with check (is_operator());


-- -----------------------------------------------------------------------------
-- 2. load_destinations
-- -----------------------------------------------------------------------------
-- ON DELETE CASCADE on load_id mirrors load_items / load_trucker_visibility.
-- The (load_id, position) UNIQUE constraint prevents two stops with the same
-- sort order on one load.

create table load_destinations (
  id          uuid primary key default gen_random_uuid(),
  load_id     uuid not null references loads(id) on delete cascade,
  address     text not null,
  position    integer not null,
  created_at  timestamptz not null default now(),
  unique (load_id, position)
);

create index load_destinations_load_idx
  on load_destinations (load_id);

alter table load_destinations enable row level security;

create policy load_destinations_select on load_destinations
  for select to authenticated using (true);

create policy load_destinations_insert on load_destinations
  for insert to authenticated with check (is_operator());

create policy load_destinations_update on load_destinations
  for update to authenticated
  using (is_operator()) with check (is_operator());

create policy load_destinations_delete on load_destinations
  for delete to authenticated using (is_operator());


-- -----------------------------------------------------------------------------
-- 3. create_load_with_items — drop 8-arg, replace with 9-arg
-- -----------------------------------------------------------------------------
-- The 9th parameter p_additional_destinations is a jsonb array of
-- {address, position} objects. Null or empty array means "no additional
-- stops" — primary destination on loads is still the canonical single
-- destination. The RPC inserts each destination row in the same transaction
-- as the load + items + visibility writes, so a half-inserted load is
-- impossible.

drop function if exists create_load_with_items(
  text, text, truck_type, timestamptz, bigint, text, jsonb, uuid[]
);

create or replace function create_load_with_items(
  p_origin_address              text,
  p_destination_address         text,
  p_truck_type_required         truck_type,
  p_pickup_deadline             timestamptz,
  p_reference_price_paise       bigint,
  p_notes                       text,
  p_items                       jsonb,
  p_trucker_ids                 uuid[],
  p_additional_destinations     jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_load_id    uuid;
  v_item       jsonb;
  v_dest       jsonb;
  v_pos        integer := 0;
  v_user_id    uuid;
  v_trucker_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not is_operator() then
    raise exception 'Only operators can create loads' using errcode = '42501';
  end if;

  if jsonb_array_length(p_items) < 1 then
    raise exception 'A load must have at least one product item';
  end if;

  if p_trucker_ids is null or array_length(p_trucker_ids, 1) is null then
    raise exception 'Select at least one trucker to make the load visible';
  end if;

  insert into loads (
    origin_address, destination_address, truck_type_required,
    pickup_deadline, reference_price_paise, notes, posted_by
  ) values (
    p_origin_address, p_destination_address, p_truck_type_required,
    p_pickup_deadline, p_reference_price_paise, p_notes, v_user_id
  )
  returning id into v_load_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    insert into load_items (
      load_id, position,
      product_name_id, container_type_id,
      quantity_value, quantity_unit_id,
      weight_value, weight_unit
    ) values (
      v_load_id, v_pos,
      (v_item->>'product_name_id')::uuid,
      (v_item->>'container_type_id')::uuid,
      (v_item->>'quantity_value')::numeric,
      (v_item->>'quantity_unit_id')::uuid,
      (v_item->>'weight_value')::numeric,
      v_item->>'weight_unit'
    );
    v_pos := v_pos + 1;
  end loop;

  foreach v_trucker_id in array p_trucker_ids
  loop
    insert into load_trucker_visibility (load_id, trucker_id)
    values (v_load_id, v_trucker_id);
  end loop;

  -- Additional destinations are optional. Caller passes null or [] when
  -- the load has only the primary destination_address.
  if p_additional_destinations is not null
     and jsonb_array_length(p_additional_destinations) > 0 then
    for v_dest in select * from jsonb_array_elements(p_additional_destinations)
    loop
      insert into load_destinations (load_id, address, position)
      values (
        v_load_id,
        v_dest->>'address',
        (v_dest->>'position')::integer
      );
    end loop;
  end if;

  return v_load_id;
end;
$$;

revoke all on function create_load_with_items(
  text, text, truck_type, timestamptz, bigint, text, jsonb, uuid[], jsonb
) from public;

grant execute on function create_load_with_items(
  text, text, truck_type, timestamptz, bigint, text, jsonb, uuid[], jsonb
) to authenticated;
