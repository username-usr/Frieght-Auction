import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { OperatorRole } from '@/lib/types'

type AuthedUser = {
  id: string
  email: string | null
}

type OperatorRow = {
  id: string
  full_name: string
  role: OperatorRole
}

export type OperatorContext = {
  user: AuthedUser | null
  operator: OperatorRow | null
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
export const getOperatorContext = cache(async (): Promise<OperatorContext> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { user: null, operator: null }
  }

  const { data: operator } = await supabase
    .from('operators')
    .select('id, full_name, role')
    .eq('id', user.id)
    .maybeSingle()

  return {
    user: { id: user.id, email: user.email ?? null },
    operator: (operator as OperatorRow | null) ?? null,
  }
})
