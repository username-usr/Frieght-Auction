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
    .select('reference_code, origin_address, destination_address, truck_type_required, pickup_deadline, reference_price_paise, notes')
    .eq('id', loadId)
    .maybeSingle()

  if (!load) {
    console.error(`[twilio_load_alert] Load ${loadId} not found`)
    return summary
  }

  // 1b. Fetch items and additional destinations
  const [{ data: items }, { data: destinations }] = await Promise.all([
    admin
      .from('load_items')
      .select('weight_value, weight_unit, quantity_value, product:product_names(name), container:container_types(name), quantity_unit:quantity_units(name)')
      .eq('load_id', loadId),
    admin
      .from('load_destinations')
      .select('address, position')
      .eq('load_id', loadId)
      .order('position', { ascending: true }),
  ])

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

  // 3. Format rich message text
  const itemsText = (items ?? [])
    .map((it: any) => `• ${it.product?.name ?? 'Item'}: ${it.quantity_value} ${it.quantity_unit?.name ?? 'units'} (${it.container?.name ?? 'Container'}) - ${it.weight_value} ${it.weight_unit}`)
    .join('\n')

  const totalWeightStr = formatWeightSummary(items ?? [])

  const destsText = (destinations ?? []).length > 0
    ? `\n📍 *Additional Stops:* ` + (destinations ?? []).map((d: any) => d.address).join(' ➔ ')
    : ''

  const refPriceStr = load.reference_price_paise
    ? `\n💰 *Target Budget:* ₹${(load.reference_price_paise / 100).toLocaleString('en-IN')}`
    : ''

  const notesStr = load.notes ? `\n📝 *Notes:* ${load.notes}` : ''

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://ramnath-logistics.vercel.app'

  const messageBody =
    `🚚 *RAM-NATH FREIGHT LOAD ALERT*\n` +
    `=============================\n` +
    `📋 *Load Ref:* *#${load.reference_code}*\n` +
    `📍 *Pickup:* ${load.origin_address}\n` +
    `🏁 *Drop:* ${load.destination_address}${destsText}\n` +
    `🚛 *Required Truck:* ${truckTypeLabel(load.truck_type_required)}\n\n` +
    `📦 *CARGO ITEMS:*\n${itemsText || '• Standard Cargo'}\n` +
    `⚖️ *Total Weight:* ${totalWeightStr}\n` +
    `⏰ *Auction Deadline:* ${formatAbsoluteIST(load.pickup_deadline)}` +
    `${refPriceStr}${notesStr}\n` +
    `=============================\n` +
    `📲 *HOW TO BID VIA WHATSAPP:*\n` +
    `Reply to this message with: *${load.reference_code} <AMOUNT>*\n` +
    `Example: *${load.reference_code} 24000*\n\n` +
    `🌐 *BID VIA PORTAL:*\n` +
    `${baseUrl}/t/loads/${loadId}`

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

function formatWeightSummary(items: any[]): string {
  const byUnit = new Map<string, number>()
  for (const it of items) {
    const v = Number(it.weight_value)
    if (!Number.isFinite(v)) continue
    byUnit.set(it.weight_unit, (byUnit.get(it.weight_unit) ?? 0) + v)
  }
  const parts = [...byUnit.entries()].map(
    ([unit, value]) => `${value.toLocaleString('en-IN')} ${unit}`
  )
  return parts.length > 0 ? parts.join(', ') : '—'
}
