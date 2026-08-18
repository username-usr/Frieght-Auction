'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { acceptAwardAction, declineAwardAction } from './actions'

type Props = {
  loadId: string
  referenceCode?: string
}

export function AcceptAwardForm({ loadId, referenceCode }: Props) {
  const router = useRouter()
  const [declining, setDeclining] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [reason, setReason] = useState('')
  const [isPending, startTransition] = useTransition()

  const normalizedInput = confirmText.trim().toUpperCase()
  const isValidConfirmation =
    normalizedInput === 'CONFIRM' ||
    normalizedInput === 'ACCEPT' ||
    normalizedInput === 'YES' ||
    (referenceCode && normalizedInput === `CONFIRM ${referenceCode.toUpperCase()}`) ||
    (referenceCode && normalizedInput === `ACCEPT ${referenceCode.toUpperCase()}`)

  function handleAccept(e?: React.FormEvent) {
    if (e) e.preventDefault()
    if (!isValidConfirmation) {
      toast.error('Please type "CONFIRM" or "ACCEPT" to confirm this load.')
      return
    }

    startTransition(async () => {
      try {
        await acceptAwardAction(loadId)
        toast.success('🎉 Congratulations! Load confirmed. Gate pass generated!')
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
        className="space-y-3 rounded-xl border border-rose-200 bg-rose-50 p-4 shadow-sm"
      >
        <div>
          <label
            htmlFor="decline-reason"
            className="block text-xs font-bold uppercase tracking-wider text-rose-900"
          >
            Why are you declining? <span className="text-rose-600">*</span>
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
            className="mt-1.5 block w-full rounded-md border border-rose-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-rose-700 focus:outline-none focus:ring-1 focus:ring-rose-700"
          />
          <p className="mt-1 text-[11px] text-rose-800">
            The operator will see this reason to re-award the load to another trucker.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-rose-700 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-60 transition-colors"
          >
            {isPending ? 'Sending…' : 'Confirm decline'}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={handleCancelDecline}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    )
  }

  return (
    <div className="space-y-4 rounded-xl border-2 border-emerald-300 bg-gradient-to-br from-emerald-50 via-white to-green-50 p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 text-xl font-bold">
          🎉
        </div>
        <div className="space-y-1">
          <h3 className="text-sm font-bold text-emerald-950 flex items-center gap-2">
            CONGRATULATIONS! YOU HAVE WON THIS BID!
          </h3>
          <p className="text-xs text-emerald-900 leading-relaxed font-medium">
            Your bid for Load {referenceCode ? `#${referenceCode}` : ''} has been selected by the operator.
            Please confirm your acceptance below to lock in the shipment and unlock your **Official Warehouse Gate Pass**.
          </p>
        </div>
      </div>

      <form onSubmit={handleAccept} className="space-y-3 pt-1 border-t border-emerald-200/80">
        <div>
          <label htmlFor="confirm-input" className="block text-xs font-semibold text-emerald-950 mb-1">
            Type <span className="font-mono bg-emerald-100 px-1.5 py-0.5 rounded text-emerald-900">CONFIRM</span> or <span className="font-mono bg-emerald-100 px-1.5 py-0.5 rounded text-emerald-900">ACCEPT</span> to confirm this load:
          </label>
          <div className="flex items-center gap-2">
            <input
              id="confirm-input"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              disabled={isPending}
              placeholder='Type "CONFIRM" or "ACCEPT"...'
              className="flex-1 rounded-md border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-900 placeholder:normal-case placeholder:font-normal placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
            />
            <button
              type="submit"
              disabled={!isValidConfirmation || isPending}
              className="rounded-md bg-emerald-700 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-emerald-800 active:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {isPending ? 'Confirming…' : '✅ Confirm & Unlock Gate Pass'}
            </button>
          </div>
          <p className="mt-1 text-[11px] text-emerald-800">
            Tip: You can also confirm by replying <span className="font-mono font-semibold">CONFIRM</span> directly on WhatsApp!
          </p>
        </div>

        <div className="flex items-center justify-between pt-2">
          <span className="text-[11px] text-slate-500">
            Cannot take this load?
          </span>
          <button
            type="button"
            onClick={handleStartDecline}
            disabled={isPending}
            className="text-xs font-medium text-rose-700 hover:text-rose-900 hover:underline"
          >
            Decline load award
          </button>
        </div>
      </form>
    </div>
  )
}

