import { redirect } from 'next/navigation'
import { Toaster } from 'sonner'
import { getOperatorContext } from '@/lib/auth'
import { BrandMark } from '@/components/brand-mark'
import { DashboardNav } from '@/components/dashboard-nav'
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
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex min-h-18 items-center justify-between gap-4 py-3">
            <BrandMark
              href="/dashboard"
              label="Operator dashboard"
              priority
            />

            <div className="flex min-w-0 items-center gap-2 sm:gap-4">
              <div className="hidden text-right leading-tight sm:block">
                <p className="max-w-48 truncate text-sm font-semibold text-slate-900">
                  {operator.full_name}
                </p>
                <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  {operator.role}
                </p>
              </div>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-bold uppercase text-blue-900">
                {operator.full_name.trim().charAt(0) || 'R'}
              </div>
              <form action={signOut}>
                <button
                  type="submit"
                  className="rounded-full border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-slate-400 hover:bg-slate-50 sm:px-4"
                >
                  Sign out
                </button>
              </form>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 py-2">
            <DashboardNav isAdmin={isAdmin} />
            <span className="hidden text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400 sm:block">
              Freight command centre
            </span>
          </div>
        </div>
      </header>
      <Toaster richColors position="top-right" closeButton />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10 lg:px-8">
        {children}
      </main>
    </div>
  )
}
