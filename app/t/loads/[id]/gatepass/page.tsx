import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatAbsoluteIST, formatINR } from '@/lib/format'
import { requireTrucker } from '@/lib/trucker'

export const dynamic = 'force-dynamic'

export default async function GatePassPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const trucker = await requireTrucker()
  const admin = createAdminClient()

  // Fetch load details
  const { data: load } = await admin
    .from('loads')
    .select(
      `id, reference_code, origin_address, destination_address, truck_type_required,
       pickup_deadline, status, created_at, truck_number, driver_name, driver_phone,
       items:load_items(
         id, position, quantity_value, weight_value, weight_unit,
         product:product_names!product_name_id(name),
         container:container_types!container_type_id(name),
         quantity_unit:quantity_units!quantity_unit_id(name)
       )`
    )
    .eq('id', id)
    .maybeSingle()

  if (!load) notFound()

  // Fetch winning bid amount
  const { data: wonBid } = await admin
    .from('bids')
    .select('amount_paise')
    .eq('load_id', load.id)
    .eq('trucker_id', trucker.id)
    .eq('status', 'won')
    .maybeSingle()

  if (!wonBid) notFound()

  const items = [...(load.items ?? [])].sort((a: any, b: any) => a.position - b.position)
  const totalWeightKg = items.reduce((acc: number, it: any) => {
    const w = Number(it.weight_value)
    return Number.isFinite(w) && it.weight_unit === 'kg' ? acc + w : acc
  }, 0)

  return (
    <div className="space-y-5">
      <nav className="text-xs print:hidden">
        <Link
          href={`/t/loads/${load.id}`}
          className="text-slate-600 hover:text-slate-900 inline-flex items-center gap-1 font-medium"
        >
          ← Back to load details
        </Link>
      </nav>

      {/* Official Digital Gate Pass Container */}
      <div className="rounded-xl border-2 border-slate-900 bg-white p-6 shadow-md space-y-6">
        {/* Header Pass Title */}
        <div className="border-b-2 border-slate-900 pb-4 text-center">
          <span className="inline-block rounded-md bg-slate-900 px-3 py-1 text-xs font-bold text-white uppercase tracking-widest">
            OFFICIAL WAREHOUSE GATE PASS
          </span>
          <h1 className="mt-2 text-xl font-black text-slate-900 uppercase tracking-tight">
            RAM-NATH FREIGHT LOGISTICS
          </h1>
          <p className="mt-0.5 font-mono text-xs text-slate-600">
            Pass Reference: <span className="font-bold text-slate-900">#{load.reference_code}</span>
          </p>
        </div>

        {/* QR Code / Digital Verification Token */}
        <div className="flex flex-col items-center justify-center rounded-lg bg-slate-50 border border-slate-200 p-4 text-center">
          <div className="h-28 w-28 bg-slate-900 flex items-center justify-center text-white rounded-md text-center p-2 font-mono text-[10px]">
            [ QR VERIFIED ]
            <br />
            {load.reference_code}
          </div>
          <p className="mt-2 text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
            Present at Warehouse Gate Verification
          </p>
        </div>

        {/* Transporter & Vehicle Details */}
        <div className="space-y-2">
          <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wider border-b border-slate-200 pb-1">
            Transporter & Vehicle Authorization
          </h2>
          <dl className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="text-slate-500">Transporter</dt>
              <dd className="font-semibold text-slate-900">{trucker.full_name ?? 'Trucker'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Assigned Truck No</dt>
              <dd className="font-bold text-slate-900 font-mono text-sm tracking-wider uppercase">
                {load.truck_number ?? 'NOT SET'}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Authorized Driver</dt>
              <dd className="font-semibold text-slate-900">{load.driver_name ?? 'NOT SET'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Driver Phone</dt>
              <dd className="font-mono text-slate-900">{load.driver_phone ?? trucker.phone_e164}</dd>
            </div>
          </dl>
        </div>

        {/* Logistics & Route Details */}
        <div className="space-y-2">
          <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wider border-b border-slate-200 pb-1">
            Route & Logistics Information
          </h2>
          <dl className="grid grid-cols-1 gap-2 text-xs">
            <div>
              <dt className="text-slate-500">Pickup Origin Address</dt>
              <dd className="font-medium text-slate-900">{load.origin_address}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Destination Delivery Address</dt>
              <dd className="font-medium text-slate-900">{load.destination_address}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Pickup Deadline Schedule</dt>
              <dd className="font-semibold text-slate-900">{formatAbsoluteIST(load.pickup_deadline)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Agreed Freight Rate</dt>
              <dd className="font-bold text-slate-900 font-mono text-sm">{formatINR(wonBid.amount_paise)}</dd>
            </div>
          </dl>
        </div>

        {/* Cargo Manifest Summary */}
        <div className="space-y-2">
          <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wider border-b border-slate-200 pb-1">
            Cargo Manifest Summary ({items.length} items)
          </h2>
          <ul className="divide-y divide-slate-100 text-xs">
            {items.map((it: any) => (
              <li key={it.id} className="py-1.5 flex justify-between">
                <span className="font-medium text-slate-900">{it.product?.name ?? 'Item'}</span>
                <span className="font-mono text-slate-700">
                  {Number(it.quantity_value).toLocaleString('en-IN')} {it.quantity_unit?.name ?? ''} (
                  {Number(it.weight_value).toLocaleString('en-IN')} {it.weight_unit})
                </span>
              </li>
            ))}
          </ul>
          <div className="pt-2 border-t border-slate-200 flex justify-between text-xs font-bold text-slate-900">
            <span>Total Manifest Weight:</span>
            <span>{totalWeightKg.toLocaleString('en-IN')} kg</span>
          </div>
        </div>

        {/* Footer Authorization Stamp */}
        <div className="border-t-2 border-dashed border-slate-300 pt-4 text-center text-[10px] text-slate-500">
          <p className="font-semibold text-slate-700 uppercase">Automated Digital Authorization</p>
          <p className="mt-0.5">Valid for single pickup entry at factory gate. Generated via Ram-Nath Logistics Platform.</p>
        </div>
      </div>
    </div>
  )
}
