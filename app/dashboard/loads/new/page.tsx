import Link from 'next/link'
import { getSavedAddresses } from '@/lib/saved-addresses'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import type { LookupOption, TruckType, TruckerStatus } from '@/lib/types'
import { NewLoadForm, type EligibleTrucker } from './form'

export default async function NewLoadPage() {
  const supabase = await createClient()

  // Truckers use the admin client because operator-level SELECT on
  // truckers is allowed by RLS but inconsistent across environments,
  // and we want a stable read for the visibility multi-select.
  const adminClient = createAdminClient()

  const [products, containers, quantities, truckers, savedAddresses] =
    await Promise.all([
      supabase
        .from('product_names')
        .select('id, name')
        .is('deleted_at', null)
        .order('name', { ascending: true }),
      supabase
        .from('container_types')
        .select('id, name')
        .is('deleted_at', null)
        .order('name', { ascending: true }),
      supabase
        .from('quantity_units')
        .select('id, name')
        .is('deleted_at', null)
        .order('name', { ascending: true }),
      // Pool of truckers eligible to be invited: not archived, and currently
      // sign-in-able (active or blocked, never inactive). The form filters
      // this pool further by truck_type at render time.
      adminClient
        .from('truckers')
        .select('id, phone_e164, secondary_phone, full_name, truck_type, status')
        .is('archived_at', null)
        .in('status', ['active', 'blocked'])
        .order('full_name', { ascending: true, nullsFirst: false }),
      // Up to 200 most-recently-saved addresses for the autocomplete
      // <datalist>. Origin, primary destination, and every additional
      // destination input all reference the same list.
      getSavedAddresses(),
    ])

  if (products.error) throw new Error(products.error.message)
  if (containers.error) throw new Error(containers.error.message)
  if (quantities.error) throw new Error(quantities.error.message)
  if (truckers.error) throw new Error(truckers.error.message)

  const truckerPool: EligibleTrucker[] = (truckers.data ?? []).map((t) => ({
    id: t.id,
    phone_e164: t.phone_e164,
    secondary_phone: t.secondary_phone ?? null,
    full_name: t.full_name,
    truck_type: t.truck_type as TruckType,
    status: t.status as TruckerStatus,
  }))

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link
          href="/dashboard"
          className="text-sm text-slate-600 hover:text-slate-900"
        >
          ← Back to loads
        </Link>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
          New load
        </h2>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <NewLoadForm
          productOptions={(products.data ?? []) as LookupOption[]}
          containerOptions={(containers.data ?? []) as LookupOption[]}
          quantityUnitOptions={(quantities.data ?? []) as LookupOption[]}
          truckerPool={truckerPool}
          savedAddresses={savedAddresses}
        />
      </div>
    </div>
  )
}
