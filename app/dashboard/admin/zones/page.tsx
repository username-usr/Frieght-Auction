import { createClient } from '@/lib/supabase/server'
import { AdminSection } from '../loads/admin-section'
import type { LookupRow } from '../loads/actions'
import { addZoneAction, deleteZoneAction } from './actions'

// Lists the active zones and lets admins add or soft-delete them. Reuses the
// existing <AdminSection> client component from the loads admin — it already
// has the right shape (title / rows / addAction / deleteAction) and is
// untyped to the underlying table.
//
// We deliberately list only the active zones here (deleted_at IS NULL) so
// the page mirrors the loads-admin pattern. Re-adding a soft-deleted zone
// by name silently restores it via addZoneAction's restore-on-duplicate
// branch.
//
// Layer of gating:
//   /dashboard layout         → must be authenticated + provisioned operator
//   /dashboard/admin layout   → must be admin (Part E)
//   zones RLS policy          → admin-only writes
//   addZone/deleteZone action → isAdmin() check, friendlier error message

export default async function AdminZonesPage() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('zones')
    .select('id, name, created_at')
    .is('deleted_at', null)
    .order('name', { ascending: true })

  if (error) throw new Error(error.message)

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-sm text-slate-600">
        Regional zones used to scope which operators see which loads.
        Removing a zone hides it from future use but keeps it on existing
        operators and loads.
      </p>

      <AdminSection
        title="Zones"
        placeholder="e.g. North-East Zone"
        rows={(data ?? []) as LookupRow[]}
        addAction={addZoneAction}
        deleteAction={deleteZoneAction}
      />
    </div>
  )
}
