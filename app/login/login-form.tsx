'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { sendMagicLink } from './actions'
import { createClient } from '@/lib/supabase/client'

type Mode = 'magic' | 'password'

// Both auth methods live in one client component so the email field can be
// shared across modes (typing your address then toggling shouldn't wipe it).
// The magic-link path still routes through the existing `sendMagicLink`
// server action — we deliberately don't touch the OTP flow. The password
// path uses the browser supabase client directly so we can surface errors
// in a toast instead of a redirect-with-error-param.
export function LoginForm() {
  const [mode, setMode] = useState<Mode>('magic')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, startTransition] = useTransition()
  const router = useRouter()
  const searchParams = useSearchParams()
  // The magic-link error comes back via ?error=... after the server action
  // redirects. Only relevant in magic mode — password errors go to toasts.
  const magicError = mode === 'magic' ? searchParams.get('error') : null

  function handlePasswordSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    startTransition(async () => {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })
      if (error) {
        toast.error(mapPasswordError(error.message))
        return
      }
      // The browser client just wrote the auth cookies. router.refresh()
      // forces server components to re-run with the new session before we
      // navigate, so the dashboard layout sees us as authenticated.
      router.refresh()
      router.push('/dashboard')
    })
  }

  const emailField = (
    <div>
      <label
        htmlFor="email"
        className="block text-sm font-medium text-slate-700"
      >
        Email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        autoComplete="email"
        placeholder="you@ramnath.in"
        className="mt-1 block w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-500 focus:border-blue-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-900"
      />
    </div>
  )

  if (mode === 'password') {
    return (
      <form onSubmit={handlePasswordSubmit} className="mt-6 space-y-4">
        {emailField}
        <div>
          <label
            htmlFor="password"
            className="block text-sm font-medium text-slate-700"
          >
            Password
          </label>
          <div className="relative mt-1">
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="block w-full rounded-md border border-slate-300 bg-slate-50 py-2.5 pl-3 pr-10 text-sm text-slate-900 placeholder:text-slate-500 focus:border-blue-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-900"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-2.5 top-2.5 text-slate-500 hover:text-slate-700"
            >
              {showPassword ? (
                /* Open Eye icon when password is visible */
                <svg
                  className="h-4 w-4"
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
                /* Slashed Eye icon when password is hidden */
                <svg
                  className="h-4 w-4"
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
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-blue-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-900 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('magic')
            setPassword('')
          }}
          disabled={isSubmitting}
          className="block w-full text-center text-sm text-slate-600 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          ← Use magic link instead
        </button>
      </form>
    )
  }

  return (
    <form action={sendMagicLink} className="mt-6 space-y-4">
      {emailField}
      <button
        type="submit"
        className="w-full rounded-md bg-blue-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-900 focus:ring-offset-2"
      >
        Send magic link
      </button>
      <button
        type="button"
        onClick={() => setMode('password')}
        className="w-full rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:border-slate-400 hover:bg-slate-50"
      >
        Sign in with password
      </button>
      {magicError ? (
        <p className="text-sm text-red-700">{magicError}</p>
      ) : null}
    </form>
  )
}

// Maps the supabase-js auth error messages to operator-friendly copy.
// Messages are matched case-insensitively because the API has flipped
// casing on some of these in the past (e.g. "Invalid login credentials"
// vs the newer "invalid_credentials" error_code).
function mapPasswordError(message: string): string {
  const m = message.toLowerCase()
  if (
    m.includes('invalid login credentials') ||
    m.includes('invalid_credentials')
  ) {
    return 'Email or password is incorrect.'
  }
  if (
    m.includes('email not confirmed') ||
    m.includes('email_not_confirmed')
  ) {
    return 'Please confirm your email first.'
  }
  return 'Could not sign in. Try again.'
}
