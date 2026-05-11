'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import type { TruckType } from '@/lib/types'
import { createLoad } from './actions'

// `redirect()` inside a server action surfaces on the client as a thrown
// object whose `digest` starts with "NEXT_REDIRECT". We let Next.js handle
// those (it'll navigate). Anything else is a real error to toast.
function isRedirectError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'digest' in err &&
    typeof (err as { digest: unknown }).digest === 'string' &&
    (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  )
}

const TRUCK_TYPES: { value: TruckType; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'container', label: 'Container' },
  { value: 'trailer', label: 'Trailer' },
  { value: 'tanker', label: 'Tanker' },
  { value: 'refrigerated', label: 'Refrigerated' },
  { value: 'other', label: 'Other' },
]

// Shared input/select/textarea styling that matches the login page so the app
// feels consistent. Once we introduce a third place that needs this we'll
// promote it to a real component.
const FIELD =
  'mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-500 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:cursor-not-allowed disabled:bg-slate-50'
const LABEL = 'block text-sm font-medium text-slate-700'
const ERROR = 'mt-1 text-xs text-red-700'

type Errors = Partial<{
  origin_city: string
  destination_city: string
  weight_kg: string
  pickup_deadline: string
  reference_price: string
}>

export function NewLoadForm() {
  const [origin, setOrigin] = useState('')
  const [destination, setDestination] = useState('')
  const [truckType, setTruckType] = useState<TruckType>('open')
  const [weight, setWeight] = useState('')
  const [pickupDeadline, setPickupDeadline] = useState('')
  const [referencePrice, setReferencePrice] = useState('')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [isPending, startTransition] = useTransition()

  function validate(): Errors {
    const e: Errors = {}
    const o = origin.trim()
    const d = destination.trim()

    if (!o) e.origin_city = 'Required'
    if (!d) e.destination_city = 'Required'
    if (o && d && o.toLowerCase() === d.toLowerCase()) {
      e.destination_city = 'Must differ from origin'
    }

    const weightNum = Number(weight)
    if (!weight.trim()) e.weight_kg = 'Required'
    else if (!Number.isFinite(weightNum) || weightNum <= 0) {
      e.weight_kg = 'Must be greater than 0'
    }

    if (!pickupDeadline) e.pickup_deadline = 'Required'
    else if (new Date(pickupDeadline).getTime() <= Date.now()) {
      e.pickup_deadline = 'Must be in the future'
    }

    if (referencePrice.trim()) {
      const refNum = Number(referencePrice)
      if (!Number.isFinite(refNum) || refNum <= 0) {
        e.reference_price = 'Must be greater than 0'
      }
    }

    return e
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const validation = validate()
    setErrors(validation)
    if (Object.keys(validation).length > 0) return

    startTransition(async () => {
      try {
        await createLoad({
          origin_city: origin.trim(),
          destination_city: destination.trim(),
          truck_type_required: truckType,
          weight_kg: parseInt(weight, 10),
          // datetime-local gives a string in browser local time; converting
          // to ISO here normalizes to UTC for storage.
          pickup_deadline: new Date(pickupDeadline).toISOString(),
          reference_price_paise: referencePrice.trim()
            ? Math.round(Number(referencePrice) * 100)
            : null,
          notes: notes.trim() || null,
        })
        // createLoad redirects on success — control never gets here.
      } catch (err) {
        if (isRedirectError(err)) throw err
        const message =
          err instanceof Error ? err.message : 'Unknown error posting load.'
        toast.error(message)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div>
          <label htmlFor="origin_city" className={LABEL}>
            Origin city
          </label>
          <input
            id="origin_city"
            name="origin_city"
            type="text"
            autoComplete="off"
            disabled={isPending}
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            placeholder="Mumbai"
            className={FIELD}
          />
          {errors.origin_city ? (
            <p className={ERROR}>{errors.origin_city}</p>
          ) : null}
        </div>
        <div>
          <label htmlFor="destination_city" className={LABEL}>
            Destination city
          </label>
          <input
            id="destination_city"
            name="destination_city"
            type="text"
            autoComplete="off"
            disabled={isPending}
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="Pune"
            className={FIELD}
          />
          {errors.destination_city ? (
            <p className={ERROR}>{errors.destination_city}</p>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <div>
          <label htmlFor="truck_type_required" className={LABEL}>
            Truck type
          </label>
          <select
            id="truck_type_required"
            name="truck_type_required"
            disabled={isPending}
            value={truckType}
            onChange={(e) => setTruckType(e.target.value as TruckType)}
            className={FIELD}
          >
            {TRUCK_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="weight_kg" className={LABEL}>
            Weight (kg)
          </label>
          <input
            id="weight_kg"
            name="weight_kg"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            disabled={isPending}
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="10000"
            className={FIELD}
          />
          {errors.weight_kg ? (
            <p className={ERROR}>{errors.weight_kg}</p>
          ) : null}
        </div>
        <div>
          <label htmlFor="pickup_deadline" className={LABEL}>
            Pickup deadline
          </label>
          <input
            id="pickup_deadline"
            name="pickup_deadline"
            type="datetime-local"
            disabled={isPending}
            value={pickupDeadline}
            onChange={(e) => setPickupDeadline(e.target.value)}
            className={FIELD}
          />
          {errors.pickup_deadline ? (
            <p className={ERROR}>{errors.pickup_deadline}</p>
          ) : null}
        </div>
      </div>

      <div>
        <label htmlFor="reference_price" className={LABEL}>
          Reference price (₹){' '}
          <span className="font-normal text-slate-500">— optional</span>
        </label>
        <input
          id="reference_price"
          name="reference_price"
          type="number"
          inputMode="decimal"
          min={1}
          step={1}
          disabled={isPending}
          value={referencePrice}
          onChange={(e) => setReferencePrice(e.target.value)}
          placeholder="14000"
          className={FIELD}
        />
        {errors.reference_price ? (
          <p className={ERROR}>{errors.reference_price}</p>
        ) : (
          <p className="mt-1 text-xs text-slate-500">
            What you expected to pay. Used for analytics; never shown to truckers.
          </p>
        )}
      </div>

      <div>
        <label htmlFor="notes" className={LABEL}>
          Notes <span className="font-normal text-slate-500">— optional</span>
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          disabled={isPending}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Special instructions, contact at pickup, etc."
          className={FIELD}
        />
      </div>

      <div className="flex items-center gap-3 border-t border-slate-200 pt-5">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-blue-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? 'Posting…' : 'Post load'}
        </button>
        <Link
          href="/dashboard"
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </Link>
      </div>
    </form>
  )
}
