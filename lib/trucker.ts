import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  TRUCKER_COOKIE_NAME,
  verifyTruckerSession,
} from '@/lib/trucker-session'
import type { TruckType, TruckerStatus } from '@/lib/types'

export type CurrentTrucker = {
  id: string
  phone_e164: string
  full_name: string | null
  truck_type: TruckType
  home_base_city: string | null
  status: TruckerStatus
}

// Per-request memoized lookup. The /t layout, the per-page server
// components, and any nested server fetches share one Supabase round trip
// through React's cache().
export const getTrucker = cache(async (): Promise<CurrentTrucker | null> => {
  console.log('[getTrucker] called')

  const cookieStore = await cookies()
  const raw = cookieStore.get(TRUCKER_COOKIE_NAME)?.value
  console.log('[getTrucker] cookie present:', !!raw, 'length:', raw?.length ?? 0)

  const session = verifyTruckerSession(raw)
  console.log('[getTrucker] session verified:', !!session, 'truckerId:', session?.truckerId)

  if (!session) {
    console.log('[getTrucker] returning null: invalid session')
    return null
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('truckers')
    .select('id, phone_e164, full_name, truck_type, home_base_city, status')
    .eq('id', session.truckerId)
    .maybeSingle()

  console.log('[getTrucker] db lookup:', {
    hasData: !!data,
    status: data?.status,
    error: error?.message,
  })

  if (!data) {
    console.log('[getTrucker] returning null: no trucker row')
    return null
  }

  if (data.status !== 'active') {
    console.log('[getTrucker] returning null: status =', data.status)
    return null
  }

  console.log('[getTrucker] success, returning trucker')
  return data as CurrentTrucker
})

// Use inside /t/* pages that REQUIRE an authenticated trucker. Redirects to
// /t/login if the session is missing or invalid. The login + set-password
// pages do NOT call this — they call getTrucker() directly and handle null
// themselves.
export async function requireTrucker(): Promise<CurrentTrucker> {
  const callerStack = new Error().stack
    ?.split('\n')
    .slice(2, 6)
    .map((l) => l.trim())
    .join(' | ')
  console.log('[requireTrucker] called from:', callerStack)
  const trucker = await getTrucker()
  if (!trucker) {
    console.log('[requireTrucker] no trucker, redirecting to /t/login. caller:', callerStack)
    redirect('/t/login')
  }
  console.log('[requireTrucker] success, trucker id:', trucker.id)
  return trucker
}
