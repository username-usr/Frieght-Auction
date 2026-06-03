'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import type { TruckType } from '@/lib/types'
import { updateTruckerAction } from '../../actions'

const TRUCK_TYPES: { value: TruckType; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'container', label: 'Container' },
  { value: 'trailer', label: 'Trailer' },
  { value: 'tanker', label: 'Tanker' },
  { value: 'refrigerated', label: 'Refrigerated' },
  { value: 'other', label: 'Other' },
]

const FIELD =
  'mt-1 block w-full rounded-md border-2 border-slate-400 px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-500 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:cursor-not-allowed disabled:bg-slate-50'
const LABEL = 'block text-sm font-medium text-slate-700'
const ERROR_TXT = 'mt-1 text-xs text-red-700'

const PHONE_RE = /^\+\d{10,15}$/

type Props = {
  id: string
  phoneE164: string
  secondaryPhone: string | null
  fullName: string | null
  truckType: TruckType
}

export function EditTruckerForm({
  id,
  phoneE164,
  secondaryPhone: initialSecondaryPhone,
  fullName: initialFullName,
  truckType: initialTruckType,
}: Props) {
  const router = useRouter()
  const [fullName, setFullName] = useState(initialFullName ?? '')
  const [secondaryPhone, setSecondaryPhone] = useState(
    initialSecondaryPhone ?? ''
  )
  const [truckType, setTruckType] = useState<TruckType>(initialTruckType)
  const [nameError, setNameError] = useState<string | null>(null)
  const [secondaryPhoneError, setSecondaryPhoneError] = useState<string | null>(
    null
  )
  const [isPending, startTransition] = useTransition()

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (fullName.trim().length > 200) {
      setNameError('Must be 200 characters or fewer.')
      return
    }
    setNameError(null)

    const sp = secondaryPhone.trim()
    if (sp) {
      if (!PHONE_RE.test(sp)) {
        setSecondaryPhoneError('Use E.164 format (e.g. +919876543210).')
        return
      }
      if (sp === phoneE164) {
        setSecondaryPhoneError('Must be different from primary phone.')
        return
      }
    }
    setSecondaryPhoneError(null)

    startTransition(async () => {
      try {
        await updateTruckerAction(id, {
          secondary_phone: sp || null,
          full_name: fullName.trim() || null,
          truck_type: truckType,
        })
        toast.success('Trucker updated.')
        router.push('/dashboard/admin/truckers')
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to update trucker.'
        )
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="trucker_phone" className={LABEL}>
          Phone (read-only)
        </label>
        <input
          id="trucker_phone"
          type="tel"
          readOnly
          value={phoneE164}
          className={`${FIELD} cursor-not-allowed bg-slate-50 font-mono`}
        />
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
        {secondaryPhoneError ? (
          <p className={ERROR_TXT}>{secondaryPhoneError}</p>
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
          className={FIELD}
        />
        {nameError ? <p className={ERROR_TXT}>{nameError}</p> : null}
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
          {isPending ? 'Saving…' : 'Save changes'}
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
