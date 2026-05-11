import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Runs on every request matched by middleware.ts at the project root.
// Two jobs: (1) refresh the Supabase session cookie if it's about to expire,
// (2) gate /dashboard behind auth and bounce signed-in users off /login.
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Mirror cookies into BOTH the incoming request (so anything later in
          // this middleware sees the refreshed values) and the outgoing response
          // (so the browser stores them).
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANT: do not remove this getUser() call. It's what triggers the
  // session refresh and the setAll() above. Skipping it leaves stale cookies
  // and the user gets logged out at random.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isProtected = path.startsWith('/dashboard')
  const isLoginPage = path === '/login'

  if (isProtected && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return copyCookies(supabaseResponse, NextResponse.redirect(url))
  }

  if (isLoginPage && user) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return copyCookies(supabaseResponse, NextResponse.redirect(url))
  }

  return supabaseResponse
}

// When we redirect, the cookies the auth refresh wrote onto supabaseResponse
// would be lost. Carry them over to the redirect response.
function copyCookies(from: NextResponse, to: NextResponse): NextResponse {
  from.cookies.getAll().forEach((cookie) => {
    to.cookies.set(cookie.name, cookie.value, cookie)
  })
  return to
}
