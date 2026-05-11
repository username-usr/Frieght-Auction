import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Use this in Server Components, Server Actions, and Route Handlers.
// `cookies()` is async in Next.js 15+, hence the await.
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Components can't actually mutate cookies — Next throws
            // if you try. We swallow it because the middleware has already
            // refreshed the session cookies for the next request.
          }
        },
      },
    }
  )
}
