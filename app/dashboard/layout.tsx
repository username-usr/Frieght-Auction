import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Toaster } from 'sonner'
import { getOperatorContext } from '@/lib/auth'
import { signOut } from './actions'

// The dashboard layout is the auth + provisioning gate for everything under
// /dashboard. It also hosts the top bar (brand, user info, sign-out) so the
// individual pages don't have to repeat it.
//
// Two-step guard:
//   1. No auth user → /login (you haven't signed in)
//   2. Signed in but no operators row → /not-authorized (you've signed in
//      with an account that isn't provisioned). The /not-authorized page
//      lives OUTSIDE /dashboard so it doesn't recurse into this guard.
//
// getOperatorContext() is memoized per request (React cache()), so pages
// under /dashboard that need the operator row can call it again without
// triggering a second round-trip.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user, operator, isAdmin } = await getOperatorContext()
  if (!user) redirect('/login')
  if (!operator) redirect('/not-authorized')

  return (
    <div className="min-h-screen bg-slate-50 antialiased">
      <header className="border-b border-slate-200 bg-white shadow-xs">
        <div className="mx-auto max-w-7xl px-3 sm:px-6 py-3 space-y-3">
          {/* Top Row: Brand & Title on left, Admin User Profile & Sign Out on right */}
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-base font-bold tracking-tight text-slate-900">
                Ramnath Logistics
              </p>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                Operator Dashboard
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-right text-xs sm:text-sm leading-tight">
                <p className="font-semibold text-slate-900 truncate max-w-[130px] sm:max-w-none">{operator.full_name}</p>
                <p className="text-[11px] capitalize text-slate-500">{operator.role}</p>
              </div>
              <form action={signOut}>
                <button
                  type="submit"
                  className="rounded-md border border-slate-300 bg-white px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-xs"
                >
                  Sign out
                </button>
              </form>
            </div>
          </div>

          {/* Bottom Row: Loads & Admin Navigation Tabs below */}
          <div className="border-t border-slate-100 pt-2 flex items-center gap-1">
            <Link
              href="/dashboard"
              className="rounded-md px-3 py-1.5 text-xs sm:text-sm font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
            >
              Loads
            </Link>
            {isAdmin ? (
              <Link
                href="/dashboard/admin"
                className="rounded-md px-3 py-1.5 text-xs sm:text-sm font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
              >
                Admin
              </Link>
            ) : null}
          </div>
        </div>
      </header>
      <Toaster richColors position="top-right" closeButton />
      <main className="mx-auto max-w-7xl px-3 sm:px-6 py-4 sm:py-8 space-y-6">{children}</main>
    </div>
  )
}
