'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { awardBidAction, placeManualBidAction } from '@/app/dashboard/loads/[id]/actions'
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
  message_text?: string | null
  trucker: {
    full_name: string | null
    phone_e164: string
    truck_type: TruckType
  } | null
}

const SELECT = `id, amount_paise, status, created_at, message_text,
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
  referencePricePaise?: number | null
  renderMode?: 'kpi' | 'table' | 'all'
}

export function BidsTableRealtime({ loadId, loadStatus, initialBids, referencePricePaise, renderMode = 'all' }: Props) {
  const [bids, setBids] = useState<BidRowData[]>(() => sortBids(initialBids))
  const { flashIds, flashRow } = useRowFlash(1000)
  const [supabase] = useState(() => createClient())
  const router = useRouter()

  const [confirmingBid, setConfirmingBid] = useState<BidRowData | null>(null)
  const [isAwarding, startAwarding] = useTransition()

  // Manual bid modal state
  const [showManualModal, setShowManualModal] = useState(false)
  const [manualPhone, setManualPhone] = useState('')
  const [manualName, setManualName] = useState('')
  const [manualAmountRupees, setManualAmountRupees] = useState('')
  const [isSubmittingManual, startSubmittingManual] = useTransition()

  // Bids table real-time search query
  const [searchQuery, setSearchQuery] = useState('')

  // Filtered bids for search
  const filteredBids = useMemo(() => {
    if (!searchQuery.trim()) return bids
    const q = searchQuery.toLowerCase().trim()
    return bids.filter((b) => {
      const name = b.trucker?.full_name?.toLowerCase() ?? ''
      const phone = b.trucker?.phone_e164 ?? ''
      const truck = b.trucker?.truck_type?.toLowerCase() ?? ''
      const amount = (b.amount_paise / 100).toString()
      const status = b.status.toLowerCase()
      return (
        name.includes(q) ||
        phone.includes(q) ||
        truck.includes(q) ||
        amount.includes(q) ||
        status.includes(q)
      )
    })
  }, [bids, searchQuery])

  // Resync when the SSR snapshot changes (parent re-renders, e.g. after
  // router.refresh()).
  useEffect(() => {
    setBids(sortBids(initialBids))
  }, [initialBids])

  // Realtime: subscribe ONCE per loadId & renderMode.
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
      .channel(`bids-load-${loadId}-${renderMode}`)
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
        console.log(`[bids-load-${loadId}-${renderMode} channel]`, status)
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, loadId, renderMode, flashRow])

  const ranks = useMemo(() => computeBidRanks(bids), [bids])

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

  function handleSubmitManualBid(e: React.FormEvent) {
    e.preventDefault()
    if (!manualPhone.trim() || !manualAmountRupees.trim()) {
      toast.error('Please enter trucker phone number and bid amount.')
      return
    }

    const rupees = parseFloat(manualAmountRupees)
    if (isNaN(rupees) || rupees <= 0) {
      toast.error('Please enter a valid bid amount in Rupees.')
      return
    }

    const amountPaise = Math.round(rupees * 100)

    startSubmittingManual(async () => {
      const res = await placeManualBidAction(
        loadId,
        manualPhone,
        amountPaise,
        manualName
      )
      if (res.success) {
        toast.success('Manual phone bid recorded successfully!')
        setShowManualModal(false)
        setManualPhone('')
        setManualName('')
        setManualAmountRupees('')
      } else {
        toast.error(res.error)
      }
    })
  }

  // Expanded Analytics & Metrics Calculation
  const activeBids = bids.filter((b) => b.status === 'active' || b.status === 'won')
  const lowestBid = activeBids.length > 0
    ? Math.min(...activeBids.map((b) => b.amount_paise))
    : null
  const highestBid = activeBids.length > 0
    ? Math.max(...activeBids.map((b) => b.amount_paise))
    : null
  const averageBid = activeBids.length > 0
    ? Math.round(activeBids.reduce((sum, b) => sum + b.amount_paise, 0) / activeBids.length)
    : null
  const bidSpread = (highestBid && lowestBid) ? highestBid - lowestBid : 0

  // Target Reference Savings Calculation
  let savingsPaise: number | null = null
  let savingsPercent: number | null = null
  if (referencePricePaise && lowestBid) {
    savingsPaise = referencePricePaise - lowestBid
    savingsPercent = Math.round((savingsPaise / referencePricePaise) * 1000) / 10
  }

  // Find L1, L2, L3 bids
  const l1Bid = activeBids.find((b) => ranks.get(b.id) === 1)
  const l2Bid = activeBids.find((b) => ranks.get(b.id) === 2)
  const l3Bid = activeBids.find((b) => ranks.get(b.id) === 3)

  // Maximum value for scaling visual bar charts
  const maxChartVal = Math.max(
    referencePricePaise ?? 0,
    highestBid ?? 0,
    averageBid ?? 0,
    1
  )

  return (
    <section className="space-y-6">
      {/* RepVue / Stripe Inspired Analytics Dashboard Panel (Matching test ui.webp) */}
      {(renderMode === 'all' || renderMode === 'kpi') && bids.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-center">
            {/* Left Column: Stat Callouts using ONLY Green, Orange, and Red */}
            <div className="space-y-5 lg:col-span-5 border-b lg:border-b-0 lg:border-r border-slate-100 pb-5 lg:pb-0 lg:pr-6">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Lowest Active Bid (L1)
                </span>
                <div className="mt-1 flex items-baseline gap-3">
                  <span className="text-3xl font-bold tracking-tight text-slate-900 tabular-nums">
                    {lowestBid ? formatINR(lowestBid) : '—'}
                  </span>
                  {savingsPercent !== null && (
                    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium border ${
                      savingsPercent >= 0
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-red-50 text-red-700 border-red-200'
                    }`}>
                      {savingsPercent >= 0 ? `${savingsPercent}% below target` : `${Math.abs(savingsPercent)}% above target`}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-xs text-slate-600 font-normal leading-relaxed">
                  Lowest bid so far is {lowestBid ? formatINR(lowestBid) : '—'} by {l1Bid?.trucker?.full_name || 'Driver'}.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-2.5 pt-2">
                {/* Green: L1 Best */}
                <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                  <span className="font-normal">Lowest Bid (L1)</span>
                  <span className="font-medium font-mono">{lowestBid ? formatINR(lowestBid) : '—'}</span>
                </div>

                {/* Orange: Average Market */}
                <div className="flex items-center justify-between rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-900">
                  <span className="font-normal">Average Market Rate</span>
                  <span className="font-medium font-mono">{averageBid ? formatINR(averageBid) : '—'}</span>
                </div>

                {/* Red: Highest Rate */}
                <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
                  <span className="font-normal">Highest Bid Rate</span>
                  <span className="font-medium font-mono">{highestBid ? formatINR(highestBid) : '—'}</span>
                </div>
              </div>
            </div>

            {/* Right Column: Sleek Line Chart matching test ui.webp */}
            <div className="space-y-3 lg:col-span-7">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">
                  Rate Trend Progression
                </span>
                {referencePricePaise && (
                  <span className="text-xs text-slate-400 font-normal">
                    Target: <span className="font-mono text-slate-700">{formatINR(referencePricePaise)}</span>
                  </span>
                )}
              </div>

              {bids.length > 0 ? (
                <div className="relative rounded-xl border border-slate-100 bg-slate-50/50 p-4">
                  {(() => {
                    const chronoBids = [...bids].sort(
                      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
                    )
                    const amounts = chronoBids.map((b) => b.amount_paise)
                    if (referencePricePaise) amounts.push(referencePricePaise)
                    const maxVal = Math.max(...amounts, 1)
                    const minVal = Math.min(...amounts) * 0.88

                    const svgWidth = 500
                    const svgHeight = 150
                    const padding = 25

                    const points = chronoBids.map((b, i) => {
                      const x = padding + (i / Math.max(1, chronoBids.length - 1)) * (svgWidth - padding * 2)
                      const range = maxVal - minVal || 1
                      const y = svgHeight - padding - ((b.amount_paise - minVal) / range) * (svgHeight - padding * 2)
                      return { x, y, bid: b }
                    })

                    const polylineStr = points.map((p) => `${p.x},${p.y}`).join(' ')
                    const areaStr = `${points[0]?.x},${svgHeight - padding} ${polylineStr} ${points[points.length - 1]?.x},${svgHeight - padding}`

                    return (
                      <svg
                        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
                        className="w-full h-auto max-h-44 overflow-visible"
                      >
                        <defs>
                          <linearGradient id="smoothGreenArea" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
                            <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                          </linearGradient>
                        </defs>

                        {/* Target Reference Line */}
                        {referencePricePaise && (
                          <g>
                            {(() => {
                              const refY = svgHeight - padding - ((referencePricePaise - minVal) / (maxVal - minVal || 1)) * (svgHeight - padding * 2)
                              return (
                                <line
                                  x1={padding}
                                  y1={refY}
                                  x2={svgWidth - padding}
                                  y2={refY}
                                  stroke="#cbd5e1"
                                  strokeDasharray="3 3"
                                  strokeWidth="1.5"
                                />
                              )
                            })()}
                          </g>
                        )}

                        {/* Area fill */}
                        {points.length > 1 && (
                          <polygon points={areaStr} fill="url(#smoothGreenArea)" />
                        )}

                        {/* Smooth Emerald Line */}
                        {points.length > 1 && (
                          <polyline
                            fill="none"
                            stroke="#10b981"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            points={polylineStr}
                          />
                        )}

                        {/* Points matching test ui.webp */}
                        {points.map((p, idx) => (
                          <g key={p.bid.id}>
                            <circle
                              cx={p.x}
                              cy={p.y}
                              r="4.5"
                              fill="#10b981"
                              stroke="#ffffff"
                              strokeWidth="2"
                            />
                            <text
                              x={p.x}
                              y={p.y - 8}
                              textAnchor="middle"
                              fill="#334155"
                              fontSize="9"
                              fontWeight="500"
                            >
                              {formatINR(p.bid.amount_paise)}
                            </text>
                            <text
                              x={p.x}
                              y={svgHeight - 6}
                              textAnchor="middle"
                              fill="#94a3b8"
                              fontSize="9"
                            >
                              Bid #{idx + 1}
                            </text>
                          </g>
                        ))}
                      </svg>
                    )
                  })()}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {(renderMode === 'all' || renderMode === 'table') && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
            <h3 className="text-lg font-semibold tracking-tight text-slate-900">
              Bids ({bids.length})
            </h3>

            <div className="flex flex-wrap items-center gap-3">
              {/* Real-time Bids Search Input */}
              {bids.length > 0 && (
                <div className="relative min-w-[240px]">
                  <svg
                    className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400"
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
                  <input
                    type="text"
                    placeholder="Search bids by trucker, phone, truck..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full rounded-md border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 focus:border-blue-900 focus:outline-none focus:ring-1 focus:ring-blue-900"
                  />
                </div>
              )}

              {loadStatus === 'open' && (
                <button
                  type="button"
                  onClick={() => setShowManualModal(true)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
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
                      d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                    />
                  </svg>
                  + Record Phone Bid
                </button>
              )}
            </div>
          </div>

          {bids.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
              No bids submitted yet for this load.
            </div>
          ) : filteredBids.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
              No bids match your search query &quot;{searchQuery}&quot;.
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-600">
                  <tr>
                    <th className="px-4 py-3 text-left">Rank</th>
                    <th className="px-4 py-3 text-left">Trucker</th>
                    <th className="px-4 py-3 text-left">Truck</th>
                    <th className="px-4 py-3 text-right">Bid</th>
                    <th className="px-4 py-3 text-left">Placed Via</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-left">Submitted</th>
                    {canAward && <th className="px-4 py-3 text-right">Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredBids.map((bid) => {
                    const rank = ranks.get(bid.id)
                    const flashing = flashIds.has(bid.id)
                    const isManualCall = bid.message_text?.toLowerCase().includes('manual') || bid.message_text?.toLowerCase().includes('operator')
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
                        <td className="px-4 py-3 whitespace-nowrap">
                          {isManualCall ? (
                            <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 border border-amber-200">
                              <svg className="h-3.5 w-3.5 text-amber-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                              </svg>
                              Phone Call
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 border border-emerald-200">
                              <svg className="h-3.5 w-3.5 text-emerald-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                              </svg>
                              WhatsApp / Web
                            </span>
                          )}
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
                                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:border-emerald-500 hover:bg-emerald-50 hover:text-emerald-800 transition-colors"
                              >
                                <svg
                                  className="h-3.5 w-3.5 text-emerald-600"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M5 13l4 4L19 7"
                                  />
                                </svg>
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
        </div>
      )}

      {/* Record Phone Bid Modal */}
      {showManualModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="manual-bid-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => {
            if (!isSubmittingManual) setShowManualModal(false)
          }}
        >
          <div
            className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              id="manual-bid-modal-title"
              className="text-lg font-semibold tracking-tight text-slate-900"
            >
              Record Phone Bid
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Manually place a bid on behalf of a trucker over the phone.
            </p>

            <form onSubmit={handleSubmitManualBid} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Trucker Phone Number *
                </label>
                <input
                  type="text"
                  placeholder="e.g. 9876543210 or +919876543210"
                  value={manualPhone}
                  onChange={(e) => setManualPhone(e.target.value)}
                  required
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-900 focus:outline-none focus:ring-1 focus:ring-blue-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Trucker / Driver Name (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Ramesh Kumar"
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-900 focus:outline-none focus:ring-1 focus:ring-blue-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">
                  Bid Amount (₹ Rupees) *
                </label>
                <div className="relative mt-1">
                  <span className="absolute left-3 top-2 text-sm font-medium text-slate-500">
                    ₹
                  </span>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    placeholder="e.g. 45000"
                    value={manualAmountRupees}
                    onChange={(e) => setManualAmountRupees(e.target.value)}
                    required
                    className="w-full rounded-md border border-slate-300 py-2 pl-7 pr-3 text-sm text-slate-900 focus:border-blue-900 focus:outline-none focus:ring-1 focus:ring-blue-900"
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowManualModal(false)}
                  disabled={isSubmittingManual}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingManual}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
                >
                  {isSubmittingManual ? 'Saving…' : 'Submit Bid'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isAwarding ? 'Awarding…' : 'Confirm award'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
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
      <span className="inline-block rounded-md bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white">
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
