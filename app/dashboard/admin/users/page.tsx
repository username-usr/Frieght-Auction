import Link from 'next/link'
import { getOperatorContext } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatRelativeTime } from '@/lib/format'
import type { OperatorRole } from '@/lib/types'
import {
  archiveOperatorAction,
  unarchiveOperatorAction,
} from './actions'

type OperatorListRow = {
  id: string
  email: string
  full_name: string
  role: OperatorRole
  zone_id: string | null
  archived_at: string | null
  created_at: string
}

type ZoneRow = { id: string; name: string }

// Server component. The /dashboard/admin layout already gated the route to
// admin-only; we rely on that here and don't re-check.

export default async function UsersAdminPage() {
  const { operator: currentOperator } = await getOperatorContext()
  const supabase = createAdminClient()

  const [operatorsResult, zonesResult] = await Promise.all([
    supabase
      .from('operators')
      .select(
        'id, email, full_name, role, zone_id, archived_at, created_at'
      )
      .order('created_at', { ascending: false }),
    // Including deleted_at IS NOT NULL zones too, so an operator linked to
    // a soft-deleted zone still shows the zone's name (just less surprising
    // than rendering "—" for them).
    supabase.from('zones').select('id, name'),
  ])

  if (operatorsResult.error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-900">
        <p className="font-semibold">Failed to load operators.</p>
        <p className="mt-2 font-mono">{operatorsResult.error.message}</p>
      </div>
    )
  }
  if (zonesResult.error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-900">
        <p className="font-semibold">Failed to load zones.</p>
        <p className="mt-2 font-mono">{zonesResult.error.message}</p>
      </div>
    )
  }

  const rows = (operatorsResult.data ?? []) as OperatorListRow[]
  const zoneNameById = new Map(
    (zonesResult.data ?? []).map((z: ZoneRow) => [z.id, z.name])
  )

  const active = rows.filter((o) => o.archived_at === null)
  const archived = rows.filter((o) => o.archived_at !== null)

  const currentId = currentOperator?.id ?? null

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="mb-1 text-[9px] font-bold uppercase tracking-[0.2em] text-blue-700">
            Access Control
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Operators & Users
          </h1>
          <p className="mt-1 text-xs text-slate-600">
            Manage operator accounts, admin roles, and zone assignments.
          </p>
        </div>
        <Link
          href="/dashboard/admin/users/new"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-blue-700 active:bg-blue-800 transition-colors"
        >
          <span aria-hidden="true" className="text-base leading-none">+</span>
          Add user
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-xs text-slate-600">
          No operators yet. Click <strong>Add user</strong> to get started.
        </div>
      ) : null}

      {active.length > 0 ? (
        <Section
          title="Active operators"
          rows={active}
          zoneNameById={zoneNameById}
          currentId={currentId}
          variant="active"
        />
      ) : null}
      {archived.length > 0 ? (
        <Section
          title="Archived operators"
          rows={archived}
          zoneNameById={zoneNameById}
          currentId={currentId}
          variant="archived"
        />
      ) : null}
    </div>
  )
}

const ROLE_BADGE: Record<OperatorRole, string> = {
  admin: 'bg-blue-50 text-blue-700 border border-blue-200/60 font-semibold',
  operator: 'bg-slate-100 text-slate-700 border border-slate-200/60 font-medium',
}

function Section({
  title,
  rows,
  zoneNameById,
  currentId,
  variant,
}: {
  title: string
  rows: OperatorListRow[]
  zoneNameById: Map<string, string>
  currentId: string | null
  variant: 'active' | 'archived'
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xs">
      <div className="border-b border-slate-200 px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
          {title} ({rows.length})
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">Email</th>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Role</th>
              <th className="px-3 py-2 text-left">Zone</th>
              <th className="px-3 py-2 text-left">Joined</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((o) => {
              const isSelf = o.id === currentId
              return (
                <tr key={o.id}>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-900 font-mono text-xs">
                    {o.email}
                    {isSelf ? (
                      <span className="ml-1.5 inline-block rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-600">
                        you
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-slate-900 font-semibold">{o.full_name}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${ROLE_BADGE[o.role]}`}
                    >
                      {o.role}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {o.zone_id ? (zoneNameById.get(o.zone_id) ?? '—') : '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                    {formatRelativeTime(o.created_at)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <RowActions
                      operator={o}
                      isSelf={isSelf}
                      variant={variant}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function RowActions({
  operator,
  isSelf,
  variant,
}: {
  operator: OperatorListRow
  isSelf: boolean
  variant: 'active' | 'archived'
}) {
  if (variant === 'archived') {
    return (
      <form action={unarchiveOperatorAction.bind(null, operator.id)}>
        <button
          type="submit"
          className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          Restore
        </button>
      </form>
    )
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <Link
        href={`/dashboard/admin/users/${operator.id}/edit`}
        className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
      >
        Edit
      </Link>
      {isSelf ? null : (
        <form action={archiveOperatorAction.bind(null, operator.id)}>
          <button
            type="submit"
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Archive
          </button>
        </form>
      )}
    </div>
  )
}
