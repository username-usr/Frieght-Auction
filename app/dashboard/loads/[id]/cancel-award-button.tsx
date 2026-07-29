'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { cancelAwardAction } from './actions'

type Props = { loadId: string }

// Reversal of award_bid: flips the load back to 'open', re-activates the
// won + lost bids, and removes the shipment row. Uses window.confirm
// because the action is destructive enough that a stray click would force
// the operator to re-pick.
export function CancelAwardButton({ loadId }: Props) {
  const [isPending, startTransition] = useTransition()

  function handleClick() {
    const ok = window.confirm(
      'Cancel this award? The load will go back to Open and active bids will be re-considered.'
    )
    if (!ok) return
    startTransition(async () => {
      try {
        await cancelAwardAction(loadId)
        toast.success('Award cancelled. Load is open for bidding again.')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed.')
      }
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="inline-flex items-center gap-1.5 h-9 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 shadow-sm hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 transition-colors"
    >
      <svg className="h-3.5 w-3.5 text-amber-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
      {isPending ? 'Cancelling…' : 'Cancel award'}
    </button>
  )
}
