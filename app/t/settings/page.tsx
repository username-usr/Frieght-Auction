import Link from 'next/link'
import { requireTrucker } from '@/lib/trucker'
import { TruckerSettingsForm } from './settings-form'

export const dynamic = 'force-dynamic'

export default async function TruckerSettingsPage() {
  const trucker = await requireTrucker()

  return (
    <div className="space-y-5">
      <nav className="text-xs">
        <Link
          href="/t/loads"
          className="text-slate-600 hover:text-slate-900 inline-flex items-center gap-1 font-medium"
        >
          ← Back to loads dashboard
        </Link>
      </nav>

      <header>
        <h1 className="text-xl font-semibold text-slate-900">
          Account & Fleet Settings
        </h1>
        <p className="mt-0.5 text-xs text-slate-600">
          Manage your transporter profile, contact details, and truck fleet parameters.
        </p>
      </header>

      <TruckerSettingsForm trucker={trucker} />
    </div>
  )
}
