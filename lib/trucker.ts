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
  const cookieStore = await cookies()
  const raw = cookieStore.get(TRUCKER_COOKIE_NAME)?.value
  const session = verifyTruckerSession(raw)
  if (!session) return null

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('truckers')
    .select('id, phone_e164, full_name, truck_type, home_base_city, status')
    .eq('id', session.truckerId)
    .maybeSingle()

  if (!data) return null

  // Defensive: a previously-active trucker whose status flipped to inactive
  // or blocked should be bounced. The /t/login page presents an opaque
  // "session expired" message — we don't reveal which side of the binary it
  // actually was.
  if (data.status !== 'active') return null

  return data as CurrentTrucker
})

// Use inside /t/* pages that REQUIRE an authenticated trucker. Redirects to
// /t/login if the session is missing or invalid. The login + set-password
// pages do NOT call this — they call getTrucker() directly and handle null
// themselves.
export async function requireTrucker(): Promise<CurrentTrucker> {
  const trucker = await getTrucker()
  if (!trucker) redirect('/t/login')
  return trucker
}
