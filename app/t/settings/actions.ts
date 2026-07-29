'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireTrucker } from '@/lib/trucker'
import type { TruckType } from '@/lib/types'

export type UpdateTruckerProfileInput = {
  full_name: string | null
  secondary_phone: string | null
  home_base_city: string | null
  truck_type: TruckType
}

export async function updateTruckerProfileAction(input: UpdateTruckerProfileInput) {
  const trucker = await requireTrucker()
  const admin = createAdminClient()

  const { error } = await admin
    .from('truckers')
    .update({
      full_name: input.full_name?.trim() || null,
      secondary_phone: input.secondary_phone?.trim() || null,
      home_base_city: input.home_base_city?.trim() || null,
      truck_type: input.truck_type,
      updated_at: new Date().toISOString(),
    })
    .eq('id', trucker.id)

  if (error) {
    throw new Error(`Failed to update profile: ${error.message}`)
  }

  revalidatePath('/t/loads')
  revalidatePath('/t/settings')
  return { success: true }
}
