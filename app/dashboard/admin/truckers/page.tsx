import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatRelativeTime } from '@/lib/format'
import type { TruckType, TruckerStatus } from '@/lib/types'
import {
  archiveTruckerAction,
  reactivateTruckerAction,
  suspendTruckerAction,
  unarchiveTruckerAction,
} from './actions'
import { ResetPasswordButton } from './reset-password-button'
import { DeleteTruckerButton } from './delete-trucker-button'

type TruckerRow = {
  id: string
  phone_e164: string
  secondary_phone: string | null
  full_name: string | null
  truck_type: TruckType
  status: TruckerStatus
  archived_at: string | null
  created_at: string
}

// Server component. The /dashboard/admin layout already gated to admin only,
// so we just fetch all truckers with the service-role client and partition
// them client-side for display.
export default async function TruckersAdminPage() {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('truckers')
    .select(
      'id, phone_e164, secondary_phone, full_name, truck_type, status, archived_at, created_at'
    )
    .order('created_at', { ascending: false })

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-900">
        <p className="font-semibold">Failed to load truckers.</p>
        <p className="mt-2 font-mono">{error.message}</p>
      </div>
    )
  }

  const rows = (data ?? []) as TruckerRow[]
  const active = rows.filter(
    (t) => t.status === 'active' && t.archived_at === null
  )
  const suspended = rows.filter(
    (t) => t.status === 'blocked' && t.archived_at === null
  )
  const archived = rows.filter((t) => t.archived_at !== null)

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="mb-1 text-[9px] font-bold uppercase tracking-[0.2em] text-blue-700">
            Fleet Management
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Fleet & Truckers
          </h1>
          <p className="mt-1 text-xs text-slate-600">
            Manage truckers, fleet profiles, and bidding access. Scroll list supports 1000+ truckers.
          </p>
        </div>
        <Link
          href="/dashboard/admin/truckers/new"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-blue-700 active:bg-blue-800 transition-colors"
        >
          <span aria-hidden="true" className="text-base leading-none">+</span>
          Add trucker
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-xs text-slate-600">
          No truckers yet. Click <strong>Add trucker</strong> to get started.
        </div>
      ) : null}

      {active.length > 0 ? (
        <Section title="Active truckers" rows={active} variant="active" />
      ) : null}
      {suspended.length > 0 ? (
        <Section title="Suspended truckers" rows={suspended} variant="suspended" />
      ) : null}
      {archived.length > 0 ? (
        <Section title="Archived truckers" rows={archived} variant="archived" />
      ) : null}
    </div>
  )
}

type SectionVariant = 'active' | 'suspended' | 'archived'

function Section({
  title,
  rows,
  variant,
}: {
  title: string
  rows: TruckerRow[]
  variant: SectionVariant
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xs">
      <div className="border-b border-slate-200 px-4 py-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
          {title} ({rows.length})
        </h2>
        {rows.length > 8 && (
          <span className="text-[11px] text-slate-500 font-medium">Scrollable ({rows.length} total)</span>
        )}
      </div>
      <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 shadow-xs z-10">
            <tr>
              <th className="px-3 py-2 text-left">Phone</th>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Truck type</th>
              <th className="px-3 py-2 text-left">Joined</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50/80 transition-colors">
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-900">
                  {t.phone_e164}
                  {t.secondary_phone ? (
                    <span className="ml-1.5 inline-block rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-600">
                      +{t.secondary_phone}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-slate-900 font-semibold">
                  {t.full_name ?? '—'}
                </td>
                <td className="px-3 py-2 capitalize text-slate-600">
                  {t.truck_type}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                  {formatRelativeTime(t.created_at)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <RowActions trucker={t} variant={variant} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function RowActions({
  trucker,
  variant,
}: {
  trucker: TruckerRow
  variant: SectionVariant
}) {
  const truckerName = trucker.full_name || trucker.phone_e164

  if (variant === 'archived') {
    return (
      <div className="flex items-center justify-end gap-2">
        <form action={unarchiveTruckerAction.bind(null, trucker.id)}>
          <button
            type="submit"
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Restore
          </button>
        </form>
        <DeleteTruckerButton truckerId={trucker.id} truckerName={truckerName} />
      </div>
    )
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <Link
        href={`/dashboard/admin/truckers/${trucker.id}/edit`}
        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        Edit
      </Link>
      <ResetPasswordButton
        truckerId={trucker.id}
        truckerPhone={trucker.phone_e164}
      />
      {variant === 'active' ? (
        <form action={suspendTruckerAction.bind(null, trucker.id)}>
          <button
            type="submit"
            className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
          >
            Suspend
          </button>
        </form>
      ) : (
        <form action={reactivateTruckerAction.bind(null, trucker.id)}>
          <button
            type="submit"
            className="rounded-md border border-green-300 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-900 hover:bg-green-100"
          >
            Reactivate
          </button>
        </form>
      )}
      <form action={archiveTruckerAction.bind(null, trucker.id)}>
        <button
          type="submit"
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Archive
        </button>
      </form>
      <DeleteTruckerButton truckerId={trucker.id} truckerName={truckerName} />
    </div>
  )
}
