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
        className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-500 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
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
          <input
            id="password"
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-500 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
          />
        </div>
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
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
        className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2"
      >
        Send magic link
      </button>
      <button
        type="button"
        onClick={() => setMode('password')}
        className="w-full rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
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
