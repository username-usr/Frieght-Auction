'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { formatAbsoluteIST, formatRelativeTime } from '@/lib/format'
import { useRowFlash } from '@/lib/use-row-flash'
import type { LoadStatus, TruckType } from '@/lib/types'

export type LoadListRow = {
  id: string
  origin_city: string
  destination_city: string
  truck_type_required: TruckType
  weight_kg: number
  pickup_deadline: string
  status: LoadStatus
  created_at: string
  posted_by_name: string
  bid_count: number
}

const SELECT = `id, origin_city, destination_city, truck_type_required, weight_kg,
  pickup_deadline, status, created_at,
  posted_by_operator:operators!loads_posted_by_fkey(full_name),
  bids(count)`

type LoadsSelectRow = {
  id: string
  origin_city: string
  destination_city: string
  truck_type_required: TruckType
  weight_kg: number
  pickup_deadline: string
  status: LoadStatus
  created_at: string
  posted_by_operator: { full_name: string } | null
  bids: { count: number }[]
}

function normalize(row: LoadsSelectRow): LoadListRow {
  return {
    id: row.id,
    origin_city: row.origin_city,
    destination_city: row.destination_city,
    truck_type_required: row.truck_type_required,
    weight_kg: row.weight_kg,
    pickup_deadline: row.pickup_deadline,
    status: row.status,
    created_at: row.created_at,
    posted_by_name: row.posted_by_operator?.full_name ?? '—',
    bid_count: row.bids[0]?.count ?? 0,
  }
}

const STATUS_BADGE: Record<LoadStatus, string> = {
  open: 'bg-blue-100 text-blue-900',
  awarded: 'bg-green-100 text-green-900',
  cancelled: 'bg-slate-200 text-slate-700',
  completed: 'bg-slate-200 text-slate-700',
}

type Props = {
  initialLoads: LoadListRow[]
  statusFilter: LoadStatus | 'all'
}

export function LoadsTable({ initialLoads, statusFilter }: Props) {
  const [loads, setLoads] = useState<LoadListRow[]>(initialLoads)
  const { flashIds, flashRow } = useRowFlash(1000)

  // Lazy init so createClient() runs exactly once per mount.
  const [supabase] = useState(() => createClient())

  // Resync when the SSR snapshot changes (filter tab switch is a real
  // navigation). Realtime updates that happened before this point are already
  // in the new snapshot, so blowing away client state is safe.
  useEffect(() => {
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
        // eslint-disable-next-line no-console
        console.log('[loads-list channel]', status)
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, flashRow])

  // Status filter is applied client-side so the realtime subscription
  // doesn't have to be torn down and re-created when the user switches tabs.
  const visibleLoads =
    statusFilter === 'all'
      ? loads
      : loads.filter((l) => l.status === statusFilter)

  if (visibleLoads.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-12 text-center text-sm text-slate-600">
        {statusFilter === 'open'
          ? "No open loads yet. Click 'New load' to post one."
          : `No ${statusFilter === 'all' ? '' : statusFilter} loads.`}
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-600">
          <tr>
            <th className="px-4 py-3 text-left">Posted</th>
            <th className="px-4 py-3 text-left">Origin → Destination</th>
            <th className="px-4 py-3 text-left">Truck</th>
            <th className="px-4 py-3 text-right">Weight</th>
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
                onClick={() => {
                  // eslint-disable-next-line no-console
                  console.log('row clicked:', load.id)
                }}
                className={`cursor-pointer transition-colors duration-500 hover:bg-slate-50 ${
                  flashing ? 'bg-blue-100' : ''
                }`}
              >
                <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                  {formatRelativeTime(load.created_at)}
                </td>
                <td className="px-4 py-3 font-medium text-slate-900">
                  {load.origin_city} → {load.destination_city}
                </td>
                <td className="px-4 py-3 capitalize text-slate-700">
                  {load.truck_type_required}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                  {load.weight_kg.toLocaleString('en-IN')} kg
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                  {formatAbsoluteIST(load.pickup_deadline)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_BADGE[load.status]}`}
                  >
                    {load.status}
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
  )
}
