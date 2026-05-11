'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { TruckType } from '@/lib/types'

export type CreateLoadInput = {
  origin_city: string
  destination_city: string
  truck_type_required: TruckType
  weight_kg: number
  pickup_deadline: string
  reference_price_paise: number | null
  notes: string | null
}

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
  if (!Number.isFinite(input.weight_kg) || input.weight_kg <= 0) {
    throw new Error('Weight must be greater than zero.')
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
      weight_kg: input.weight_kg,
      pickup_deadline: input.pickup_deadline,
      reference_price_paise: input.reference_price_paise,
      notes: input.notes,
      posted_by: user.id,
    })
    .select('id')
    .single()

  if (error) throw new Error(error.message)
  if (!data) throw new Error('Insert returned no row.')

  // Step 3 will land /dashboard/loads/<id>; until then we route back to the
  // list view with ?posted=<id>, which triggers the success toast there.
  redirect(`/dashboard?posted=${data.id}`)
}
