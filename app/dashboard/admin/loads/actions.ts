'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

// All three lookup tables share an identical shape, so a single helper handles
// the add/delete logic and the six exported actions are thin per-entity wrappers.
// We use the user-authenticated server client (NOT the admin client) — RLS on
// the lookup tables enforces operator-only writes via is_operator().

type LookupTable = 'product_names' | 'container_types' | 'quantity_units'

export type LookupRow = {
  id: string
  name: string
  created_at: string
}

async function addLookup(table: LookupTable, rawName: string): Promise<LookupRow> {
  const name = rawName.trim()
  if (!name) throw new Error('Name is required.')
  if (name.length > 100) {
    throw new Error('Name must be 100 characters or fewer.')
  }

  const supabase = await createClient()

  // If a soft-deleted row with the same name exists, the UNIQUE(name)
  // constraint would block a fresh INSERT. Restore the existing row instead
  // so the operator's history (created_at) is preserved.
  const { data: existing, error: lookupErr } = await supabase
    .from(table)
    .select('id, name, created_at, deleted_at')
    .eq('name', name)
    .maybeSingle()
  if (lookupErr) throw new Error(lookupErr.message)

  if (existing) {
    if (existing.deleted_at === null) {
      throw new Error(`"${name}" already exists.`)
    }
    const { data, error } = await supabase
      .from(table)
      .update({ deleted_at: null })
      .eq('id', existing.id)
      .select('id, name, created_at')
      .single()
    if (error) throw new Error(error.message)
    revalidatePath('/dashboard/admin/loads')
    return data as LookupRow
  }

  const { data, error } = await supabase
    .from(table)
    .insert({ name })
    .select('id, name, created_at')
    .single()
  if (error) throw new Error(error.message)

  revalidatePath('/dashboard/admin/loads')
  return data as LookupRow
}

async function deleteLookup(table: LookupTable, id: string): Promise<void> {
  if (!id) throw new Error('id is required.')

  const supabase = await createClient()
  const { error } = await supabase
    .from(table)
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null)
  if (error) throw new Error(error.message)

  revalidatePath('/dashboard/admin/loads')
}

export async function addProductNameAction(name: string): Promise<LookupRow> {
  return addLookup('product_names', name)
}
export async function deleteProductNameAction(id: string): Promise<void> {
  return deleteLookup('product_names', id)
}

export async function addContainerTypeAction(name: string): Promise<LookupRow> {
  return addLookup('container_types', name)
}
export async function deleteContainerTypeAction(id: string): Promise<void> {
  return deleteLookup('container_types', id)
}

export async function addQuantityUnitAction(name: string): Promise<LookupRow> {
  return addLookup('quantity_units', name)
}
export async function deleteQuantityUnitAction(id: string): Promise<void> {
  return deleteLookup('quantity_units', id)
}
