'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { cancelLoadAction } from '@/app/dashboard/loads/[id]/cancel-action'

type Props = {
  loadId: string
  activeBidCount: number
}

// Sibling-of-bids cancel control. Rendered on the load detail page only when
// (a) the load is open and (b) the viewer is the operator who posted it —
// both checks are enforced server-side in page.tsx. The cancel_load()
// function in 0003_cancel_load.sql re-enforces them at the DB level.
//
// `activeBidCount` is a snapshot from the initial server fetch. The dialog
// shows this number; the cancel_load() function will mark every currently-
// active bid as 'lost' regardless, so a stale count only affects the
// human-readable copy, not correctness.
export function CancelLoadButton({ loadId, activeBidCount }: Props) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleConfirm() {
    startTransition(async () => {
      const result = await cancelLoadAction(loadId, reason)
      if (result.success) {
        toast.success(
          `Load cancelled. ${activeBidCount} bidder${activeBidCount === 1 ? '' : 's'} will be notified.`
        )
        setOpen(false)
        setReason('')
        // SAFETY NET — mirrors the award flow. Bids realtime flips statuses
        // on its own; router.refresh() pulls the new load row (status,
        // cancelled_at, cancellation_reason, cancelled_by name).
        setTimeout(() => router.refresh(), 1000)
      } else {
        toast.error(result.error)
        // Drift: load was awarded or cancelled by someone else between page
        // render and our click. Close the dialog and refresh so the UI shows
        // the real state.
        if (result.errorCode === 'LOAD_NOT_OPEN') {
          setOpen(false)
          router.refresh()
        }
      }
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 h-9 rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800 shadow-sm hover:bg-red-100 transition-colors"
      >
        <svg className="h-3.5 w-3.5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Cancel load
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => {
            if (!isPending) setOpen(false)
          }}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="cancel-dialog-title"
              className="text-lg font-semibold tracking-tight text-slate-900"
            >
              Cancel this load?
            </h3>
            <p className="mt-2 text-sm text-slate-700">
              {activeBidCount} active bidder
              {activeBidCount === 1 ? '' : 's'} will be notified.
            </p>

            <label className="mt-4 block">
              <span className="text-xs font-medium uppercase tracking-wider text-slate-600">
                Reason (optional)
              </span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={isPending}
                placeholder="e.g. Customer cancelled, no longer needed"
                rows={3}
                className="mt-1 w-full rounded-md border-2 border-slate-400 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={isPending}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Keep load open
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isPending}
                className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPending ? 'Cancelling…' : 'Cancel load'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
