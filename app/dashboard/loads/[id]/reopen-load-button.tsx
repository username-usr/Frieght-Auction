'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { reopenLoadAction } from './actions'

type Props = { loadId: string }

// Reopen is reversible (the operator can mark it completed again), but a
// quick window.confirm gives a visible safety pause so a stray click on a
// completed load doesn't quietly flip it back to Awarded.
export function ReopenLoadButton({ loadId }: Props) {
  const [isPending, startTransition] = useTransition()

  function handleClick() {
    const ok = window.confirm(
      'Reopen this load? It will go back to Awarded status.'
    )
    if (!ok) return
    startTransition(async () => {
      try {
        await reopenLoadAction(loadId)
        toast.success('Load reopened.')
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
      className="inline-flex items-center gap-1.5 h-9 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 transition-colors"
    >
      <svg className="h-3.5 w-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
      {isPending ? 'Reopening…' : 'Reopen load'}
    </button>
  )
}
