import Link from 'next/link'
import { NewTruckerForm } from './form'

// No server-side data fetching needed — the truck-type dropdown options are
// the static TruckType enum. The /dashboard/admin layout already gated to
// admin only.

export default function NewTruckerPage() {
  return (
    <div className="max-w-xl space-y-6">
      <div>
        <Link
          href="/dashboard/admin/truckers"
          className="text-sm text-slate-600 hover:text-slate-900"
        >
          ← Back to truckers
        </Link>
        <h2 className="mt-2 text-lg font-semibold tracking-tight text-slate-900">
          Add trucker
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          The trucker will set their own password on first login. They
          can&apos;t bid until they sign in at least once.
        </p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <NewTruckerForm />
      </div>
    </div>
  )
}
