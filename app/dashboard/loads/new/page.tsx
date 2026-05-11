import Link from 'next/link'
import { NewLoadForm } from './form'

export default function NewLoadPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link
          href="/dashboard"
          className="text-sm text-slate-600 hover:text-slate-900"
        >
          ← Back to loads
        </Link>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
          New load
        </h2>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <NewLoadForm />
      </div>
    </div>
  )
}
