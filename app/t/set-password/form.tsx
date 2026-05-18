'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { setPasswordAction } from './actions'

export function SetPasswordForm({ phone }: { phone: string }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [isSubmitting, startTransition] = useTransition()
  const router = useRouter()

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    startTransition(async () => {
      const result = await setPasswordAction(phone, password, confirm)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      router.refresh()
      router.push('/t/loads')
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="password"
          className="block text-sm font-medium text-slate-700"
        >
          New password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          autoFocus
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 block h-12 w-full rounded-md border border-slate-300 px-3 text-base text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
        />
        <p className="mt-2 text-xs text-slate-500">
          At least 6 characters.
        </p>
      </div>
      <div>
        <label
          htmlFor="confirm"
          className="block text-sm font-medium text-slate-700"
        >
          Confirm password
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="mt-1 block h-12 w-full rounded-md border border-slate-300 px-3 text-base text-slate-900 shadow-sm focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
        />
      </div>
      <button
        type="submit"
        disabled={isSubmitting}
        className="block h-12 w-full rounded-md bg-blue-900 px-4 text-base font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? 'Setting password…' : 'Set password and continue'}
      </button>
    </form>
  )
}
