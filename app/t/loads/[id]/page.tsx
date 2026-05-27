import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  formatAbsoluteIST,
  formatINR,
  formatRelativeTime,
} from '@/lib/format'
import { requireTrucker } from '@/lib/trucker'
import type { LoadStatus, TruckType, BidStatus } from '@/lib/types'
import { PlaceBidForm } from './place-bid-form'

export const dynamic = 'force-dynamic'

type LoadItem = {
  id: string
  position: number
  quantity_value: number | string
  weight_value: number | string
  weight_unit: 'kg' | 'liters'
  product: { name: string } | null
  container: { name: string } | null
  quantity_unit: { name: string } | null
}

type LoadDetail = {
  id: string
  origin_city: string
  destination_city: string
  truck_type_required: TruckType
  pickup_deadline: string
  reference_price_paise: number | null
  notes: string | null
  status: LoadStatus
  created_at: string
  items: LoadItem[]
}

type BidRow = {
  id: string
  amount_paise: number
  status: BidStatus
  trucker_id: string
  created_at: string
}

export default async function TruckerLoadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const trucker = await requireTrucker()
  const supabase = createAdminClient()

  const [{ data: loadRaw, error: loadError }, { data: bidsRaw }] =
    await Promise.all([
      supabase
        .from('loads')
        .select(
          `id, origin_city, destination_city, truck_type_required,
           pickup_deadline, reference_price_paise, notes, status, created_at,
           items:load_items(
             id, position, quantity_value, weight_value, weight_unit,
             product:product_names!product_name_id(name),
             container:container_types!container_type_id(name),
             quantity_unit:quantity_units!quantity_unit_id(name)
           )`
        )
        .eq('id', id)
        .maybeSingle(),
      supabase
        .from('bids')
        .select('id, amount_paise, status, trucker_id, created_at')
        .eq('load_id', id),
    ])

  if (loadError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
        <p className="font-semibold">Could not load this load.</p>
        <p className="mt-1 font-mono text-xs">{loadError.message}</p>
      </div>
    )
  }
  if (!loadRaw) notFound()

  const load = loadRaw as unknown as LoadDetail
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
  const bids = (bidsRaw ?? []) as BidRow[]

  // Anonymized L1: lowest amount among ACTIVE bids. We deliberately do not
  // reveal the bidder identity to a trucker — they only see the number.
  const activeAmounts = bids
    .filter((b) => b.status === 'active')
    .map((b) => b.amount_paise)
  const lowBid = activeAmounts.length > 0 ? Math.min(...activeAmounts) : null

  // Pull THIS trucker's own active bid (if any) so we can prefill the form
  // and switch the button copy to "Update bid".
  const ownActiveBid =
    bids.find(
      (b) => b.trucker_id === trucker.id && b.status === 'active'
    ) ?? null
  const ownNonActiveBid =
    bids.find(
      (b) =>
        b.trucker_id === trucker.id &&
        (b.status === 'won' || b.status === 'lost' || b.status === 'withdrawn')
    ) ?? null

  const canBid = load.status === 'open'

  // Outcome banner for awarded loads. We only render it when this trucker
  // has a non-active bid on record — a trucker who never bid on an awarded
  // load shouldn't be landing here, so showing nothing in that case is fine.
  const wonBanner =
    load.status === 'awarded' && ownNonActiveBid?.status === 'won'
  const lostBanner =
    load.status === 'awarded' && ownNonActiveBid?.status === 'lost'

  return (
    <div className="space-y-5">
      <nav className="text-xs">
        <Link
          href="/t/loads"
          className="text-slate-600 hover:text-slate-900"
        >
          ← Back to loads
        </Link>
      </nav>

      {wonBanner ? (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm font-medium text-green-900">
          🎉 You won this load — Pickup by{' '}
          {formatAbsoluteIST(load.pickup_deadline)}
        </div>
      ) : lostBanner ? (
        <div className="rounded-lg border border-slate-200 bg-slate-100 p-4 text-sm text-slate-700">
          Bidding closed for this load.
        </div>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-lg font-semibold text-slate-900">
            {load.origin_city} → {load.destination_city}
          </h1>
          <span className="inline-block whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium capitalize text-slate-700">
            {load.status}
          </span>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-3 text-xs">
          <div>
            <dt className="text-slate-500">Truck</dt>
            <dd className="mt-0.5 capitalize text-slate-900">
              {load.truck_type_required}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Posted</dt>
            <dd className="mt-0.5 text-slate-900">
              {formatRelativeTime(load.created_at)}
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-slate-500">Pickup by</dt>
            <dd className="mt-0.5 text-slate-900">
              {formatAbsoluteIST(load.pickup_deadline)}
            </dd>
          </div>
        </dl>
        {load.notes ? (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Notes
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
              {load.notes}
            </p>
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">
          Products ({items.length})
        </h2>
        {items.length === 0 ? (
          <p className="mt-2 text-xs text-slate-600">No items on this load.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {items.map((item) => {
              const qty = Number(item.quantity_value)
              const w = Number(item.weight_value)
              return (
                <li
                  key={item.id}
                  className="rounded-md border border-slate-200 bg-slate-50/40 p-3"
                >
                  <p className="text-sm font-medium text-slate-900">
                    {item.product?.name ?? '—'}
                  </p>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <div>
                      <dt className="text-slate-500">Container</dt>
                      <dd className="text-slate-900">
                        {item.container?.name ?? '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Quantity</dt>
                      <dd className="tabular-nums text-slate-900">
                        {qty.toLocaleString('en-IN')}{' '}
                        {item.quantity_unit?.name ?? ''}
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-slate-500">Weight</dt>
                      <dd className="tabular-nums text-slate-900">
                        {w.toLocaleString('en-IN')} {item.weight_unit}
                      </dd>
                    </div>
                  </dl>
                </li>
              )
            })}
          </ul>
        )}
        {items.length > 0 ? (
          <div className="mt-3 flex items-baseline justify-between border-t border-slate-100 pt-3">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Total weight
            </span>
            <span className="text-sm font-semibold tabular-nums text-slate-900">
              {totals.kg.toLocaleString('en-IN')} kg
              {' • '}
              {totals.liters.toLocaleString('en-IN')} liters
            </span>
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-baseline justify-between">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Current low bid
          </p>
          <p className="text-lg font-semibold tabular-nums text-slate-900">
            {lowBid != null ? formatINR(lowBid) : 'No bids yet'}
          </p>
        </div>
        {ownActiveBid ? (
          <p className="mt-2 text-xs text-slate-600">
            Your active bid:{' '}
            <span className="font-medium tabular-nums text-slate-900">
              {formatINR(ownActiveBid.amount_paise)}
            </span>
          </p>
        ) : ownNonActiveBid ? (
          <p className="mt-2 text-xs text-slate-600">
            Your last bid was{' '}
            <span className="font-medium tabular-nums text-slate-900">
              {formatINR(ownNonActiveBid.amount_paise)}
            </span>{' '}
            ({ownNonActiveBid.status}).
          </p>
        ) : null}
      </section>

      {canBid ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">
            {ownActiveBid ? 'Update your bid' : 'Place a bid'}
          </h2>
          <div className="mt-3">
            <PlaceBidForm
              loadId={load.id}
              existingAmountPaise={ownActiveBid?.amount_paise ?? null}
            />
          </div>
        </section>
      ) : wonBanner || lostBanner ? null : (
        <div className="rounded-lg border border-slate-200 bg-slate-100 p-4 text-sm text-slate-700">
          This load is no longer open for bidding.
        </div>
      )}
    </div>
  )
}
