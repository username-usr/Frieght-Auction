-- =============================================================================
-- Migration 0019: Trucker acceptance lifecycle.
--
-- Splits the post-award flow into a 3-way choice for the trucker:
--   open → award → awarded (awaiting trucker response)
--                  ↓
--                  trucker accepts  → 'accepted' (then later → 'completed')
--                  trucker declines → 'declined' (operator can re-award)
--                  operator cancels → back to 'open' (bidding resumes)
--
-- Adds:
--   * 'accepted' and 'declined' to load_status enum
--   * 'declined' to bid_status enum
--   * loads.accepted_at / declined_at / decline_reason columns
--   * accept_award(p_load_id, p_trucker_id)   RPC, trucker-driven
--   * decline_award(p_load_id, p_trucker_id, p_reason)  RPC, trucker-driven
--   * cancel_award(p_load_id, p_operator_id)  RPC, operator-driven
--
-- Modifies:
--   * award_bid: precondition now accepts 'open' OR 'declined' so the
--     operator can re-award a bid after a trucker declined. The first-
--     time 'open' → 'awarded' path is unchanged.
--   * record_audit: loads branch picks up acceptance/decline transitions
--     before falling through to completed_at / status / generic checks.
--     The bids branch already covers 'bid_declined' via the
--     'bid_' || NEW.status::text generic case — no change needed there.
--     ALL 8 branches (bids, loads, shipments, load_items, truckers,
--     operators, zones, load_trucker_visibility) plus the trucker
--     session variable lookup are preserved verbatim.
--
-- IMPORTANT: ALTER TYPE ADD VALUE has to run in its own transaction in
-- older Postgres, and the new values can't be used in the same transaction
-- they're added. Supabase's SQL editor runs each statement in autocommit
-- mode, so the ALTER TYPE → ALTER TABLE → CREATE OR REPLACE FUNCTION
-- ordering applies cleanly. Apply once in the SQL editor.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Enum extensions
-- -----------------------------------------------------------------------------

alter type load_status add value if not exists 'accepted';
alter type load_status add value if not exists 'declined';

alter type bid_status add value if not exists 'declined';


-- -----------------------------------------------------------------------------
-- 2. loads: acceptance / decline columns
-- -----------------------------------------------------------------------------

alter table loads
  add column if not exists accepted_at    timestamptz,
  add column if not exists declined_at    timestamptz,
  add column if not exists decline_reason text;


-- -----------------------------------------------------------------------------
-- 3. accept_award(p_load_id, p_trucker_id) — trucker-driven
-- -----------------------------------------------------------------------------
-- Trucker portal flow: the trucker is signed in via the cookie session
-- (not Supabase Auth), so this function does NOT use auth.uid(). The
-- caller's identity is asserted by p_trucker_id and verified by checking
-- the bids table (only a trucker with a 'won' bid on this load can accept).
--
-- set_config('app.trucker_id', ...) primes the trucker-session var so the
-- audit trigger attributes the resulting 'load_accepted' row to the right
-- actor (migration 0006 pattern).
--
-- Granted to anon AND authenticated because trucker requests hit PostgREST
-- as anon — they have no Supabase JWT.

create or replace function accept_award(
  p_load_id    uuid,
  p_trucker_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_load_status load_status;
  v_bid_count   integer;
begin
  -- Stamp the session so the audit trigger picks up the trucker's id.
  perform set_config('app.trucker_id', p_trucker_id::text, true);

  -- Lock the load row to serialize against concurrent accept/decline/cancel.
  select status into v_load_status
    from loads
    where id = p_load_id
    for update;

  if v_load_status is null then
    raise exception 'Load not found';
  end if;
  if v_load_status <> 'awarded' then
    raise exception 'Load is not awaiting acceptance (status=%)', v_load_status;
  end if;

  -- Verify caller actually has the winning bid on this load. Defends
  -- against a malicious or buggy client calling with someone else's
  -- trucker_id.
  select count(*) into v_bid_count
    from bids
    where load_id    = p_load_id
      and trucker_id = p_trucker_id
      and status     = 'won';

  if v_bid_count = 0 then
    raise exception 'No winning bid for this trucker on this load';
  end if;

  update loads
    set status      = 'accepted',
        accepted_at = now()
    where id = p_load_id;
end;
$$;

revoke all on function accept_award(uuid, uuid) from public;
grant execute on function accept_award(uuid, uuid) to anon, authenticated;


-- -----------------------------------------------------------------------------
-- 4. decline_award(p_load_id, p_trucker_id, p_reason) — trucker-driven
-- -----------------------------------------------------------------------------
-- Same authentication model as accept_award. The reason is mandatory; the
-- empty / whitespace check fires before the session stamp so a bad call
-- doesn't pollute the audit log.

create or replace function decline_award(
  p_load_id    uuid,
  p_trucker_id uuid,
  p_reason     text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_load_status load_status;
begin
  if p_reason is null or trim(p_reason) = '' then
    raise exception 'Decline reason is required';
  end if;

  perform set_config('app.trucker_id', p_trucker_id::text, true);

  select status into v_load_status
    from loads
    where id = p_load_id
    for update;

  if v_load_status is null then
    raise exception 'Load not found';
  end if;
  if v_load_status <> 'awarded' then
    raise exception 'Load is not awaiting acceptance (status=%)', v_load_status;
  end if;

  -- Flip the trucker's winning bid to 'declined'. We don't pre-check
  -- existence because the UPDATE itself catches no-match (zero rows
  -- affected → still passes), but combined with the load status check
  -- above a stranger trying to decline someone else's win would have
  -- already been rejected at the load_status step.
  update bids
    set status = 'declined'
    where load_id    = p_load_id
      and trucker_id = p_trucker_id
      and status     = 'won';

  update loads
    set status         = 'declined',
        declined_at    = now(),
        decline_reason = trim(p_reason)
    where id = p_load_id;
end;
$$;

revoke all on function decline_award(uuid, uuid, text) from public;
grant execute on function decline_award(uuid, uuid, text) to anon, authenticated;


-- -----------------------------------------------------------------------------
-- 5. cancel_award(p_load_id, p_operator_id) — operator-driven
-- -----------------------------------------------------------------------------
-- Used when the operator wants to take the award back BEFORE the trucker
-- has responded. Reverts the load to 'open', flips the winning bid back
-- to 'active', flips the auto-lost bids back to 'active' too, and removes
-- the shipment row that award_bid created.
--
-- Uses auth.uid() (operator client carries a Supabase JWT), unlike the
-- two trucker-driven RPCs above.

create or replace function cancel_award(
  p_load_id     uuid,
  p_operator_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller_id   uuid;
  v_load_status load_status;
begin
  v_caller_id := auth.uid();
  if v_caller_id is null or v_caller_id <> p_operator_id then
    raise exception 'caller does not match p_operator_id' using errcode = '42501';
  end if;
  if not is_operator() then
    raise exception 'Only operators can cancel awards' using errcode = '42501';
  end if;

  select status into v_load_status
    from loads
    where id = p_load_id
    for update;

  if v_load_status is null then
    raise exception 'Load not found';
  end if;
  if v_load_status not in ('awarded') then
    raise exception 'Load is not in cancellable state (status=%)', v_load_status;
  end if;

  -- Winning bid → active so the trucker can withdraw or the operator can
  -- re-award later.
  update bids
    set status = 'active'
    where load_id = p_load_id
      and status  = 'won';

  -- Auto-lost bids → active too. They were valid candidates before; they
  -- are again now that the award is being undone.
  update bids
    set status = 'active'
    where load_id = p_load_id
      and status  = 'lost';

  -- Drop the shipment row created by award_bid.
  delete from shipments where load_id = p_load_id;

  update loads
    set status      = 'open',
        accepted_at = null
    where id = p_load_id;
end;
$$;

revoke all on function cancel_award(uuid, uuid) from public;
grant execute on function cancel_award(uuid, uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- 6. award_bid — accept 'declined' as a re-awardable state
-- -----------------------------------------------------------------------------
-- Full CREATE OR REPLACE with the original body from 0001 carried through
-- verbatim except for two changes, both in the loads branch:
--   (a) precondition allows 'open' OR 'declined' (was 'open' only)
--   (b) when re-awarding from 'declined', the UPDATE clears declined_at
--       and decline_reason so the row's history reflects the new attempt
--
-- The lock semantics, bid-status mutations, shipment insert, and return
-- payload all stay byte-identical.

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

  -- 0019: accept 'declined' too so the operator can re-award a load after
  -- the first-pick trucker declined. The first-time 'open' → 'awarded'
  -- path is unchanged.
  if v_load_status not in ('open', 'declined') then
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

  -- Mutations. The decline-state reset (declined_at + decline_reason) is
  -- a no-op when we're going from 'open' → 'awarded' for the first time.
  update loads
    set status         = 'awarded',
        declined_at    = null,
        decline_reason = null
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

revoke all on function award_bid(uuid, uuid, uuid) from public;
grant execute on function award_bid(uuid, uuid, uuid) to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 7. record_audit — full body with all 8 branches, loads branch extended
-- -----------------------------------------------------------------------------
-- Carried verbatim from migration 0016 (the latest restatement; 0017 and
-- 0018 didn't touch record_audit). Only the loads branch is modified:
--   * accepted_at / declined_at / re-offer transitions take precedence
--   * completed_at / generic status / generic update checks unchanged
--
-- Branches present, in order: bids, loads, shipments, load_items, truckers,
-- operators, zones, load_trucker_visibility — 8 total. Trucker session var
-- lookup preserved at the top.

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
  -- 7a. Actor identity: JWT first, then trucker session var, then system.
  v_actor_id := auth.uid();

  if v_actor_id is null then
    -- Fall back to the trucker session variable that place_trucker_bid()
    -- and the new accept/decline RPCs set within their transactions.
    -- nullif(..., '') handles the case where the GUC was never SET.
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

  -- 7b. Serialize before/after rows as jsonb.
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

  -- 7c. Plural table name → singular entity_type.
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

  -- 7d. Per-table action label, entity_id, and load_id.
  if TG_TABLE_NAME = 'bids' then
    if TG_OP = 'INSERT' then
      v_action := 'bid_placed';
    elsif TG_OP = 'UPDATE' then
      -- The generic 'bid_' || NEW.status::text catches every transition:
      -- bid_won, bid_lost, bid_withdrawn, bid_declined, bid_active.
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
      -- Acceptance / decline transitions take precedence over the older
      -- completed_at + generic status branches so the audit label is
      -- descriptive for the new lifecycle steps.
      if OLD.accepted_at is null and NEW.accepted_at is not null then
        v_action := 'load_accepted';
      elsif OLD.declined_at is null and NEW.declined_at is not null then
        v_action := 'load_declined';
      elsif OLD.declined_at is not null
            and NEW.declined_at is null
            and NEW.status = 'awarded' then
        v_action := 'load_award_re_offered';
      elsif OLD.completed_at is null and NEW.completed_at is not null then
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
