'use client'

import { useEffect, useState } from 'react'

export function AuctionCountdown({
  pickupDeadline,
  bids,
  currentTruckerId,
}: {
  pickupDeadline: string
  bids: Array<{
    id: string
    amount_paise: number
    status: string
    trucker_id: string
    created_at: string
  }>
  currentTruckerId: string
}) {
  const [timeLeft, setTimeLeft] = useState<{
    hours: number
    minutes: number
    seconds: number
    isExpired: boolean
  }>({ hours: 0, minutes: 0, seconds: 0, isExpired: false })

  useEffect(() => {
    function calculateTime() {
      const deadline = new Date(pickupDeadline).getTime()
      const now = Date.now()
      const diff = deadline - now

      if (diff <= 0) {
        setTimeLeft({ hours: 0, minutes: 0, seconds: 0, isExpired: true })
        return
      }

      const hours = Math.floor(diff / (1000 * 60 * 60))
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
      const seconds = Math.floor((diff % (1000 * 60)) / 1000)

      setTimeLeft({ hours, minutes, seconds, isExpired: false })
    }

    calculateTime()
    const timer = setInterval(calculateTime, 1000)
    return () => clearInterval(timer)
  }, [pickupDeadline])

  // Get active bids sorted by lowest amount
  const activeBids = bids
    .filter((b) => b.status === 'active' || b.status === 'won')
    .sort((a, b) => a.amount_paise - b.amount_paise)

  const top3 = activeBids.slice(0, 3)
  const isEndingSoon = !timeLeft.isExpired && timeLeft.hours === 0 && timeLeft.minutes < 30

  return (
    <div className="space-y-4">
      {/* Live Countdown Banner */}
      <div className={`rounded-xl border p-4 sm:p-5 transition-all ${
        timeLeft.isExpired
          ? 'border-slate-200 bg-slate-100 text-slate-700'
          : isEndingSoon
          ? 'border-amber-300 bg-amber-50 text-amber-900 animate-pulse'
          : 'border-blue-200 bg-blue-50/80 text-blue-950'
      }`}>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-800">
              <span className="h-2 w-2 rounded-full bg-blue-600 animate-ping" />
              Live Auction Status
            </span>
            <p className="mt-1 text-sm font-medium">
              {timeLeft.isExpired
                ? 'Auction Bidding Closed — Processing Results'
                : isEndingSoon
                ? '⚡ Hurry! Auction closes soon — submit your competitive bid now.'
                : 'Place your lowest competitive bid before time expires.'}
            </p>
          </div>

          <div className="flex items-center gap-2 font-mono text-lg font-extrabold sm:text-2xl text-slate-900 bg-white/90 px-4 py-2 rounded-lg border border-slate-200 shadow-sm">
            {timeLeft.isExpired ? (
              <span className="text-slate-500 text-sm font-sans uppercase">CLOSED</span>
            ) : (
              <>
                <div className="text-center">
                  <span>{String(timeLeft.hours).padStart(2, '0')}</span>
                  <span className="block text-[9px] font-sans font-normal text-slate-500 uppercase">HRS</span>
                </div>
                <span>:</span>
                <div className="text-center">
                  <span>{String(timeLeft.minutes).padStart(2, '0')}</span>
                  <span className="block text-[9px] font-sans font-normal text-slate-500 uppercase">MIN</span>
                </div>
                <span>:</span>
                <div className="text-center text-blue-700">
                  <span>{String(timeLeft.seconds).padStart(2, '0')}</span>
                  <span className="block text-[9px] font-sans font-normal text-slate-500 uppercase">SEC</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Top 3 Bidders Leaderboard */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-3">
          <div className="flex items-center gap-2">
            <span className="text-base">🏆</span>
            <h3 className="text-sm font-bold text-slate-900">Current Top Bids</h3>
          </div>
          <span className="text-xs text-slate-500 font-medium">
            {activeBids.length} {activeBids.length === 1 ? 'bid' : 'bids'} placed
          </span>
        </div>

        {top3.length === 0 ? (
          <p className="text-xs text-slate-500 py-3 text-center">
            No bids placed yet. Be the first to bid on this load!
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {top3.map((bid, index) => {
              const isMine = bid.trucker_id === currentTruckerId
              const amountRupees = Math.round(bid.amount_paise / 100)
              const medal = index === 0 ? '🥇 1st Lowest' : index === 1 ? '🥈 2nd Lowest' : '🥉 3rd Lowest'
              const badgeBg = index === 0 ? 'bg-amber-50 text-amber-900 border-amber-200' : index === 1 ? 'bg-slate-50 text-slate-800 border-slate-200' : 'bg-orange-50 text-orange-900 border-orange-200'

              return (
                <div
                  key={bid.id}
                  className={`rounded-lg border p-3 flex flex-col justify-between transition-all ${badgeBg} ${
                    isMine ? 'ring-2 ring-blue-600 font-semibold' : ''
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span>{medal}</span>
                    {isMine && (
                      <span className="rounded-full bg-blue-600 text-white px-2 py-0.5 text-[10px] font-bold">
                        YOUR BID
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-xl font-extrabold tracking-tight">
                    ₹{amountRupees.toLocaleString('en-IN')}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
