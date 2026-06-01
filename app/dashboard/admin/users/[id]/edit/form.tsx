'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import type { LookupOption, OperatorRole } from '@/lib/types'
import { updateOperatorAction } from '../../actions'

const FULL_NAME_MAX = 200

const FIELD =
  'mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-500 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:cursor-not-allowed disabled:bg-slate-50'
const LABEL = 'block text-sm font-medium text-slate-700'
const ERROR_TXT = 'mt-1 text-xs text-red-700'

type Props = {
  id: string
  email: string
  fullName: string
  role: OperatorRole
  zoneId: string | null
  isSelf: boolean
  zones: LookupOption[]
}

export function EditUserForm({
  id,
  email,
  fullName: initialFullName,
  role: initialRole,
  zoneId: initialZoneId,
  isSelf,
  zones,
}: Props) {
  const router = useRouter()
  const [fullName, setFullName] = useState(initialFullName)
  const [role, setRole] = useState<OperatorRole>(initialRole)
  const [zoneId, setZoneId] = useState<string>(initialZoneId ?? '')
  const [nameError, setNameError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = fullName.trim()
    if (!trimmed) {
      setNameError('Required')
      return
    }
    if (trimmed.length > FULL_NAME_MAX) {
      setNameError(`Must be ${FULL_NAME_MAX} characters or fewer.`)
      return
    }
    setNameError(null)

    startTransition(async () => {
      try {
        await updateOperatorAction(id, {
          full_name: trimmed,
          role,
          zone_id: zoneId === '' ? null : zoneId,
        })
        toast.success('User updated.')
        router.push('/dashboard/admin/users')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update user.')
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="user_email" className={LABEL}>
          Email (read-only)
        </label>
        <input
          id="user_email"
          type="email"
          readOnly
          value={email}
          className={`${FIELD} cursor-not-allowed bg-slate-50`}
        />
      </div>

      <div>
        <label htmlFor="user_name" className={LABEL}>
          Full name
        </label>
        <input
          id="user_name"
          name="full_name"
          type="text"
          autoComplete="off"
          disabled={isPending}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className={FIELD}
        />
        {nameError ? <p className={ERROR_TXT}>{nameError}</p> : null}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="user_role" className={LABEL}>
            Role
          </label>
          <select
            id="user_role"
            name="role"
            disabled={isPending || isSelf}
            value={role}
            onChange={(e) => setRole(e.target.value as OperatorRole)}
            className={FIELD}
          >
            <option value="operator">Operator</option>
            <option value="admin">Admin</option>
          </select>
          {isSelf ? (
            <p className="mt-1 text-xs text-slate-500">
              You can&apos;t change your own role. Ask another admin if you
              need to step down.
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor="user_zone" className={LABEL}>
            Zone
          </label>
          <select
            id="user_zone"
            name="zone_id"
            disabled={isPending}
            value={zoneId}
            onChange={(e) => setZoneId(e.target.value)}
            className={FIELD}
          >
            <option value="">No zone</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-slate-200 pt-4">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-blue-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? 'Saving…' : 'Save changes'}
        </button>
        <Link
          href="/dashboard/admin/users"
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </Link>
      </div>
    </form>
  )
}
