-- =============================================================================
-- Ramnath Logistics - Freight Bidding Platform
-- Migration 0001: Initial schema
--
-- Paste this entire file into the Supabase SQL editor and run once.
-- Safe to re-run on a fresh project; NOT idempotent against an existing schema
-- (it does not drop anything). If you need to reset, drop the schema in the
-- Supabase dashboard first or run the teardown commands at the bottom of this
-- file (commented out).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Extensions
-- -----------------------------------------------------------------------------
-- pgcrypto gives us gen_random_uuid(). Supabase enables it by default in newer
-- projects, but `create extension if not exists` makes this portable.
create extension if not exists pgcrypto;


-- -----------------------------------------------------------------------------
-- 2. Enums
-- -----------------------------------------------------------------------------
-- We use Postgres enums (rather than text + CHECK) so invalid values fail at
-- write time and so the TypeScript types Supabase generates are union types.
-- Adding a new value later is a one-liner: `alter type truck_type add value 'flatbed';`
-- Renaming/removing is harder, so keep these conservative.

create type truck_type as enum (
  'open', 'container', 'trailer', 'tanker', 'refrigerated', 'other'
);

create type operator_role     as enum ('admin', 'operator');
create type trucker_status    as enum ('active', 'inactive', 'blocked');
create type load_status       as enum ('open', 'awarded', 'cancelled', 'completed');
create type bid_status        as enum ('active', 'won', 'lost', 'withdrawn');
create type delivery_status   as enum ('pending_pickup', 'in_transit', 'delivered', 'cancelled');
create type message_direction as enum ('inbound', 'outbound');
create type message_status    as enum ('queued', 'sent', 'delivered', 'read', 'failed');


-- -----------------------------------------------------------------------------
-- 3. Helper: updated_at trigger function
-- -----------------------------------------------------------------------------
-- Standard pattern: any table with an updated_at column gets this trigger so
-- the application layer never has to remember to set it.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- -----------------------------------------------------------------------------
-- 4. Tables
-- -----------------------------------------------------------------------------

-- 4.1 operators -------------------------------------------------------------
-- One row per dashboard user. id = auth.users.id (Supabase Auth user). When
-- you invite an operator via Supabase Auth, you'll insert a matching row here
-- (or do it via a trigger on auth.users; we'll wire that up in Phase 2 once
-- the dashboard exists).
create table operators (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  full_name   text not null,
  role        operator_role not null default 'operator',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger operators_set_updated_at
  before update on operators
  for each row execute function set_updated_at();


-- 4.2 truckers --------------------------------------------------------------
-- Truckers never log into anything; their phone number IS their identity.
-- The CHECK constraint enforces E.164 format ('+' then 1-15 digits, leading
-- digit not 0). This catches malformed numbers from the WhatsApp webhook.
create table truckers (
  id                uuid primary key default gen_random_uuid(),
  phone_e164        text not null unique
                      check (phone_e164 ~ '^\+[1-9]\d{1,14}$'),
  full_name         text,
  truck_type        truck_type not null default 'other',
  home_base_city    text,
  status            trucker_status not null default 'active',
  -- onboarding_state is a free-form jsonb the WhatsApp state machine writes to.
  -- Keeping it untyped on purpose: the state machine evolves quickly and we
  -- don't want migrations every time we add a step.
  onboarding_state  jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger truckers_set_updated_at
  before update on truckers
  for each row execute function set_updated_at();


-- 4.3 routes ----------------------------------------------------------------
-- A route is just an (origin, destination) pair we've seen at least once. The
-- unique constraint means we INSERT ... ON CONFLICT DO NOTHING when a load is
-- posted, so the routes table grows organically.
create table routes (
  id                uuid primary key default gen_random_uuid(),
  origin_city       text not null,
  destination_city  text not null,
  created_at        timestamptz not null default now(),
  unique (origin_city, destination_city),
  check (origin_city <> destination_city)
);


-- 4.4 trucker_routes --------------------------------------------------------
-- Many-to-many: which routes does each trucker want alerts for. Composite PK
-- (no surrogate id) since we never reference these rows from elsewhere.
create table trucker_routes (
  trucker_id  uuid not null references truckers(id) on delete cascade,
  route_id    uuid not null references routes(id)   on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (trucker_id, route_id)
);


-- 4.5 loads -----------------------------------------------------------------
-- A truckload posted by an operator. weight_kg is integer (we'll never need
-- gram-precision for freight). reference_price_paise is what Ramnath expected
-- to pay; nullable so operators can skip it.
create table loads (
  id                      uuid primary key default gen_random_uuid(),
  origin_city             text not null,
  destination_city        text not null,
  truck_type_required     truck_type not null,
  weight_kg               integer not null check (weight_kg > 0),
  pickup_deadline         timestamptz not null,
  reference_price_paise   bigint check (reference_price_paise is null or reference_price_paise > 0),
  notes                   text,
  status                  load_status not null default 'open',
  posted_by               uuid not null references operators(id) on delete restrict,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (origin_city <> destination_city)
);

create trigger loads_set_updated_at
  before update on loads
  for each row execute function set_updated_at();


-- 4.6 bids ------------------------------------------------------------------
-- All currency is stored in paise (1 INR = 100 paise) as bigint. We never use
-- floats or numerics for money. message_text is the raw WhatsApp body we
-- parsed the bid from, kept for audit / "why did we accept this number?" debugging.
create table bids (
  id            uuid primary key default gen_random_uuid(),
  load_id       uuid not null references loads(id)    on delete cascade,
  trucker_id    uuid not null references truckers(id) on delete restrict,
  amount_paise  bigint not null check (amount_paise > 0),
  message_text  text,
  status        bid_status not null default 'active',
  created_at    timestamptz not null default now()
);

-- A trucker can only have one ACTIVE bid per load at a time. They can revise
-- (withdraw old, place new), but can't have two competing actives. This
-- partial unique index enforces that without blocking historical (won/lost/
-- withdrawn) rows. If you don't want this, comment it out — the spec didn't
-- ask for it but the award flow is ambiguous without it.
create unique index bids_one_active_per_trucker_per_load
  on bids (load_id, trucker_id)
  where status = 'active';


-- 4.7 shipments -------------------------------------------------------------
-- Created by award_bid(). One shipment per load (load_id is unique).
create table shipments (
  id                uuid primary key default gen_random_uuid(),
  load_id           uuid not null unique references loads(id) on delete restrict,
  winning_bid_id    uuid not null references bids(id)         on delete restrict,
  awarded_by        uuid not null references operators(id)    on delete restrict,
  awarded_at        timestamptz not null default now(),
  delivery_status   delivery_status not null default 'pending_pickup'
);


-- 4.8 whatsapp_messages -----------------------------------------------------
-- Audit log of every message in or out. wa_message_id is Meta's wamid we get
-- back when we send (or that arrives in the inbound webhook); we use it to
-- match delivery-status webhooks back to the row. Nullable because outbound
-- rows are inserted BEFORE we hear back from Meta with the id.
create table whatsapp_messages (
  id                uuid primary key default gen_random_uuid(),
  direction         message_direction not null,
  from_phone        text,
  to_phone          text,
  template_name     text,
  body              text,
  wa_message_id     text unique,
  status            message_status not null default 'queued',
  related_load_id   uuid references loads(id) on delete set null,
  related_bid_id    uuid references bids(id)  on delete set null,
  created_at        timestamptz not null default now()
);


-- -----------------------------------------------------------------------------
-- 5. Indexes
-- -----------------------------------------------------------------------------
-- Postgres auto-indexes primary keys and unique constraints. These are the
-- additional indexes for the queries we'll actually run from the dashboard
-- and webhook handler.

-- Bids list on a load page: "show all bids for load X, newest first"
create index bids_load_id_created_at_idx on bids (load_id, created_at desc);

-- Open-loads dashboard: "all loads where status = 'open', newest first"
-- Partial index keeps it tiny since most loads will eventually be 'awarded' or 'completed'.
create index loads_status_open_idx on loads (created_at desc) where status = 'open';
-- General status filter for non-open queries:
create index loads_status_idx on loads (status);

-- Inbound WhatsApp lookup: "who sent this message?"
-- (phone_e164 already has a unique index from the UNIQUE constraint, so this
-- line is intentionally omitted — the unique constraint serves the lookup.)

-- whatsapp_messages: filter by load (for the load detail page audit panel)
-- and by recency (for the global activity feed). Partial index on
-- related_load_id skips the many rows that aren't tied to a load.
create index whatsapp_messages_related_load_idx
  on whatsapp_messages (related_load_id, created_at desc)
  where related_load_id is not null;
create index whatsapp_messages_created_at_idx
  on whatsapp_messages (created_at desc);

-- Trucker route alerts: "which truckers subscribe to route X" (by far the
-- most common direction we'll query trucker_routes, when fanning out a load alert).
create index trucker_routes_route_id_idx on trucker_routes (route_id);


-- -----------------------------------------------------------------------------
-- 6. RLS helper functions
-- -----------------------------------------------------------------------------
-- These are SECURITY DEFINER so they can read the operators table from
-- inside an RLS policy without recursing into the operators-table policies.
-- STABLE means Postgres can cache the result within a single statement.

create or replace function is_operator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from operators where id = auth.uid())
$$;

create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from operators where id = auth.uid() and role = 'admin')
$$;


-- -----------------------------------------------------------------------------
-- 7. The atomic award function
-- -----------------------------------------------------------------------------
-- This is the concurrency-critical one. Three operators can click "Award" at
-- nearly the same moment; only one award should win. We use SELECT ... FOR
-- UPDATE on the load row to serialize the contenders — the second caller
-- blocks until the first commits, then sees status = 'awarded' and raises.
--
-- SECURITY DEFINER so the function can write across all the involved tables
-- regardless of the caller's RLS context. We re-check the operator's identity
-- inside the function instead.
--
-- Returns one row: shipment id, the winning trucker's phone, and an array of
-- the losing truckers' phones, so the caller can fan out WhatsApp messages
-- without a second round-trip.

create or replace function award_bid(
  p_load_id     uuid,
  p_bid_id      uuid,
  p_operator_id uuid
)
returns table (
  shipment_id   uuid,
  winner_phone  text,
  loser_phones  text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_load_status        load_status;
  v_bid_load_id        uuid;
  v_bid_status         bid_status;
  v_winner_trucker_id  uuid;
  v_winner_phone       text;
  v_loser_phones       text[];
  v_shipment_id        uuid;
begin
  -- The caller must be a real operator. When invoked from the dashboard via
  -- a Supabase client, auth.uid() is set; require it to match the supplied
  -- operator id. When invoked server-side via the service role key,
  -- auth.uid() is null and we trust the supplied id (but still verify it
  -- exists in operators).
  if auth.uid() is not null and auth.uid() <> p_operator_id then
    raise exception 'award_bid: caller (%) does not match p_operator_id (%)',
      auth.uid(), p_operator_id;
  end if;

  if not exists (select 1 from operators where id = p_operator_id) then
    raise exception 'award_bid: operator % not found', p_operator_id;
  end if;

  -- Lock the load row. Other concurrent award_bid calls for this load will
  -- block here until we commit or roll back.
  select status into v_load_status
    from loads
    where id = p_load_id
    for update;

  if v_load_status is null then
    raise exception 'award_bid: load % not found', p_load_id;
  end if;

  if v_load_status <> 'open' then
    raise exception 'award_bid: load % is not open (status=%)',
      p_load_id, v_load_status;
  end if;

  -- Verify the bid belongs to this load and is still active.
  select load_id, status, trucker_id
    into v_bid_load_id, v_bid_status, v_winner_trucker_id
    from bids
    where id = p_bid_id
    for update;

  if v_bid_load_id is null then
    raise exception 'award_bid: bid % not found', p_bid_id;
  end if;

  if v_bid_load_id <> p_load_id then
    raise exception 'award_bid: bid % does not belong to load %',
      p_bid_id, p_load_id;
  end if;

  if v_bid_status <> 'active' then
    raise exception 'award_bid: bid % is not active (status=%)',
      p_bid_id, v_bid_status;
  end if;

  -- Resolve phone numbers BEFORE we mutate anything else, so the return
  -- payload reflects the state the operator just acted on.
  select phone_e164 into v_winner_phone
    from truckers
    where id = v_winner_trucker_id;

  select coalesce(array_agg(t.phone_e164), array[]::text[]) into v_loser_phones
    from bids b
    join truckers t on t.id = b.trucker_id
    where b.load_id = p_load_id
      and b.id <> p_bid_id
      and b.status = 'active';

  -- Mutations:
  update loads
    set status = 'awarded'
    where id = p_load_id;

  update bids
    set status = 'won'
    where id = p_bid_id;

  update bids
    set status = 'lost'
    where load_id = p_load_id
      and id <> p_bid_id
      and status = 'active';

  insert into shipments (load_id, winning_bid_id, awarded_by)
    values (p_load_id, p_bid_id, p_operator_id)
    returning id into v_shipment_id;

  return query select v_shipment_id, v_winner_phone, v_loser_phones;
end;
$$;

-- Allow authenticated users to call award_bid (RLS still gates everything
-- inside it via the operator check). service_role can call it too.
revoke all on function award_bid(uuid, uuid, uuid) from public;
grant execute on function award_bid(uuid, uuid, uuid) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 8. Row Level Security
-- -----------------------------------------------------------------------------
-- The service_role key bypasses RLS automatically (Supabase grants it the
-- BYPASSRLS attribute). Use that key in the WhatsApp webhook handler — it
-- runs without an authenticated user and needs unrestricted access.
--
-- The anon and authenticated roles are subject to these policies. Our
-- dashboard uses the authenticated role.

-- Enable RLS everywhere.
alter table operators          enable row level security;
alter table truckers           enable row level security;
alter table routes             enable row level security;
alter table trucker_routes     enable row level security;
alter table loads              enable row level security;
alter table bids               enable row level security;
alter table shipments          enable row level security;
alter table whatsapp_messages  enable row level security;

-- 8.1 operators -------------------------------------------------------------
-- Any operator can SEE the team list (small team, flat trust model).
-- Only admins can ADD or REMOVE operators; admins can also UPDATE rows
-- (e.g. promote someone). A user can update their own full_name.
create policy operators_select on operators
  for select to authenticated
  using (is_operator());

create policy operators_insert_admin on operators
  for insert to authenticated
  with check (is_admin());

create policy operators_update_admin_or_self on operators
  for update to authenticated
  using (is_admin() or id = auth.uid())
  with check (is_admin() or id = auth.uid());

create policy operators_delete_admin on operators
  for delete to authenticated
  using (is_admin());

-- 8.2 truckers / routes / trucker_routes / loads / bids / shipments / whatsapp_messages
-- Same pattern: any operator can read and write. No deletes (we keep history).
-- Service role bypasses RLS for the webhook to insert truckers / bids /
-- whatsapp_messages without an auth context.

-- truckers
create policy truckers_select on truckers
  for select to authenticated using (is_operator());
create policy truckers_insert on truckers
  for insert to authenticated with check (is_operator());
create policy truckers_update on truckers
  for update to authenticated using (is_operator()) with check (is_operator());

-- routes
create policy routes_select on routes
  for select to authenticated using (is_operator());
create policy routes_insert on routes
  for insert to authenticated with check (is_operator());
create policy routes_update on routes
  for update to authenticated using (is_operator()) with check (is_operator());

-- trucker_routes
create policy trucker_routes_select on trucker_routes
  for select to authenticated using (is_operator());
create policy trucker_routes_insert on trucker_routes
  for insert to authenticated with check (is_operator());
create policy trucker_routes_update on trucker_routes
  for update to authenticated using (is_operator()) with check (is_operator());

-- loads
create policy loads_select on loads
  for select to authenticated using (is_operator());
create policy loads_insert on loads
  for insert to authenticated with check (is_operator());
create policy loads_update on loads
  for update to authenticated using (is_operator()) with check (is_operator());

-- bids
create policy bids_select on bids
  for select to authenticated using (is_operator());
create policy bids_insert on bids
  for insert to authenticated with check (is_operator());
create policy bids_update on bids
  for update to authenticated using (is_operator()) with check (is_operator());

-- shipments
create policy shipments_select on shipments
  for select to authenticated using (is_operator());
create policy shipments_insert on shipments
  for insert to authenticated with check (is_operator());
create policy shipments_update on shipments
  for update to authenticated using (is_operator()) with check (is_operator());

-- whatsapp_messages
create policy whatsapp_messages_select on whatsapp_messages
  for select to authenticated using (is_operator());
create policy whatsapp_messages_insert on whatsapp_messages
  for insert to authenticated with check (is_operator());
create policy whatsapp_messages_update on whatsapp_messages
  for update to authenticated using (is_operator()) with check (is_operator());


-- =============================================================================
-- Optional teardown (uncomment and run if you need to reset during development)
-- =============================================================================
-- drop function if exists award_bid(uuid, uuid, uuid);
-- drop function if exists is_operator();
-- drop function if exists is_admin();
-- drop function if exists set_updated_at() cascade;
-- drop table if exists whatsapp_messages cascade;
-- drop table if exists shipments         cascade;
-- drop table if exists bids              cascade;
-- drop table if exists loads             cascade;
-- drop table if exists trucker_routes    cascade;
-- drop table if exists routes            cascade;
-- drop table if exists truckers          cascade;
-- drop table if exists operators         cascade;
-- drop type if exists message_status;
-- drop type if exists message_direction;
-- drop type if exists delivery_status;
-- drop type if exists bid_status;
-- drop type if exists load_status;
-- drop type if exists trucker_status;
-- drop type if exists operator_role;
-- drop type if exists truck_type;
