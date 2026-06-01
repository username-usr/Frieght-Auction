'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import type { TruckType, TruckerStatus } from '@/lib/types'
import { updateLoadVisibilityAction } from './actions'

export type VisibilityTrucker = {
  id: string
  phone_e164: string
  full_name: string | null
  truck_type: TruckType
  status: TruckerStatus
}

type Props = {
  loadId: string
  truckTypeRequired: TruckType
  pool: VisibilityTrucker[]
  initialSelected: string[]
}

// Edit-mode counterpart to the new-load form's Trucker section. Pre-selects
// the load's current visibility list and computes the diff inside the
// server action.
export function VisibilityForm({
  loadId,
  truckTypeRequired,
  pool,
  initialSelected,
}: Props) {
  const router = useRouter()
  const [selectedTruckerIds, setSelectedTruckerIds] = useState<Set<string>>(
    () => new Set(initialSelected)
  )
  const [isPending, startTransition] = useTransition()

  const activeMatching = useMemo(
    () => pool.filter((t) => t.status === 'active'),
    [pool]
  )
  const suspendedMatching = useMemo(
    () => pool.filter((t) => t.status === 'blocked'),
    [pool]
  )

  function toggleTrucker(id: string) {
    setSelectedTruckerIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllMatching() {
    setSelectedTruckerIds(new Set(pool.map((t) => t.id)))
  }

  function deselectAll() {
    setSelectedTruckerIds(new Set())
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (selectedTruckerIds.size === 0) {
      toast.error('Select at least one trucker.')
      return
    }

    startTransition(async () => {
      try {
        await updateLoadVisibilityAction(
          loadId,
          Array.from(selectedTruckerIds)
        )
        toast.success('Visibility updated.')
        router.push(`/dashboard/loads/${loadId}`)
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : 'Failed to update visibility.'
        )
      }
    })
  }

  const noMatchingTruckers = pool.length === 0
  const submitDisabled =
    isPending || selectedTruckerIds.size === 0 || noMatchingTruckers

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-600">
          Required truck type:{' '}
          <span className="font-medium capitalize text-slate-900">
            {truckTypeRequired}
          </span>
        </p>
        <span className="text-xs text-slate-600">
          <span className="font-medium text-slate-900">
            {selectedTruckerIds.size}
          </span>
          {' / '}
          {pool.length} selected
        </span>
      </div>

      {noMatchingTruckers ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          No truckers match this load&apos;s truck type. Add truckers in admin
          first, or cancel and re-post the load with a different truck type.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              disabled={isPending}
              onClick={selectAllMatching}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Select all
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={deselectAll}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Deselect all
            </button>
            <p className="text-slate-500">
              Suspended truckers can be invited but can&apos;t bid until
              reactivated.
            </p>
          </div>

          <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
            {activeMatching.map((t) => (
              <TruckerCheckbox
                key={t.id}
                trucker={t}
                checked={selectedTruckerIds.has(t.id)}
                disabled={isPending}
                onToggle={() => toggleTrucker(t.id)}
              />
            ))}
            {suspendedMatching.length > 0 ? (
              <li className="bg-slate-50 px-3 py-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                Suspended
              </li>
            ) : null}
            {suspendedMatching.map((t) => (
              <TruckerCheckbox
                key={t.id}
                trucker={t}
                checked={selectedTruckerIds.has(t.id)}
                disabled={isPending}
                onToggle={() => toggleTrucker(t.id)}
                suspended
              />
            ))}
          </ul>
        </>
      )}

      <div className="flex items-center gap-3 border-t border-slate-200 pt-4">
        <button
          type="submit"
          disabled={submitDisabled}
          className="rounded-md bg-blue-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? 'Saving…' : 'Save visibility'}
        </button>
        <Link
          href={`/dashboard/loads/${loadId}`}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </Link>
      </div>
    </form>
  )
}

function TruckerCheckbox({
  trucker,
  checked,
  disabled,
  onToggle,
  suspended,
}: {
  trucker: VisibilityTrucker
  checked: boolean
  disabled: boolean
  onToggle: () => void
  suspended?: boolean
}) {
  const inputId = `vis-trucker-${trucker.id}`
  return (
    <li>
      <label
        htmlFor={inputId}
        className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50 ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
      >
        <input
          id={inputId}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
          className="h-4 w-4 rounded border-slate-300 text-blue-900 focus:ring-blue-900"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-900">
              {trucker.full_name ?? 'Unnamed trucker'}
            </span>
            {suspended ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                suspended
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
            <span className="font-mono">{trucker.phone_e164}</span>
            <span>·</span>
            <span className="capitalize">{trucker.truck_type}</span>
          </div>
        </div>
      </label>
    </li>
  )
}
