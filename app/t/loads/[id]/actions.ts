'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTrucker } from '@/lib/trucker'

export type PlaceBidResult =
  | { ok: true; bidId: string; amountPaise: number }
  | { ok: false; error: string }

// Server-side bid submission. Re-authenticates the trucker via the session
// cookie (we never trust a trucker_id sent from the form). The actual
// INSERT/UPDATE happens inside place_trucker_bid(), which also stamps
// app.trucker_id so the audit trigger records actor_role='trucker'.
export async function placeBidAction(
  loadId: string,
  amountRupeesRaw: string
): Promise<PlaceBidResult> {
  const trucker = await getTrucker()
  if (!trucker) {
    return { ok: false, error: 'Your session expired. Sign in again.' }
  }

  const amountRupees = Number(amountRupeesRaw)
  if (!Number.isFinite(amountRupees) || amountRupees <= 0) {
    return { ok: false, error: 'Enter a positive amount in rupees.' }
  }
  if (!Number.isInteger(amountRupees)) {
    return { ok: false, error: 'Bid in whole rupees only.' }
  }
  const amountPaise = amountRupees * 100

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('place_trucker_bid', {
    p_trucker_id: trucker.id,
    p_load_id: loadId,
    p_amount_paise: amountPaise,
  })

  if (error) {
    if (/Load is no longer open/.test(error.message)) {
      return { ok: false, error: 'This load is no longer open.' }
    }
    if (/Load not found/.test(error.message)) {
      return { ok: false, error: 'Load not found.' }
    }
    if (/Trucker account is not active/.test(error.message)) {
      return { ok: false, error: 'Your account is not active.' }
    }
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.error('[placeBidAction]', error)
    }
    return { ok: false, error: 'Could not place bid. Try again.' }
  }

  revalidatePath(`/t/loads/${loadId}`)
  revalidatePath('/t/loads')
  return { ok: true, bidId: data as string, amountPaise }
}
