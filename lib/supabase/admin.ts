import 'server-only'
import { createClient } from '@supabase/supabase-js'

// Service-role Supabase client. Bypasses RLS entirely. Use this ONLY in
// server contexts where we've already authenticated the caller through a
// non-Supabase mechanism — currently the trucker session cookie checked in
// lib/trucker.ts.
//
// `import 'server-only'` makes this file fail to build if it ever leaks
// into a client bundle (which would expose the service key in the browser).
//
// Do not memoize the client at module scope across runs — keep it scoped
// per call so transient env-var changes during dev don't strand a stale
// client.

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — ' +
        'cannot create admin client'
    )
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
