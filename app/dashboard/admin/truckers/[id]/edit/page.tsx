import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatAbsoluteIST } from '@/lib/format'
import type { TruckType, TruckerStatus } from '@/lib/types'
import { EditTruckerForm } from './form'

type TruckerDetail = {
  id: string
  phone_e164: string
  full_name: string | null
  truck_type: TruckType
  status: TruckerStatus
  archived_at: string | null
  created_at: string
}

const STATUS_BADGE: Record<TruckerStatus, string> = {
  active: 'bg-green-100 text-green-900',
  blocked: 'bg-amber-100 text-amber-900',
  inactive: 'bg-slate-200 text-slate-700',
}

export default async function EditTruckerPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('truckers')
    .select(
      'id, phone_e164, full_name, truck_type, status, archived_at, created_at'
    )
    .eq('id', id)
    .maybeSingle()

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-900">
        <p className="font-semibold">Failed to load trucker.</p>
        <p className="mt-2 font-mono">{error.message}</p>
      </div>
    )
  }
  if (!data) notFound()

  const trucker = data as TruckerDetail

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
          Edit trucker
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Phone is immutable — changing it would break sign-in. Use
          suspend/archive actions on the list page to change status.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <dl className="mb-6 grid grid-cols-2 gap-x-6 gap-y-3 text-xs">
          <div>
            <dt className="font-medium uppercase tracking-wider text-slate-500">
              Status
            </dt>
            <dd className="mt-1">
              <span
                className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_BADGE[trucker.status]}`}
              >
                {trucker.status}
              </span>
            </dd>
          </div>
          <div>
            <dt className="font-medium uppercase tracking-wider text-slate-500">
              Archived
            </dt>
            <dd className="mt-1 text-sm text-slate-900">
              {trucker.archived_at
                ? `Yes — ${formatAbsoluteIST(trucker.archived_at)}`
                : 'No'}
            </dd>
          </div>
        </dl>

        <EditTruckerForm
          id={trucker.id}
          phoneE164={trucker.phone_e164}
          fullName={trucker.full_name}
          truckType={trucker.truck_type}
        />
      </div>
    </div>
  )
}
