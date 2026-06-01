import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { OperatorRole } from '@/lib/types'

type AuthedUser = {
  id: string
  email: string | null
}

type OperatorRow = {
  id: string
  email: string
  full_name: string
  role: OperatorRole
  zone_id: string | null
  archived_at: string | null
}

export type OperatorContext = {
  user: AuthedUser | null
  operator: OperatorRow | null
  isAdmin: boolean
}

// Per-request memoized lookup of the current user + their operators row.
//
// React's `cache()` scopes the result to a single server-render request, so
// the dashboard layout, every page under /dashboard, and any nested server
// component can call this without round-tripping to Supabase again. The
// first caller in the request triggers the queries; subsequent callers get
// the same resolved value.
//
// This does NOT cross request boundaries — server actions (POST) run in a
// separate request, so cancel-action.ts and actions.ts still maintain
// their own auth checks.
//
// Archived operators get operator=null (and isAdmin=false), matching the
// behavior of is_operator() / is_admin() in the DB (migration 0013): an
// archived account loses elevated permissions immediately, even if the
// Supabase session is still valid.
export const getOperatorContext = cache(async (): Promise<OperatorContext> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { user: null, operator: null, isAdmin: false }
  }

  const { data: operator } = await supabase
    .from('operators')
    .select('id, email, full_name, role, zone_id, archived_at')
    .eq('id', user.id)
    .is('archived_at', null)
    .maybeSingle()

  const operatorRow = (operator as OperatorRow | null) ?? null

  return {
    user: { id: user.id, email: user.email ?? null },
    operator: operatorRow,
    isAdmin: operatorRow?.role === 'admin',
  }
})
