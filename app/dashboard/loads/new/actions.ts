'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { TruckType, WeightUnit } from '@/lib/types'

export type CreateLoadItemInput = {
  product_name_id: string
  container_type_id: string
  quantity_value: number
  quantity_unit_id: string
  weight_value: number
  weight_unit: WeightUnit
}

export type CreateLoadInput = {
  origin_address: string
  destination_address: string
  truck_type_required: TruckType
  pickup_deadline: string
  reference_price_paise: number | null
  notes: string | null
  items: CreateLoadItemInput[]
  trucker_ids: string[]
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function validateItem(it: CreateLoadItemInput, idx: number): void {
  const where = `Item ${idx + 1}`
  if (!UUID_RE.test(it.product_name_id)) {
    throw new Error(`${where}: product is required.`)
  }
  if (!UUID_RE.test(it.container_type_id)) {
    throw new Error(`${where}: container type is required.`)
  }
  if (!UUID_RE.test(it.quantity_unit_id)) {
    throw new Error(`${where}: quantity unit is required.`)
  }
  if (!Number.isFinite(it.quantity_value) || it.quantity_value <= 0) {
    throw new Error(`${where}: quantity must be greater than zero.`)
  }
  if (!Number.isFinite(it.weight_value) || it.weight_value <= 0) {
    throw new Error(`${where}: weight must be greater than zero.`)
  }
  if (it.weight_unit !== 'kg' && it.weight_unit !== 'liters') {
    throw new Error(`${where}: weight unit must be kg or liters.`)
  }
}

// Server action invoked from the new-load form. Re-validates input as a
// safety net (the client validates first, but never trust the client) and
// then delegates the actual writes to create_load_with_items() so the load,
// items, and per-trucker visibility rows all land in a single transaction
// (migration 0015). The RPC reads auth.uid() server-side for posted_by and
// enforces the operator check, so the client doesn't pass either.
//
// trucker_ids is the explicit operator-chosen visibility list (Part I). We
// re-validate each id against the DB to confirm the trucker exists, isn't
// archived, and matches the load's truck_type criteria — defends against
// a stale client picking truckers who've since been archived or had their
// truck_type changed.
export async function createLoad(input: CreateLoadInput): Promise<never> {
  const origin = input.origin_address.trim()
  const destination = input.destination_address.trim()

  if (!origin || !destination) {
    throw new Error('Origin and destination are required.')
  }
  if (origin.toLowerCase() === destination.toLowerCase()) {
    throw new Error('Origin and destination must differ.')
  }
  if (!input.pickup_deadline) {
    throw new Error('Pickup deadline is required.')
  }
  if (new Date(input.pickup_deadline).getTime() <= Date.now()) {
    throw new Error('Pickup deadline must be in the future.')
  }
  if (
    input.reference_price_paise !== null &&
    (!Number.isFinite(input.reference_price_paise) ||
      input.reference_price_paise <= 0)
  ) {
    throw new Error('Reference price must be greater than zero.')
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error('Add at least one product.')
  }
  input.items.forEach((it, idx) => validateItem(it, idx))

  if (!Array.isArray(input.trucker_ids) || input.trucker_ids.length === 0) {
    throw new Error('Select at least one trucker.')
  }
  // De-dupe before checking — duplicate ids in the payload would otherwise
  // collide on load_trucker_visibility's primary key inside the RPC.
  const truckerIds = Array.from(new Set(input.trucker_ids))
  for (const id of truckerIds) {
    if (!UUID_RE.test(id)) {
      throw new Error('One or more selected truckers are no longer eligible. Refresh and try again.')
    }
  }

  const supabase = await createClient()
  // Surface "not authenticated" with a clean message before the RPC.
  // posted_by isn't passed — the function reads auth.uid() itself.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated.')

  // Re-validate the selected truckers server-side. RLS lets operators SELECT
  // truckers, so the authenticated client works here. The OR criteria mirrors
  // the trucker portal's load-visibility filter: a trucker can bid when
  // their truck_type matches the load's requirement, or when the load
  // requests the 'open' wildcard. We allow status='blocked' through —
  // suspended truckers can still be invited (they just can't bid until
  // reactivated), which matches the operator UI's behavior.
  const { data: validTruckers, error: validateErr } = await supabase
    .from('truckers')
    .select('id, truck_type, archived_at')
    .in('id', truckerIds)

  if (validateErr) throw new Error(validateErr.message)

  const eligibleIds = new Set(
    (validTruckers ?? [])
      .filter(
        (t) =>
          t.archived_at === null &&
          (t.truck_type === input.truck_type_required ||
            t.truck_type === 'open')
      )
      .map((t) => t.id)
  )
  if (eligibleIds.size !== truckerIds.length) {
    throw new Error(
      'One or more selected truckers are no longer eligible. Refresh and try again.'
    )
  }

  const { data: loadId, error } = await supabase.rpc(
    'create_load_with_items',
    {
      p_origin_address: origin,
      p_destination_address: destination,
      p_truck_type_required: input.truck_type_required,
      p_pickup_deadline: input.pickup_deadline,
      p_reference_price_paise: input.reference_price_paise,
      p_notes: input.notes,
      p_items: input.items,
      p_trucker_ids: truckerIds,
    }
  )

  if (error) throw new Error(error.message)
  if (!loadId) throw new Error('Insert returned no row.')

  redirect(`/dashboard/loads/${loadId}`)
}
