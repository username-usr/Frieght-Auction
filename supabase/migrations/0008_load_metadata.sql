-- =============================================================================
-- Migration 0008: Load metadata (product, quantity, container, weight unit)
--
-- Adds three lookup tables (product_names, container_types, quantity_units)
-- plus five new NOT NULL columns on loads. Because the new columns are
-- required, this migration WIPES all existing test loads / bids / shipments /
-- audit history first — there's no sane backfill for fields the operators
-- never specified.
--
-- Apply once in the Supabase SQL editor. Not idempotent against partial
-- application (uses plain CREATE TABLE / ADD COLUMN, not IF NOT EXISTS).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Lookup tables
-- -----------------------------------------------------------------------------
-- Soft-delete via deleted_at so historical loads keep working even after an
-- operator removes an option from the admin UI. The UNIQUE constraint on name
-- applies across deleted rows too; if you re-add a previously-deleted name,
-- restore the existing row by clearing deleted_at instead of inserting a new
-- one (the admin layer handles this).

create table product_names (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz null
);

create table container_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz null
);

create table quantity_units (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz null
);


-- -----------------------------------------------------------------------------
-- 2. Seed values
-- -----------------------------------------------------------------------------

insert into product_names (name) values
  ('Rice'), ('Wheat'), ('Cement'), ('Steel'), ('Electronics'),
  ('Textiles'), ('Furniture'), ('Machinery'), ('Chemicals');

insert into container_types (name) values
  ('Drum'), ('Bag'), ('Carton'), ('Pallet'), ('Loose'), ('Sack'),
  ('Box'), ('Container');

insert into quantity_units (name) values
  ('Pieces'), ('Bags'), ('Cartons'), ('Drums'), ('Tonnes');


-- -----------------------------------------------------------------------------
-- 3. Wipe existing test data
-- -----------------------------------------------------------------------------
-- The new columns on loads are NOT NULL, so anything that already exists has
-- to go. FK order: shipments.winning_bid_id references bids.id, so shipments
-- must go before bids. Then bids (which reference loads) before loads.
-- bid_audit_log has no FK constraints but references logical entities.

delete from shipments;
delete from bids;
delete from bid_audit_log;
delete from loads;


-- -----------------------------------------------------------------------------
-- 4. Alter loads
-- -----------------------------------------------------------------------------

-- 4.1 Rename weight_kg → weight_value. Liquids are coming, so the column name
-- can no longer assume kilograms. Postgres rewrites the existing CHECK
-- (weight_kg > 0) to reference weight_value automatically.
alter table loads rename column weight_kg to weight_value;

-- 4.2 Add the new columns nullable first, then SET NOT NULL once seeded. The
-- table is empty (step 3) so SET NOT NULL succeeds without a default.
alter table loads
  add column product_name_id    uuid references product_names(id),
  add column quantity_value     numeric,
  add column quantity_unit_id   uuid references quantity_units(id),
  add column container_type_id  uuid references container_types(id),
  add column weight_unit        text;

-- 4.3 CHECK constraint on weight_unit. We use text + CHECK (not an enum)
-- because the set is closed and unlikely to grow; a CHECK is easier to
-- evolve than an enum if it does.
alter table loads
  add constraint loads_weight_unit_check
    check (weight_unit in ('kg', 'liters'));

-- 4.4 Quantity must be positive.
alter table loads
  add constraint loads_quantity_value_check
    check (quantity_value > 0);

-- 4.5 Lock in NOT NULL on all five new fields.
alter table loads
  alter column product_name_id    set not null,
  alter column quantity_value     set not null,
  alter column quantity_unit_id   set not null,
  alter column container_type_id  set not null,
  alter column weight_unit        set not null;


-- -----------------------------------------------------------------------------
-- 5. Indexes
-- -----------------------------------------------------------------------------
-- The admin UI queries each lookup table by `where deleted_at is null` order
-- by name. The dropdown render path is the hot one; a partial index keeps
-- the lookup fast even as the soft-deleted set grows.

create index product_names_active_idx
  on product_names (name)
  where deleted_at is null;

create index container_types_active_idx
  on container_types (name)
  where deleted_at is null;

create index quantity_units_active_idx
  on quantity_units (name)
  where deleted_at is null;


-- -----------------------------------------------------------------------------
-- 6. Row Level Security
-- -----------------------------------------------------------------------------
-- Mirror the loads RLS model: any authenticated session can SELECT, but only
-- operators can INSERT or UPDATE. Service role bypasses RLS automatically.
--
-- SELECT is permissive (true) rather than is_operator() so trucker queries
-- (which authenticate as the service role from the server, not as the
-- trucker — see lib/trucker.ts) and any future authenticated-but-not-operator
-- contexts can still read the lookup names for display.

alter table product_names   enable row level security;
alter table container_types enable row level security;
alter table quantity_units  enable row level security;

create policy product_names_select on product_names
  for select to authenticated using (true);
create policy product_names_insert on product_names
  for insert to authenticated with check (is_operator());
create policy product_names_update on product_names
  for update to authenticated using (is_operator()) with check (is_operator());

create policy container_types_select on container_types
  for select to authenticated using (true);
create policy container_types_insert on container_types
  for insert to authenticated with check (is_operator());
create policy container_types_update on container_types
  for update to authenticated using (is_operator()) with check (is_operator());

create policy quantity_units_select on quantity_units
  for select to authenticated using (true);
create policy quantity_units_insert on quantity_units
  for insert to authenticated with check (is_operator());
create policy quantity_units_update on quantity_units
  for update to authenticated using (is_operator()) with check (is_operator());
