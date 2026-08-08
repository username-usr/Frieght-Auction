'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import type { LookupRow } from './actions'

type Props = {
  title: string
  placeholder: string
  rows: LookupRow[]
  addAction: (name: string) => Promise<LookupRow>
  deleteAction: (id: string) => Promise<void>
}

// Shared styling — matches the new-load form constants intentionally.
const FIELD =
  'block w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-500 focus:border-blue-900 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-900 disabled:cursor-not-allowed disabled:bg-slate-100'

export function AdminSection({
  title,
  placeholder,
  rows,
  addAction,
  deleteAction,
}: Props) {
  const [name, setName] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [isAdding, startAddTransition] = useTransition()
  const [, startDeleteTransition] = useTransition()

  function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    startAddTransition(async () => {
      try {
        await addAction(trimmed)
        setName('')
        toast.success(`Added "${trimmed}"`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to add.')
      }
    })
  }

  function handleDelete(id: string, label: string) {
    setPendingDeleteId(id)
    startDeleteTransition(async () => {
      try {
        await deleteAction(id)
        toast.success(`Removed "${label}"`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to remove.')
      } finally {
        setPendingDeleteId(null)
      }
    })
  }

  const inputId = `admin-${title.replace(/\s+/g, '-').toLowerCase()}`

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-6 py-4">
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <p className="mt-0.5 text-xs text-slate-600">
          {rows.length} active {rows.length === 1 ? 'entry' : 'entries'}
        </p>
      </div>
      <div className="space-y-4 p-6">
        <form onSubmit={handleAdd} className="flex items-start gap-2">
          <div className="flex-1">
            <label htmlFor={inputId} className="sr-only">
              {title}
            </label>
            <input
              id={inputId}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={placeholder}
              disabled={isAdding}
              maxLength={100}
              className={FIELD}
            />
          </div>
          <button
            type="submit"
            disabled={isAdding || !name.trim()}
            className="shrink-0 rounded-md bg-blue-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isAdding ? 'Adding…' : 'Add'}
          </button>
        </form>

        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">No entries.</p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
            {rows.map((row) => {
              const isPending = pendingDeleteId === row.id
              return (
                <li
                  key={row.id}
                  className="flex items-center justify-between px-3 py-2"
                >
                  <span className="text-sm text-slate-900">{row.name}</span>
                  <button
                    type="button"
                    onClick={() => handleDelete(row.id, row.name)}
                    disabled={isPending}
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isPending ? 'Removing…' : 'Remove'}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
