'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { placeBidAction } from './actions'
import { formatINR } from '@/lib/format'

type Props = {
  loadId: string
  existingAmountPaise: number | null
}

export function PlaceBidForm({ loadId, existingAmountPaise }: Props) {
  const initialRupees =
    existingAmountPaise != null ? String(existingAmountPaise / 100) : ''
  const [rupees, setRupees] = useState(initialRupees)
  const [isSubmitting, startTransition] = useTransition()
  const router = useRouter()

  const isUpdate = existingAmountPaise != null

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    startTransition(async () => {
      const result = await placeBidAction(loadId, rupees)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(
        isUpdate
          ? `Bid updated to ${formatINR(result.amountPaise)}.`
          : `Bid placed at ${formatINR(result.amountPaise)}.`
      )
      router.refresh()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label
          htmlFor="bid-amount"
          className="block text-sm font-medium text-slate-700"
        >
          Your bid (₹)
        </label>
        <input
          id="bid-amount"
          name="amount"
          type="number"
          inputMode="numeric"
          required
          min={1}
          step={1}
          value={rupees}
          onChange={(e) => setRupees(e.target.value)}
          placeholder="13000"
          className="mt-1 block h-12 w-full rounded-md border border-slate-300 px-3 text-base text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
        />
        <p className="mt-2 text-xs text-slate-500">
          Whole rupees only. Lowest bid wins when the load is awarded.
        </p>
      </div>
      <button
        type="submit"
        disabled={isSubmitting}
        className="block h-12 w-full rounded-md bg-blue-900 px-4 text-base font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting
          ? isUpdate
            ? 'Updating bid…'
            : 'Placing bid…'
          : isUpdate
            ? 'Update bid'
            : 'Submit bid'}
      </button>
    </form>
  )
}
