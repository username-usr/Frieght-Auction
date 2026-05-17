'use server'

import { createClient } from '@/lib/supabase/server'

export type CancelErrorCode =
  | 'LOAD_NOT_OPEN'
  | 'NOT_POSTER'
  | 'LOAD_NOT_FOUND'
  | 'NOT_AUTHORIZED'
  | 'UNKNOWN'

export type CancelResult =
  | { success: true }
  | { success: false; error: string; errorCode: CancelErrorCode }

// Server action invoked from the cancel-load dialog on the load detail page.
// Wraps the cancel_load() Postgres function defined in
// supabase/migrations/0003_cancel_load.sql, which is the *only* sanctioned
// path to cancel a load — its FOR UPDATE on the load row is what protects
// against a cancel racing an award_bid() call.
export async function cancelLoadAction(
  loadId: string,
  reason: string | null
): Promise<CancelResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return notAuthorized()
  }

  const { data: operator } = await supabase
    .from('operators')
    .select('id')
    .eq('id', user.id)
    .maybeSingle()

  if (!operator) {
    return notAuthorized()
  }

  const trimmed = reason?.trim()
  const { error } = await supabase.rpc('cancel_load', {
    p_load_id: loadId,
    p_operator_id: operator.id,
    p_reason: trimmed ? trimmed : null,
  })

  if (error) {
    return mapCancelError(error.message)
  }

  return { success: true }
}

function notAuthorized(): CancelResult {
  return {
    success: false,
    error: 'Not authorized.',
    errorCode: 'NOT_AUTHORIZED',
  }
}

// Maps the RAISE EXCEPTION text from cancel_load() in
// supabase/migrations/0003_cancel_load.sql to user-friendly messages and
// stable error codes the UI can branch on. If those raise messages change,
// this map needs to change too.
function mapCancelError(message: string): CancelResult {
  if (message.includes('Load is no longer open')) {
    return {
      success: false,
      error: 'This load is no longer open.',
      errorCode: 'LOAD_NOT_OPEN',
    }
  }

  if (message.includes('Only the operator who posted this load can cancel it')) {
    return {
      success: false,
      error: 'Only the operator who posted this load can cancel it.',
      errorCode: 'NOT_POSTER',
    }
  }

  if (message.includes('Load not found')) {
    return {
      success: false,
      error: 'Load not found.',
      errorCode: 'LOAD_NOT_FOUND',
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.error('[cancelLoadAction] unmapped error:', message)
  }

  return {
    success: false,
    error: 'Could not cancel load. Try again.',
    errorCode: 'UNKNOWN',
  }
}
