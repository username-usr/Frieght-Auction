'use server'

import { cookies } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  TRUCKER_COOKIE_NAME,
  signTruckerSession,
  truckerCookieOptions,
} from '@/lib/trucker-session'

export type SetPasswordResult =
  | { ok: true }
  | { ok: false; error: string }

function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim().replace(/\s+/g, '')
  if (!trimmed) return null
  if (!/^\+[1-9]\d{1,14}$/.test(trimmed)) return null
  return trimmed
}

export async function setPasswordAction(
  phoneRaw: string,
  password: string,
  confirm: string
): Promise<SetPasswordResult> {
  const phone = normalizePhone(phoneRaw)
  if (!phone) {
    return { ok: false, error: 'Invalid phone number.' }
  }
  if (password.length < 6) {
    return { ok: false, error: 'Password must be at least 6 characters.' }
  }
  if (password !== confirm) {
    return { ok: false, error: 'Passwords do not match.' }
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc('trucker_set_password', {
    p_phone: phone,
    p_password: password,
  })

  if (error) {
    if (/Trucker not registered/.test(error.message)) {
      return {
        ok: false,
        error: 'Phone not registered. Please ask Ramnath Logistics to add you.',
      }
    }
    if (/Password already set/.test(error.message)) {
      return {
        ok: false,
        error: 'A password is already set for this phone. Go to sign-in instead.',
      }
    }
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.error('[setPasswordAction]', error)
    }
    return { ok: false, error: 'Could not set password. Try again.' }
  }

  // First-time set acts as auto-login per spec.
  const truckerId = data as string
  const cookieStore = await cookies()
  cookieStore.set(
    TRUCKER_COOKIE_NAME,
    signTruckerSession(truckerId),
    truckerCookieOptions()
  )

  return { ok: true }
}
