import type { BidStatus } from '@/lib/types'

// JS equivalent of:
//   ORDER BY (status NOT IN ('active','won')), amount_paise ASC
//
// active+won come first as one group (sorted by amount asc), then
// lost+withdrawn as another group (also sorted by amount asc within).
//
// We sort here (not in supabase-js .order()) because supabase-js can't
// express the boolean grouping. The server fetch just orders by amount;
// this function applies the grouping. Both the SSR initial render and
// the realtime client updates funnel through here so the table can never
// disagree with itself.
export function sortBids<
  T extends { amount_paise: number; status: BidStatus },
>(bids: T[]): T[] {
  return [...bids].sort((a, b) => {
    const aGroup = a.status === 'active' || a.status === 'won' ? 0 : 1
    const bGroup = b.status === 'active' || b.status === 'won' ? 0 : 1
    if (aGroup !== bGroup) return aGroup - bGroup
    return a.amount_paise - b.amount_paise
  })
}

// Caller passes bids already in sortBids() order. Active+won get a 1-based
// rank; lost+withdrawn are absent from the map (caller renders "—" for those).
export function computeBidRanks<T extends { id: string; status: BidStatus }>(
  sortedBids: T[]
): Map<string, number> {
  const ranks = new Map<string, number>()
  let r = 0
  for (const bid of sortedBids) {
    if (bid.status === 'active' || bid.status === 'won') {
      r += 1
      ranks.set(bid.id, r)
    }
  }
  return ranks
}
