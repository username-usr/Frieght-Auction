'use client'

import { useTransition } from 'react'
import { toast } from 'sonner'
import { resetTruckerPasswordAction } from './actions'

type Props = {
  truckerId: string
  truckerPhone: string
}

// Reset wipes password_hash + onboarding_state so the trucker is forced
// through the set-password flow on next login. window.confirm includes the
// phone number so the admin sees exactly whose credentials they're
// invalidating before they commit.
export function ResetPasswordButton({ truckerId, truckerPhone }: Props) {
  const [isPending, startTransition] = useTransition()

  function handleClick() {
    const ok = window.confirm(
      `Reset password for ${truckerPhone}? They will be prompted to set a new password on next login.`
    )
    if (!ok) return

    startTransition(async () => {
      try {
        await resetTruckerPasswordAction(truckerId)
        toast.success(
          'Password reset. Trucker will set a new one on next login.'
        )
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to reset password.'
        )
      }
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isPending ? 'Resetting…' : 'Reset password'}
    </button>
  )
}
