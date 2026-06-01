import Link from 'next/link'
import { getActiveZones } from '@/lib/zones'
import { NewUserForm } from './form'

// Server component. Fetches active zones for the dropdown; the /dashboard/admin
// layout already gates this route to admins, so no extra auth check here.

export default async function NewUserPage() {
  const zones = await getActiveZones()

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <Link
          href="/dashboard/admin/users"
          className="text-sm text-slate-600 hover:text-slate-900"
        >
          ← Back to users
        </Link>
        <h2 className="mt-2 text-lg font-semibold tracking-tight text-slate-900">
          Add user
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Creates a Supabase Auth account and the matching operators row in
          a single step. The user signs in with the email and the password
          you set below.
        </p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <NewUserForm zones={zones} />
      </div>
    </div>
  )
}
