import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { TRUCKER_COOKIE_NAME } from '@/lib/trucker-session'

// GET /t/logout — clear the trucker session cookie and bounce to /t/login.
// We accept GET (not just POST) so the "Sign out" Link in the trucker UI
// works without a form. There's no useful CSRF surface here: clearing your
// own session is the desired behaviour even for cross-site-initiated GETs.
async function clearAndRedirect(request: Request) {
  const cookieStore = await cookies()
  cookieStore.delete(TRUCKER_COOKIE_NAME)
  const url = new URL('/t/login', request.url)
  return NextResponse.redirect(url)
}

export async function GET(request: Request) {
  return clearAndRedirect(request)
}

export async function POST(request: Request) {
  return clearAndRedirect(request)
}
