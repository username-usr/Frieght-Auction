'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { acceptAwardAction, declineAwardAction } from './actions'

type Props = { loadId: string }

// Sit-side action panel: Accept (single click) or Decline (single click ->
// reveal reason textarea -> confirm). The textarea-with-confirm pattern is
// in-line (not a modal) so it works well on mobile.
export function AcceptAwardForm({ loadId }: Props) {
  const router = useRouter()
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleAccept() {
    startTransition(async () => {
      try {
        await acceptAwardAction(loadId)
        toast.success('Load accepted.')
        router.refresh()
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to accept load.'
        )
      }
    })
  }

  function handleStartDecline() {
    setDeclining(true)
  }

  function handleCancelDecline() {
    setDeclining(false)
    setReason('')
  }

  function handleConfirmDecline(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = reason.trim()
    if (!trimmed) {
      toast.error('Please tell the operator why you can’t take this load.')
      return
    }
    startTransition(async () => {
      try {
        await declineAwardAction(loadId, trimmed)
        toast.success('Decline recorded.')
        router.refresh()
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to decline load.'
        )
      }
    })
  }

  if (declining) {
    return (
      <form
        onSubmit={handleConfirmDecline}
        className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4"
      >
        <div>
          <label
            htmlFor="decline-reason"
            className="block text-sm font-medium text-red-900"
          >
            Why are you declining?{' '}
            <span className="text-red-600">*</span>
          </label>
          <textarea
            id="decline-reason"
            name="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={isPending}
            required
            rows={3}
            placeholder="e.g. Truck broken down, schedule conflict, rate too low…"
            className="mt-1 block w-full rounded-md border-2 border-red-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-red-700 focus:outline-none focus:ring-1 focus:ring-red-700"
          />
          <p className="mt-1 text-xs text-red-800">
            Required. The operator will see this when they pick another bid.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? 'Sending…' : 'Confirm decline'}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={handleCancelDecline}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </form>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border border-green-200 bg-green-50 p-4">
      <div>
        <p className="text-sm font-semibold text-green-900">
          🎉 You&apos;ve been awarded this load
        </p>
        <p className="mt-1 text-xs text-green-800">
          Accept to lock it in, or decline with a reason so the operator can
          pick someone else.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleAccept}
          disabled={isPending}
          className="rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? 'Accepting…' : 'Accept'}
        </button>
        <button
          type="button"
          onClick={handleStartDecline}
          disabled={isPending}
          className="rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Decline
        </button>
      </div>
    </div>
  )
}
