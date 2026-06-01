import { Suspense } from 'react'
import Link from 'next/link'
import { getOperatorContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { LoadsTable, type LoadListRow } from '@/components/loads/loads-table'
import { PostedToast } from '@/components/loads/posted-toast'
import { StatusFilter } from '@/components/loads/status-filter'
import { summarizeItemsByProduct } from '@/lib/format'
import type { LoadStatus, TruckType } from '@/lib/types'

type FilterValue = LoadStatus | 'all'

const VALID_FILTERS: FilterValue[] = [
  'open',
  'awarded',
  'cancelled',
  'completed',
  'all',
]

type LoadsSelectRow = {
  id: string
  reference_code: string
  origin_address: string
  destination_address: string
  truck_type_required: TruckType
  pickup_deadline: string
  status: LoadStatus
  created_at: string
  posted_by_operator: { full_name: string } | null
  bids: { count: number }[]
}

type ItemRow = {
  load_id: string
  position: number
  product: { name: string } | null
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

  const { operator, isAdmin } = await getOperatorContext()

  const supabase = await createClient()
  let query = supabase
    .from('loads')
    .select(
      `id, reference_code, origin_address, destination_address, truck_type_required,
       pickup_deadline, status, created_at,
       posted_by_operator:operators!loads_posted_by_fkey(full_name),
       bids(count)`
    )
    .order('created_at', { ascending: false })

  if (status !== 'all') {
    query = query.eq('status', status)
  }

  // Zone-based visibility. Admins and unzoned operators see all loads; a
  // zoned operator only sees loads in their zone OR loads with no zone
  // (the wildcard). The OR string-builder syntax matches PostgREST's filter
  // format — zone_id values come from the operator's own row, no SQL
  // injection concern.
  const viewerZoneId = operator?.zone_id ?? null
  if (!isAdmin && viewerZoneId != null) {
    query = query.or(`zone_id.eq.${viewerZoneId},zone_id.is.null`)
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
  const loadIds = rows.map((r) => r.id)

  // Items live on load_items now (migration 0010), so we can't fetch them
  // through the broken loads → product_names FK. Pull all items for the
  // visible loads in one round-trip and group by load_id client-side.
  const itemsByLoad = new Map<string, ItemRow[]>()
  if (loadIds.length > 0) {
    const { data: itemsRaw, error: itemsError } = await supabase
      .from('load_items')
      .select(
        `load_id, position,
         product:product_names!product_name_id(name)`
      )
      .in('load_id', loadIds)

    if (itemsError) {
      return (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-900">
          <p className="font-semibold">Failed to load items.</p>
          <p className="mt-2 font-mono">{itemsError.message}</p>
        </div>
      )
    }

    for (const item of (itemsRaw ?? []) as unknown as ItemRow[]) {
      const list = itemsByLoad.get(item.load_id)
      if (list) list.push(item)
      else itemsByLoad.set(item.load_id, [item])
    }
  }

  const loads: LoadListRow[] = rows.map((row) => {
    const items = (itemsByLoad.get(row.id) ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
    return {
      id: row.id,
      reference_code: row.reference_code,
      origin_address: row.origin_address,
      destination_address: row.destination_address,
      truck_type_required: row.truck_type_required,
      pickup_deadline: row.pickup_deadline,
      status: row.status,
      created_at: row.created_at,
      posted_by_name: row.posted_by_operator?.full_name ?? '—',
      bid_count: row.bids[0]?.count ?? 0,
      items_summary: summarizeItemsByProduct(
        items.map((i) => i.product?.name ?? null)
      ),
    }
  })

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
