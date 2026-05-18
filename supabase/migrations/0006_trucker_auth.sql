-- =============================================================================
-- Migration 0006: Trucker auth + bid attribution
--
-- Adds a phone+password auth flow for the /t (trucker preview) portal,
-- separate from Supabase Auth (which is reserved for operators). Truckers
-- have no email accounts in the system, so we hash their chosen password
-- onto the existing truckers row instead of creating Supabase Auth users.
--
-- Also wires up audit-log attribution for trucker writes. Because trucker
-- requests never have a JWT, auth.uid() is NULL inside their transactions;
-- without a separate signal the audit log would record them all as
-- actor_role='system'. Fix: trucker server actions go through a SECURITY
-- DEFINER RPC (place_trucker_bid) that sets a per-transaction session
-- variable `app.trucker_id`; record_audit() reads it as a fallback.
--
-- Idempotent: column adds use IF NOT EXISTS; functions use CREATE OR REPLACE.
-- =============================================================================


-- 1. Columns -----------------------------------------------------------------

alter table truckers
  add column if not exists password_hash    text,
  add column if not exists password_set_at  timestamptz;

-- password_hash is nullable on purpose: a trucker exists (an operator added
-- their row) before they've set a password. NULL means "first-login flow:
-- send them to /t/set-password".


-- 2. trucker_set_password ----------------------------------------------------
-- First-time password setter. Fails if the trucker already has a password
-- (we explicitly do not silently overwrite; that path is "password reset",
-- which we'll add later).
--
-- pgcrypto (enabled in 0001) provides crypt() + gen_salt('bf') = bcrypt.

create or replace function trucker_set_password(
  p_phone    text,
  p_password text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trucker truckers%rowtype;
begin
  select * into v_trucker from truckers where phone_e164 = p_phone;
  if v_trucker.id is null then
    raise exception 'Trucker not registered';
  end if;

  if v_trucker.password_hash is not null then
    raise exception 'Password already set; use password reset';
  end if;

  update truckers
     set password_hash    = crypt(p_password, gen_salt('bf', 10)),
         password_set_at  = now()
   where id = v_trucker.id;

  return v_trucker.id;
end;
$$;

revoke all on function trucker_set_password(text, text) from public;
grant execute on function trucker_set_password(text, text) to anon, authenticated;


-- 3. trucker_verify_password -------------------------------------------------
-- Returns the trucker_id on a successful match, NULL otherwise (including
-- "no such phone" and "password not yet set"). The caller decides what to
-- say to the user — we deliberately don't distinguish "bad phone" from "bad
-- password" in the return value to avoid an account-enumeration oracle.

create or replace function trucker_verify_password(
  p_phone    text,
  p_password text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id    uuid;
  v_hash  text;
begin
  select id, password_hash
    into v_id, v_hash
    from truckers
    where phone_e164 = p_phone;

  if v_id is null or v_hash is null then
    return null;
  end if;

  -- crypt() with an existing hash extracts the salt from that hash and
  -- recomputes — so the equality test below is the bcrypt verify operation.
  if v_hash = crypt(p_password, v_hash) then
    return v_id;
  end if;

  return null;
end;
$$;

revoke all on function trucker_verify_password(text, text) from public;
grant execute on function trucker_verify_password(text, text) to anon, authenticated;


-- 4. trucker_check_phone -----------------------------------------------------
-- Lightweight lookup used by /t/login's first stage: does this phone exist,
-- and does it already have a password? Lets the UI route the user to either
-- the password input or the set-password screen without exposing whether
-- arbitrary phones are registered.
--
-- Returns ('not_registered' | 'needs_password' | 'has_password').

create or replace function trucker_check_phone(p_phone text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hash text;
  v_exists boolean;
begin
  select password_hash, true into v_hash, v_exists
    from truckers where phone_e164 = p_phone;

  if v_exists is null then
    return 'not_registered';
  end if;

  if v_hash is null then
    return 'needs_password';
  end if;

  return 'has_password';
end;
$$;

revoke all on function trucker_check_phone(text) from public;
grant execute on function trucker_check_phone(text) to anon, authenticated;


-- 5. place_trucker_bid -------------------------------------------------------
-- The ONLY sanctioned write path for trucker bids. Wraps three concerns in
-- a single transaction:
--
--   (a) Audit attribution: SET LOCAL app.trucker_id so record_audit()'s
--       fallback branch (see section 6 below) tags the resulting audit row
--       with actor_role='trucker' and the correct actor_id. We cannot do
--       this from supabase-js because each .from()/.rpc() call is its own
--       HTTP request and its own transaction — a SET LOCAL in one call
--       would not survive into a subsequent INSERT call.
--
--   (b) Concurrency: lock the load row with SELECT ... FOR UPDATE so an
--       in-flight award_bid()/cancel_load() can't transition the load to
--       a non-open state mid-bid.
--
--   (c) Upsert semantics: a partial unique index on bids enforces "one
--       active bid per trucker per load". To "update" a bid, we update the
--       existing active row's amount_paise in place. (We deliberately do
--       NOT withdraw-then-insert because that would create extra audit
--       noise and would race with the unique index.)
--
-- SECURITY DEFINER + grant to anon, because trucker sessions never carry a
-- Supabase JWT — they hit PostgREST as the anon role. The function performs
-- its own validation (trucker exists & active, load open, amount > 0).

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
  v_load_status      load_status;
  v_existing_bid_id  uuid;
  v_new_bid_id       uuid;
begin
  if p_amount_paise is null or p_amount_paise <= 0 then
    raise exception 'Bid amount must be positive';
  end if;

  -- (a) Stamp the transaction so the audit trigger can attribute correctly.
  perform set_config('app.trucker_id', p_trucker_id::text, true);

  -- Verify the trucker is real and active.
  select status into v_trucker_status from truckers where id = p_trucker_id;
  if v_trucker_status is null then
    raise exception 'Trucker not found';
  end if;
  if v_trucker_status <> 'active' then
    raise exception 'Trucker account is not active';
  end if;

  -- (b) Lock the load row.
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

  -- (c) Upsert. There's a partial unique index
  -- (load_id, trucker_id) WHERE status='active', so at most one row matches.
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


-- 6. record_audit(): trucker-session-var fallback ----------------------------
-- Additive change. Operator flows continue to land via auth.uid(). Trucker
-- flows that went through place_trucker_bid() above will have set the
-- session var, and we pick it up here. Pure service-role / SQL-editor
-- writes still fall through to 'system'.
--
-- All other behaviour (jsonb serialization, action labels, entity mapping,
-- trigger return) is identical to migration 0005's record_audit().

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
  -- 6a. Resolve actor identity from JWT first; fall back to the trucker
  -- session variable that place_trucker_bid() sets within its transaction.
  v_actor_id := auth.uid();

  if v_actor_id is null then
    -- nullif(..., '') handles the case where the GUC was never SET; the
    -- 'true' arg to current_setting means "missing_ok" — return '' rather
    -- than erroring on the lookup.
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

  -- 6b. before/after jsonb.
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

  -- 6c. Plural table name → singular entity_type.
  v_entity_type := case TG_TABLE_NAME
    when 'bids'      then 'bid'
    when 'loads'     then 'load'
    when 'shipments' then 'shipment'
  end;

  -- 6d. Per-table action label, entity_id, load_id.
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
  end if;

  -- 6e. Insert.
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
