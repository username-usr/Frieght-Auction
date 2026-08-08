'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  actionFailure,
  actionSuccess,
  ExpectedActionError,
  type ActionResult,
} from '@/lib/action-result'

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
  if (!name) throw new ExpectedActionError('Name is required.', 'name')
  if (name.length > 100) {
    throw new ExpectedActionError(
      'Name must be 100 characters or fewer.',
      'name'
    )
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
      throw new ExpectedActionError(`"${name}" already exists.`, 'name')
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
  if (error?.code === '23505') {
    throw new ExpectedActionError(`"${name}" already exists.`, 'name')
  }
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

export async function addProductNameAction(
  name: string
): Promise<ActionResult<LookupRow>> {
  try {
    return actionSuccess(await addLookup('product_names', name))
  } catch (error) {
    return actionFailure(error, 'Could not add the stock item.', 'addProductNameAction')
  }
}
export async function deleteProductNameAction(
  id: string
): Promise<ActionResult<null>> {
  try {
    await deleteLookup('product_names', id)
    return actionSuccess(null)
  } catch (error) {
    return actionFailure(error, 'Could not remove the stock item.', 'deleteProductNameAction')
  }
}

export async function addContainerTypeAction(
  name: string
): Promise<ActionResult<LookupRow>> {
  try {
    return actionSuccess(await addLookup('container_types', name))
  } catch (error) {
    return actionFailure(error, 'Could not add the container type.', 'addContainerTypeAction')
  }
}
export async function deleteContainerTypeAction(
  id: string
): Promise<ActionResult<null>> {
  try {
    await deleteLookup('container_types', id)
    return actionSuccess(null)
  } catch (error) {
    return actionFailure(error, 'Could not remove the container type.', 'deleteContainerTypeAction')
  }
}

export async function addQuantityUnitAction(
  name: string
): Promise<ActionResult<LookupRow>> {
  try {
    return actionSuccess(await addLookup('quantity_units', name))
  } catch (error) {
    return actionFailure(error, 'Could not add the quantity unit.', 'addQuantityUnitAction')
  }
}
export async function deleteQuantityUnitAction(
  id: string
): Promise<ActionResult<null>> {
  try {
    await deleteLookup('quantity_units', id)
    return actionSuccess(null)
  } catch (error) {
    return actionFailure(error, 'Could not remove the quantity unit.', 'deleteQuantityUnitAction')
  }
}
