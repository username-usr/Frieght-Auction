'use server'

import { createClient } from '@/lib/supabase/server'

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
