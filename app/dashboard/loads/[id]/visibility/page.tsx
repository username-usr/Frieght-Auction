import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getOperatorContext } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import type { TruckType, TruckerStatus } from '@/lib/types'
import {
  VisibilityForm,
  type VisibilityTrucker,
} from './form'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type LoadHeader = {
  id: string
  reference_code: string
  origin_address: string
  destination_address: string
  truck_type_required: TruckType
  status: 'open' | 'awarded' | 'cancelled' | 'completed'
  zone_id: string | null
}

export default async function EditVisibilityPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const adminClient = createAdminClient()

  // Lookup by UUID or by reference_code — same pattern as the detail page.
  const loadQuery = supabase
    .from('loads')
    .select(
      'id, reference_code, origin_address, destination_address, truck_type_required, status, zone_id'
    )
  const { data: loadRaw, error: loadError } = await (UUID_RE.test(id)
    ? loadQuery.eq('id', id)
    : loadQuery.eq('reference_code', id.toUpperCase())
  ).maybeSingle()

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-900">
        <p className="font-semibold">Failed to load load.</p>
        <p className="mt-2 font-mono">{loadError.message}</p>
      </div>
    )
  }
  if (!loadRaw) notFound()
  const load = loadRaw as LoadHeader

  // Zone gate — mirrors the detail page (Part I5). notFound() rather than a
  // friendly card so the URL stays opaque to operators in other zones.
  const { isAdmin, operator } = await getOperatorContext()
  if (
    !isAdmin &&
    operator?.zone_id &&
    load.zone_id &&
    load.zone_id !== operator.zone_id
  ) {
    notFound()
  }

  // Closed loads have frozen visibility. Render an explanatory card with a
  // link back to the detail page rather than 404-ing.
  if (load.status !== 'open') {
    return (
      <div className="max-w-2xl space-y-4">
        <div>
          <Link
            href={`/dashboard/loads/${load.id}`}
            className="text-sm text-slate-600 hover:text-slate-900"
          >
            ← Back to load
          </Link>
          <h2 className="mt-2 text-lg font-semibold tracking-tight text-slate-900">
            Visibility is locked
          </h2>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-700">
            This load is no longer open — visibility can only be edited
            while a load is accepting bids.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Current status: <span className="capitalize">{load.status}</span>
          </p>
        </div>
      </div>
    )
  }

  // Pool of eligible truckers + current visibility list in parallel.
  const [poolResult, visibilityResult] = await Promise.all([
    adminClient
      .from('truckers')
      .select('id, phone_e164, full_name, truck_type, status')
      .is('archived_at', null)
      .in('status', ['active', 'blocked'])
      .or(`truck_type.eq.${load.truck_type_required},truck_type.eq.open`)
      .order('full_name', { ascending: true, nullsFirst: false }),
    supabase
      .from('load_trucker_visibility')
      .select('trucker_id')
      .eq('load_id', load.id),
  ])

  if (poolResult.error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-900">
        <p className="font-semibold">Failed to load truckers.</p>
        <p className="mt-2 font-mono">{poolResult.error.message}</p>
      </div>
    )
  }
  if (visibilityResult.error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-900">
        <p className="font-semibold">Failed to load visibility list.</p>
        <p className="mt-2 font-mono">{visibilityResult.error.message}</p>
      </div>
    )
  }

  const pool: VisibilityTrucker[] = (poolResult.data ?? []).map((t) => ({
    id: t.id,
    phone_e164: t.phone_e164,
    full_name: t.full_name,
    truck_type: t.truck_type as TruckType,
    status: t.status as TruckerStatus,
  }))
  const initialSelected = (visibilityResult.data ?? []).map(
    (r) => r.trucker_id as string
  )

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link
          href={`/dashboard/loads/${load.id}`}
          className="text-sm text-slate-600 hover:text-slate-900"
        >
          ← Back to load
        </Link>
        <h2 className="mt-2 text-lg font-semibold tracking-tight text-slate-900">
          Edit visibility
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Load{' '}
          <span className="font-mono text-slate-900">
            #{load.reference_code}
          </span>{' '}
          — {load.origin_address} → {load.destination_address}
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <VisibilityForm
          loadId={load.id}
          truckTypeRequired={load.truck_type_required}
          pool={pool}
          initialSelected={initialSelected}
        />
      </div>
    </div>
  )
}
