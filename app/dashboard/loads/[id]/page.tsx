import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  BidsTableRealtime,
  type BidRowData,
} from '@/components/loads/bids-table-realtime'
import { CancelLoadButton } from '@/components/loads/cancel-load-button'
import { createClient } from '@/lib/supabase/server'
import {
  formatAbsoluteIST,
  formatINR,
  formatRelativeTime,
} from '@/lib/format'
import type { LoadStatus, TruckType } from '@/lib/types'

type LoadDetailRow = {
  id: string
  origin_city: string
  destination_city: string
  truck_type_required: TruckType
  weight_kg: number
  pickup_deadline: string
  reference_price_paise: number | null
  notes: string | null
  status: LoadStatus
  created_at: string
  posted_by: string
  cancelled_at: string | null
  cancellation_reason: string | null
  posted_by_operator: { full_name: string } | null
  cancelled_by_operator: { full_name: string } | null
}

const LOAD_STATUS_BADGE: Record<LoadStatus, string> = {
  open: 'bg-blue-100 text-blue-900',
  awarded: 'bg-green-100 text-green-900',
  cancelled: 'bg-slate-200 text-slate-700',
  completed: 'bg-slate-200 text-slate-700',
}

export default async function LoadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  // We need the viewer's operator id to decide whether to show the Cancel
  // button. The /dashboard layout already redirects unauthenticated users
  // and renders the "not provisioned" banner if there's no operator row,
  // but we re-resolve here so we have the id without leaning on context.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: currentOperator } = await supabase
    .from('operators')
    .select('id')
    .eq('id', user.id)
    .maybeSingle()

  const { data: loadRaw, error: loadError } = await supabase
    .from('loads')
    .select(
      `id, origin_city, destination_city, truck_type_required, weight_kg,
       pickup_deadline, reference_price_paise, notes, status, created_at,
       posted_by, cancelled_at, cancellation_reason,
       posted_by_operator:operators!loads_posted_by_fkey(full_name),
       cancelled_by_operator:operators!loads_cancelled_by_fkey(full_name)`
    )
    .eq('id', id)
    .maybeSingle()

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
    .eq('load_id', id)
    .order('amount_paise', { ascending: true })

  const bids = (bidsRaw ?? []) as unknown as BidRowData[]
  const shortId = id.slice(0, 8)

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
        <span className="font-mono text-slate-900">Load #{shortId}</span>
      </nav>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
            {load.origin_city} → {load.destination_city}
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

        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
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
              Weight
            </dt>
            <dd className="mt-1 text-sm tabular-nums text-slate-900">
              {load.weight_kg.toLocaleString('en-IN')} kg
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

      {bidsError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-900">
          <p className="font-semibold">Failed to load bids.</p>
          <p className="mt-2 font-mono">{bidsError.message}</p>
        </div>
      ) : (
        <BidsTableRealtime
          loadId={id}
          loadStatus={load.status}
          initialBids={bids}
        />
      )}
    </div>
  )
}
