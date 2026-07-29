import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  BidsTableRealtime,
  type BidRowData,
} from '@/components/loads/bids-table-realtime'
import { CancelLoadButton } from '@/components/loads/cancel-load-button'
import { CancelAwardButton } from './cancel-award-button'
import { MarkCompletedButton } from './mark-completed-button'
import { ReopenLoadButton } from './reopen-load-button'
import { BroadcastWhatsAppButton } from './broadcast-whatsapp-button'
import { ExportBidsButton } from './export-bids-button'
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

type AdditionalDestinationRow = {
  id: string
  address: string
  position: number
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
  accepted_at: string | null
  declined_at: string | null
  decline_reason: string | null
  invoice_number: string | null
  truck_number: string | null
  driver_name: string | null
  driver_phone: string | null
  posted_by_operator: { full_name: string } | null
  cancelled_by_operator: { full_name: string } | null
  items: LoadItemRow[]
  destinations: AdditionalDestinationRow[]
}

const LOAD_STATUS_BADGE: Record<LoadStatus, string> = {
  open: 'bg-blue-100 text-blue-900',
  awarded: 'bg-amber-100 text-amber-900',
  accepted: 'bg-green-100 text-green-900',
  declined: 'bg-red-100 text-red-900',
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
       accepted_at, declined_at, decline_reason,
       invoice_number, truck_number, driver_name, driver_phone,
       posted_by_operator:operators!loads_posted_by_fkey(full_name),
       cancelled_by_operator:operators!loads_cancelled_by_fkey(full_name),
       items:load_items(
         id, position, quantity_value, weight_value, weight_unit,
         product:product_names!product_name_id(name),
         container:container_types!container_type_id(name),
         quantity_unit:quantity_units!quantity_unit_id(name)
       ),
       destinations:load_destinations(id, address, position)`

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
  // Additional destinations beyond the primary destination_address, sorted
  // by the position the operator chose at post time.
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

  // ALL bids for this load — no status filter (UX decision in step 4: show
  // lost/withdrawn too so the operator has the full audit trail). The
  // boolean grouping (active+won first, then everything else) is applied
  // client-side via lib/bids-sort.ts because supabase-js can't express it
  // in `.order()`.
  const { data: bidsRaw, error: bidsError } = await supabase
    .from('bids')
    .select(
      `id, amount_paise, status, created_at, message_text,
       trucker:truckers!bids_trucker_id_fkey(full_name, phone_e164, truck_type)`
    )
    .eq('load_id', load.id)
    .order('amount_paise', { ascending: true })

  const bids = (bidsRaw ?? []) as unknown as BidRowData[]

  const canCancel =
    load.status === 'open' &&
    currentOperator?.id != null &&
    currentOperator.id === load.posted_by
  const activeBidCount = bids.filter((b) => b.status === 'active').length

  return (
    <div className="space-y-6">
      {/* 1. TOP HEADER BAR: Ref ID, Route Title, Status Badge & Action Buttons */}
      <header className="py-2 px-1 mb-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-mono font-semibold text-slate-700 border border-slate-200">
                Load #{load.reference_code}
              </span>
              <span
                className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${LOAD_STATUS_BADGE[load.status]}`}
              >
                {load.status}
              </span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              {load.origin_address} → {load.destination_address}
              {additionalDestinations.length > 0 ? (
                <span className="text-slate-500 font-normal text-lg">
                  {' '}
                  (+{additionalDestinations.length} drop stop{additionalDestinations.length > 1 ? 's' : ''})
                </span>
              ) : null}
            </h1>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5">
            {canCancel ? (
              <CancelLoadButton
                loadId={load.id}
                activeBidCount={activeBidCount}
              />
            ) : null}
            {load.status === 'awarded' ? (
              <CancelAwardButton loadId={load.id} />
            ) : null}
            {load.status === 'accepted' ? (
              <MarkCompletedButton loadId={load.id} />
            ) : null}
            {load.status === 'completed' ? (
              <ReopenLoadButton loadId={load.id} />
            ) : null}
            {load.status === 'open' ? (
              <>
                <BroadcastWhatsAppButton loadId={load.id} />
                <Link
                  href={`/dashboard/loads/${load.id}/visibility`}
                  className="inline-flex items-center gap-1.5 h-9 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900 transition-colors"
                >
                  <svg className="h-3.5 w-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  Edit visibility
                </Link>
              </>
            ) : null}
            <ExportBidsButton
              loadRefCode={load.reference_code}
              bids={bids}
              referencePricePaise={load.reference_price_paise}
            />
            <Link
              href={`/dashboard/loads/${load.id}/audit`}
              className="inline-flex items-center gap-1.5 h-9 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900 transition-colors"
            >
              <svg className="h-3.5 w-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Activity log
            </Link>
          </div>
        </div>
      </header>

      {/* 2. KPI ANALYTICS SECTION (Directly Below Title Header) */}
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
          referencePricePaise={load.reference_price_paise}
          renderMode="kpi"
        />
      )}

      {/* 3. UNIFIED LOAD SPECIFICATION SHEET (Clean Minimal Spec Sheet) */}
      <section className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
        <div className="bg-slate-50 px-6 py-3 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">
            Load Specifications & Logistics
          </h2>
          <span className="text-xs text-slate-500 font-medium font-mono">
            #{load.reference_code}
          </span>
        </div>

        <div className="divide-y divide-slate-100 text-sm">
          {/* Row 1: Logistics Addresses & Route */}
          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100 bg-white">
            <div className="p-4 space-y-1">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-500 block">Origin Pickup</span>
              <div className="font-medium text-slate-900 text-sm flex items-center gap-2 pt-0.5">
                <svg className="h-4 w-4 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                </svg>
                {load.origin_address}
              </div>
            </div>

            <div className="p-4 space-y-1">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-500 block">Destination Unloading</span>
              <div className="font-medium text-slate-900 text-sm flex items-center gap-2 pt-0.5">
                <svg className="h-4 w-4 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {load.destination_address}
                {additionalDestinations.length > 0 && (
                  <span className="text-xs font-normal text-slate-500 block">
                    (+{additionalDestinations.length} drop stop{additionalDestinations.length > 1 ? 's' : ''}: {additionalDestinations.map(d => d.address).join(', ')})
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Row 2: Cargo Specs & Fleet Specs in 4 Equal Columns */}
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-slate-100 bg-slate-50/40">
            <div className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-500 block">Truck Required</span>
              <span className="mt-1 block font-semibold capitalize text-slate-900">{load.truck_type_required}</span>
            </div>
            <div className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-500 block">Pickup Deadline</span>
              <span className="mt-1 block font-medium text-slate-900">{formatAbsoluteIST(load.pickup_deadline)}</span>
            </div>
            <div className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-500 block">Target Ref Price</span>
              <span className="mt-1 block font-semibold font-mono text-slate-900">
                {load.reference_price_paise ? formatINR(load.reference_price_paise) : 'Not specified'}
              </span>
            </div>
            <div className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-500 block">Posted By</span>
              <span className="mt-1 block font-medium text-slate-900">{load.posted_by_operator?.full_name ?? 'Operator'}</span>
            </div>
          </div>

          {/* Row 3: Stock Items Table Inline */}
          {items.length > 0 && (
            <div className="p-4 space-y-3 bg-white">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Stock Items ({items.length})
                </span>
                <span className="text-xs font-medium text-slate-600">
                  Total Weight: <span className="font-bold text-slate-900">{totals.kg.toLocaleString('en-IN')} kg</span>
                  {totals.liters > 0 ? ` • ${totals.liters.toLocaleString('en-IN')} L` : ''}
                </span>
              </div>

              <div className="overflow-x-auto rounded-md border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-medium border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2 text-left">Item Name</th>
                      <th className="px-3 py-2 text-left">Container / Package</th>
                      <th className="px-3 py-2 text-right">Quantity</th>
                      <th className="px-3 py-2 text-right">Weight</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {items.map((item) => {
                      const qty = Number(item.quantity_value)
                      const w = Number(item.weight_value)
                      return (
                        <tr key={item.id} className="hover:bg-slate-50">
                          <td className="px-3 py-2 font-medium text-slate-900">{item.product?.name ?? '—'}</td>
                          <td className="px-3 py-2 text-slate-600">{item.container?.name ?? '—'}</td>
                          <td className="px-3 py-2 text-right text-slate-700">{qty.toLocaleString('en-IN')} {item.quantity_unit?.name ?? ''}</td>
                          <td className="px-3 py-2 text-right font-medium text-slate-900 font-mono">{w.toLocaleString('en-IN')} {item.weight_unit}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Row 4: Special Notes & Instructions & POD Document Viewer */}
          {load.notes && (
            <div className="p-4 bg-slate-50/50 space-y-3">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-500 block">Special Notes & Logistics Instructions</span>
              <p className="text-xs text-slate-700 leading-relaxed font-normal whitespace-pre-wrap">
                {load.notes.split('[POD_DOCUMENT]:')[0].trim()}
              </p>

              {load.notes.includes('[POD_DOCUMENT]:') && (
                <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-emerald-900 flex items-center gap-1.5">
                      <svg className="h-4 w-4 text-emerald-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      Proof of Delivery (POD) & e-Way Bill Uploaded
                    </span>
                    <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                      ✓ Verified Document
                    </span>
                  </div>
                  <div className="pt-1">
                    {load.notes.split('[POD_DOCUMENT]:')[1].trim().startsWith('data:image/') ? (
                      <div className="space-y-2">
                        <img
                          src={load.notes.split('[POD_DOCUMENT]:')[1].trim()}
                          alt="Proof of Delivery / e-Way Bill Receipt"
                          className="max-h-64 rounded-md border border-emerald-300 object-contain bg-white p-1"
                        />
                        <a
                          href={load.notes.split('[POD_DOCUMENT]:')[1].trim()}
                          download={`POD_${load.reference_code}.png`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-900 underline"
                        >
                          📥 Download High-Res Signed POD Image
                        </a>
                      </div>
                    ) : (
                      <a
                        href={load.notes.split('[POD_DOCUMENT]:')[1].trim()}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-900 underline"
                      >
                        📄 View Uploaded Signed POD / e-Way Bill Document
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Row 5: Driver / Shipment Details (if Accepted or Completed) */}
          {(load.status === 'accepted' || load.status === 'completed') && (
            <div className="p-4 bg-emerald-50/40 grid grid-cols-2 md:grid-cols-4 gap-4 text-xs border-t border-emerald-100">
              <div>
                <span className="text-emerald-800 font-medium uppercase tracking-wider block">Assigned Truck</span>
                <span className="font-mono font-bold text-emerald-950 uppercase">{load.truck_number ?? '—'}</span>
              </div>
              <div>
                <span className="text-emerald-800 font-medium uppercase tracking-wider block">Driver Name</span>
                <span className="font-semibold text-emerald-950">{load.driver_name ?? '—'}</span>
              </div>
              <div>
                <span className="text-emerald-800 font-medium uppercase tracking-wider block">Driver Phone</span>
                <span className="font-mono text-emerald-950">{load.driver_phone ?? '—'}</span>
              </div>
              <div>
                <span className="text-emerald-800 font-medium uppercase tracking-wider block">Invoice No.</span>
                <span className="font-medium text-emerald-950">{load.invoice_number ?? '—'}</span>
              </div>
            </div>
          )}

          {/* Lifecycle Banners */}
          {load.status === 'awarded' && (
            <div className="p-4 bg-amber-50 text-xs text-amber-900 flex items-center gap-2">
              <svg className="h-4 w-4 text-amber-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>Awaiting Trucker Acceptance: The winning trucker will review and accept/decline this award.</span>
            </div>
          )}

          {load.status === 'declined' && (
            <div className="p-4 bg-red-50 text-xs text-red-900 flex items-center gap-2">
              <svg className="h-4 w-4 text-red-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              <span>Trucker Declined Award: {load.decline_reason ?? 'No reason provided'}. Select another bid below to re-award.</span>
            </div>
          )}

          {load.status === 'cancelled' && (
            <div className="p-4 bg-slate-100 text-xs text-slate-700 flex items-center gap-2">
              <svg className="h-4 w-4 text-slate-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
              <span>Load Cancelled{load.cancelled_at ? ` on ${formatAbsoluteIST(load.cancelled_at)}` : ''}</span>
            </div>
          )}
        </div>
      </section>

      {/* 4. BOTTOM BIDS TABLE SECTION */}
      {bidsError ? null : (
        <BidsTableRealtime
          loadId={load.id}
          loadStatus={load.status}
          initialBids={bids}
          referencePricePaise={load.reference_price_paise}
          renderMode="table"
        />
      )}
    </div>
  )
}
