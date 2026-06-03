'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { editShipmentDetailsAction } from './actions'

const FIELD =
  'mt-1 block w-full rounded-md border-2 border-slate-400 px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-500 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:cursor-not-allowed disabled:bg-slate-50'
const LABEL = 'block text-sm font-medium text-slate-700'

type Props = {
  loadId: string
  initialInvoiceNumber: string | null
  initialTruckNumber: string | null
  initialDriverName: string | null
  initialDriverPhone: string | null
}

// Operator-facing form for the post-award shipment details. All four fields
// are optional. truck_number is force-uppercased + filtered to A-Z0-9 in
// the onChange so the user can't enter spaces or punctuation — the DB has
// the same CHECK constraint, but the input filter avoids round-tripping a
// bad value.
export function ShipmentDetailsForm({
  loadId,
  initialInvoiceNumber,
  initialTruckNumber,
  initialDriverName,
  initialDriverPhone,
}: Props) {
  const router = useRouter()
  const [invoiceNumber, setInvoiceNumber] = useState(
    initialInvoiceNumber ?? ''
  )
  const [truckNumber, setTruckNumber] = useState(initialTruckNumber ?? '')
  const [driverName, setDriverName] = useState(initialDriverName ?? '')
  const [driverPhone, setDriverPhone] = useState(initialDriverPhone ?? '')
  const [isPending, startTransition] = useTransition()

  function handleTruckNumberChange(e: React.ChangeEvent<HTMLInputElement>) {
    // Strip everything that isn't a letter or digit, then uppercase. This
    // mirrors the server action's normalization step and the DB CHECK.
    const cleaned = e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
    setTruckNumber(cleaned)
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    startTransition(async () => {
      try {
        await editShipmentDetailsAction(loadId, {
          invoice_number: invoiceNumber.trim() || null,
          truck_number: truckNumber.trim() || null,
          driver_name: driverName.trim() || null,
          driver_phone: driverPhone.trim() || null,
        })
        toast.success('Shipment details saved.')
        router.refresh()
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to save shipment details.'
        )
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="invoice_number" className={LABEL}>
            Invoice number{' '}
            <span className="font-normal text-slate-500">— optional</span>
          </label>
          <input
            id="invoice_number"
            name="invoice_number"
            type="text"
            autoComplete="off"
            disabled={isPending}
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            placeholder="INV-2026-001"
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="truck_number" className={LABEL}>
            Truck number{' '}
            <span className="font-normal text-slate-500">— optional</span>
          </label>
          <input
            id="truck_number"
            name="truck_number"
            type="text"
            autoComplete="off"
            disabled={isPending}
            value={truckNumber}
            onChange={handleTruckNumberChange}
            placeholder="MH12AB1234"
            // text-transform: uppercase keeps already-typed characters
            // upper-cased visually even if the onChange somehow misses.
            // tracking-wider gives the plate-style spacing for readability.
            className={`${FIELD} font-mono uppercase tracking-wider`}
          />
          <p className="mt-1 text-xs text-slate-500">
            Letters and digits only. Auto-uppercased.
          </p>
        </div>
        <div>
          <label htmlFor="driver_name" className={LABEL}>
            Driver name{' '}
            <span className="font-normal text-slate-500">— optional</span>
          </label>
          <input
            id="driver_name"
            name="driver_name"
            type="text"
            autoComplete="off"
            disabled={isPending}
            value={driverName}
            onChange={(e) => setDriverName(e.target.value)}
            placeholder="Rajesh Kumar"
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="driver_phone" className={LABEL}>
            Driver phone{' '}
            <span className="font-normal text-slate-500">— optional</span>
          </label>
          <input
            id="driver_phone"
            name="driver_phone"
            type="tel"
            autoComplete="off"
            disabled={isPending}
            value={driverPhone}
            onChange={(e) => setDriverPhone(e.target.value)}
            placeholder="+919876543210"
            className={`${FIELD} font-mono`}
          />
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-slate-200 pt-4">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-blue-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? 'Saving…' : 'Save shipment details'}
        </button>
      </div>
    </form>
  )
}
