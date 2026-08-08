'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { placeBidAction } from './actions'
import { formatINR } from '@/lib/format'

type Props = {
  loadId: string
  existingAmountPaise: number | null
  lowBidPaise?: number | null
  disabledReason?: string | null
}

export function PlaceBidForm({
  loadId,
  existingAmountPaise,
  lowBidPaise,
  disabledReason,
}: Props) {
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
          Your bid (₹) <span className="text-red-600">*</span>
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
          className="mt-1 block h-12 w-full rounded-md border border-slate-300 bg-slate-50 px-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-blue-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-900"
        />
        <p className="mt-2 text-xs text-slate-500">
          Required. Whole rupees only. Lowest bid wins when the load is awarded.
        </p>

        {lowBidPaise && lowBidPaise > 0 ? (
          <div className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 block">
              ⚡ Quick 1-Tap Undercut Actions
            </span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={isSubmitting || !!disabledReason}
                onClick={() => setRupees(String(lowBidPaise / 100))}
                className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-900 hover:bg-blue-100 transition-colors"
              >
                Match Lowest (₹{(lowBidPaise / 100).toLocaleString('en-IN')})
              </button>
              {lowBidPaise > 50000 && (
                <button
                  type="button"
                  disabled={isSubmitting || !!disabledReason}
                  onClick={() => setRupees(String((lowBidPaise - 50000) / 100))}
                  className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 transition-colors"
                >
                  Drop ₹500 (₹{((lowBidPaise - 50000) / 100).toLocaleString('en-IN')})
                </button>
              )}
              {lowBidPaise > 100000 && (
                <button
                  type="button"
                  disabled={isSubmitting || !!disabledReason}
                  onClick={() => setRupees(String((lowBidPaise - 100000) / 100))}
                  className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 transition-colors"
                >
                  Drop ₹1,000 (₹{((lowBidPaise - 100000) / 100).toLocaleString('en-IN')})
                </button>
              )}
            </div>
          </div>
        ) : null}
      </div>
      {disabledReason ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          {disabledReason}
        </div>
      ) : (
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
      )}
    </form>
  )
}
