import { createBrowserClient } from '@supabase/ssr'

// Use this in Client Components ('use client') and inside browser-only code.
// It reads the session from cookies that the server already wrote.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
