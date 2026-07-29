import { createAdminClient } from '@/lib/supabase/admin'
import { parseBidMessage } from '@/lib/parse-bid-message'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  try {
    const textData = await request.text()
    const params = new URLSearchParams(textData)

    const rawFrom = params.get('From') ?? ''
    const rawTo = params.get('To') ?? ''
    const messageText = (params.get('Body') ?? '').trim()
    const messageSid = params.get('MessageSid') ?? null

    // Extract clean E.164 phone: e.g. "whatsapp:+919876543210" -> "+919876543210"
    const fromPhone = rawFrom.replace('whatsapp:', '').trim()
    const toPhone = rawTo.replace('whatsapp:', '').trim()

    console.log(`[twilio-webhook] Received message from ${fromPhone}: "${messageText}"`)

    const admin = createAdminClient()

    // 1. Resolve trucker by phone
    let truckerId: string | null = null
    if (fromPhone) {
      const { data: trucker } = await admin
        .from('truckers')
        .select('id')
        .eq('phone_e164', fromPhone)
        .maybeSingle()
      truckerId = trucker?.id ?? null
    }

    if (!truckerId) {
      console.warn(`[twilio-webhook] Unknown trucker phone ${fromPhone}; logging only`)
      await logInbound(admin, { fromPhone, toPhone, body: messageText, messageSid })
      return new Response('<Response></Response>', {
        headers: { 'Content-Type': 'text/xml' },
        status: 200,
      })
    }

    // 2. Parse bid message text
    const parsed = parseBidMessage(messageText)
    if (parsed.refCandidates.length === 0) {
      console.warn(`[twilio-webhook] No reference code candidates found in "${messageText}"`)
      await logInbound(admin, { fromPhone, toPhone, body: messageText, messageSid })
      return new Response('<Response></Response>', {
        headers: { 'Content-Type': 'text/xml' },
        status: 200,
      })
    }

    // 3. Resolve load by reference code
    const { data: loads } = await admin
      .from('loads')
      .select('id, status')
      .in('reference_code', parsed.refCandidates)

    const load = loads?.[0] ?? null
    if (!load) {
      console.warn(`[twilio-webhook] Ref code ${parsed.refCandidates.join('/')} matches no load`)
      await logInbound(admin, { fromPhone, toPhone, body: messageText, messageSid })
      return new Response('<Response></Response>', {
        headers: { 'Content-Type': 'text/xml' },
        status: 200,
      })
    }

    const loadId = load.id as string

    // 4. Verify trucker visibility
    const { data: vis } = await admin
      .from('load_trucker_visibility')
      .select('load_id')
      .eq('load_id', loadId)
      .eq('trucker_id', truckerId)
      .maybeSingle()

    if (!vis) {
      console.warn(`[twilio-webhook] Load ${loadId} not visible to trucker ${truckerId}`)
      await logInbound(admin, { fromPhone, toPhone, body: messageText, messageSid, relatedLoadId: loadId })
      return new Response('<Response></Response>', {
        headers: { 'Content-Type': 'text/xml' },
        status: 200,
      })
    }

    if (parsed.amountRupees === null) {
      console.warn(`[twilio-webhook] Invalid bid amount in "${messageText}"`)
      await logInbound(admin, { fromPhone, toPhone, body: messageText, messageSid, relatedLoadId: loadId })
      return new Response('<Response></Response>', {
        headers: { 'Content-Type': 'text/xml' },
        status: 200,
      })
    }

    // 5. Place bid via RPC
    const amountPaise = parsed.amountRupees * 100
    const { data: bidId, error } = await admin.rpc('place_trucker_bid', {
      p_trucker_id: truckerId,
      p_load_id: loadId,
      p_amount_paise: amountPaise,
    })

    if (error) {
      console.warn(`[twilio-webhook] Bid placement failed: ${error.message}`)
      await logInbound(admin, { fromPhone, toPhone, body: messageText, messageSid, relatedLoadId: loadId })
      return new Response('<Response></Response>', {
        headers: { 'Content-Type': 'text/xml' },
        status: 200,
      })
    }

    console.log(`[twilio-webhook] Bid ${bidId} successfully placed on load ${loadId} (₹${parsed.amountRupees})`)

    await logInbound(admin, {
      fromPhone,
      toPhone,
      body: messageText,
      messageSid,
      relatedLoadId: loadId,
      relatedBidId: bidId as string,
    })

    // Return empty TwiML response
    return new Response('<Response></Response>', {
      headers: { 'Content-Type': 'text/xml' },
      status: 200,
    })
  } catch (err) {
    console.error('[twilio-webhook] Processing error:', err)
    return new Response('<Response></Response>', {
      headers: { 'Content-Type': 'text/xml' },
      status: 200,
    })
  }
}

async function logInbound(
  admin: ReturnType<typeof createAdminClient>,
  args: {
    fromPhone: string
    toPhone: string
    body: string
    messageSid: string | null
    relatedLoadId?: string | null
    relatedBidId?: string | null
  }
) {
  try {
    await admin.from('whatsapp_messages').insert({
      direction: 'inbound',
      from_phone: args.fromPhone,
      to_phone: args.toPhone,
      body: args.body,
      wa_message_id: args.messageSid,
      status: 'delivered',
      related_load_id: args.relatedLoadId ?? null,
      related_bid_id: args.relatedBidId ?? null,
    })
  } catch (err) {
    console.error('[twilio-webhook] Log insert threw:', err)
  }
}
