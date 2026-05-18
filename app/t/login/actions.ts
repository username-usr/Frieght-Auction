'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  TRUCKER_COOKIE_NAME,
  signTruckerSession,
  truckerCookieOptions,
} from '@/lib/trucker-session'

// Light first-stage check used by /t/login: tell the UI whether to ask for
// a password, send the trucker to set-password, or show "not registered".
export type PhoneStatus =
  | 'not_registered'
  | 'needs_password'
  | 'has_password'

function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim().replace(/\s+/g, '')
  if (!trimmed) return null
  // E.164 only: '+' followed by 1-15 digits, leading digit non-zero. The
  // DB CHECK constraint enforces this too; we mirror it client-side so we
  // can give a clean error before hitting the RPC.
  if (!/^\+[1-9]\d{1,14}$/.test(trimmed)) return null
  return trimmed
}

export type CheckPhoneResult =
  | { ok: true; status: PhoneStatus }
  | { ok: false; error: string }

export async function checkPhoneAction(
  phoneRaw: string
): Promise<CheckPhoneResult> {
  const phone = normalizePhone(phoneRaw)
  if (!phone) {
    return {
      ok: false,
      error: 'Enter a valid phone number in international format, e.g. +919900000001',
    }
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('trucker_check_phone', {
    p_phone: phone,
  })
  if (error) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.error('[checkPhoneAction]', error)
    }
    return { ok: false, error: 'Something went wrong. Try again.' }
  }
  return { ok: true, status: data as PhoneStatus }
}

export type LoginResult =
  | { ok: true }
  | { ok: false; error: string }

export async function loginAction(
  phoneRaw: string,
  password: string
): Promise<LoginResult> {
  const phone = normalizePhone(phoneRaw)
  if (!phone) {
    return { ok: false, error: 'Enter a valid phone number.' }
  }
  if (!password) {
    return { ok: false, error: 'Enter your password.' }
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('trucker_verify_password', {
    p_phone: phone,
    p_password: password,
  })

  if (error) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.error('[loginAction]', error)
    }
    return { ok: false, error: 'Something went wrong. Try again.' }
  }

  // The RPC returns NULL for any failure (bad phone, password not set, wrong
  // password) — opaque on purpose to avoid an account-enumeration oracle.
  if (!data) {
    return { ok: false, error: 'Phone or password is incorrect.' }
  }

  const truckerId = data as string
  const cookieStore = await cookies()
  cookieStore.set(
    TRUCKER_COOKIE_NAME,
    signTruckerSession(truckerId),
    truckerCookieOptions()
  )

  return { ok: true }
}

// Convenience: the set-password flow calls this AFTER successfully setting
// a password, to auto-log-in. Keeps the cookie-issuing logic in one place.
export async function issueTruckerSession(truckerId: string): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(
    TRUCKER_COOKIE_NAME,
    signTruckerSession(truckerId),
    truckerCookieOptions()
  )
}

export async function redirectToLoads(): Promise<never> {
  redirect('/t/loads')
}
