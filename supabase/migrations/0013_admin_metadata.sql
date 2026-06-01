-- =============================================================================
-- Migration 0013: Admin metadata — archived_at, is_admin/is_operator hardening,
--                 record_audit() coverage for trucker/operator changes,
--                 place_trucker_bid() rejects archived/suspended truckers.
--
-- Adds the plumbing the Phase 3e+3f admin pages need:
--   * truckers.archived_at, operators.archived_at (soft-delete)
--   * is_operator() / is_admin() refuse to recognize archived rows
--   * place_trucker_bid() blocks archived + blocked truckers explicitly
--   * record_audit() emits trucker_* / operator_* actions; the entity_type
--     CHECK on bid_audit_log is expanded to allow them
--   * After-row triggers attached to truckers and operators
--
-- record_audit() has regressed twice (migrations 0010 and 0011 each dropped a
-- previously-added branch). The body below is the full re-statement and
-- preserves: bids, loads, shipments, load_items, the trucker-session-variable
-- fallback for actor attribution, plus the new truckers + operators branches.
--
-- Apply once in the Supabase SQL editor. Not idempotent for the entity_type
-- CHECK swap (uses plain DROP CONSTRAINT / ADD CONSTRAINT).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Soft-delete columns
-- -----------------------------------------------------------------------------
-- IF NOT EXISTS guards against accidental re-application. archived_at=NULL
-- means active; non-null records the moment the row was archived.

alter table truckers
  add column if not exists archived_at timestamptz;

alter table operators
  add column if not exists archived_at timestamptz;


-- -----------------------------------------------------------------------------
-- 2. is_operator() — refuse archived operators
-- -----------------------------------------------------------------------------
-- Only the archived_at filter is new; signature, language, volatility, and
-- search_path are unchanged from 0001 so existing RLS policies behave
-- identically for live operators.

create or replace function is_operator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from operators
    where id = auth.uid()
      and archived_at is null
  )
$$;


-- -----------------------------------------------------------------------------
-- 3. is_admin() — refuse archived admins
-- -----------------------------------------------------------------------------
-- is_admin() already existed in 0001 (predates the admin UI). Re-stated here
-- with the archived_at filter so an archived admin loses their elevated
-- permissions immediately, even if they still hold a valid Supabase session.

create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from operators
    where id = auth.uid()
      and role = 'admin'
      and archived_at is null
  )
$$;

grant execute on function is_admin() to authenticated;


-- -----------------------------------------------------------------------------
-- 4. bid_audit_log.entity_type CHECK — allow trucker + operator values
-- -----------------------------------------------------------------------------
-- 0012 added 'load_item'. This adds 'trucker' and 'operator' so the audit
-- inserts that the trigger about to be re-defined will emit don't get
-- rejected with a 23514 error.

alter table bid_audit_log
  drop constraint bid_audit_log_entity_type_check;

alter table bid_audit_log
  add constraint bid_audit_log_entity_type_check
  check (entity_type in (
    'bid', 'load', 'shipment', 'load_item', 'trucker', 'operator'
  ));


-- -----------------------------------------------------------------------------
-- 5. record_audit() — full body with all branches
-- -----------------------------------------------------------------------------
-- Full restatement. Previous incremental edits (0010, 0011) each silently
-- dropped a branch; this version re-asserts everything in one place so
-- regressions are obvious in diff review.
--
-- Branches present, in order: bids, loads, shipments, load_items, truckers,
-- operators. Actor resolution: JWT auth.uid() first, then the trucker session
-- variable that place_trucker_bid() sets via SET LOCAL, then 'system'.

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
  -- 5a. Actor identity: JWT first, then trucker session var, then system.
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

  -- 5b. Serialize before/after rows as jsonb.
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

  -- 5c. Plural table name → singular entity_type.
  v_entity_type := case TG_TABLE_NAME
    when 'bids'       then 'bid'
    when 'loads'      then 'load'
    when 'shipments'  then 'shipment'
    when 'load_items' then 'load_item'
    when 'truckers'   then 'trucker'
    when 'operators'  then 'operator'
  end;

  -- 5d. Per-table action label, entity_id, and load_id.
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
-- 6. place_trucker_bid() — reject archived + suspended truckers explicitly
-- -----------------------------------------------------------------------------
-- The body from 0006 already rejected non-active truckers via the catch-all
-- "<> 'active'" check, but with a generic message. The new explicit checks
-- give the trucker portal a chance to render specific copy ("account
-- archived" / "account suspended") instead of the generic fallback.
--
-- Single SELECT pulls both columns so we don't add a round-trip. Everything
-- else (session var, load lock, upsert) is preserved verbatim from 0006.

create or replace function place_trucker_bid(
  p_trucker_id   uuid,
  p_load_id      uuid,
  p_amount_paise bigint
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trucker_status   trucker_status;
  v_trucker_archived timestamptz;
  v_load_status      load_status;
  v_existing_bid_id  uuid;
  v_new_bid_id       uuid;
begin
  if p_amount_paise is null or p_amount_paise <= 0 then
    raise exception 'Bid amount must be positive';
  end if;

  -- Stamp the transaction so the audit trigger can attribute correctly.
  perform set_config('app.trucker_id', p_trucker_id::text, true);

  -- Pull status + archived_at in one read.
  select status, archived_at
    into v_trucker_status, v_trucker_archived
    from truckers
    where id = p_trucker_id;

  if v_trucker_status is null then
    raise exception 'Trucker not found';
  end if;
  if v_trucker_archived is not null then
    raise exception 'Account archived' using errcode = '42501';
  end if;
  if v_trucker_status = 'blocked' then
    raise exception 'Account suspended from bidding' using errcode = '42501';
  end if;
  -- Catch-all: 'inactive' or any future non-active status.
  if v_trucker_status <> 'active' then
    raise exception 'Trucker account is not active';
  end if;

  -- Lock the load row so an in-flight award_bid / cancel_load can't change
  -- its status between our check and the bid insert.
  select status into v_load_status
    from loads
    where id = p_load_id
    for update;

  if v_load_status is null then
    raise exception 'Load not found';
  end if;
  if v_load_status <> 'open' then
    raise exception 'Load is no longer open';
  end if;

  -- Upsert: the partial unique index (load_id, trucker_id) WHERE status='active'
  -- guarantees at most one row matches, so we update in place rather than
  -- withdraw-then-insert (would double the audit rows and race the index).
  select id into v_existing_bid_id
    from bids
    where load_id    = p_load_id
      and trucker_id = p_trucker_id
      and status     = 'active'
    for update;

  if v_existing_bid_id is not null then
    update bids
       set amount_paise = p_amount_paise
     where id = v_existing_bid_id;
    return v_existing_bid_id;
  end if;

  insert into bids (load_id, trucker_id, amount_paise, status)
    values (p_load_id, p_trucker_id, p_amount_paise, 'active')
    returning id into v_new_bid_id;

  return v_new_bid_id;
end;
$$;

revoke all on function place_trucker_bid(uuid, uuid, bigint) from public;
grant execute on function place_trucker_bid(uuid, uuid, bigint) to anon, authenticated;


-- -----------------------------------------------------------------------------
-- 7. Audit triggers on truckers + operators
-- -----------------------------------------------------------------------------

drop trigger if exists record_audit_truckers on truckers;
create trigger record_audit_truckers
  after insert or update or delete on truckers
  for each row execute function record_audit();

drop trigger if exists record_audit_operators on operators;
create trigger record_audit_operators
  after insert or update or delete on operators
  for each row execute function record_audit();
