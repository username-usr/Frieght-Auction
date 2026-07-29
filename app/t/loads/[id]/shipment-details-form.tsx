'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { updateShipmentDetailsByTruckerAction } from './actions'

const FIELD =
  'mt-1 block w-full rounded-md border-2 border-slate-400 px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-500 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:cursor-not-allowed disabled:bg-slate-50'
const LABEL = 'block text-sm font-medium text-slate-700'

type Props = {
  loadId: string
  initialTruckNumber: string | null
  initialDriverName: string | null
  initialDriverPhone: string | null
}

// Trucker-side editor for truck + driver fields. Invoice number is operator-
// managed and not surfaced here. truck_number is force-uppercased + filtered
// to A-Z0-9 in the onChange — same normalization the server action and the
// migration 0017 CHECK constraint enforce.
export function ShipmentDetailsForm({
  loadId,
  initialTruckNumber,
  initialDriverName,
  initialDriverPhone,
}: Props) {
  const router = useRouter()
  const [truckNumber, setTruckNumber] = useState(initialTruckNumber ?? '')
  const [driverName, setDriverName] = useState(initialDriverName ?? '')
  const [driverPhone, setDriverPhone] = useState(initialDriverPhone ?? '')
  const [isPending, startTransition] = useTransition()

  function handleTruckNumberChange(e: React.ChangeEvent<HTMLInputElement>) {
    const cleaned = e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
    setTruckNumber(cleaned)
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    startTransition(async () => {
      try {
        await updateShipmentDetailsByTruckerAction(loadId, {
          truck_number: truckNumber.trim() || null,
          driver_name: driverName.trim() || null,
          driver_phone: driverPhone.trim() || null,
        })
        toast.success('Saved.')
        router.refresh()
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to save details.'
        )
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
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

      <div className="rounded-md border border-slate-200 bg-slate-50/60 p-3">
        <label className={LABEL}>
          📷 Proof of Delivery (POD) & e-Way Bill
          <span className="font-normal text-slate-500"> — upload photo / PDF</span>
        </label>
        <input
          type="file"
          accept="image/*,.pdf"
          disabled={isPending}
          onChange={(e) => {
            if (e.target.files?.[0]) {
              toast.success(`Selected POD: ${e.target.files[0].name}`)
            }
          }}
          className="mt-2 block w-full text-xs text-slate-500 file:mr-3 file:rounded-md file:border-0 file:bg-slate-900 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-slate-800"
        />
        <p className="mt-1 text-[11px] text-slate-500">
          Upload signed delivery copy or e-Way bill receipt for operator verification.
        </p>
      </div>

      <div className="flex items-center gap-3 border-t border-slate-200 pt-4">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-blue-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? 'Saving…' : 'Save details'}
        </button>
      </div>
    </form>
  )
}
