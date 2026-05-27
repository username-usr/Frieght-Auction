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
  const { user, operator } = await getOperatorContext()
  if (!user) redirect('/login')
  if (!operator) redirect('/not-authorized')

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <div>
            <p className="text-base font-semibold tracking-tight text-slate-900">
              Ramnath Logistics
            </p>
            <p className="text-xs font-medium uppercase tracking-widest text-slate-500">
              Operator Dashboard
            </p>
          </div>
          <nav className="flex items-center gap-1">
            <Link
              href="/dashboard"
              className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Loads
            </Link>
            <Link
              href="/dashboard/admin"
              className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Admin
            </Link>
          </nav>
          <div className="flex items-center gap-4">
            <div className="text-right text-sm leading-tight">
              <p className="font-medium text-slate-900">{operator.full_name}</p>
              <p className="text-xs capitalize text-slate-600">{operator.role}</p>
            </div>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <Toaster richColors position="top-right" closeButton />
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </div>
  )
}
