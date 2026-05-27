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
  origin_city: string
  destination_city: string
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
// then delegates the actual writes to create_load_with_items() so the load
// and its items land in a single transaction (migration 0011). The RPC
// reads auth.uid() server-side for posted_by and enforces the operator
// check, so the client doesn't pass either.
export async function createLoad(input: CreateLoadInput): Promise<never> {
  const origin = input.origin_city.trim()
  const destination = input.destination_city.trim()

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

  const { data: loadId, error } = await supabase.rpc(
    'create_load_with_items',
    {
      p_origin_city: origin,
      p_destination_city: destination,
      p_truck_type_required: input.truck_type_required,
      p_pickup_deadline: input.pickup_deadline,
      p_reference_price_paise: input.reference_price_paise,
      p_notes: input.notes,
      p_items: input.items,
    }
  )

  if (error) throw new Error(error.message)
  if (!loadId) throw new Error('Insert returned no row.')

  redirect(`/dashboard/loads/${loadId}`)
}
