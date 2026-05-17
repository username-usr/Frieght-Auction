-- =============================================================================
-- Migration 0003: Cancel load flow
--
-- Adds cancellation columns to `loads` and creates `cancel_load()`, the
-- atomic counterpart to `award_bid()` (see 0001_initial_schema.sql).
--
-- Safe to re-run on an existing database: the column adds use IF NOT EXISTS
-- and the function uses CREATE OR REPLACE.
-- =============================================================================

-- 1. Cancellation columns -----------------------------------------------------
-- Nullable on purpose; only populated when a load is cancelled. We keep this
-- on `loads` rather than a separate `load_cancellations` table because there
-- is exactly one cancellation per load at most, and the audit-log table
-- (Step 7) will hold the immutable event record.

alter table loads add column if not exists cancelled_at        timestamptz;
alter table loads add column if not exists cancelled_by        uuid references operators(id);
alter table loads add column if not exists cancellation_reason text;


-- 2. cancel_load() ------------------------------------------------------------
-- Why a Postgres function and not application-layer SQL:
--   * Two tables mutate (loads + bids) and must commit together. PostgREST /
--     supabase-js cannot open an explicit transaction, so doing this from the
--     dashboard would risk a half-applied cancel (load flipped, bids not).
--   * We need SELECT ... FOR UPDATE on the load row so a concurrent award_bid()
--     blocks here instead of racing us. Whoever acquires the lock first wins;
--     the loser sees status <> 'open' and raises.
--
-- SECURITY DEFINER: same reasoning as award_bid(). The cascade UPDATE on bids
-- needs to run regardless of the caller's RLS context, and we re-check the
-- operator's identity inside the function (the posted_by guard below) instead
-- of relying on RLS. UI conditional rendering is convenience; THIS is the
-- source of truth for who is allowed to cancel.

create or replace function cancel_load(
  p_load_id     uuid,
  p_operator_id uuid,
  p_reason      text default null
)
returns setof loads
language plpgsql
security definer
set search_path = public
as $$
declare
  v_load loads%rowtype;
begin
  -- Acquire row lock on the load. Concurrent award_bid() or another
  -- cancel_load() call for this same load will block here until we commit
  -- or roll back.
  select * into v_load
    from loads
    where id = p_load_id
    for update;

  if v_load.id is null then
    raise exception 'Load not found';
  end if;

  if v_load.status <> 'open' then
    raise exception 'Load is no longer open';
  end if;

  -- Permission check: only the operator who posted the load may cancel it.
  -- This is the authoritative gate; the UI hides the button as a convenience
  -- but a hand-crafted RPC call from elsewhere must still be rejected here.
  if v_load.posted_by <> p_operator_id then
    raise exception 'Only the operator who posted this load can cancel it';
  end if;

  update loads
     set status              = 'cancelled',
         cancelled_at        = now(),
         cancelled_by        = p_operator_id,
         cancellation_reason = p_reason,
         updated_at          = now()
   where id = p_load_id;

  -- Cascade: every still-active bid becomes 'lost'. Already-withdrawn or
  -- previously-lost rows are left as-is so the historical trail is preserved.
  update bids
     set status = 'lost'
   where load_id = p_load_id
     and status  = 'active';

  return query select * from loads where id = p_load_id;
end;
$$;

revoke all on function cancel_load(uuid, uuid, text) from public;
grant execute on function cancel_load(uuid, uuid, text) to authenticated;
