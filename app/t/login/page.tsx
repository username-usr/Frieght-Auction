'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { checkPhoneAction, loginAction } from './actions'

// Two-stage login: first the trucker types their phone and taps Continue;
// we ask the server what state that phone is in and either reveal a
// password field (existing trucker) or redirect to /t/set-password (no
// password yet) or show a clear error (not registered).

type Stage = 'phone' | 'password'

export default function TruckerLoginPage() {
  const [stage, setStage] = useState<Stage>('phone')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, startTransition] = useTransition()
  const router = useRouter()

  function handlePhoneSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    startTransition(async () => {
      const result = await checkPhoneAction(phone)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      if (result.status === 'not_registered') {
        toast.error('Phone not registered. Please ask Ramnath Logistics to add you.')
        return
      }
      if (result.status === 'needs_password') {
        router.push(
          `/t/set-password?phone=${encodeURIComponent(phone.trim())}`
        )
        return
      }
      setStage('password')
    })
  }

  function handleLoginSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    startTransition(async () => {
      const result = await loginAction(phone, password)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      // The action set the cookie. Hard navigate so the next request reads
      // the cookie and the server-rendered /t/loads sees us as signed in.
      router.refresh()
      router.push('/t/loads')
    })
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Sign in
      </h1>

      {stage === 'phone' ? (
        <form onSubmit={handlePhoneSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="phone"
              className="block text-sm font-medium text-slate-700"
            >
              Phone number <span className="text-red-600">*</span>
            </label>
            <input
              id="phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              required
              autoFocus
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+919900000001"
              className="mt-1 block h-12 w-full rounded-md border-2 border-slate-400 px-3 text-base text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
            />
            <p className="mt-2 text-xs text-slate-500">
              Required. Use international format, e.g. +919900000001
            </p>
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="block h-12 w-full rounded-md bg-blue-900 px-4 text-base font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Checking…' : 'Continue'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleLoginSubmit} className="space-y-4">
          <div>
            <p className="text-sm text-slate-600">
              Signing in as{' '}
              <span className="font-mono text-slate-900">{phone}</span>
            </p>
            <button
              type="button"
              onClick={() => {
                setStage('phone')
                setPassword('')
              }}
              disabled={isSubmitting}
              className="mt-1 text-xs font-medium text-slate-600 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              ← Use a different phone
            </button>
          </div>
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-slate-700"
            >
              Password <span className="text-red-600">*</span>
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block h-12 w-full rounded-md border-2 border-slate-400 px-3 text-base text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
            />
            <p className="mt-2 text-xs text-slate-500">Required</p>
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="block h-12 w-full rounded-md bg-blue-900 px-4 text-base font-medium text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      )}
    </div>
  )
}
