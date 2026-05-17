-- Migration 0004: add missing auth.uid() guard to cancel_load.
--
-- Background: cancel_load() was missing the auth.uid() guard that
-- award_bid() has. This allowed a privilege escalation: any authenticated
-- operator could pass another operator's id as p_operator_id and cancel
-- loads they didn't post. Confirmed during Phase 3a testing.
--
-- Fix: replicate the dual-mode auth pattern from award_bid:
-- - Dashboard callers (auth.uid() set): caller must match p_operator_id
-- - Server-side service-role callers (auth.uid() null): trusted, but
--   operator id must still exist in the operators table
--
-- Signature unchanged. No client code changes required.

CREATE OR REPLACE FUNCTION cancel_load(
  p_load_id uuid,
  p_operator_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS SETOF loads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_load loads%ROWTYPE;
BEGIN
  -- AUTH GUARD: same dual-mode pattern as award_bid.
  -- Dashboard callers must match the supplied operator id.
  -- Server-side service-role calls (auth.uid() null) are trusted but
  -- the operator id must still exist.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_operator_id THEN
    RAISE EXCEPTION 'cancel_load: caller (%) does not match p_operator_id (%)',
      auth.uid(), p_operator_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM operators WHERE id = p_operator_id) THEN
    RAISE EXCEPTION 'cancel_load: operator % not found', p_operator_id;
  END IF;

  -- Lock the load row
  SELECT * INTO v_load FROM loads WHERE id = p_load_id FOR UPDATE;
  IF v_load IS NULL THEN
    RAISE EXCEPTION 'Load not found';
  END IF;

  -- Status check
  IF v_load.status <> 'open' THEN
    RAISE EXCEPTION 'Load is no longer open';
  END IF;

  -- Posted-by check (only the operator who posted can cancel)
  IF v_load.posted_by <> p_operator_id THEN
    RAISE EXCEPTION 'Only the operator who posted this load can cancel it';
  END IF;

  -- Cancel the load
  UPDATE loads
  SET status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = p_operator_id,
      cancellation_reason = NULLIF(trim(p_reason), ''),
      updated_at = now()
  WHERE id = p_load_id;

  -- Cascade: mark all active bids as lost
  UPDATE bids
  SET status = 'lost'
  WHERE load_id = p_load_id AND status = 'active';

  RETURN QUERY SELECT * FROM loads WHERE id = p_load_id;
END;
$$;

GRANT EXECUTE ON FUNCTION cancel_load(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_load(uuid, uuid, text) TO service_role;
