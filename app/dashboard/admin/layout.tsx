import { redirect } from 'next/navigation'
import { getOperatorContext } from '@/lib/auth'
import { AdminSubNav } from './admin-subnav'

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
    <div className="space-y-7">
      <div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700">
          Workspace
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Admin
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Manage truckers, loads metadata, and users.
        </p>
      </div>
      <AdminSubNav />
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        {children}
      </div>
    </div>
  )
}
