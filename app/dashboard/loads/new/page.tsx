import Link from 'next/link'
import { getSavedAddresses } from '@/lib/saved-addresses'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { ensureChemicalLookupOptions } from '@/lib/chemical-options'
import type { LookupOption, TruckType, TruckerStatus } from '@/lib/types'
import { NewLoadForm, type EligibleTrucker } from './form'

export default async function NewLoadPage() {
  const supabase = await createClient()

  // Truckers use the admin client because operator-level SELECT on
  // truckers is allowed by RLS but inconsistent across environments,
  // and we want a stable read for the visibility multi-select.
  const adminClient = createAdminClient()

  const [chemicalOptions, truckers, savedAddresses] = await Promise.all([
    ensureChemicalLookupOptions(),
    adminClient
      .from('truckers')
      .select('id, phone_e164, secondary_phone, full_name, truck_type, status')
      .is('archived_at', null)
      .in('status', ['active', 'blocked'])
      .order('full_name', { ascending: true, nullsFirst: false }),
    getSavedAddresses(),
  ])

  if (truckers.error) throw new Error(truckers.error.message)

  const { products, containers, quantities } = chemicalOptions

  const truckerPool: EligibleTrucker[] = (truckers.data ?? []).map((t) => ({
    id: t.id,
    phone_e164: t.phone_e164,
    secondary_phone: t.secondary_phone ?? null,
    full_name: t.full_name,
    truck_type: t.truck_type as TruckType,
    status: t.status as TruckerStatus,
  }))

  return (
    <div className="max-w-3xl space-y-7">
      <div>
        <Link
          href="/dashboard"
          className="text-sm text-slate-600 hover:text-slate-900"
        >
          ← Back to loads
        </Link>
        <p className="mb-2 mt-6 text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700">
          Create shipment
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          New load
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Add the route, cargo, deadline, and invited truckers.
        </p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-7">
        <NewLoadForm
          productOptions={products}
          containerOptions={containers}
          quantityUnitOptions={quantities}
          truckerPool={truckerPool}
          savedAddresses={savedAddresses}
        />
      </div>
    </div>
  )
}
