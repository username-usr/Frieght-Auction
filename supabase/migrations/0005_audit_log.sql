-- =============================================================================
-- Migration 0005: Audit log
--
-- Append-only history of every change to bids, loads, and shipments. Postgres
-- triggers do all the writing — no application code changes are required for
-- the database layer. The dashboard gets a new per-load viewer (a separate
-- file, app/dashboard/loads/[id]/audit/page.tsx).
--
-- Backfill: DELIBERATELY SKIPPED. The existing test data is messy from prior
-- cancel/award testing. The audit log starts fresh from the moment this
-- migration is applied; historical actions are not retroactively recorded.
--
-- Idempotent: the table uses IF NOT EXISTS, indexes use IF NOT EXISTS, the
-- trigger function uses CREATE OR REPLACE, and triggers are dropped before
-- being recreated. Safe to re-run.
-- =============================================================================


-- 1. bid_audit_log table -----------------------------------------------------

create table if not exists bid_audit_log (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('bid', 'load', 'shipment')),
  entity_id   uuid not null,
  action      text not null,
  -- actor_id is nullable for service-role / system writes. Phase 4 WhatsApp
  -- ingestion runs without a JWT and lands as actor_id=NULL, role='system'.
  actor_id    uuid,
  -- 'admin' | 'operator' | 'trucker' | 'system' (free text; not an enum so
  -- future roles don't require a migration).
  actor_role  text,
  before      jsonb,
  after       jsonb,
  -- Denormalized load_id for fast per-load lookup. Computed inside the
  -- trigger from the row being modified. NULL only for orphaned/edge cases.
  load_id     uuid,
  created_at  timestamptz not null default now()
);


-- 2. Indexes -----------------------------------------------------------------

create index if not exists bid_audit_log_load_id_created_idx
  on bid_audit_log (load_id, created_at desc);

create index if not exists bid_audit_log_entity_idx
  on bid_audit_log (entity_type, entity_id, created_at desc);

create index if not exists bid_audit_log_created_at_idx
  on bid_audit_log (created_at desc);


-- 3. Grants ------------------------------------------------------------------
-- Append-only at the API level. The trigger function below is
-- SECURITY DEFINER, so it can INSERT regardless of these grants —
-- they only affect direct API access (PostgREST / supabase-js).
-- No role can INSERT, UPDATE, or DELETE via the API.

revoke update, delete on bid_audit_log from public;
revoke update, delete on bid_audit_log from authenticated;
revoke update, delete on bid_audit_log from anon;
revoke update, delete on bid_audit_log from service_role;

revoke insert on bid_audit_log from public;
revoke insert on bid_audit_log from authenticated;
revoke insert on bid_audit_log from anon;
revoke insert on bid_audit_log from service_role;

grant select on bid_audit_log to authenticated;
grant select on bid_audit_log to service_role;


-- 4. Row Level Security ------------------------------------------------------
-- Enable RLS, with an explicit policy that mirrors the GRANT model:
-- any authenticated user can SELECT all rows. The REVOKEs above already
-- prevent INSERT/UPDATE/DELETE via the API; RLS adds row-level enforcement
-- on SELECT as a defense in depth (and silences Supabase's linter).

alter table bid_audit_log enable row level security;

-- DROP POLICY IF EXISTS before CREATE POLICY so re-running the migration is
-- safe. CREATE POLICY itself is not idempotent.
drop policy if exists "Authenticated operators can read audit log" on bid_audit_log;
drop policy if exists "Service role can read audit log" on bid_audit_log;

create policy "Authenticated operators can read audit log"
  on bid_audit_log for select to authenticated using (true);

create policy "Service role can read audit log"
  on bid_audit_log for select to service_role using (true);


-- 5. record_audit() trigger function -----------------------------------------
-- Fires AFTER each row-level change on bids/loads/shipments. AFTER (not
-- BEFORE) is important: if the surrounding transaction rolls back, the audit
-- row goes with it — we never want audit entries for actions that didn't
-- actually happen.
--
-- The function is SECURITY DEFINER so its INSERT into bid_audit_log works
-- regardless of the triggering role's grants. auth.uid() still reads the
-- caller's JWT identity (SECURITY DEFINER changes current_user but not the
-- session-level JWT claims that auth.uid() reads).

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
  -- 4a. Resolve actor identity from JWT.
  v_actor_id := auth.uid();

  if v_actor_id is null then
    v_actor_role := 'system';
  else
    select role::text into v_actor_role
      from operators where id = v_actor_id;
    -- If the caller is authenticated but isn't an operator, assume trucker
    -- (Phase 4 will introduce trucker auth via a separate flow).
    if v_actor_role is null then
      v_actor_role := 'trucker';
    end if;
  end if;

  -- 4b. Serialize before/after rows as jsonb.
  if TG_OP = 'INSERT' then
    v_before := null;
    v_after  := to_jsonb(NEW);
  elsif TG_OP = 'UPDATE' then
    v_before := to_jsonb(OLD);
    v_after  := to_jsonb(NEW);
  elsif TG_OP = 'DELETE' then
    -- Defensive: this app never deletes via the API, but cover the case so
    -- a stray DELETE (admin SQL editor, manual cleanup) is still recorded.
    v_before := to_jsonb(OLD);
    v_after  := null;
  end if;

  -- 4c. Map plural table name → singular entity_type.
  v_entity_type := case TG_TABLE_NAME
    when 'bids'      then 'bid'
    when 'loads'     then 'load'
    when 'shipments' then 'shipment'
  end;

  -- 4d. Per-table action label, entity_id, and load_id.
  if TG_TABLE_NAME = 'bids' then
    if TG_OP = 'INSERT' then
      v_action := 'bid_placed';
    elsif TG_OP = 'UPDATE' then
      if OLD.status is distinct from NEW.status then
        -- bid_won, bid_lost, bid_withdrawn, bid_active
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
        -- load_awarded, load_cancelled, load_completed (load_open is unusual
        -- but recorded if it ever happens)
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
  end if;

  -- 4e. Insert the audit row.
  insert into bid_audit_log (
    entity_type, entity_id, action, actor_id, actor_role,
    before, after, load_id
  ) values (
    v_entity_type, v_entity_id, v_action, v_actor_id, v_actor_role,
    v_before, v_after, v_load_id
  );

  -- 4f. Trigger return value (required by row-level triggers).
  if TG_OP = 'DELETE' then
    return OLD;
  else
    return NEW;
  end if;
end;
$$;


-- 6. Attach triggers ---------------------------------------------------------
-- DROP TRIGGER IF EXISTS before CREATE TRIGGER so the migration is safe to
-- re-run. (CREATE TRIGGER IF NOT EXISTS isn't available in older Postgres
-- versions; the drop+create pattern works universally.)

drop trigger if exists bids_audit_trigger      on bids;
drop trigger if exists loads_audit_trigger     on loads;
drop trigger if exists shipments_audit_trigger on shipments;

create trigger bids_audit_trigger
  after insert or update or delete on bids
  for each row execute function record_audit();

create trigger loads_audit_trigger
  after insert or update or delete on loads
  for each row execute function record_audit();

create trigger shipments_audit_trigger
  after insert or update or delete on shipments
  for each row execute function record_audit();
