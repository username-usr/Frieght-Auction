'use client'

import { useEffect, useState } from 'react'
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
  declined: 'bg-red-100 text-red-900',
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
  // 'awarded' groups the three sub-states so a load moving from awarded →
  // accepted/declined stays in the same tab the operator was looking at.
  const visibleLoads =
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
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
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
  )
}
