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
// PART-I-PREQUEL note: the form doesn't yet expose a trucker multi-select,
// so we auto-pick "every active non-archived trucker whose truck_type
// matches the load (or is 'open', the wildcard)". This preserves the prior
// "all matching truckers see the load" behavior. Part I proper will replace
// this query with an explicit operator-driven selection step in the form.
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

  const supabase = await createClient()
  // Surface "not authenticated" with a clean message before the RPC.
  // posted_by isn't passed — the function reads auth.uid() itself.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated.')

  // Auto-populate the visibility list: every active non-archived trucker
  // whose truck_type matches the load's requirement OR is the 'open'
  // wildcard. RLS on truckers allows operator SELECT.
  const { data: matchingTruckers, error: truckersError } = await supabase
    .from('truckers')
    .select('id')
    .or(`truck_type.eq.${input.truck_type_required},truck_type.eq.open`)
    .eq('status', 'active')
    .is('archived_at', null)

  if (truckersError) throw new Error(truckersError.message)
  if (!matchingTruckers || matchingTruckers.length === 0) {
    throw new Error(
      'No active truckers available for this truck type. Add truckers in admin first.'
    )
  }
  const truckerIds = matchingTruckers.map((t) => t.id)

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
