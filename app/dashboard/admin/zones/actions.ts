'use server'

import { revalidatePath } from 'next/cache'
import { getOperatorContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  actionFailure,
  actionSuccess,
  ExpectedActionError,
  type ActionResult,
} from '@/lib/action-result'

// Server actions for the zones admin sub-page.
//
// All three actions are gated by an isAdmin() check at the server-action
// layer — zones writes are restricted to admins by the RLS policy in
// migration 0014 too, so this is belt-and-suspenders: the JS-side guard
// gives a friendlier error than PostgREST's "row violates row-level
// security" message.

export type ZoneRow = {
  id: string
  name: string
  created_at: string
  deleted_at: string | null
}

async function requireAdmin(): Promise<void> {
  const { isAdmin } = await getOperatorContext()
  if (!isAdmin) {
    throw new Error('Admin role required to manage zones.')
  }
}

async function addZone(rawName: string): Promise<ZoneRow> {
  await requireAdmin()

  const name = rawName.trim()
  if (!name) throw new ExpectedActionError('Name is required.', 'name')
  if (name.length > 100) {
    throw new ExpectedActionError(
      'Name must be 100 characters or fewer.',
      'name'
    )
  }

  const supabase = await createClient()

  // Mirror the loads-admin restore-on-duplicate pattern: if a soft-deleted
  // zone with the same name exists, clear its deleted_at instead of erroring
  // on the UNIQUE(name) constraint. Preserves the original created_at.
  const { data: existing, error: lookupErr } = await supabase
    .from('zones')
    .select('id, name, created_at, deleted_at')
    .eq('name', name)
    .maybeSingle()
  if (lookupErr) throw new Error(lookupErr.message)

  if (existing) {
    if (existing.deleted_at === null) {
      throw new ExpectedActionError(`"${name}" already exists.`, 'name')
    }
    const { data, error } = await supabase
      .from('zones')
      .update({ deleted_at: null })
      .eq('id', existing.id)
      .select('id, name, created_at')
      .single()
    if (error) throw new Error(error.message)
    revalidatePath('/dashboard/admin/zones')
    return data as ZoneRow
  }

  const { data, error } = await supabase
    .from('zones')
    .insert({ name })
    .select('id, name, created_at')
    .single()
  if (error?.code === '23505') {
    throw new ExpectedActionError(`"${name}" already exists.`, 'name')
  }
  if (error) throw new Error(error.message)

  revalidatePath('/dashboard/admin/zones')
  return data as ZoneRow
}

export async function addZoneAction(
  rawName: string
): Promise<ActionResult<ZoneRow>> {
  try {
    return actionSuccess(await addZone(rawName))
  } catch (error) {
    return actionFailure(error, 'Could not add the zone.', 'addZoneAction')
  }
}

export async function deleteZoneAction(id: string): Promise<ActionResult<null>> {
  try {
    await requireAdmin()

    if (!id) throw new ExpectedActionError('Zone id is required.')

    const supabase = await createClient()
    const { error } = await supabase
      .from('zones')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null)
    if (error) throw new Error(error.message)

    revalidatePath('/dashboard/admin/zones')
    return actionSuccess(null)
  } catch (error) {
    return actionFailure(error, 'Could not remove the zone.', 'deleteZoneAction')
  }
}

// Restore action for a soft-deleted zone by id. Not wired to the current
// page UI (which mirrors loads-admin and lists only active rows) — it's
// exported so a future "deleted zones" section, an admin tool, or test
// fixtures have an in-app path to re-activate a row without dropping to
// the SQL editor.
export async function restoreZoneAction(id: string): Promise<ZoneRow> {
  await requireAdmin()

  if (!id) throw new Error('id is required.')

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('zones')
    .update({ deleted_at: null })
    .eq('id', id)
    .not('deleted_at', 'is', null)
    .select('id, name, created_at')
    .single()
  if (error) throw new Error(error.message)

  revalidatePath('/dashboard/admin/zones')
  return data as ZoneRow
}
