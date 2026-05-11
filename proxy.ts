import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

// Next.js 16 renamed this file convention from `middleware.ts` to `proxy.ts`
// and the exported function from `middleware` to `proxy`. The behavior is
// identical — runs on every request matched by `config.matcher`.
export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

// Skip proxy for static assets and image optimization. Everything else
// (pages, API routes) goes through the auth refresh + protection checks.
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
