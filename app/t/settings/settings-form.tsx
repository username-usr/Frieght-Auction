'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { updateTruckerProfileAction } from './actions'
import type { TruckType } from '@/lib/types'
import type { CurrentTrucker } from '@/lib/trucker'

const FIELD =
  'mt-1 block w-full rounded-md border-2 border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100'
const LABEL = 'block text-sm font-medium text-slate-700'

const TRUCK_TYPES: { value: TruckType; label: string }[] = [
  { value: 'open', label: 'Open Body Truck' },
  { value: 'container', label: 'Closed Container' },
  { value: 'trailer', label: 'Multi-Axle Trailer' },
  { value: 'tanker', label: 'Liquid Tanker' },
  { value: 'refrigerated', label: 'Refrigerated Cold Chain' },
  { value: 'other', label: 'Other / Custom Truck' },
]

export function TruckerSettingsForm({ trucker }: { trucker: CurrentTrucker }) {
  const router = useRouter()
  const [fullName, setFullName] = useState(trucker.full_name ?? '')
  const [secondaryPhone, setSecondaryPhone] = useState(trucker.secondary_phone ?? '')
  const [homeBaseCity, setHomeBaseCity] = useState(trucker.home_base_city ?? '')
  const [truckType, setTruckType] = useState<TruckType>(trucker.truck_type ?? 'open')
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    startTransition(async () => {
      try {
        await updateTruckerProfileAction({
          full_name: fullName.trim() || null,
          secondary_phone: secondaryPhone.trim() || null,
          home_base_city: homeBaseCity.trim() || null,
          truck_type: truckType,
        })
        toast.success('Profile & fleet settings saved successfully!')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update profile.')
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {/* 1. Account & Identity */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm space-y-4">
        <h2 className="text-sm font-semibold text-slate-900 border-b border-slate-100 pb-2">
          👤 Transporter Profile & Contact
        </h2>

        <div>
          <label htmlFor="full_name" className={LABEL}>
            Transporter / Company Name
          </label>
          <input
            id="full_name"
            type="text"
            disabled={isPending}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Ashwin Freight Logistics"
            className={FIELD}
          />
        </div>

        <div>
          <label htmlFor="primary_phone" className={LABEL}>
            Primary Phone / WhatsApp Number{' '}
            <span className="font-normal text-slate-400">(Registered ID)</span>
          </label>
          <input
            id="primary_phone"
            type="text"
            disabled
            value={trucker.phone_e164}
            className={`${FIELD} font-mono bg-slate-100 text-slate-500`}
          />
          <p className="mt-1 text-[11px] text-slate-500">
            This is your registered WhatsApp identity for placing bids.
          </p>
        </div>

        <div>
          <label htmlFor="secondary_phone" className={LABEL}>
            Secondary / Alternate Phone{' '}
            <span className="font-normal text-slate-400">— optional</span>
          </label>
          <input
            id="secondary_phone"
            type="tel"
            disabled={isPending}
            value={secondaryPhone}
            onChange={(e) => setSecondaryPhone(e.target.value)}
            placeholder="+919876543210"
            className={`${FIELD} font-mono`}
          />
        </div>

        <div>
          <label htmlFor="home_base" className={LABEL}>
            Home Base / Operating Hub City
          </label>
          <input
            id="home_base"
            type="text"
            disabled={isPending}
            value={homeBaseCity}
            onChange={(e) => setHomeBaseCity(e.target.value)}
            placeholder="Bengaluru / Chennai / Mumbai"
            className={FIELD}
          />
        </div>
      </div>

      {/* 2. Fleet Specifications */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm space-y-4">
        <h2 className="text-sm font-semibold text-slate-900 border-b border-slate-100 pb-2">
          🚛 Fleet Specifications & Truck Type
        </h2>

        <div>
          <label htmlFor="truck_type" className={LABEL}>
            Primary Truck Type
          </label>
          <select
            id="truck_type"
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
          <p className="mt-1 text-[11px] text-slate-500">
            We match you automatically with load postings required for this truck category.
          </p>
        </div>
      </div>

      {/* Save Button */}
      <div className="pt-2">
        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60 transition-colors"
        >
          {isPending ? 'Saving Settings...' : 'Save Profile & Fleet Settings'}
        </button>
      </div>
    </form>
  )
}
