'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { deleteTruckerAction } from './actions'

type Props = {
  truckerId: string
  truckerName: string
}

export function DeleteTruckerButton({ truckerId, truckerName }: Props) {
  const [isPending, startTransition] = useTransition()

  function handleDelete() {
    const ok = window.confirm(
      `Are you sure you want to permanently delete trucker "${truckerName}"? This action cannot be undone.`
    )
    if (!ok) return

    startTransition(async () => {
      try {
        await deleteTruckerAction(truckerId)
        toast.success(`Trucker ${truckerName} deleted successfully.`)
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to delete trucker.'
        )
      }
    })
  }

  return (
    <button
      type="button"
      onClick={handleDelete}
      disabled={isPending}
      className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isPending ? 'Deleting…' : 'Delete'}
    </button>
  )
}
