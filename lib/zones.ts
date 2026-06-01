import { createClient } from '@/lib/supabase/server'
import type { LookupOption } from '@/lib/types'

// Active zones list for dropdowns (admin pages, operator forms that pick a
// zone). Filters out soft-deleted rows (deleted_at IS NOT NULL). Sorted by
// name so the UI doesn't need to sort again.
//
// Throws on read errors rather than swallowing them — zones is a small
// table that should always be reachable; a failure here usually means an
// RLS or connection problem the caller needs to surface.
export async function getActiveZones(): Promise<LookupOption[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('zones')
    .select('id, name')
    .is('deleted_at', null)
    .order('name', { ascending: true })

  if (error) throw new Error(error.message)
  return (data ?? []) as LookupOption[]
}
