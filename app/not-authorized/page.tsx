import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { signOut } from '@/app/dashboard/actions'

// Landing page for authenticated users who don't have an operators row.
// Deliberately lives OUTSIDE /dashboard so the dashboard layout's
// "redirect non-operators here" doesn't infinite-loop.
//
// No database query is required to render — we only check auth.getUser()
// to decide whether to show "Sign out" (signed in but unprovisioned) or
// "Sign in" (someone bookmarked the URL while logged out). Even if that
// check fails, the page still renders.
export default async function NotAuthorizedPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">
            Ramnath Logistics
          </h2>
          <p className="mt-1 text-xs font-medium uppercase tracking-widest text-slate-500">
            Operator Dashboard
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">
            Access not granted
          </h1>
          <p className="mt-3 text-sm text-slate-700">
            You&apos;re signed in
            {user?.email ? (
              <>
                {' '}as <span className="font-mono">{user.email}</span>
              </>
            ) : null}
            , but you don&apos;t have an operator account for Ramnath
            Logistics. If you believe this is a mistake, please contact your
            administrator.
          </p>
          <div className="mt-6">
            {user ? (
              <form action={signOut}>
                <button
                  type="submit"
                  className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2"
                >
                  Sign out
                </button>
              </form>
            ) : (
              <Link
                href="/login"
                className="block w-full rounded-md bg-slate-900 px-4 py-2 text-center text-sm font-medium text-white hover:bg-slate-800"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
