import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getOperatorContext } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatAbsoluteIST } from '@/lib/format'
import { getActiveZones } from '@/lib/zones'
import type { OperatorRole } from '@/lib/types'
import { EditUserForm } from './form'

type OperatorDetail = {
  id: string
  email: string
  full_name: string
  role: OperatorRole
  zone_id: string | null
  archived_at: string | null
}

export default async function EditUserPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { operator: currentOperator } = await getOperatorContext()
  const supabase = createAdminClient()

  const [operatorResult, zones] = await Promise.all([
    supabase
      .from('operators')
      .select('id, email, full_name, role, zone_id, archived_at')
      .eq('id', id)
      .maybeSingle(),
    getActiveZones(),
  ])

  if (operatorResult.error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-900">
        <p className="font-semibold">Failed to load operator.</p>
        <p className="mt-2 font-mono">{operatorResult.error.message}</p>
      </div>
    )
  }
  if (!operatorResult.data) notFound()

  const operator = operatorResult.data as OperatorDetail
  const isSelf = currentOperator?.id === operator.id

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
          Edit user
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Email is immutable — changing it would break sign-in. Use the
          listing page to archive or restore an account.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <dl className="mb-6 text-xs">
          <dt className="font-medium uppercase tracking-wider text-slate-500">
            Archived
          </dt>
          <dd className="mt-1 text-sm text-slate-900">
            {operator.archived_at
              ? `Yes — ${formatAbsoluteIST(operator.archived_at)}`
              : 'No'}
          </dd>
        </dl>

        <EditUserForm
          id={operator.id}
          email={operator.email}
          fullName={operator.full_name}
          role={operator.role}
          zoneId={operator.zone_id}
          isSelf={isSelf}
          zones={zones}
        />
      </div>
    </div>
  )
}
