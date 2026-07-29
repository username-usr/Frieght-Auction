'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { sendNewLoadAlerts } from '@/lib/notifications/new-load-alert'

export type AwardErrorCode =
  | 'CONCURRENT_AWARD'
  | 'BID_INACTIVE'
  | 'LOAD_NOT_OPEN'
  | 'NOT_AUTHORIZED'
  | 'UNKNOWN'

export type AwardResult =
  | {
      success: true
      shipmentId: string
      winnerPhone: string
      loserPhones: string[]
    }
  | {
      success: false
      error: string
      errorCode: AwardErrorCode
    }

// Server action invoked from the bids table on the load detail page. Wraps
// the award_bid() Postgres function defined in 0001_initial_schema.sql, which
// is the *only* sanctioned path to award a bid — its FOR UPDATE on the load
// row is what protects against two operators awarding the same load at once.
export async function awardBidAction(
  loadId: string,
  bidId: string
): Promise<AwardResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return notAuthorized()
  }

  // Resolve the operator row. RLS would also block a non-operator from
  // calling award_bid in practice, but failing here gives a cleaner UX path.
  const { data: operator } = await supabase
    .from('operators')
    .select('id')
    .eq('id', user.id)
    .maybeSingle()

  if (!operator) {
    return notAuthorized()
  }

  const { data, error } = await supabase.rpc('award_bid', {
    p_load_id: loadId,
    p_bid_id: bidId,
    p_operator_id: operator.id,
  })

  if (error) {
    return mapAwardError(error.message)
  }

  // award_bid is `RETURNS TABLE (...)`, so even though the function emits
  // exactly one row, supabase-js gives us an array. Take the first row.
  const row = Array.isArray(data) ? data[0] : data
  if (!row) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.error('[awardBidAction] empty data with no error')
    }
    return {
      success: false,
      error: 'Something went wrong.',
      errorCode: 'UNKNOWN',
    }
  }

  return {
    success: true,
    shipmentId: row.shipment_id as string,
    winnerPhone: row.winner_phone as string,
    loserPhones: (row.loser_phones as string[] | null) ?? [],
  }
}

function notAuthorized(): AwardResult {
  return {
    success: false,
    error: 'Not authorized.',
    errorCode: 'NOT_AUTHORIZED',
  }
}

// Maps the RAISE EXCEPTION text from award_bid() in
// supabase/migrations/0001_initial_schema.sql to user-friendly messages and
// stable error codes the UI can branch on. If those raise messages change,
// this map needs to change too.
function mapAwardError(message: string): AwardResult {
  // 'load <uuid> is not open (status=<status>)'
  // status='awarded' specifically means another operator just won the race.
  const notOpen = message.match(/is not open \(status=(\w+)\)/)
  if (notOpen) {
    if (notOpen[1] === 'awarded') {
      return {
        success: false,
        error:
          'This load was just awarded by another operator. Refresh to see the current state.',
        errorCode: 'CONCURRENT_AWARD',
      }
    }
    return {
      success: false,
      error: 'This load is no longer open for bidding.',
      errorCode: 'LOAD_NOT_OPEN',
    }
  }

  // 'bid <uuid> is not active (status=<status>)' — trucker withdrew between
  // page load and click, OR another operator awarded a different bid which
  // flipped this one to 'lost' before our transaction got the row lock.
  if (/is not active \(status=/.test(message)) {
    return {
      success: false,
      error: 'This bid is no longer active.',
      errorCode: 'BID_INACTIVE',
    }
  }

  // Auth side: 'caller (...) does not match p_operator_id (...)' or
  // 'operator <uuid> not found'.
  if (
    message.includes('does not match p_operator_id') ||
    /operator\s.*not found/.test(message)
  ) {
    return notAuthorized()
  }

  // 'load <uuid> not found' / 'bid <uuid> not found' / 'bid does not belong'
  // — these shouldn't happen via the dashboard since the user clicked a row
  // we just rendered server-side. Fall through to the generic toast and log
  // the raw text for debugging in dev.
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.error('[awardBidAction] unmapped error:', message)
  }
  return {
    success: false,
    error: 'Something went wrong.',
    errorCode: 'UNKNOWN',
  }
}


// ---------------------------------------------------------------------------
// Lifecycle: mark a load completed and reverse it.
//
// Cancellation lives in cancel-action.ts because it predates this file and
// wraps an existing Postgres function. Award uses the RPC pattern above.
// Complete/reopen are simpler — guarded UPDATEs are enough.
//
// Auth model: the authenticated client confirms the caller is a provisioned,
// non-archived operator; the actual write goes through the admin client so
// RLS policy nuances on loads don't fight us. The .eq('status', …) on each
// UPDATE doubles as a concurrency guard.
// ---------------------------------------------------------------------------

async function requireOperator(): Promise<{ id: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated.')

  const { data: operator, error } = await supabase
    .from('operators')
    .select('id')
    .eq('id', user.id)
    .is('archived_at', null)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!operator) throw new Error('Operator role required.')
  return operator as { id: string }
}

export async function completeLoadAction(loadId: string): Promise<void> {
  await requireOperator()
  if (!loadId) throw new Error('loadId is required.')

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('loads')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', loadId)
    // Only ACCEPTED loads can be completed in the new lifecycle (0019).
    // The trucker has to accept first; the operator only marks complete
    // once the delivery actually wraps up.
    .eq('status', 'accepted')
  if (error) throw new Error(error.message)

  revalidatePath('/dashboard/loads')
  revalidatePath(`/dashboard/loads/${loadId}`)
}

export async function reopenLoadAction(loadId: string): Promise<void> {
  await requireOperator()
  if (!loadId) throw new Error('loadId is required.')

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('loads')
    .update({
      status: 'accepted',
      completed_at: null,
    })
    .eq('id', loadId)
    // Reopen now returns to the 'accepted' lane (the prior post-acceptance
    // state) rather than 'awarded', because completion only happens after
    // the trucker accepted in the first place.
    .eq('status', 'completed')
  if (error) throw new Error(error.message)

  revalidatePath('/dashboard/loads')
  revalidatePath(`/dashboard/loads/${loadId}`)
}

// ---------------------------------------------------------------------------
// Cancel award (migration 0019). The operator takes the award back BEFORE
// the trucker responds. The cancel_award RPC reverts the load to 'open',
// flips the won bid AND all auto-lost bids back to 'active', and removes
// the shipment row that award_bid created.
// ---------------------------------------------------------------------------

export async function cancelAwardAction(loadId: string): Promise<void> {
  const operator = await requireOperator()
  if (!loadId) throw new Error('loadId is required.')

  const supabase = await createClient()
  const { error } = await supabase.rpc('cancel_award', {
    p_load_id: loadId,
    p_operator_id: operator.id,
  })
  if (error) throw new Error(error.message)

  revalidatePath('/dashboard/loads')
  revalidatePath(`/dashboard/loads/${loadId}`)
}

// ---------------------------------------------------------------------------
// Record a manual bid (placed by operator on behalf of a trucker calling in)
// ---------------------------------------------------------------------------

export type ManualBidResult =
  | { success: true; bidId: string }
  | { success: false; error: string }

export async function placeManualBidAction(
  loadId: string,
  truckerPhone: string,
  amountPaise: number,
  truckerName?: string
): Promise<ManualBidResult> {
  await requireOperator()
  if (!loadId || !truckerPhone || !amountPaise) {
    return { success: false, error: 'All fields are required.' }
  }

  if (amountPaise <= 0) {
    return { success: false, error: 'Bid amount must be greater than zero.' }
  }

  const supabase = createAdminClient()

  // Clean phone string format (e.g. ensure +91 prefix for Indian numbers if not present)
  let cleanPhone = truckerPhone.trim().replace(/[\s-]/g, '')
  if (!cleanPhone.startsWith('+')) {
    if (cleanPhone.length === 10) {
      cleanPhone = `+91${cleanPhone}`
    } else {
      cleanPhone = `+${cleanPhone}`
    }
  }

  // Fetch load to verify truck_type
  const { data: load, error: loadErr } = await supabase
    .from('loads')
    .select('id, status, truck_type_required')
    .eq('id', loadId)
    .single()

  if (loadErr || !load) {
    return { success: false, error: 'Load not found.' }
  }

  if (load.status !== 'open') {
    return { success: false, error: 'Bids can only be placed on open loads.' }
  }

  // Find or create trucker record
  let truckerId: string
  const { data: existingTrucker } = await supabase
    .from('truckers')
    .select('id')
    .eq('phone_e164', cleanPhone)
    .maybeSingle()

  if (existingTrucker) {
    truckerId = existingTrucker.id
  } else {
    // Create trucker
    const { data: newTrucker, error: createErr } = await supabase
      .from('truckers')
      .insert({
        phone_e164: cleanPhone,
        full_name: truckerName?.trim() || `Trucker (${cleanPhone.slice(-4)})`,
        truck_type: load.truck_type_required,
        status: 'active',
      })
      .select('id')
      .single()

    if (createErr || !newTrucker) {
      return { success: false, error: `Failed to register trucker: ${createErr?.message}` }
    }
    truckerId = newTrucker.id
  }

  // Insert active bid
  const { data: newBid, error: bidErr } = await supabase
    .from('bids')
    .insert({
      load_id: loadId,
      trucker_id: truckerId,
      amount_paise: amountPaise,
      status: 'active',
      message_text: 'Manual bid placed by operator',
    })
    .select('id')
    .single()

  if (bidErr || !newBid) {
    return { success: false, error: `Failed to place bid: ${bidErr?.message}` }
  }

  revalidatePath(`/dashboard/loads/${loadId}`)
  return { success: true, bidId: newBid.id }
}

export async function broadcastWhatsAppAlertAction(loadId: string) {
  await requireOperator()
  if (!loadId) throw new Error('loadId is required.')
  const summary = await sendNewLoadAlerts(loadId)
  revalidatePath(`/dashboard/loads/${loadId}`)
  return summary
}

