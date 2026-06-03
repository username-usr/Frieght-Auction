'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { awardBidAction } from '@/app/dashboard/loads/[id]/actions'
import { createClient } from '@/lib/supabase/client'
import { computeBidRanks, sortBids } from '@/lib/bids-sort'
import { formatINR, formatRelativeTime } from '@/lib/format'
import { useRowFlash } from '@/lib/use-row-flash'
import type { BidStatus, LoadStatus, TruckType } from '@/lib/types'

export type BidRowData = {
  id: string
  amount_paise: number
  status: BidStatus
  created_at: string
  trucker: {
    full_name: string | null
    phone_e164: string
    truck_type: TruckType
  } | null
}

const SELECT = `id, amount_paise, status, created_at,
  trucker:truckers!bids_trucker_id_fkey(full_name, phone_e164, truck_type)`

const STATUS_BADGE: Record<BidStatus, string> = {
  active: 'bg-blue-100 text-blue-900',
  won: 'bg-green-100 text-green-900',
  lost: 'bg-slate-200 text-slate-700',
  withdrawn: 'bg-slate-200 text-slate-700',
  declined: 'bg-red-100 text-red-900',
}

type Props = {
  loadId: string
  loadStatus: LoadStatus
  initialBids: BidRowData[]
}

export function BidsTableRealtime({ loadId, loadStatus, initialBids }: Props) {
  const [bids, setBids] = useState<BidRowData[]>(() => sortBids(initialBids))
  const { flashIds, flashRow } = useRowFlash(1000)
  const [supabase] = useState(() => createClient())
  const router = useRouter()

  const [confirmingBid, setConfirmingBid] = useState<BidRowData | null>(null)
  const [isAwarding, startAwarding] = useTransition()

  // Resync when the SSR snapshot changes (parent re-renders, e.g. after
  // router.refresh()).
  useEffect(() => {
    setBids(sortBids(initialBids))
  }, [initialBids])

  // Realtime: subscribe ONCE per loadId. See loads-table.tsx for the lesson
  // about not using router.refresh() as the primary update path.
  useEffect(() => {
    async function fetchBid(bidId: string): Promise<BidRowData | null> {
      const { data } = await supabase
        .from('bids')
        .select(SELECT)
        .eq('id', bidId)
        .maybeSingle()
      return (data ?? null) as unknown as BidRowData | null
    }

    async function upsertBid(bidId: string) {
      const bid = await fetchBid(bidId)
      if (!bid) return
      setBids((prev) => {
        const idx = prev.findIndex((b) => b.id === bid.id)
        const merged =
          idx === -1
            ? [...prev, bid]
            : prev.map((b) => (b.id === bid.id ? bid : b))
        return sortBids(merged)
      })
      flashRow(bid.id)
    }

    const channel = supabase
      .channel(`bids-load-${loadId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bids',
          filter: `load_id=eq.${loadId}`,
        },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const id = (payload.old as { id?: string }).id
            if (id) setBids((prev) => prev.filter((b) => b.id !== id))
            return
          }
          const id = (payload.new as { id?: string }).id
          if (id) void upsertBid(id)
        }
      )
      .subscribe((status) => {
        // eslint-disable-next-line no-console
        console.log(`[bids-load-${loadId} channel]`, status)
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, loadId, flashRow])

  const ranks = useMemo(() => computeBidRanks(bids), [bids])

  // Option B: derive load-awarded state from bids. award_bid() atomically
  // sets one bid to 'won' and the load to 'awarded' in the same transaction,
  // so a 'won' bid in our state means the load is awarded — even if the
  // loadStatus prop hasn't been refreshed yet. This avoids any cross-table
  // realtime coordination.
  const hasWinner = useMemo(
    () => bids.some((b) => b.status === 'won'),
    [bids]
  )
  const canAward = loadStatus === 'open' && !hasWinner

  function handleConfirmAward() {
    if (!confirmingBid) return
    const bid = confirmingBid
    startAwarding(async () => {
      const result = await awardBidAction(loadId, bid.id)
      if (result.success) {
        toast.success(
          `Awarded to ${bid.trucker?.full_name ?? 'trucker'}. Other bidders will be notified.`
        )
        setConfirmingBid(null)
        // SAFETY NET — the realtime subscription is the primary update path
        // and should have already flipped the bid statuses by the time the
        // toast renders. router.refresh() one second later catches the rare
        // case of a dropped publication event so the UI doesn't go stale.
        setTimeout(() => router.refresh(), 1000)
      } else {
        toast.error(result.error)
        const drift =
          result.errorCode === 'CONCURRENT_AWARD' ||
          result.errorCode === 'LOAD_NOT_OPEN' ||
          result.errorCode === 'BID_INACTIVE'
        if (drift) {
          setConfirmingBid(null)
          router.refresh()
        }
      }
    })
  }

  return (
    <>
      <section className="space-y-3">
        <h3 className="text-lg font-semibold tracking-tight text-slate-900">
          Bids ({bids.length})
        </h3>
        {bids.length === 0 ? (
          <p className="text-sm text-slate-500">No bids yet.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left">Rank</th>
                  <th className="px-4 py-3 text-left">Trucker</th>
                  <th className="px-4 py-3 text-left">Truck</th>
                  <th className="px-4 py-3 text-right">Bid</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Submitted</th>
                  {canAward && <th className="px-4 py-3 text-right">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {bids.map((bid) => {
                  const rank = ranks.get(bid.id)
                  const flashing = flashIds.has(bid.id)
                  return (
                    <tr
                      key={bid.id}
                      className={`transition-colors duration-500 ${flashing ? 'bg-blue-100' : ''}`}
                    >
                      <td className="px-4 py-3">{renderRank(rank)}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">
                          {bid.trucker?.full_name ?? '—'}
                        </div>
                        <div className="font-mono text-xs text-slate-500">
                          {bid.trucker?.phone_e164 ?? ''}
                        </div>
                      </td>
                      <td className="px-4 py-3 capitalize text-slate-700">
                        {bid.trucker?.truck_type ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-900">
                        {formatINR(bid.amount_paise)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_BADGE[bid.status]}`}
                        >
                          {bid.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                        {formatRelativeTime(bid.created_at)}
                      </td>
                      {canAward && (
                        <td className="px-4 py-3 text-right">
                          {bid.status === 'active' ? (
                            <button
                              type="button"
                              onClick={() => setConfirmingBid(bid)}
                              className="rounded-md bg-blue-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-blue-800"
                            >
                              Award
                            </button>
                          ) : null}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {confirmingBid ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="award-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => {
            if (!isAwarding) setConfirmingBid(null)
          }}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="award-dialog-title"
              className="text-lg font-semibold tracking-tight text-slate-900"
            >
              Award this load?
            </h3>
            <p className="mt-2 text-sm text-slate-700">
              Award this load to{' '}
              <span className="font-semibold">
                {confirmingBid.trucker?.full_name ?? 'this trucker'}
              </span>{' '}
              at{' '}
              <span className="font-semibold tabular-nums">
                {formatINR(confirmingBid.amount_paise)}
              </span>
              ? This locks the rate. Other bidders will be notified.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmingBid(null)}
                disabled={isAwarding}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmAward}
                disabled={isAwarding}
                className="rounded-md bg-blue-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isAwarding ? 'Awarding…' : 'Confirm award'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

// L1 = lowest active+won bid. L2/L3 step down through the existing palette.
// 4+ shows a plain number. lost/withdrawn rows have no rank → "—".
function renderRank(rank: number | undefined) {
  if (rank === undefined) {
    return <span className="text-sm text-slate-400">—</span>
  }
  if (rank === 1) {
    return (
      <span className="inline-block rounded-md bg-blue-900 px-2 py-0.5 text-xs font-semibold text-white">
        L1
      </span>
    )
  }
  if (rank === 2) {
    return (
      <span className="inline-block rounded-md bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-900">
        L2
      </span>
    )
  }
  if (rank === 3) {
    return (
      <span className="inline-block rounded-md bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">
        L3
      </span>
    )
  }
  return <span className="text-sm tabular-nums text-slate-600">{rank}</span>
}
