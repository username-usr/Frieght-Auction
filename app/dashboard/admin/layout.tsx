import { redirect } from 'next/navigation'
import { getOperatorContext } from '@/lib/auth'

// The /dashboard layout has already gated to an authenticated, provisioned
// operator. This nested layout adds the admin-only gate on top: a non-admin
// operator who guesses /dashboard/admin lands back on the loads list. The
// top-nav also hides the Admin link from non-admins (see /dashboard/layout.tsx),
// so this redirect is belt-and-suspenders.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { isAdmin } = await getOperatorContext()
  if (!isAdmin) redirect('/dashboard')

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        {children}
      </div>
    </div>
  )
}
