-- =============================================================================
-- Migration 0011: create_load_with_items() RPC
--
-- Wraps the two-step "insert load + insert items" into a single Postgres
-- function so both inserts succeed or fail together. supabase-js has no
-- transaction primitive, so the server action previously did the two inserts
-- back-to-back with a best-effort cleanup on item failure. That left a window
-- where a Node crash between the inserts orphaned an empty load.
--
-- The function takes load fields as scalar parameters and items as a jsonb
-- array. It returns the new load's id so the caller can redirect.
--
-- security definer means this function bypasses RLS, so we re-enforce the
-- operator-only check that the loads_insert policy provides on direct INSERT.
-- posted_by is taken from auth.uid() server-side so it can't be spoofed by
-- a client passing someone else's UUID.
--
-- Apply once in the Supabase SQL editor.
-- =============================================================================

create or replace function create_load_with_items(
  p_origin_city            text,
  p_destination_city       text,
  p_truck_type_required    truck_type,
  p_pickup_deadline        timestamptz,
  p_reference_price_paise  bigint,
  p_notes                  text,
  p_items                  jsonb  -- array of {product_name_id, container_type_id, quantity_value, quantity_unit_id, weight_value, weight_unit}
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_load_id uuid;
  v_item    jsonb;
  v_pos     integer := 0;
  v_user_id uuid;
begin
  -- Auth guard: function bypasses RLS, so we re-enforce operator-only here
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

  -- Insert the parent load
  insert into loads (
    origin_city, destination_city, truck_type_required,
    pickup_deadline, reference_price_paise, notes, posted_by
  ) values (
    p_origin_city, p_destination_city, p_truck_type_required,
    p_pickup_deadline, p_reference_price_paise, p_notes, v_user_id
  )
  returning id into v_load_id;

  -- Insert each item with sequential position
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

  return v_load_id;
end;
$$;

revoke all on function create_load_with_items(text, text, truck_type, timestamptz, bigint, text, jsonb) from public;
grant execute on function create_load_with_items(text, text, truck_type, timestamptz, bigint, text, jsonb) to authenticated;
