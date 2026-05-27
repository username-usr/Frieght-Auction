import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  formatAbsoluteIST,
  formatINR,
  formatRelativeTime,
  summarizeItemsByProduct,
} from '@/lib/format'
import { requireTrucker } from '@/lib/trucker'
import type { LoadStatus, TruckType } from '@/lib/types'

export const dynamic = 'force-dynamic'

type LoadRow = {
  id: string
  origin_city: string
  destination_city: string
  truck_type_required: TruckType
  pickup_deadline: string
  status: LoadStatus
  created_at: string
  bids: { amount_paise: number; status: string }[]
}

type WonBidRow = {
  amount_paise: number
  load: {
    id: string
    origin_city: string
    destination_city: string
    truck_type_required: TruckType
    pickup_deadline: string
    status: LoadStatus
    created_at: string
  } | null
}

type ItemRow = {
  load_id: string
  position: number
  quantity_value: number | string
  product: { name: string } | null
  quantity_unit: { name: string } | null
}

// What to render under the route line: single item gets the full "50 Bags of
// Rice" treatment with the product emphasized; multi-item uses the shared
// summary helper.
type ItemSummary =
  | {
      kind: 'single'
      quantity: number
      unit: string | null
      product: string
    }
  | { kind: 'multi'; text: string }
  | null

function summarize(items: ItemRow[]): ItemSummary {
  if (items.length === 1 && items[0].product?.name) {
    return {
      kind: 'single',
      quantity: Number(items[0].quantity_value),
      unit: items[0].quantity_unit?.name ?? null,
      product: items[0].product.name,
    }
  }
  if (items.length > 0) {
    return {
      kind: 'multi',
      text: summarizeItemsByProduct(
        items.map((i) => i.product?.name ?? null)
      ),
    }
  }
  return null
}

export default async function TruckerLoadsPage() {
  const trucker = await requireTrucker()
  const supabase = createAdminClient()

  // Two-row visibility filter for the trucker:
  //   * loads requesting their exact truck_type
  //   * loads requesting 'open' (the "any truck" wildcard in the enum)
  // We fetch active bids inline so we can show the L1 amount on each card.
  // RLS doesn't apply (admin client) so the OR filter behaves as written.
  const { data: openLoadsRaw, error: openError } = await supabase
    .from('loads')
    .select(
      `id, origin_city, destination_city, truck_type_required,
       pickup_deadline, status, created_at,
       bids:bids!bids_load_id_fkey(amount_paise, status)`
    )
    .eq('status', 'open')
    .or(`truck_type_required.eq.${trucker.truck_type},truck_type_required.eq.open`)
    .order('pickup_deadline', { ascending: true })

  if (openError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
        <p className="font-semibold">Could not load matching loads.</p>
        <p className="mt-1 font-mono text-xs">{openError.message}</p>
      </div>
    )
  }

  // Won loads: this trucker's 'won' bids with their parent load embedded.
  // award_bid sets bid.status='won' atomically, so a 'won' bid is the
  // authoritative signal that the trucker should still see the load.
  const { data: wonBidsRaw, error: wonError } = await supabase
    .from('bids')
    .select(
      `amount_paise,
       load:loads!bids_load_id_fkey(
         id, origin_city, destination_city, truck_type_required,
         pickup_deadline, status, created_at
       )`
    )
    .eq('trucker_id', trucker.id)
    .eq('status', 'won')

  if (wonError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
        <p className="font-semibold">Could not load your won loads.</p>
        <p className="mt-1 font-mono text-xs">{wonError.message}</p>
      </div>
    )
  }

  const openRows = (openLoadsRaw ?? []) as unknown as LoadRow[]
  const wonRows = (wonBidsRaw ?? []) as unknown as WonBidRow[]

  const openLoadIds = openRows.map((r) => r.id)
  const wonLoadIds = wonRows
    .map((r) => r.load?.id)
    .filter((id): id is string => !!id)
  const allLoadIds = Array.from(new Set([...openLoadIds, ...wonLoadIds]))

  // Single items query covers both sections — open and won load IDs are
  // disjoint (open.status='open' vs won-bid.load.status='awarded') but we
  // de-dupe with a Set just to be safe.
  const itemsByLoad = new Map<string, ItemRow[]>()
  if (allLoadIds.length > 0) {
    const { data: itemsRaw, error: itemsError } = await supabase
      .from('load_items')
      .select(
        `load_id, position, quantity_value,
         product:product_names!product_name_id(name),
         quantity_unit:quantity_units!quantity_unit_id(name)`
      )
      .in('load_id', allLoadIds)

    if (itemsError) {
      return (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-semibold">Could not load items.</p>
          <p className="mt-1 font-mono text-xs">{itemsError.message}</p>
        </div>
      )
    }

    for (const item of (itemsRaw ?? []) as unknown as ItemRow[]) {
      const list = itemsByLoad.get(item.load_id)
      if (list) list.push(item)
      else itemsByLoad.set(item.load_id, [item])
    }
  }

  // Active bids are filtered & reduced server-side here because supabase-js
  // can't express both a filter on the embedded resource and a "min"
  // aggregate in one request.
  const openLoads = openRows.map((row) => {
    const items = (itemsByLoad.get(row.id) ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
    const activeAmounts = row.bids
      .filter((b) => b.status === 'active')
      .map((b) => b.amount_paise)
    const lowBid =
      activeAmounts.length > 0 ? Math.min(...activeAmounts) : null

    return {
      ...row,
      itemSummary: summarize(items),
      lowBid,
    }
  })

  const wonLoads = wonRows
    .filter(
      (r): r is WonBidRow & { load: NonNullable<WonBidRow['load']> } =>
        r.load != null
    )
    .map((r) => {
      const items = (itemsByLoad.get(r.load.id) ?? [])
        .slice()
        .sort((a, b) => a.position - b.position)
      return {
        load: r.load,
        amount_paise: r.amount_paise,
        itemSummary: summarize(items),
      }
    })
    .sort(
      (a, b) =>
        new Date(a.load.pickup_deadline).getTime() -
        new Date(b.load.pickup_deadline).getTime()
    )

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
          prefetch={false}
          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Sign out
        </Link>
      </header>

      {wonLoads.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-600">
            Your won loads ({wonLoads.length})
          </h2>
          <ul className="space-y-3">
            {wonLoads.map((won) => (
              <li key={won.load.id}>
                <Link
                  href={`/t/loads/${won.load.id}`}
                  className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-base font-semibold text-slate-900">
                      {won.load.origin_city} → {won.load.destination_city}
                    </p>
                    <span className="inline-block whitespace-nowrap rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium uppercase tracking-wider text-green-900">
                      Won
                    </span>
                  </div>
                  {won.itemSummary?.kind === 'single' ? (
                    <p className="mt-0.5 text-xs text-slate-600">
                      {won.itemSummary.quantity.toLocaleString('en-IN')}
                      {won.itemSummary.unit
                        ? ` ${won.itemSummary.unit}`
                        : ''}{' '}
                      of{' '}
                      <span className="font-medium text-slate-900">
                        {won.itemSummary.product}
                      </span>
                    </p>
                  ) : won.itemSummary?.kind === 'multi' ? (
                    <p className="mt-0.5 text-xs text-slate-600">
                      {won.itemSummary.text}
                    </p>
                  ) : null}
                  <dl className="mt-3 text-xs">
                    <dt className="text-slate-500">Pickup by</dt>
                    <dd className="text-slate-900">
                      {formatAbsoluteIST(won.load.pickup_deadline)}
                    </dd>
                  </dl>
                  <div className="mt-3 flex items-baseline justify-between border-t border-slate-100 pt-3">
                    <span className="text-xs text-slate-500">
                      Your winning bid
                    </span>
                    <span className="text-base font-semibold tabular-nums text-green-900">
                      {formatINR(won.amount_paise)}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-600">
          Open loads ({openLoads.length})
        </h2>

        {openLoads.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
            No open loads matching your truck type right now.
          </div>
        ) : (
          <ul className="space-y-3">
            {openLoads.map((load) => (
              <li key={load.id}>
                <Link
                  href={`/t/loads/${load.id}`}
                  className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow"
                >
                  <p className="text-base font-semibold text-slate-900">
                    {load.origin_city} → {load.destination_city}
                  </p>
                  {load.itemSummary?.kind === 'single' ? (
                    <p className="mt-0.5 text-xs text-slate-600">
                      {load.itemSummary.quantity.toLocaleString('en-IN')}
                      {load.itemSummary.unit
                        ? ` ${load.itemSummary.unit}`
                        : ''}{' '}
                      of{' '}
                      <span className="font-medium text-slate-900">
                        {load.itemSummary.product}
                      </span>
                    </p>
                  ) : load.itemSummary?.kind === 'multi' ? (
                    <p className="mt-0.5 text-xs text-slate-600">
                      {load.itemSummary.text}
                    </p>
                  ) : null}
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    <div>
                      <dt className="text-slate-500">Truck</dt>
                      <dd className="capitalize text-slate-900">
                        {load.truck_type_required}
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
      </section>
    </div>
  )
}
