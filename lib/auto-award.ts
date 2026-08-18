import { createAdminClient } from '@/lib/supabase/admin'
import { sendTwilioAwardNotification } from '@/lib/notifications/twilio-award-alert'

export async function checkAndAutoAwardExpiredLoads(): Promise<void> {
  try {
    const admin = createAdminClient()
    const nowIso = new Date().toISOString()

    // 1. Find open loads where pickup_deadline has passed
    const { data: expiredLoads } = await admin
      .from('loads')
      .select('id, reference_code, posted_by, pickup_deadline')
      .eq('status', 'open')
      .lte('pickup_deadline', nowIso)

    if (!expiredLoads || expiredLoads.length === 0) return

    for (const load of expiredLoads) {
      // 2. Fetch active bids for this load ordered by amount ascending (lowest bid first)
      const { data: bids } = await admin
        .from('bids')
        .select('id, trucker_id, amount_paise, created_at')
        .eq('load_id', load.id)
        .eq('status', 'active')
        .order('amount_paise', { ascending: true })
        .order('created_at', { ascending: true })

      if (!bids || bids.length === 0) {
        // No bids placed; load remains open or can expire without award
        continue
      }

      const lowestBid = bids[0]

      // Call award_bid RPC
      const { data: awardData, error: awardErr } = await admin.rpc('award_bid', {
        p_load_id: load.id,
        p_bid_id: lowestBid.id,
        p_operator_id: load.posted_by,
      })

      if (awardErr) {
        console.error(`[auto-award] Failed to auto-award load ${load.reference_code}:`, awardErr.message)
        continue
      }

      const row = Array.isArray(awardData) ? awardData[0] : awardData
      if (row) {
        const winnerPhone = row.winner_phone as string
        const loserPhones = (row.loser_phones as string[] | null) ?? []

        console.log(`[auto-award] Load #${load.reference_code} auto-awarded to ${winnerPhone} (Bid: ₹${lowestBid.amount_paise / 100})`)

        // Send WhatsApp award notification
        sendTwilioAwardNotification(load.id, winnerPhone, loserPhones).catch((err) => {
          console.error('[auto-award] Error sending award notification:', err)
        })
      }
    }
  } catch (err) {
    console.error('[auto-award] Unexpected error during auto-award check:', err)
  }
}
