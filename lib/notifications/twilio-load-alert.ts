import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatAbsoluteIST } from '@/lib/format'
import { sendTwilioWhatsAppMessage } from '@/lib/twilio'
import { truckTypeLabel } from '@/lib/truck-types'

export type TwilioLoadAlertSummary = {
  loadId: string
  recipients: number
  sent: number
  failed: number
}

export async function sendTwilioLoadAlerts(
  loadId: string
): Promise<TwilioLoadAlertSummary> {
  const summary: TwilioLoadAlertSummary = {
    loadId,
    recipients: 0,
    sent: 0,
    failed: 0,
  }

  const admin = createAdminClient()

  // 1. Fetch load details
  const { data: load } = await admin
    .from('loads')
    .select('reference_code, origin_address, destination_address, truck_type_required, pickup_deadline')
    .eq('id', loadId)
    .maybeSingle()

  if (!load) {
    console.error(`[twilio_load_alert] Load ${loadId} not found`)
    return summary
  }

  // 2. Fetch visible truckers
  const { data: visRows } = await admin
    .from('load_trucker_visibility')
    .select('trucker_id')
    .eq('load_id', loadId)

  const truckerIds = (visRows ?? []).map((r) => r.trucker_id as string)
  if (truckerIds.length === 0) return summary

  const { data: truckers } = await admin
    .from('truckers')
    .select('id, phone_e164, status')
    .in('id', truckerIds)
    .neq('status', 'blocked')

  summary.recipients = truckers?.length ?? 0

  // 3. Format message text
  const messageBody =
    `🚨 *NEW FREIGHT LOAD ALERT*\n` +
    `Ref Code: *${load.reference_code}*\n` +
    `Pickup: ${load.origin_address}\n` +
    `Drop: ${load.destination_address}\n` +
    `Truck Type: ${truckTypeLabel(load.truck_type_required)}\n` +
    `Deadline: ${formatAbsoluteIST(load.pickup_deadline)}\n\n` +
    `Reply to this message with: *${load.reference_code} <AMOUNT>* to place your bid!\n` +
    `Example: *${load.reference_code} 24000*`

  // 4. Send outbound WhatsApp messages via Twilio
  for (const t of truckers ?? []) {
    const phone = t.phone_e164 as string
    try {
      const res = await sendTwilioWhatsAppMessage({
        toPhone: phone,
        messageBody,
      })

      if (res.ok) {
        summary.sent++
      } else {
        summary.failed++
      }

      await admin.from('whatsapp_messages').insert({
        direction: 'outbound',
        from_phone: process.env.TWILIO_WHATSAPP_NUMBER || '+14155238886',
        to_phone: phone,
        body: messageBody,
        wa_message_id: res.ok ? res.sid : null,
        status: res.ok ? 'sent' : 'failed',
        related_load_id: loadId,
      })
    } catch (err) {
      summary.failed++
      console.error(`[twilio_load_alert] Error sending to ${phone}:`, err)
    }
  }

  return summary
}
