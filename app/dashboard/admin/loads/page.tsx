import { createClient } from '@/lib/supabase/server'
import { AdminSection } from './admin-section'
import {
  addContainerTypeAction,
  addProductNameAction,
  addQuantityUnitAction,
  deleteContainerTypeAction,
  deleteProductNameAction,
  deleteQuantityUnitAction,
  type LookupRow,
} from './actions'

// Lookup-table editor for the new-load form's dropdowns. The /dashboard/admin
// layout (and parent /dashboard layout) gate access to admins / operators; we
// just fetch the three lookup tables in parallel and hand each list off to a
// shared <AdminSection> client component.

export default async function AdminLoadsPage() {
  const supabase = await createClient()

  const [products, containers, quantities] = await Promise.all([
    supabase
      .from('product_names')
      .select('id, name, created_at')
      .is('deleted_at', null)
      .order('name', { ascending: true }),
    supabase
      .from('container_types')
      .select('id, name, created_at')
      .is('deleted_at', null)
      .order('name', { ascending: true }),
    supabase
      .from('quantity_units')
      .select('id, name, created_at')
      .is('deleted_at', null)
      .order('name', { ascending: true }),
  ])

  if (products.error) throw new Error(products.error.message)
  if (containers.error) throw new Error(containers.error.message)
  if (quantities.error) throw new Error(quantities.error.message)

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700">
          Master Data
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          Cargo & Stock Items
        </h1>
        <p className="mt-1.5 text-sm text-slate-600">
          Manage stock items, chemical product names, container types, and quantity units for load postings.
        </p>
      </div>

      <AdminSection
        title="Stock item names"
        placeholder="e.g. Sugar"
        rows={(products.data ?? []) as LookupRow[]}
        addAction={addProductNameAction}
        deleteAction={deleteProductNameAction}
      />
      <AdminSection
        title="Container Types"
        placeholder="e.g. Crate"
        rows={(containers.data ?? []) as LookupRow[]}
        addAction={addContainerTypeAction}
        deleteAction={deleteContainerTypeAction}
      />
      <AdminSection
        title="Quantity Units"
        placeholder="e.g. Kilograms"
        rows={(quantities.data ?? []) as LookupRow[]}
        addAction={addQuantityUnitAction}
        deleteAction={deleteQuantityUnitAction}
      />
    </div>
  )
}
