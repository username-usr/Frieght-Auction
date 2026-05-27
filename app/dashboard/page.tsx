import { Suspense } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { LoadsTable, type LoadListRow } from '@/components/loads/loads-table'
import { PostedToast } from '@/components/loads/posted-toast'
import { StatusFilter } from '@/components/loads/status-filter'
import type { LoadStatus, TruckType } from '@/lib/types'

type FilterValue = LoadStatus | 'all'

const VALID_FILTERS: FilterValue[] = [
  'open',
  'awarded',
  'cancelled',
  'completed',
  'all',
]

// Shape returned by the embedded-resource select below. Manually typed because
// we're not running `supabase gen types` yet; small enough that hand-keeping
// it in sync is fine.
//
// weight_value and quantity_value are NUMERIC in Postgres; supabase-js returns
// them as string (precision-preserving) or number depending on the driver
// version. Type them as the union and call Number() at the display boundary.
type LoadsSelectRow = {
  id: string
  origin_city: string
  destination_city: string
  truck_type_required: TruckType
  weight_value: number | string
  weight_unit: 'kg' | 'liters'
  quantity_value: number | string
  pickup_deadline: string
  status: LoadStatus
  created_at: string
  posted_by_operator: { full_name: string } | null
  product: { name: string } | null
  quantity_unit: { name: string } | null
  bids: { count: number }[]
}

export default async function LoadsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const params = await searchParams
  const status: FilterValue = VALID_FILTERS.includes(
    params.status as FilterValue
  )
    ? (params.status as FilterValue)
    : 'open'

  const supabase = await createClient()
  let query = supabase
    .from('loads')
    .select(
      `id, origin_city, destination_city, truck_type_required, weight_value, weight_unit,
       quantity_value, pickup_deadline, status, created_at,
       posted_by_operator:operators!loads_posted_by_fkey(full_name),
       product:product_names!product_name_id(name),
       quantity_unit:quantity_units!quantity_unit_id(name),
       bids(count)`
    )
    .order('created_at', { ascending: false })

  if (status !== 'all') {
    query = query.eq('status', status)
  }

  const { data, error } = await query

  // Surface read errors loudly during development; we don't expect them under
  // normal RLS policy. Replace with a friendlier UI once we have a pattern.
  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-900">
        <p className="font-semibold">Failed to load loads.</p>
        <p className="mt-2 font-mono">{error.message}</p>
      </div>
    )
  }

  const rows = (data ?? []) as unknown as LoadsSelectRow[]
  const loads: LoadListRow[] = rows.map((row) => ({
    id: row.id,
    origin_city: row.origin_city,
    destination_city: row.destination_city,
    truck_type_required: row.truck_type_required,
    weight_value: Number(row.weight_value),
    weight_unit: row.weight_unit,
    quantity_value: Number(row.quantity_value),
    quantity_unit_name: row.quantity_unit?.name ?? '—',
    product_name: row.product?.name ?? '—',
    pickup_deadline: row.pickup_deadline,
    status: row.status,
    created_at: row.created_at,
    posted_by_name: row.posted_by_operator?.full_name ?? '—',
    bid_count: row.bids[0]?.count ?? 0,
  }))

  return (
    <div className="space-y-6">
      <Suspense fallback={null}>
        <PostedToast />
      </Suspense>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
          Loads
        </h2>
        <Link
          href="/dashboard/loads/new"
          className="rounded-md bg-blue-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-800"
        >
          New load
        </Link>
      </div>
      <StatusFilter current={status} />
      <LoadsTable initialLoads={loads} statusFilter={status} />
    </div>
  )
}
