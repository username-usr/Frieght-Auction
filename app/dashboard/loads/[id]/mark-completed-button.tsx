'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { completeLoadAction } from './actions'

type Props = { loadId: string }

// Two-click confirm pattern: first click flips the button to a green
// "Confirm?" state, second click within 4 seconds fires the action. Auto-
// reverts after 4 seconds so a stray first click doesn't strand the UI in
// a primed state. No modal — completion is reversible via the Reopen
// button, so heavy confirmation chrome would be overkill.
export function MarkCompletedButton({ loadId }: Props) {
  const [confirming, setConfirming] = useState(false)
  const [isPending, startTransition] = useTransition()
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear the timer on unmount so it doesn't fire setState after the
  // component is gone (React would log a "set state on unmounted" warning).
  useEffect(() => {
    return () => {
      if (timeoutRef.current != null) clearTimeout(timeoutRef.current)
    }
  }, [])

  function handleClick() {
    if (!confirming) {
      setConfirming(true)
      timeoutRef.current = setTimeout(() => {
        setConfirming(false)
        timeoutRef.current = null
      }, 4000)
      return
    }
    if (timeoutRef.current != null) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    startTransition(async () => {
      try {
        await completeLoadAction(loadId)
        toast.success('Load marked as completed.')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed.')
      } finally {
        setConfirming(false)
      }
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className={
        confirming
          ? 'inline-flex items-center gap-1.5 h-9 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-60 transition-colors'
          : 'inline-flex items-center gap-1.5 h-9 rounded-md bg-blue-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-800 shadow-sm disabled:cursor-not-allowed disabled:opacity-60 transition-colors'
      }
    >
      <svg className="h-3.5 w-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
      {isPending ? 'Saving…' : confirming ? 'Confirm completion?' : 'Mark completed'}
    </button>
  )
}
