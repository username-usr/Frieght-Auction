'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { getTrucker, requireTrucker } from '@/lib/trucker'

const TRUCK_NUMBER_RE = /^[A-Z0-9]+$/

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


// ---------------------------------------------------------------------------
// Award lifecycle (migration 0019). The trucker accepts or declines an
// award; both wrap RPCs that set_config('app.trucker_id', ...) so the audit
// trigger attributes the resulting row to the right actor.
// ---------------------------------------------------------------------------

export async function acceptAwardAction(loadId: string): Promise<void> {
  const trucker = await requireTrucker()
  if (!loadId) throw new Error('loadId is required.')

  const supabase = createAdminClient()
  const { error } = await supabase.rpc('accept_award', {
    p_load_id: loadId,
    p_trucker_id: trucker.id,
  })
  if (error) throw new Error(error.message)

  revalidatePath('/t/loads')
  revalidatePath(`/t/loads/${loadId}`)
}

export async function declineAwardAction(
  loadId: string,
  reason: string
): Promise<void> {
  const trucker = await requireTrucker()
  if (!loadId) throw new Error('loadId is required.')

  const trimmedReason = reason?.trim() ?? ''
  if (!trimmedReason) {
    throw new Error('Please tell the operator why you can’t take this load.')
  }

  const supabase = createAdminClient()
  const { error } = await supabase.rpc('decline_award', {
    p_load_id: loadId,
    p_trucker_id: trucker.id,
    p_reason: trimmedReason,
  })
  if (error) throw new Error(error.message)

  revalidatePath('/t/loads')
  revalidatePath(`/t/loads/${loadId}`)
}


// ---------------------------------------------------------------------------
// Trucker-side shipment details (migrations 0017 + 0019). truck_number,
// driver_name, driver_phone are trucker-managed; invoice_number stays
// operator-managed (no UI editor right now). The action verifies the
// trucker owns the 'won' bid on this load and the load is in 'accepted'.
// ---------------------------------------------------------------------------

export type ShipmentDetailsByTruckerInput = {
  truck_number: string | null
  driver_name: string | null
  driver_phone: string | null
}

export async function updateShipmentDetailsByTruckerAction(
  loadId: string,
  input: ShipmentDetailsByTruckerInput
): Promise<void> {
  const trucker = await requireTrucker()
  if (!loadId) throw new Error('loadId is required.')

  const truckNumber = input.truck_number?.trim().toUpperCase() || null
  const driverName = input.driver_name?.trim() || null
  const driverPhone = input.driver_phone?.trim() || null

  if (truckNumber && !TRUCK_NUMBER_RE.test(truckNumber)) {
    throw new Error(
      'Truck number must be alphanumeric only (no spaces or special characters).'
    )
  }

  const supabase = createAdminClient()

  const { data: bid, error: bidErr } = await supabase
    .from('bids')
    .select('id')
    .eq('load_id', loadId)
    .eq('trucker_id', trucker.id)
    .eq('status', 'won')
    .maybeSingle()
  if (bidErr) throw new Error(bidErr.message)
  if (!bid) {
    throw new Error('You do not have a winning bid on this load.')
  }

  const { error } = await supabase
    .from('loads')
    .update({
      truck_number: truckNumber,
      driver_name: driverName,
      driver_phone: driverPhone,
    })
    .eq('id', loadId)
    // Editable only while the load is in the 'accepted' lane. Once the
    // operator marks completed, the fields are frozen.
    .eq('status', 'accepted')
  if (error) throw new Error(error.message)

  revalidatePath(`/t/loads/${loadId}`)
}
