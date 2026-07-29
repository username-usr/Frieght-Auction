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
  const [showPassword, setShowPassword] = useState(false)
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
            <div className="relative mt-1">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block h-12 w-full rounded-md border-2 border-slate-400 py-2 pl-3 pr-10 text-base text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-3 top-3 text-slate-500 hover:text-slate-700"
              >
                {showPassword ? (
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                    />
                  </svg>
                ) : (
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858-5.908a10.043 10.043 0 013.122-.463c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m-1.956-1.956a3 3 0 11-4.243-4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"
                    />
                  </svg>
                )}
              </button>
            </div>
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
