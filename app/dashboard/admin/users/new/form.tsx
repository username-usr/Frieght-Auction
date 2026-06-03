'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import type { LookupOption, OperatorRole } from '@/lib/types'
import { addOperatorAction } from '../actions'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PASSWORD_MIN = 8
const FULL_NAME_MAX = 200

const FIELD =
  'mt-1 block w-full rounded-md border-2 border-slate-400 px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-500 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:cursor-not-allowed disabled:bg-slate-50'
const LABEL = 'block text-sm font-medium text-slate-700'
const ERROR_TXT = 'mt-1 text-xs text-red-700'

type Errors = Partial<{
  email: string
  full_name: string
  role: string
  zone_id: string
  password: string
  confirm: string
}>

type Props = {
  zones: LookupOption[]
}

export function NewUserForm({ zones }: Props) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<OperatorRole>('operator')
  const [zoneId, setZoneId] = useState<string>('') // '' means "No zone"
  // type="text" (not "password") is intentional — the admin needs to see
  // what they typed in order to share it with the new user out-of-band.
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [isPending, startTransition] = useTransition()

  function validate(): Errors {
    const e: Errors = {}
    const em = email.trim().toLowerCase()
    if (!em) e.email = 'Required'
    else if (!EMAIL_RE.test(em)) e.email = 'Enter a valid email address.'

    const fn = fullName.trim()
    if (!fn) e.full_name = 'Required'
    else if (fn.length > FULL_NAME_MAX) {
      e.full_name = `Must be ${FULL_NAME_MAX} characters or fewer.`
    }

    if (password.length < PASSWORD_MIN) {
      e.password = `Must be at least ${PASSWORD_MIN} characters.`
    }
    if (confirm !== password) {
      e.confirm = 'Passwords do not match.'
    }

    return e
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const v = validate()
    setErrors(v)
    if (Object.keys(v).length > 0) return

    startTransition(async () => {
      try {
        await addOperatorAction({
          email: email.trim().toLowerCase(),
          full_name: fullName.trim(),
          role,
          zone_id: zoneId === '' ? null : zoneId,
          password,
        })
        toast.success('User added.')
        router.push('/dashboard/admin/users')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to add user.')
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="user_email" className={LABEL}>
          Email <span className="text-red-600">*</span>
        </label>
        <input
          id="user_email"
          name="email"
          type="email"
          autoComplete="off"
          disabled={isPending}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="rajesh@ramnathlogistics.in"
          className={FIELD}
        />
        {errors.email ? (
          <p className={ERROR_TXT}>{errors.email}</p>
        ) : (
          <p className="mt-1 text-xs text-slate-500">
            Required. Used as the sign-in identifier. Can&apos;t be changed after creation.
          </p>
        )}
      </div>

      <div>
        <label htmlFor="user_name" className={LABEL}>
          Full name <span className="text-red-600">*</span>
        </label>
        <input
          id="user_name"
          name="full_name"
          type="text"
          autoComplete="off"
          disabled={isPending}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Rajesh Kumar"
          className={FIELD}
        />
        {errors.full_name ? (
          <p className={ERROR_TXT}>{errors.full_name}</p>
        ) : (
          <p className="mt-1 text-xs text-slate-500">Required</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="user_role" className={LABEL}>
            Role <span className="text-red-600">*</span>
          </label>
          <select
            id="user_role"
            name="role"
            disabled={isPending}
            value={role}
            onChange={(e) => setRole(e.target.value as OperatorRole)}
            className={FIELD}
          >
            <option value="operator">Operator</option>
            <option value="admin">Admin</option>
          </select>
          <p className="mt-1 text-xs text-slate-500">Required</p>
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

      <div>
        <label htmlFor="user_password" className={LABEL}>
          Password <span className="text-red-600">*</span>
        </label>
        <input
          id="user_password"
          name="password"
          type="text"
          autoComplete="new-password"
          disabled={isPending}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 8 characters"
          className={`${FIELD} font-mono`}
        />
        {errors.password ? (
          <p className={ERROR_TXT}>{errors.password}</p>
        ) : (
          <p className="mt-1 text-xs text-slate-500">
            Required. Make sure to share this password securely with the user.
          </p>
        )}
      </div>

      <div>
        <label htmlFor="user_confirm" className={LABEL}>
          Confirm password <span className="text-red-600">*</span>
        </label>
        <input
          id="user_confirm"
          name="confirm"
          type="text"
          autoComplete="new-password"
          disabled={isPending}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Type the password again"
          className={`${FIELD} font-mono`}
        />
        {errors.confirm ? (
          <p className={ERROR_TXT}>{errors.confirm}</p>
        ) : (
          <p className="mt-1 text-xs text-slate-500">Required</p>
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-slate-200 pt-4">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-blue-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? 'Adding…' : 'Add user'}
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
