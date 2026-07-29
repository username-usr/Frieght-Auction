import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendTwilioWhatsAppMessage } from '@/lib/twilio'

export async function sendTwilioAwardNotification(
  loadId: string,
  winnerPhoneArg?: string | null,
  loserPhonesArg?: string[] | null
) {
  const provider = process.env.WHATSAPP_PROVIDER ?? 'twilio'
  if (provider !== 'twilio') return

  const admin = createAdminClient()

  // Fetch load details
  const { data: load } = await admin
    .from('loads')
    .select('reference_code, origin_address, destination_address')
    .eq('id', loadId)
    .maybeSingle()

  if (!load) return

  // Query winning bid directly if winnerPhoneArg is not provided
  let winnerPhone = winnerPhoneArg ?? null
  if (!winnerPhone) {
    const { data: wonBid } = await admin
      .from('bids')
      .select('trucker:truckers(phone_e164)')
      .eq('load_id', loadId)
      .eq('status', 'won')
      .maybeSingle()

    const truckerObj = Array.isArray(wonBid?.trucker) ? wonBid?.trucker[0] : wonBid?.trucker
    winnerPhone = (truckerObj as { phone_e164?: string } | null)?.phone_e164 ?? null
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://ramnath-logistics.vercel.app'

  // 1. Send WhatsApp Award Notification to Winner
  if (winnerPhone) {
    const winnerMessage =
      `🎉 *CONGRATULATIONS! LOAD AWARDED*\n\n` +
      `Your bid for Load *#${load.reference_code}* (${load.origin_address} → ${load.destination_address}) has been *AWARDED* to you!\n\n` +
      `Click the link below to confirm truck & driver details:\n` +
      `${appUrl}/t/loads/${loadId}`

    try {
      const res = await sendTwilioWhatsAppMessage({
        toPhone: winnerPhone,
        messageBody: winnerMessage,
      })

      console.log(`[twilio_award_alert] Winner notification result to ${winnerPhone}: ok=${res.ok}`)

      await admin.from('whatsapp_messages').insert({
        direction: 'outbound',
        from_phone: process.env.TWILIO_WHATSAPP_NUMBER || '+14155238886',
        to_phone: winnerPhone,
        body: winnerMessage,
        wa_message_id: res.ok ? res.sid : null,
        status: res.ok ? 'sent' : 'failed',
        related_load_id: loadId,
      })
    } catch (err) {
      console.error(`[twilio_award_alert] Winner alert error for ${winnerPhone}:`, err)
    }
  } else {
    console.warn(`[twilio_award_alert] No winner phone found for load ${loadId}`)
  }

  // 2. Send WhatsApp Notification to Non-Winning Bidders
  const loserPhones = loserPhonesArg ?? []
  for (const loserPhone of loserPhones) {
    if (!loserPhone || loserPhone === winnerPhone) continue

    const loserMessage =
      `📢 *LOAD BIDDING CLOSED*\n\n` +
      `Bidding for Load *#${load.reference_code}* (${load.origin_address} → ${load.destination_address}) is now closed as it has been awarded.\n\n` +
      `Thank you for participating!`

    try {
      const res = await sendTwilioWhatsAppMessage({
        toPhone: loserPhone,
        messageBody: loserMessage,
      })

      await admin.from('whatsapp_messages').insert({
        direction: 'outbound',
        from_phone: process.env.TWILIO_WHATSAPP_NUMBER || '+14155238886',
        to_phone: loserPhone,
        body: loserMessage,
        wa_message_id: res.ok ? res.sid : null,
        status: res.ok ? 'sent' : 'failed',
        related_load_id: loadId,
      })
    } catch (err) {
      console.error(`[twilio_award_alert] Loser alert error for ${loserPhone}:`, err)
    }
  }
}
