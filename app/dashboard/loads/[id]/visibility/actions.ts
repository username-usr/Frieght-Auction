'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { getOperatorContext } from '@/lib/auth'
import type { TruckType } from '@/lib/types'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Replace a load's visibility list with the operator-supplied set, computing
// the diff so we INSERT only the additions and DELETE only the removals.
// Preserves load_trucker_visibility.created_at on truckers who were already
// invited — useful for audit history.
//
// Constraints enforced server-side:
//   * caller must be an operator (the /dashboard layout gates browsing, but
//     this is a server action so re-check)
//   * load must exist and be 'open' — closed loads have frozen visibility
//   * every selected trucker_id must be a real, non-archived trucker whose
//     truck_type matches the load's requirement (or is the 'open' wildcard)
export async function updateLoadVisibilityAction(
  loadId: string,
  truckerIds: string[]
): Promise<void> {
  if (!UUID_RE.test(loadId)) throw new Error('Invalid load id.')

  const { operator } = await getOperatorContext()
  if (!operator) throw new Error('Operator role required.')

  if (!Array.isArray(truckerIds) || truckerIds.length === 0) {
    throw new Error('Select at least one trucker.')
  }
  const desired = Array.from(new Set(truckerIds))
  for (const id of desired) {
    if (!UUID_RE.test(id)) {
      throw new Error(
        'One or more selected truckers are no longer eligible. Refresh and try again.'
      )
    }
  }

  const supabase = await createClient()

  const { data: load, error: loadErr } = await supabase
    .from('loads')
    .select('id, status, truck_type_required')
    .eq('id', loadId)
    .maybeSingle()
  if (loadErr) throw new Error(loadErr.message)
  if (!load) throw new Error('Load not found.')
  if (load.status !== 'open') {
    throw new Error('Visibility can only be edited on open loads.')
  }
  const requiredTruckType = load.truck_type_required as TruckType

  // Re-validate selected truckers against the DB. Same rule as the new-load
  // action: matches the truck_type or is 'open'; status='blocked' is allowed
  // through (suspended truckers can be invited).
  const { data: validTruckers, error: validateErr } = await supabase
    .from('truckers')
    .select('id, truck_type, archived_at')
    .in('id', desired)
  if (validateErr) throw new Error(validateErr.message)

  const eligibleIds = new Set(
    (validTruckers ?? [])
      .filter(
        (t) =>
          t.archived_at === null &&
          (t.truck_type === requiredTruckType || t.truck_type === 'open')
      )
      .map((t) => t.id)
  )
  if (eligibleIds.size !== desired.length) {
    throw new Error(
      'One or more selected truckers are no longer eligible. Refresh and try again.'
    )
  }

  // Diff against the current visibility list. The audit trigger on
  // load_trucker_visibility records each insert/delete; replacing the whole
  // list with TRUNCATE-style writes would emit noisy "removed then added"
  // events for unchanged rows.
  const { data: current, error: currentErr } = await supabase
    .from('load_trucker_visibility')
    .select('trucker_id')
    .eq('load_id', loadId)
  if (currentErr) throw new Error(currentErr.message)

  const currentIds = new Set((current ?? []).map((r) => r.trucker_id as string))
  const desiredIds = new Set(desired)

  const toAdd = desired.filter((id) => !currentIds.has(id))
  const toRemove = Array.from(currentIds).filter((id) => !desiredIds.has(id))

  // Writes use the admin client to bypass RLS — operators have the right to
  // edit visibility for any open load they can see, but the existing RLS
  // policy on load_trucker_visibility checks is_operator() which we've
  // already confirmed above via getOperatorContext().
  const adminClient = createAdminClient()

  if (toAdd.length > 0) {
    const { error: insertErr } = await adminClient
      .from('load_trucker_visibility')
      .insert(
        toAdd.map((trucker_id) => ({ load_id: loadId, trucker_id }))
      )
    if (insertErr) throw new Error(insertErr.message)
  }

  if (toRemove.length > 0) {
    const { error: deleteErr } = await adminClient
      .from('load_trucker_visibility')
      .delete()
      .eq('load_id', loadId)
      .in('trucker_id', toRemove)
    if (deleteErr) throw new Error(deleteErr.message)
  }

  revalidatePath(`/dashboard/loads/${loadId}`)
  revalidatePath(`/dashboard/loads/${loadId}/visibility`)
}
