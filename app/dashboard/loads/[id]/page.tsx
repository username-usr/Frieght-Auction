import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  BidsTableRealtime,
  type BidRowData,
} from '@/components/loads/bids-table-realtime'
import { CancelLoadButton } from '@/components/loads/cancel-load-button'
import { getOperatorContext } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  formatAbsoluteIST,
  formatINR,
  formatRelativeTime,
} from '@/lib/format'
import type { LoadStatus, TruckType } from '@/lib/types'

type LoadItemRow = {
  id: string
  position: number
  quantity_value: number | string
  weight_value: number | string
  weight_unit: 'kg' | 'liters'
  product: { name: string } | null
  container: { name: string } | null
  quantity_unit: { name: string } | null
}

type LoadDetailRow = {
  id: string
  reference_code: string
  origin_address: string
  destination_address: string
  truck_type_required: TruckType
  pickup_deadline: string
  reference_price_paise: number | null
  notes: string | null
  status: LoadStatus
  created_at: string
  posted_by: string
  zone_id: string | null
  cancelled_at: string | null
  cancellation_reason: string | null
  posted_by_operator: { full_name: string } | null
  cancelled_by_operator: { full_name: string } | null
  items: LoadItemRow[]
}

const LOAD_STATUS_BADGE: Record<LoadStatus, string> = {
  open: 'bg-blue-100 text-blue-900',
  awarded: 'bg-green-100 text-green-900',
  cancelled: 'bg-slate-200 text-slate-700',
  completed: 'bg-slate-200 text-slate-700',
}

// Standard UUID v4 shape with dashes; anything else (e.g. 4-char ref code)
// is looked up by reference_code instead. Letting users hit either form
// means a quoted "Load #A8K2" can become a URL without translation.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const LOAD_SELECT = `id, reference_code, origin_address, destination_address, truck_type_required,
       pickup_deadline, reference_price_paise, notes, status, created_at,
       posted_by, zone_id, cancelled_at, cancellation_reason,
       posted_by_operator:operators!loads_posted_by_fkey(full_name),
       cancelled_by_operator:operators!loads_cancelled_by_fkey(full_name),
       items:load_items(
         id, position, quantity_value, weight_value, weight_unit,
         product:product_names!product_name_id(name),
         container:container_types!container_type_id(name),
         quantity_unit:quantity_units!quantity_unit_id(name)
       )`

export default async function LoadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  // The /dashboard layout already redirects non-operators to /not-authorized
  // before this page renders, so `operator` is guaranteed here. We use the
  // memoized helper to avoid a second round-trip — the layout's call and
  // this call share one Supabase fetch via React's cache().
  const { operator: currentOperator, isAdmin } = await getOperatorContext()

  const loadQuery = supabase.from('loads').select(LOAD_SELECT)
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

  const load = loadRaw as unknown as LoadDetailRow

  // Zone-based visibility gate. Admins and unzoned operators see everything;
  // a zoned operator can see no-zone loads plus loads matching their zone.
  // notFound() rather than a "denied" page so the URL stays opaque.
  const viewerZoneId = currentOperator?.zone_id ?? null
  const canSee =
    isAdmin ||
    viewerZoneId == null ||
    load.zone_id == null ||
    load.zone_id === viewerZoneId
  if (!canSee) notFound()
  const items = [...load.items].sort((a, b) => a.position - b.position)
  const totals = items.reduce(
    (acc, it) => {
      const w = Number(it.weight_value)
      if (Number.isFinite(w) && w > 0) {
        if (it.weight_unit === 'kg') acc.kg += w
        else acc.liters += w
      }
      return acc
    },
    { kg: 0, liters: 0 }
  )

  // ALL bids for this load — no status filter (UX decision in step 4: show
  // lost/withdrawn too so the operator has the full audit trail). The
  // boolean grouping (active+won first, then everything else) is applied
  // client-side via lib/bids-sort.ts because supabase-js can't express it
  // in `.order()`.
  const { data: bidsRaw, error: bidsError } = await supabase
    .from('bids')
    .select(
      `id, amount_paise, status, created_at,
       trucker:truckers!bids_trucker_id_fkey(full_name, phone_e164, truck_type)`
    )
    .eq('load_id', load.id)
    .order('amount_paise', { ascending: true })

  const bids = (bidsRaw ?? []) as unknown as BidRowData[]

  // Server-side gate: button renders only when the viewer is the poster
  // AND the load is still open. The DB function re-enforces both.
  const canCancel =
    load.status === 'open' &&
    currentOperator?.id != null &&
    currentOperator.id === load.posted_by
  const activeBidCount = bids.filter((b) => b.status === 'active').length

  return (
    <div className="space-y-6">
      <nav className="text-sm">
        <Link
          href="/dashboard"
          className="text-slate-600 hover:text-slate-900"
        >
          Dashboard
        </Link>
        <span className="mx-2 text-slate-400">/</span>
        <span className="font-mono text-slate-900">
          Load #{load.reference_code}
        </span>
      </nav>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
            {load.origin_address} → {load.destination_address}
          </h2>
          <div className="flex items-center gap-3">
            <span
              className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${LOAD_STATUS_BADGE[load.status]}`}
            >
              {load.status}
            </span>
            {canCancel ? (
              <CancelLoadButton
                loadId={load.id}
                activeBidCount={activeBidCount}
              />
            ) : null}
          </div>
        </div>

        {load.status === 'cancelled' && load.cancelled_at ? (
          <p className="mt-3 text-sm text-slate-600">
            Cancelled by{' '}
            <span className="font-medium text-slate-900">
              {load.cancelled_by_operator?.full_name ?? 'unknown'}
            </span>{' '}
            at {formatAbsoluteIST(load.cancelled_at)}
            {load.cancellation_reason
              ? ` — Reason: ${load.cancellation_reason}`
              : ''}
            .
          </p>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <Link
            href={`/dashboard/loads/${load.id}/audit`}
            className="font-medium text-slate-700 hover:text-slate-900"
          >
            View activity log →
          </Link>
          {load.status === 'open' ? (
            <Link
              href={`/dashboard/loads/${load.id}/visibility`}
              className="font-medium text-slate-700 hover:text-slate-900"
            >
              Edit visibility →
            </Link>
          ) : null}
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Truck type
            </dt>
            <dd className="mt-1 text-sm capitalize text-slate-900">
              {load.truck_type_required}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Pickup deadline
            </dt>
            <dd className="mt-1 text-sm text-slate-900">
              {formatAbsoluteIST(load.pickup_deadline)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Posted by
            </dt>
            <dd className="mt-1 text-sm text-slate-900">
              {load.posted_by_operator?.full_name ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Posted
            </dt>
            <dd className="mt-1 text-sm text-slate-900">
              {formatRelativeTime(load.created_at)}
            </dd>
          </div>
          {load.reference_price_paise != null && (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">
                Reference price
              </dt>
              <dd className="mt-1 text-sm tabular-nums text-slate-900">
                {formatINR(load.reference_price_paise)}
              </dd>
            </div>
          )}
        </dl>

        {load.notes ? (
          <div className="mt-6 border-t border-slate-200 pt-4">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Notes
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
              {load.notes}
            </p>
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900">
          Products ({items.length})
        </h3>
        {items.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">No items on this load.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="px-4 py-2 text-left">Product</th>
                  <th className="px-4 py-2 text-left">Container</th>
                  <th className="px-4 py-2 text-right">Quantity</th>
                  <th className="px-4 py-2 text-right">Weight</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => {
                  const qty = Number(item.quantity_value)
                  const w = Number(item.weight_value)
                  return (
                    <tr key={item.id}>
                      <td className="px-4 py-2 font-medium text-slate-900">
                        {item.product?.name ?? '—'}
                      </td>
                      <td className="px-4 py-2 text-slate-700">
                        {item.container?.name ?? '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-slate-700">
                        {qty.toLocaleString('en-IN')}{' '}
                        {item.quantity_unit?.name ?? ''}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums text-slate-700">
                        {w.toLocaleString('en-IN')} {item.weight_unit}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="bg-slate-50 text-xs">
                <tr>
                  <td
                    className="px-4 py-2 text-right font-medium uppercase tracking-wider text-slate-600"
                    colSpan={3}
                  >
                    Total weight
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums font-semibold text-slate-900">
                    {totals.kg.toLocaleString('en-IN')} kg
                    {' • '}
                    {totals.liters.toLocaleString('en-IN')} liters
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {bidsError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-900">
          <p className="font-semibold">Failed to load bids.</p>
          <p className="mt-2 font-mono">{bidsError.message}</p>
        </div>
      ) : (
        <BidsTableRealtime
          loadId={load.id}
          loadStatus={load.status}
          initialBids={bids}
        />
      )}
    </div>
  )
}
