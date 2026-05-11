import { redirect } from 'next/navigation'
import { Toaster } from 'sonner'
import { createClient } from '@/lib/supabase/server'
import { signOut } from './actions'

// The dashboard layout is the auth + provisioning gate for everything under
// /dashboard. It also hosts the top bar (brand, user info, sign-out) so the
// individual pages don't have to repeat it.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // RLS: the operators-table policy only returns a row when the caller is
  // already an operator. So `operator` is null for an authenticated-but-not-
  // provisioned user, which we render as the amber banner instead of `children`.
  const { data: operator } = await supabase
    .from('operators')
    .select('full_name, role')
    .eq('id', user.id)
    .maybeSingle()

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
          <div className="flex items-center gap-4">
            {operator ? (
              <div className="text-right text-sm leading-tight">
                <p className="font-medium text-slate-900">{operator.full_name}</p>
                <p className="text-xs capitalize text-slate-600">
                  {operator.role}
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-700">{user.email}</p>
            )}
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
      <main className="mx-auto max-w-7xl px-6 py-8">
        {operator ? (
          children
        ) : (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
            <p className="font-semibold">
              You&apos;re authenticated but not yet provisioned as an operator.
            </p>
            <p className="mt-2">
              Ask the admin to add a row in the{' '}
              <span className="font-mono">operators</span> table for{' '}
              {user.email}. Your auth user id is{' '}
              <span className="font-mono">{user.id}</span>.
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
