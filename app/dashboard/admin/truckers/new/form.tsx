'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import type { TruckType } from '@/lib/types'
import { addTruckerAction } from '../actions'

const TRUCK_TYPES: { value: TruckType; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'container', label: 'Container' },
  { value: 'trailer', label: 'Trailer' },
  { value: 'tanker', label: 'Tanker' },
  { value: 'refrigerated', label: 'Refrigerated' },
  { value: 'other', label: 'Other' },
]

// Matches the action's regex (migration 0006 doesn't enforce phone format
// at the DB level, so the JS guard is the only client-visible validation).
const PHONE_RE = /^\+\d{10,15}$/

const FIELD =
  'mt-1 block w-full rounded-md border-2 border-slate-400 px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-500 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:cursor-not-allowed disabled:bg-slate-50'
const LABEL = 'block text-sm font-medium text-slate-700'
const ERROR_TXT = 'mt-1 text-xs text-red-700'

type Errors = Partial<{
  phone_e164: string
  secondary_phone: string
  full_name: string
  truck_type: string
}>

export function NewTruckerForm() {
  const router = useRouter()
  const [phone, setPhone] = useState('+91')
  const [secondaryPhone, setSecondaryPhone] = useState('')
  const [fullName, setFullName] = useState('')
  const [truckType, setTruckType] = useState<TruckType>('open')
  const [errors, setErrors] = useState<Errors>({})
  const [isPending, startTransition] = useTransition()

  function validate(): Errors {
    const e: Errors = {}
    const p = phone.trim()
    if (!p) e.phone_e164 = 'Required'
    else if (!PHONE_RE.test(p)) {
      e.phone_e164 = 'Use E.164 format (e.g. +919876543210).'
    }
    const sp = secondaryPhone.trim()
    if (sp) {
      if (!PHONE_RE.test(sp)) {
        e.secondary_phone = 'Use E.164 format (e.g. +919876543210).'
      } else if (sp === p) {
        e.secondary_phone = 'Must be different from primary phone.'
      }
    }
    if (fullName.trim().length > 200) {
      e.full_name = 'Must be 200 characters or fewer.'
    }
    return e
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const v = validate()
    setErrors(v)
    if (Object.keys(v).length > 0) return

    startTransition(async () => {
      try {
        await addTruckerAction({
          phone_e164: phone.trim(),
          secondary_phone: secondaryPhone.trim() || null,
          full_name: fullName.trim() || null,
          truck_type: truckType,
        })
        toast.success('Trucker added.')
        router.push('/dashboard/admin/truckers')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to add trucker.')
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="trucker_phone" className={LABEL}>
          Phone (E.164) <span className="text-red-600">*</span>
        </label>
        <input
          id="trucker_phone"
          name="phone_e164"
          type="tel"
          autoComplete="off"
          disabled={isPending}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+919876543210"
          className={`${FIELD} font-mono`}
        />
        {errors.phone_e164 ? (
          <p className={ERROR_TXT}>{errors.phone_e164}</p>
        ) : (
          <p className="mt-1 text-xs text-slate-500">
            Required. Starts with + and country code. This is the trucker&apos;s
            login identifier — choose carefully.
          </p>
        )}
      </div>

      <div>
        <label htmlFor="trucker_secondary_phone" className={LABEL}>
          Secondary phone{' '}
          <span className="font-normal text-slate-500">— optional</span>
        </label>
        <input
          id="trucker_secondary_phone"
          name="secondary_phone"
          type="tel"
          autoComplete="off"
          disabled={isPending}
          value={secondaryPhone}
          onChange={(e) => setSecondaryPhone(e.target.value)}
          placeholder="+919876543210"
          className={`${FIELD} font-mono`}
        />
        {errors.secondary_phone ? (
          <p className={ERROR_TXT}>{errors.secondary_phone}</p>
        ) : (
          <p className="mt-1 text-xs text-slate-500">
            Alternate contact number. Must differ from primary.
          </p>
        )}
      </div>

      <div>
        <label htmlFor="trucker_name" className={LABEL}>
          Full name <span className="font-normal text-slate-500">— optional</span>
        </label>
        <input
          id="trucker_name"
          name="full_name"
          type="text"
          autoComplete="off"
          disabled={isPending}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Rajesh Kumar"
          className={FIELD}
        />
        {errors.full_name ? (
          <p className={ERROR_TXT}>{errors.full_name}</p>
        ) : null}
      </div>

      <div>
        <label htmlFor="trucker_truck_type" className={LABEL}>
          Truck type <span className="text-red-600">*</span>
        </label>
        <select
          id="trucker_truck_type"
          name="truck_type"
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
        <p className="mt-1 text-xs text-slate-500">Required</p>
      </div>

      <div className="flex items-center gap-3 border-t border-slate-200 pt-4">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-blue-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? 'Adding…' : 'Add trucker'}
        </button>
        <Link
          href="/dashboard/admin/truckers"
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </Link>
      </div>
    </form>
  )
}
