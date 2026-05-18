import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  formatAbsoluteIST,
  formatINR,
  formatRelativeTime,
} from '@/lib/format'
import { requireTrucker } from '@/lib/trucker'
import type { LoadStatus, TruckType } from '@/lib/types'

type LoadRow = {
  id: string
  origin_city: string
  destination_city: string
  truck_type_required: TruckType
  weight_kg: number
  pickup_deadline: string
  status: LoadStatus
  created_at: string
  bids: { amount_paise: number; status: string }[]
}

export default async function TruckerLoadsPage() {
  const trucker = await requireTrucker()
  const supabase = createAdminClient()

  // Two-row visibility filter for the trucker:
  //   * loads requesting their exact truck_type
  //   * loads requesting 'open' (the "any truck" wildcard in the enum)
  // We fetch active bids inline so we can show the L1 amount on each card.
  // RLS doesn't apply (admin client) so the OR filter behaves as written.
  const { data: loadsRaw, error } = await supabase
    .from('loads')
    .select(
      `id, origin_city, destination_city, truck_type_required, weight_kg,
       pickup_deadline, status, created_at,
       bids:bids!bids_load_id_fkey(amount_paise, status)`
    )
    .eq('status', 'open')
    .or(`truck_type_required.eq.${trucker.truck_type},truck_type_required.eq.open`)
    .order('pickup_deadline', { ascending: true })

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
        <p className="font-semibold">Could not load matching loads.</p>
        <p className="mt-1 font-mono text-xs">{error.message}</p>
      </div>
    )
  }

  // Active bids are filtered & reduced server-side here because supabase-js
  // can't express both a filter on the embedded resource and a "min"
  // aggregate in one request.
  const loads = (loadsRaw ?? []).map((l) => {
    const row = l as unknown as LoadRow
    const activeAmounts = row.bids
      .filter((b) => b.status === 'active')
      .map((b) => b.amount_paise)
    const lowBid = activeAmounts.length > 0
      ? Math.min(...activeAmounts)
      : null
    return { ...row, lowBid }
  })

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Hi, {trucker.full_name ?? 'trucker'}
          </h1>
          <p className="mt-0.5 text-xs text-slate-600">
            <span className="font-mono">{trucker.phone_e164}</span> ·{' '}
            <span className="capitalize">{trucker.truck_type}</span> truck
          </p>
        </div>
        <Link
          href="/t/logout"
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Sign out
        </Link>
      </header>

      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-600">
        Open loads ({loads.length})
      </h2>

      {loads.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
          No open loads matching your truck type right now.
        </div>
      ) : (
        <ul className="space-y-3">
          {loads.map((load) => (
            <li key={load.id}>
              <Link
                href={`/t/loads/${load.id}`}
                className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow"
              >
                <p className="text-base font-semibold text-slate-900">
                  {load.origin_city} → {load.destination_city}
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                  <div>
                    <dt className="text-slate-500">Truck</dt>
                    <dd className="capitalize text-slate-900">
                      {load.truck_type_required}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Weight</dt>
                    <dd className="tabular-nums text-slate-900">
                      {load.weight_kg.toLocaleString('en-IN')} kg
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-slate-500">Pickup by</dt>
                    <dd className="text-slate-900">
                      {formatAbsoluteIST(load.pickup_deadline)}
                    </dd>
                  </div>
                </dl>
                <div className="mt-3 flex items-baseline justify-between border-t border-slate-100 pt-3">
                  <span className="text-xs text-slate-500">
                    {load.lowBid != null ? 'Current low bid' : 'Posted'}
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-slate-900">
                    {load.lowBid != null
                      ? formatINR(load.lowBid)
                      : formatRelativeTime(load.created_at)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
