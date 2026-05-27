'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { TruckType, WeightUnit } from '@/lib/types'

export type CreateLoadInput = {
  origin_city: string
  destination_city: string
  truck_type_required: TruckType
  product_name_id: string
  quantity_value: number
  quantity_unit_id: string
  container_type_id: string
  weight_value: number
  weight_unit: WeightUnit
  pickup_deadline: string
  reference_price_paise: number | null
  notes: string | null
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Server action invoked from the new-load form. Re-validates input as a
// safety net (the client validates first, but never trust the client) and
// then inserts via the user's authenticated Supabase session — RLS is what
// actually keeps non-operators out, posted_by is set from auth.uid() so it
// can't be spoofed.
export async function createLoad(input: CreateLoadInput): Promise<never> {
  const origin = input.origin_city.trim()
  const destination = input.destination_city.trim()

  if (!origin || !destination) {
    throw new Error('Origin and destination are required.')
  }
  if (origin.toLowerCase() === destination.toLowerCase()) {
    throw new Error('Origin and destination must differ.')
  }
  if (!UUID_RE.test(input.product_name_id)) {
    throw new Error('Product is required.')
  }
  if (!UUID_RE.test(input.quantity_unit_id)) {
    throw new Error('Quantity unit is required.')
  }
  if (!UUID_RE.test(input.container_type_id)) {
    throw new Error('Container type is required.')
  }
  if (!Number.isFinite(input.quantity_value) || input.quantity_value <= 0) {
    throw new Error('Quantity must be greater than zero.')
  }
  if (!Number.isFinite(input.weight_value) || input.weight_value <= 0) {
    throw new Error('Weight must be greater than zero.')
  }
  if (input.weight_unit !== 'kg' && input.weight_unit !== 'liters') {
    throw new Error('Weight unit must be kg or liters.')
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

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated.')

  const { data, error } = await supabase
    .from('loads')
    .insert({
      origin_city: origin,
      destination_city: destination,
      truck_type_required: input.truck_type_required,
      product_name_id: input.product_name_id,
      quantity_value: input.quantity_value,
      quantity_unit_id: input.quantity_unit_id,
      container_type_id: input.container_type_id,
      weight_value: input.weight_value,
      weight_unit: input.weight_unit,
      pickup_deadline: input.pickup_deadline,
      reference_price_paise: input.reference_price_paise,
      notes: input.notes,
      posted_by: user.id,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  if (!data) throw new Error('Insert returned no row.')

  redirect(`/dashboard/loads/${data.id}`)
}
