import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatINR, formatRelativeTime } from '@/lib/format'
import { requireTrucker } from '@/lib/trucker'

export const dynamic = 'force-dynamic'

type TruckerBidRow = {
  id: string
  amount_paise: number
  status: 'active' | 'won' | 'lost' | 'withdrawn' | 'declined'
  created_at: string
  load: {
    id: string
    reference_code: string
    origin_address: string
    destination_address: string
    truck_type_required: string
    pickup_deadline: string
    status: string
  } | null
}

export default async function TruckerBidsHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>
}) {
  const { filter = 'all' } = await searchParams
  const trucker = await requireTrucker()
  const admin = createAdminClient()

  // Fetch all bids placed by this trucker with parent load details
  const { data: bidsRaw } = await admin
    .from('bids')
    .select(
      `id, amount_paise, status, created_at,
       load:loads!bids_load_id_fkey(
         id, reference_code, origin_address, destination_address,
         truck_type_required, pickup_deadline, status
       )`
    )
    .eq('trucker_id', trucker.id)
    .order('created_at', { ascending: false })

  const allBids = (bidsRaw ?? []) as unknown as TruckerBidRow[]

  // KPI Metrics
  const totalBidsCount = allBids.length
  const activeBidsCount = allBids.filter((b) => b.status === 'active').length
  const wonBidsCount = allBids.filter((b) => b.status === 'won').length

  // Filter logic
  const filteredBids = allBids.filter((b) => {
    if (filter === 'active') return b.status === 'active'
    if (filter === 'won') return b.status === 'won'
    if (filter === 'closed') return b.status === 'lost' || b.status === 'withdrawn' || b.status === 'declined'
    return true
  })

  return (
    <div className="space-y-5">
      <nav className="text-xs">
        <Link
          href="/t/loads"
          className="text-slate-600 hover:text-slate-900 inline-flex items-center gap-1 font-medium"
        >
          ← Back to loads dashboard
        </Link>
      </nav>

      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            My Bids & Bidding History
          </h1>
          <p className="mt-0.5 text-xs text-slate-600">
            Track your active, won, and past submitted rate quotes.
          </p>
        </div>
      </header>

      {/* KPI Overview Cards */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Total Bids</p>
          <p className="mt-1 text-lg font-bold text-slate-900 font-mono">{totalBidsCount}</p>
        </div>
        <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 shadow-sm">
          <p className="text-[11px] font-medium text-blue-700 uppercase tracking-wider">Active Bids</p>
          <p className="mt-1 text-lg font-bold text-blue-900 font-mono">{activeBidsCount}</p>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 shadow-sm">
          <p className="text-[11px] font-medium text-emerald-700 uppercase tracking-wider">Won Loads</p>
          <p className="mt-1 text-lg font-bold text-emerald-900 font-mono">{wonBidsCount}</p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex border-b border-slate-200 text-xs font-medium">
        <Link
          href="/t/bids?filter=all"
          className={`pb-2 px-3 border-b-2 transition-colors ${
            filter === 'all'
              ? 'border-slate-900 text-slate-900 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          All ({totalBidsCount})
        </Link>
        <Link
          href="/t/bids?filter=active"
          className={`pb-2 px-3 border-b-2 transition-colors ${
            filter === 'active'
              ? 'border-blue-600 text-blue-600 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Active ({activeBidsCount})
        </Link>
        <Link
          href="/t/bids?filter=won"
          className={`pb-2 px-3 border-b-2 transition-colors ${
            filter === 'won'
              ? 'border-emerald-600 text-emerald-600 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Won ({wonBidsCount})
        </Link>
        <Link
          href="/t/bids?filter=closed"
          className={`pb-2 px-3 border-b-2 transition-colors ${
            filter === 'closed'
              ? 'border-slate-900 text-slate-900 font-semibold'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Closed
        </Link>
      </div>

      {/* Bids List */}
      {filteredBids.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 shadow-sm">
          No bids found in this category.
        </div>
      ) : (
        <ul className="space-y-3">
          {filteredBids.map((b) => {
            const load = b.load
            if (!load) return null

            const isWon = b.status === 'won'
            const isActive = b.status === 'active'
            const isLost = b.status === 'lost'

            return (
              <li key={b.id}>
                <Link
                  href={`/t/loads/${load.id}`}
                  className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300 transition"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-slate-900 text-sm">
                        {load.origin_address} → {load.destination_address}
                      </h3>
                      <p className="mt-0.5 text-xs text-slate-500 font-mono">
                        #{load.reference_code} • {load.truck_type_required} truck
                      </p>
                    </div>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider ${
                        isWon
                          ? 'bg-emerald-100 text-emerald-800'
                          : isActive
                          ? 'bg-blue-100 text-blue-800'
                          : isLost
                          ? 'bg-red-100 text-red-800'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {b.status}
                    </span>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2 text-xs">
                    <span className="text-slate-500">
                      Submitted {formatRelativeTime(b.created_at)}
                    </span>
                    <span className="font-bold text-slate-900 text-sm font-mono">
                      {formatINR(b.amount_paise)}
                    </span>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
