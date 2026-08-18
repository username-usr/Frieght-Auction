import { redirect } from 'next/navigation'
import { Toaster } from 'sonner'
import { getOperatorContext } from '@/lib/auth'
import { BrandMark } from '@/components/brand-mark'
import { SidebarNav } from '@/components/dashboard-nav'
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
      <SidebarNav
        isAdmin={isAdmin}
        operator={operator}
        signOutAction={signOut}
      />
      <Toaster richColors position="top-right" closeButton />
      <div className="lg:pl-60 flex flex-col min-h-screen">
        <main className="flex-1 p-3.5 sm:p-5 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
