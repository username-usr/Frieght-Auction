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
      className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isPending ? 'Reopening…' : 'Reopen'}
    </button>
  )
}
