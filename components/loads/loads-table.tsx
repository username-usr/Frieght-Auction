'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  formatAbsoluteIST,
  formatRelativeTime,
  summarizeItemsByProduct,
} from '@/lib/format'
import { useRowFlash } from '@/lib/use-row-flash'
import type { LoadStatus, TruckType } from '@/lib/types'

export type LoadListRow = {
  id: string
  reference_code: string
  origin_address: string
  destination_address: string
  truck_type_required: TruckType
  pickup_deadline: string
  status: LoadStatus
  created_at: string
  posted_by_name: string
  bid_count: number
  items_summary: string
}

// Embedded load_items in the realtime refetch is a single SQL join, so the
// summary stays current when loads change (e.g. a new INSERT). Per Part D,
// items don't get their own realtime channel — a page refresh shows item
// edits made after the load was first posted.
const SELECT = `id, reference_code, origin_address, destination_address, truck_type_required,
  pickup_deadline, status, created_at,
  posted_by_operator:operators!loads_posted_by_fkey(full_name),
  bids(count),
  load_items(position, product:product_names!product_name_id(name))`

type LoadsSelectRow = {
  id: string
  reference_code: string
  origin_address: string
  destination_address: string
  truck_type_required: TruckType
  pickup_deadline: string
  status: LoadStatus
  created_at: string
  posted_by_operator: { full_name: string } | null
  bids: { count: number }[]
  load_items: { position: number; product: { name: string } | null }[]
}

function normalize(row: LoadsSelectRow): LoadListRow {
  const items = [...row.load_items].sort((a, b) => a.position - b.position)
  return {
    id: row.id,
    reference_code: row.reference_code,
    origin_address: row.origin_address,
    destination_address: row.destination_address,
    truck_type_required: row.truck_type_required,
    pickup_deadline: row.pickup_deadline,
    status: row.status,
    created_at: row.created_at,
    posted_by_name: row.posted_by_operator?.full_name ?? '—',
    bid_count: row.bids[0]?.count ?? 0,
    items_summary: summarizeItemsByProduct(
      items.map((i) => i.product?.name ?? null)
    ),
  }
}

const STATUS_BADGE: Record<LoadStatus, string> = {
  open: 'bg-blue-100 text-blue-900',
  awarded: 'bg-amber-100 text-amber-900',
  accepted: 'bg-green-100 text-green-900',
  declined: 'bg-rose-100 text-rose-900',
  cancelled: 'bg-slate-200 text-slate-700',
  completed: 'bg-slate-200 text-slate-700',
}

// Human-friendly relabel for the three Awarded sub-states. The DB status
// stays the source of truth; this map only affects what the operator reads.
const STATUS_LABEL: Record<LoadStatus, string> = {
  open: 'open',
  awarded: 'awaiting',
  accepted: 'accepted',
  declined: 'declined',
  cancelled: 'cancelled',
  completed: 'completed',
}

// Left-border tint per status. Used to color-code rows inside the Awarded
// section without introducing a new section header.
const ROW_TINT: Record<LoadStatus, string> = {
  open: '',
  awarded: 'border-l-4 border-amber-400',
  accepted: 'border-l-4 border-green-500',
  declined: 'border-l-4 border-red-400',
  cancelled: '',
  completed: '',
}

type Props = {
  initialLoads: LoadListRow[]
  statusFilter: LoadStatus | 'all'
}

type TimeField = 'created_at' | 'pickup_deadline'
type TimePreset =
  | 'all'
  | 'today'
  | 'yesterday'
  | 'last_7_days'
  | 'last_30_days'
  | 'next_7_days'
  | 'next_30_days'
  | 'custom'

const IST_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function formatISTDateKey(value: Date | string | number): string {
  const parts = IST_DATE.formatToParts(new Date(value))
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  return `${year}-${month}-${day}`
}

function dateKeyAtDayOffset(now: number, offset: number): string {
  return formatISTDateKey(now + offset * 24 * 60 * 60 * 1000)
}

function matchesTimeFilter(
  load: LoadListRow,
  field: TimeField,
  preset: TimePreset,
  customFrom: string,
  customTo: string,
  now: number
): boolean {
  if (preset === 'all') return true

  const loadDate = formatISTDateKey(load[field])
  const today = dateKeyAtDayOffset(now, 0)

  if (preset === 'today') return loadDate === today
  if (preset === 'yesterday') {
    return loadDate === dateKeyAtDayOffset(now, -1)
  }
  if (preset === 'last_7_days') {
    return loadDate >= dateKeyAtDayOffset(now, -6) && loadDate <= today
  }
  if (preset === 'last_30_days') {
    return loadDate >= dateKeyAtDayOffset(now, -29) && loadDate <= today
  }
  if (preset === 'next_7_days') {
    return loadDate >= today && loadDate <= dateKeyAtDayOffset(now, 6)
  }
  if (preset === 'next_30_days') {
    return loadDate >= today && loadDate <= dateKeyAtDayOffset(now, 29)
  }

  return (
    (!customFrom || loadDate >= customFrom) &&
    (!customTo || loadDate <= customTo)
  )
}

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function LoadsTable({ initialLoads, statusFilter }: Props) {
  const router = useRouter()
  const [loads, setLoads] = useState<LoadListRow[]>(initialLoads)
  const { flashIds, flashRow } = useRowFlash(1000)

  // Lazy init so createClient() runs exactly once per mount.
  const [supabase] = useState(() => createClient())

  // Resync when the SSR snapshot changes (filter tab switch is a real
  // navigation). Realtime updates that happened before this point are already
  // in the new snapshot, so blowing away client state is safe.
  useEffect(() => {
    // Intentional prop-to-state resync: local state also contains realtime rows.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoads(initialLoads)
  }, [initialLoads])

  // Realtime: subscribe ONCE on mount and merge events directly into state.
  // We deliberately do not use router.refresh() here — Next.js's Router
  // Cache dedupes rapid refresh() calls, which made only the first event of
  // a burst show up. Maintaining the row list ourselves avoids that entirely.
  useEffect(() => {
    async function fetchLoad(id: string): Promise<LoadListRow | null> {
      const { data } = await supabase
        .from('loads')
        .select(SELECT)
        .eq('id', id)
        .maybeSingle()
      if (!data) return null
      return normalize(data as unknown as LoadsSelectRow)
    }

    async function upsertById(id: string) {
      const load = await fetchLoad(id)
      if (!load) return
      setLoads((prev) => {
        const idx = prev.findIndex((l) => l.id === load.id)
        if (idx === -1) {
          return [load, ...prev].sort(
            (a, b) =>
              new Date(b.created_at).getTime() -
              new Date(a.created_at).getTime()
          )
        }
        const next = [...prev]
        next[idx] = load
        return next
      })
      flashRow(load.id)
    }

    const channel = supabase
      .channel('loads-list')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'loads' },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const id = (payload.old as { id?: string }).id
            if (!id) return
            setLoads((prev) => prev.filter((l) => l.id !== id))
            return
          }
          const id = (payload.new as { id?: string }).id
          if (id) void upsertById(id)
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'bids' },
        (payload) => {
          const loadId = (payload.new as { load_id?: string }).load_id
          if (loadId) void upsertById(loadId)
        }
      )
      .subscribe((status) => {
        // Surfaces SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT / CLOSED so a dead
        // channel is visible without poking around in the WS frames panel.
        console.log('[loads-list channel]', status)
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, flashRow])

  const [searchQuery, setSearchQuery] = useState('')
  const [timeField, setTimeField] = useState<TimeField>('created_at')
  const [timePreset, setTimePreset] = useState<TimePreset>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [timeReference, setTimeReference] = useState(() => Date.now())

  // Status filter is applied client-side so the realtime subscription
  // doesn't have to be torn down and re-created when the user switches tabs.
  // 'awarded' groups the three sub-states so a load moving from awarded →
  // accepted/declined stays in the same tab the operator was looking at.
  const statusFilteredLoads =
    statusFilter === 'all'
      ? loads
      : statusFilter === 'awarded'
        ? loads.filter(
            (l) =>
              l.status === 'awarded' ||
              l.status === 'accepted' ||
              l.status === 'declined'
          )
        : loads.filter((l) => l.status === statusFilter)

  const visibleLoads = useMemo(() => {
    const q = searchQuery.toLowerCase().trim()

    return statusFilteredLoads.filter((load) => {
      if (
        !matchesTimeFilter(
          load,
          timeField,
          timePreset,
          customFrom,
          customTo,
          timeReference
        )
      ) {
        return false
      }

      if (!q) return true
      return (
        load.reference_code.toLowerCase().includes(q) ||
        load.origin_address.toLowerCase().includes(q) ||
        load.destination_address.toLowerCase().includes(q) ||
        load.items_summary.toLowerCase().includes(q) ||
        load.truck_type_required.toLowerCase().includes(q) ||
        load.posted_by_name.toLowerCase().includes(q)
      )
    })
  }, [
    statusFilteredLoads,
    searchQuery,
    timeField,
    timePreset,
    customFrom,
    customTo,
    timeReference,
  ])

  const hasTimeFilter =
    timePreset !== 'all' || customFrom !== '' || customTo !== ''

  function clearTimeFilter() {
    setTimePreset('all')
    setCustomFrom('')
    setCustomTo('')
  }

  function exportToCSV() {
    if (visibleLoads.length === 0) return
    const rangeName =
      timePreset === 'custom'
        ? `${customFrom || 'start'}_to_${customTo || 'end'}`
        : timePreset
    const headers = [
      'Reference Code',
      'Posted At',
      'Origin',
      'Destination',
      'Items',
      'Truck Type Required',
      'Pickup Deadline',
      'Status',
      'Bid Count',
      'Posted By',
    ]

    const rows = visibleLoads.map((l) => [
      l.reference_code,
      formatAbsoluteIST(l.created_at),
      l.origin_address,
      l.destination_address,
      l.items_summary,
      l.truck_type_required,
      formatAbsoluteIST(l.pickup_deadline),
      l.status,
      l.bid_count,
      l.posted_by_name,
    ])

    const csvContent = [headers, ...rows]
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n')
    const blob = new Blob([`\uFEFF${csvContent}`], {
      type: 'text/csv;charset=utf-8',
    })
    const downloadUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', downloadUrl)
    link.setAttribute(
      'download',
      `loads_export_${statusFilter}_${timeField}_${rangeName}_${formatISTDateKey(Date.now())}.csv`
    )
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(downloadUrl)
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-3 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-blue-600" />
          <h2 className="text-sm font-semibold text-slate-900">Time filter</h2>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[150px] flex-1 sm:max-w-48">
            <label
              htmlFor="time-field"
              className="mb-1 block text-xs font-medium text-slate-600"
            >
              Filter date by
            </label>
            <select
              id="time-field"
              value={timeField}
              onChange={(event) =>
                setTimeField(event.target.value as TimeField)
              }
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-900 focus:outline-none focus:ring-1 focus:ring-blue-900"
            >
              <option value="created_at">Posted at</option>
              <option value="pickup_deadline">Pickup deadline</option>
            </select>
          </div>

          <div className="min-w-[150px] flex-1 sm:max-w-52">
            <label
              htmlFor="time-preset"
              className="mb-1 block text-xs font-medium text-slate-600"
            >
              Time period
            </label>
            <select
              id="time-preset"
              value={timePreset}
              onChange={(event) => {
                const preset = event.target.value as TimePreset
                setTimePreset(preset)
                setTimeReference(Date.now())
                if (preset !== 'custom') {
                  setCustomFrom('')
                  setCustomTo('')
                }
              }}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-blue-900 focus:outline-none focus:ring-1 focus:ring-blue-900"
            >
              <option value="all">All time</option>
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="last_7_days">Last 7 days</option>
              <option value="last_30_days">Last 30 days</option>
              <option value="next_7_days">Next 7 days</option>
              <option value="next_30_days">Next 30 days</option>
              <option value="custom">Custom range</option>
            </select>
          </div>

          {timePreset === 'custom' && (
            <>
              <div className="min-w-[150px] flex-1 sm:max-w-48">
                <label
                  htmlFor="time-from"
                  className="mb-1 block text-xs font-medium text-slate-600"
                >
                  From
                </label>
                <input
                  id="time-from"
                  type="date"
                  value={customFrom}
                  max={customTo || undefined}
                  onChange={(event) => setCustomFrom(event.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-900 focus:outline-none focus:ring-1 focus:ring-blue-900"
                />
              </div>
              <div className="min-w-[150px] flex-1 sm:max-w-48">
                <label
                  htmlFor="time-to"
                  className="mb-1 block text-xs font-medium text-slate-600"
                >
                  To
                </label>
                <input
                  id="time-to"
                  type="date"
                  value={customTo}
                  min={customFrom || undefined}
                  onChange={(event) => setCustomTo(event.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-900 focus:outline-none focus:ring-1 focus:ring-blue-900"
                />
              </div>
            </>
          )}

          {hasTimeFilter && (
            <button
              type="button"
              onClick={clearTimeFilter}
              className="rounded-md px-3 py-2 text-sm font-medium text-blue-900 hover:bg-blue-50"
            >
              Clear time filter
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Date boundaries use Indian Standard Time (IST).
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-[240px] flex-1 max-w-md">
          <input
            type="text"
            placeholder="Search ref, location, items, trucker, operator..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2.5 pl-9 text-sm text-slate-900 placeholder-slate-400 shadow-sm focus:border-blue-900 focus:outline-none focus:ring-1 focus:ring-blue-900"
          />
          <svg
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-500 hover:text-slate-900"
            >
              Clear
            </button>
          )}
        </div>

        <button
          onClick={exportToCSV}
          disabled={visibleLoads.length === 0}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 shadow-sm hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50 sm:w-auto"
        >
          <svg
            className="h-3.5 w-3.5 text-slate-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          Export CSV ({visibleLoads.length})
        </button>
      </div>

      {visibleLoads.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-12 text-center text-sm text-slate-600">
          {searchQuery || hasTimeFilter ? (
            <div className="space-y-2">
              <p>No loads match the current filters.</p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('')
                  clearTimeFilter()
                }}
                className="font-medium text-blue-900 hover:underline"
              >
                Clear search and time filters
              </button>
            </div>
          ) : statusFilter === 'open' ? (
            "No open loads yet. Click 'New load' to post one."
          ) : (
            `No ${statusFilter === 'all' ? '' : statusFilter} loads.`
          )}
        </div>
      ) : (
        <>
          <ul className="space-y-3 sm:hidden">
            {visibleLoads.map((load) => {
              const flashing = flashIds.has(load.id)
              return (
                <li key={load.id}>
                  <button
                    type="button"
                    onClick={() => router.push(`/dashboard/loads/${load.id}`)}
                    className={`w-full rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm ${
                      flashing ? 'bg-blue-100' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-xs font-semibold text-blue-800">
                          {load.reference_code}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          Posted {formatRelativeTime(load.created_at)}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${STATUS_BADGE[load.status]}`}
                      >
                        {STATUS_LABEL[load.status]}
                      </span>
                    </div>

                    <div className="mt-4 space-y-1">
                      <p className="font-semibold text-slate-900">
                        {load.origin_address}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-blue-700">
                        <span className="h-px w-5 bg-blue-300" />
                        <span aria-hidden="true">↓</span>
                      </div>
                      <p className="font-semibold text-slate-900">
                        {load.destination_address}
                      </p>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-xs">
                      <div>
                        <p className="text-slate-500">Pickup</p>
                        <p className="mt-1 font-medium text-slate-800">
                          {formatAbsoluteIST(load.pickup_deadline)}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-500">Truck · Bids</p>
                        <p className="mt-1 font-medium capitalize text-slate-800">
                          {load.truck_type_required} · {load.bid_count}
                        </p>
                      </div>
                    </div>
                    <p className="mt-3 truncate text-xs text-slate-600">
                      {load.items_summary}
                    </p>
                  </button>
                </li>
              )
            })}
          </ul>

          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm sm:block">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left">Ref</th>
                <th className="px-4 py-3 text-left">Posted</th>
                <th className="px-4 py-3 text-left">Origin → Destination</th>
                <th className="px-4 py-3 text-left">Items</th>
                <th className="px-4 py-3 text-left">Truck</th>
                <th className="px-4 py-3 text-left">Pickup</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-right">Bids</th>
                <th className="px-4 py-3 text-left">Posted by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleLoads.map((load) => {
                const flashing = flashIds.has(load.id)
                return (
                  <tr
                    key={load.id}
                    onClick={() => router.push(`/dashboard/loads/${load.id}`)}
                    className={`cursor-pointer transition-colors duration-500 hover:bg-slate-50 ${ROW_TINT[load.status]} ${
                      flashing ? 'bg-blue-100' : ''
                    }`}
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-medium text-slate-900">
                      {load.reference_code}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                      {formatRelativeTime(load.created_at)}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {load.origin_address} → {load.destination_address}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {load.items_summary}
                    </td>
                    <td className="px-4 py-3 capitalize text-slate-700">
                      {load.truck_type_required}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                      {formatAbsoluteIST(load.pickup_deadline)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_BADGE[load.status]}`}
                      >
                        {STATUS_LABEL[load.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                      {load.bid_count}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {load.posted_by_name}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        </>
      )}
    </div>
  )
}

