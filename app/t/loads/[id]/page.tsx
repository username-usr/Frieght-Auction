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
import { AcceptAwardForm } from './accept-award-form'
import { PlaceBidForm } from './place-bid-form'
import { ShipmentDetailsForm } from './shipment-details-form'

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

type AdditionalDestinationRow = {
  id: string
  address: string
  position: number
}

type LoadDetail = {
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
  accepted_at: string | null
  declined_at: string | null
  decline_reason: string | null
  invoice_number: string | null
  truck_number: string | null
  driver_name: string | null
  driver_phone: string | null
  items: LoadItem[]
  destinations: AdditionalDestinationRow[]
}

type BidRow = {
  id: string
  amount_paise: number
  status: BidStatus
  trucker_id: string
  created_at: string
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const LOAD_SELECT = `id, reference_code, origin_address, destination_address, truck_type_required,
           pickup_deadline, reference_price_paise, notes, status, created_at,
           accepted_at, declined_at, decline_reason,
           invoice_number, truck_number, driver_name, driver_phone,
           items:load_items(
             id, position, quantity_value, weight_value, weight_unit,
             product:product_names!product_name_id(name),
             container:container_types!container_type_id(name),
             quantity_unit:quantity_units!quantity_unit_id(name)
           ),
           destinations:load_destinations(id, address, position)`

export default async function TruckerLoadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const trucker = await requireTrucker()
  const supabase = createAdminClient()

  const loadQuery = supabase.from('loads').select(LOAD_SELECT)
  const { data: loadRaw, error: loadError } = await (UUID_RE.test(id)
    ? loadQuery.eq('id', id)
    : loadQuery.eq('reference_code', id.toUpperCase())
  ).maybeSingle()

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

  // Visibility + bids in parallel — both keyed on load.id. The page is
  // gated below: if the trucker isn't on the visibility list AND has no
  // bid history on this load, we 404 to mask the load's existence.
  const [{ data: bidsRaw }, { data: visibilityRow }] = await Promise.all([
    supabase
      .from('bids')
      .select('id, amount_paise, status, trucker_id, created_at')
      .eq('load_id', load.id),
    supabase
      .from('load_trucker_visibility')
      .select('load_id')
      .eq('load_id', load.id)
      .eq('trucker_id', trucker.id)
      .maybeSingle(),
  ])

  const bids = (bidsRaw ?? []) as BidRow[]
  const ownAnyBid = bids.find((b) => b.trucker_id === trucker.id)
  const isVisible = visibilityRow != null

  if (!ownAnyBid && !isVisible) {
    notFound()
  }

  const items = [...load.items].sort((a, b) => a.position - b.position)
  const additionalDestinations = [...(load.destinations ?? [])].sort(
    (a, b) => a.position - b.position
  )
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

  const activeAmounts = bids
    .filter((b) => b.status === 'active')
    .map((b) => b.amount_paise)
  const lowBid = activeAmounts.length > 0 ? Math.min(...activeAmounts) : null

  // Bucket the trucker's own bid by status. ownWonBid stays 'won' through
  // the awarded → accepted → completed lifecycle (accept_award doesn't
  // touch bid status, only load status). ownDeclinedBid is set only after
  // decline_award flips the won bid to 'declined'.
  const ownActiveBid =
    bids.find(
      (b) => b.trucker_id === trucker.id && b.status === 'active'
    ) ?? null
  const ownWonBid =
    bids.find(
      (b) => b.trucker_id === trucker.id && b.status === 'won'
    ) ?? null
  const ownDeclinedBid =
    bids.find(
      (b) => b.trucker_id === trucker.id && b.status === 'declined'
    ) ?? null
  const ownLostBid =
    bids.find(
      (b) => b.trucker_id === trucker.id && b.status === 'lost'
    ) ?? null
  const ownWithdrawnBid =
    bids.find(
      (b) => b.trucker_id === trucker.id && b.status === 'withdrawn'
    ) ?? null

  const isSuspended = trucker.status === 'blocked'
  const canBid = load.status === 'open'

  // Lifecycle state for THIS trucker on THIS load.
  const pendingAcceptance =
    ownWonBid != null && load.status === 'awarded'
  const acceptedByMe = ownWonBid != null && load.status === 'accepted'
  const completedForMe = ownWonBid != null && load.status === 'completed'
  const declinedByMe = ownDeclinedBid != null && load.status === 'declined'
  // Other terminal "bidding closed" states for this trucker.
  const shutOut =
    ownLostBid != null &&
    (load.status === 'awarded' ||
      load.status === 'accepted' ||
      load.status === 'completed')

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

      {isSuspended ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-semibold">Your account is suspended from bidding</p>
          <p className="mt-1 text-xs">
            Contact the operator to reactivate your account.
          </p>
        </div>
      ) : null}

      {pendingAcceptance ? (
        // Awarded but not yet accepted — show the Accept/Decline panel.
        <AcceptAwardForm loadId={load.id} />
      ) : acceptedByMe ? (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">
          <p className="font-semibold">
            ✅ You accepted this load
            {load.accepted_at
              ? ` on ${formatAbsoluteIST(load.accepted_at)}`
              : ''}
          </p>
          <p className="mt-1 text-xs">
            Pickup by {formatAbsoluteIST(load.pickup_deadline)}. Fill in your
            truck and driver details below — they help the operator track
            the load.
          </p>
        </div>
      ) : completedForMe ? (
        <div className="rounded-lg border border-slate-200 bg-slate-100 p-4 text-sm text-slate-800">
          <p className="font-semibold">Load completed.</p>
          <p className="mt-1 text-xs">
            The operator marked this load delivered. Details are now locked.
          </p>
        </div>
      ) : declinedByMe ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-semibold">You declined this award</p>
          {load.declined_at ? (
            <p className="mt-1 text-xs">
              On {formatAbsoluteIST(load.declined_at)}
            </p>
          ) : null}
          {load.decline_reason ? (
            <p className="mt-2 whitespace-pre-wrap text-xs text-red-800">
              <span className="font-medium">Reason:</span>{' '}
              {load.decline_reason}
            </p>
          ) : null}
        </div>
      ) : shutOut ? (
        <div className="rounded-lg border border-slate-200 bg-slate-100 p-4 text-sm text-slate-700">
          Bidding closed for this load.
        </div>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              {load.origin_address} → {load.destination_address}
              {additionalDestinations.length > 0 ? (
                <span className="text-slate-500">
                  {' '}
                  (+{additionalDestinations.length} more)
                </span>
              ) : null}
            </h1>
            <p className="mt-1 font-mono text-xs text-slate-500">
              #{load.reference_code}
            </p>
          </div>
          <span className="inline-block whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium capitalize text-slate-700">
            {load.status}
          </span>
        </div>

        {additionalDestinations.length > 0 ? (
          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50/60 p-3">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
              All destinations
            </p>
            <ol className="mt-2 space-y-1 text-sm text-slate-900">
              <li>
                <span className="mr-2 inline-block w-4 text-right tabular-nums text-slate-500">
                  1.
                </span>
                {load.destination_address}
              </li>
              {additionalDestinations.map((d, idx) => (
                <li key={d.id}>
                  <span className="mr-2 inline-block w-4 text-right tabular-nums text-slate-500">
                    {idx + 2}.
                  </span>
                  {d.address}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
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

      {/* Shipment details on the trucker side: editable in 'accepted',
        read-only in 'completed'. Not shown otherwise. */}
      {acceptedByMe ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">
            Truck & driver details
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Optional. The operator will see what you enter here.
          </p>
          <div className="mt-3">
            <ShipmentDetailsForm
              loadId={load.id}
              initialTruckNumber={load.truck_number}
              initialDriverName={load.driver_name}
              initialDriverPhone={load.driver_phone}
            />
          </div>
        </section>
      ) : completedForMe ? (
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-900">
            Truck & driver details
          </h2>
          <dl className="mt-3 grid grid-cols-1 gap-x-3 gap-y-3 text-xs">
            <div>
              <dt className="text-slate-500">Truck number</dt>
              <dd className="mt-0.5 font-mono uppercase tracking-wider text-slate-900">
                {load.truck_number ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Driver name</dt>
              <dd className="mt-0.5 text-slate-900">
                {load.driver_name ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Driver phone</dt>
              <dd className="mt-0.5 font-mono text-slate-900">
                {load.driver_phone ?? '—'}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">
          Stock items ({items.length})
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
        ) : ownWonBid ? (
          <p className="mt-2 text-xs text-slate-600">
            Your winning bid:{' '}
            <span className="font-medium tabular-nums text-slate-900">
              {formatINR(ownWonBid.amount_paise)}
            </span>
          </p>
        ) : ownDeclinedBid ? (
          <p className="mt-2 text-xs text-slate-600">
            Your declined bid was{' '}
            <span className="font-medium tabular-nums text-slate-900">
              {formatINR(ownDeclinedBid.amount_paise)}
            </span>
            .
          </p>
        ) : ownLostBid ? (
          <p className="mt-2 text-xs text-slate-600">
            Your last bid was{' '}
            <span className="font-medium tabular-nums text-slate-900">
              {formatINR(ownLostBid.amount_paise)}
            </span>{' '}
            (lost).
          </p>
        ) : ownWithdrawnBid ? (
          <p className="mt-2 text-xs text-slate-600">
            Your last bid was{' '}
            <span className="font-medium tabular-nums text-slate-900">
              {formatINR(ownWithdrawnBid.amount_paise)}
            </span>{' '}
            (withdrawn).
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
              disabledReason={
                isSuspended ? 'Your account is suspended.' : null
              }
            />
          </div>
        </section>
      ) : pendingAcceptance ||
        acceptedByMe ||
        completedForMe ||
        declinedByMe ||
        shutOut ? null : (
        <div className="rounded-lg border border-slate-200 bg-slate-100 p-4 text-sm text-slate-700">
          This load is no longer open for bidding.
        </div>
      )}
    </div>
  )
}
