import { createHmac, timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseBidMessage } from '@/lib/parse-bid-message'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request): Promise<Response> {
  try {
    const textData = await request.text()
    const params = new URLSearchParams(textData)

    // Authenticate the caller BEFORE trusting anything in the body. Every
    // branch below keys off the `From` param and then writes through the
    // service-role client (which bypasses RLS), so without this gate anyone
    // who knows the URL could forge bids and award acceptances on behalf of
    // any registered trucker. Fail closed: no token or no/!bad signature = 401.
    if (!verifyTwilioSignature(request, params)) {
      console.warn('[twilio-webhook] signature verification failed → 401')
      return new Response('Invalid signature', { status: 401 })
    }

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
      return twimlReply('⚠️ Your phone number is not registered on the Ram-Nath Freight Bidding Platform.')
    }

    // Handle ACCEPT command (e.g., "ACCEPT A3JK" or "CONFIRM A3JK" or "ACCEPT")
    const upperText = messageText.toUpperCase().trim()
    const isAcceptCommand = upperText.startsWith('ACCEPT') || upperText.startsWith('CONFIRM') || upperText.startsWith('YES')
    const isDriverCommand = upperText.startsWith('DRIVER') || upperText.startsWith('TRUCK')

    if (isAcceptCommand) {
      // Find awarded load for this trucker
      const refMatch = messageText.match(/\b([A-Z0-9]{4})\b/i)
      const refCode = refMatch ? refMatch[1].toUpperCase() : null

      let targetLoad: { id: string; reference_code: string; status: string } | null = null
      if (refCode) {
        const { data: load } = await admin
          .from('loads')
          .select('id, reference_code, status')
          .eq('reference_code', refCode)
          .maybeSingle()
        if (load) targetLoad = load
      } else {
        // Find latest awarded load for trucker
        const { data: wonBid } = await admin
          .from('bids')
          .select('load_id, loads(id, reference_code, status)')
          .eq('trucker_id', truckerId)
          .eq('status', 'won')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (wonBid && wonBid.loads) {
          const l = Array.isArray(wonBid.loads) ? wonBid.loads[0] : wonBid.loads
          targetLoad = l as any
        }
      }

      if (!targetLoad) {
        await logInbound(admin, { fromPhone, toPhone, body: messageText, messageSid })
        return twimlReply('⚠️ No pending load award found to accept. Please specify load code: e.g. ACCEPT A3JK')
      }

      // Execute accept_award RPC
      const { error: acceptErr } = await admin.rpc('accept_award', {
        p_load_id: targetLoad.id,
        p_trucker_id: truckerId,
      })

      if (acceptErr && !acceptErr.message.includes('already')) {
        console.warn(`[twilio-webhook] Accept failed: ${acceptErr.message}`)
        await logInbound(admin, { fromPhone, toPhone, body: messageText, messageSid, relatedLoadId: targetLoad.id })
        return twimlReply(`⚠️ Acceptance failed: ${acceptErr.message}`)
      }

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
      await logInbound(admin, { fromPhone, toPhone, body: messageText, messageSid, relatedLoadId: targetLoad.id })
      return twimlReply(
        `🎉 Load #${targetLoad.reference_code} ACCEPTANCE CONFIRMED!\n\n` +
        `📄 *View Official Warehouse Gate Pass*:\n` +
        `${baseUrl}/t/loads/${targetLoad.reference_code}/gatepass\n\n` +
        `🚚 *Next Step:* Reply with your Vehicle & Driver details:\n` +
        `DRIVER ${targetLoad.reference_code} <NAME> <PHONE> <TRUCK_NO>\n` +
        `Example: DRIVER ${targetLoad.reference_code} Rajesh 9876543210 TN01AB1234`
      )
    }

    if (isDriverCommand) {
      // Format: DRIVER [REF_CODE] <NAME> <PHONE> <TRUCK_NO>
      const parts = messageText.split(/\s+/)
      const refCodeCandidate = parts[1] ? parts[1].toUpperCase() : ''

      let targetLoadId: string | null = null
      let targetRefCode = ''
      let nameIndex = 1

      if (refCodeCandidate && /^[A-Z0-9]{4}$/.test(refCodeCandidate)) {
        const { data: l } = await admin
          .from('loads')
          .select('id, reference_code')
          .eq('reference_code', refCodeCandidate)
          .maybeSingle()
        if (l) {
          targetLoadId = l.id
          targetRefCode = l.reference_code
          nameIndex = 2
        }
      }

      if (!targetLoadId) {
        // Fallback to trucker's latest accepted load
        const { data: acceptedBid } = await admin
          .from('bids')
          .select('load_id, loads(id, reference_code, status)')
          .eq('trucker_id', truckerId)
          .eq('status', 'won')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (acceptedBid && acceptedBid.loads) {
          const l = Array.isArray(acceptedBid.loads) ? acceptedBid.loads[0] : acceptedBid.loads
          targetLoadId = (l as any).id
          targetRefCode = (l as any).reference_code
        }
      }

      if (!targetLoadId) {
        await logInbound(admin, { fromPhone, toPhone, body: messageText, messageSid })
        return twimlReply('⚠️ Could not match load for driver details. Format: DRIVER <REF_CODE> <NAME> <PHONE> <TRUCK_NO>')
      }

      const driverDetailsParts = parts.slice(nameIndex)
      const driverName = driverDetailsParts[0] || 'Assigned Driver'
      const driverPhone = driverDetailsParts[1] || fromPhone
      const rawTruckNo = driverDetailsParts[2] || driverDetailsParts[driverDetailsParts.length - 1] || 'MH12AB1234'
      const truckNumber = rawTruckNo.replace(/[^A-Za-z0-9]/g, '').toUpperCase()

      const { error: updateErr } = await admin
        .from('loads')
        .update({
          driver_name: driverName,
          driver_phone: driverPhone,
          truck_number: truckNumber,
        })
        .eq('id', targetLoadId)

      if (updateErr) {
        console.warn(`[twilio-webhook] Driver update failed: ${updateErr.message}`)
        await logInbound(admin, { fromPhone, toPhone, body: messageText, messageSid, relatedLoadId: targetLoadId })
        return twimlReply(`⚠️ Could not save details: ${updateErr.message}`)
      }

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://ramnath-logistics.vercel.app'

      await logInbound(admin, { fromPhone, toPhone, body: messageText, messageSid, relatedLoadId: targetLoadId })
      return twimlReply(
        `✅ Vehicle & Driver details registered for Load #${targetRefCode}!\n` +
        `• Driver: ${driverName}\n` +
        `• Phone: ${driverPhone}\n` +
        `• Truck No: ${truckNumber}\n\n` +
        `🌐 View Official Gate Pass:\n` +
        `${baseUrl}/t/loads/${targetLoadId}/gatepass`
      )
    }

    // 2. Parse bid message text
    const parsed = parseBidMessage(messageText)
    if (parsed.refCandidates.length === 0) {
      console.warn(`[twilio-webhook] No reference code candidates found in "${messageText}"`)
      await logInbound(admin, { fromPhone, toPhone, body: messageText, messageSid })
      return twimlReply(
        '⚠️ Message received! To bid, send: <REF_CODE> <AMOUNT> (e.g. A3JK 24000).\nTo accept an awarded load, send: ACCEPT <REF_CODE>'
      )
    }

    // 3. Resolve load by reference code
    const { data: loads } = await admin
      .from('loads')
      .select('id, reference_code, status')
      .in('reference_code', parsed.refCandidates)

    const load = loads?.[0] ?? null
    if (!load) {
      console.warn(`[twilio-webhook] Ref code ${parsed.refCandidates.join('/')} matches no load`)
      await logInbound(admin, { fromPhone, toPhone, body: messageText, messageSid })
      return twimlReply(`⚠️ Load reference code ${parsed.refCandidates[0]} not found.`)
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
      return twimlReply(`⚠️ Load #${load.reference_code} is not assigned to your trucker profile.`)
    }

    if (parsed.amountRupees === null) {
      console.warn(`[twilio-webhook] Invalid bid amount in "${messageText}"`)
      await logInbound(admin, { fromPhone, toPhone, body: messageText, messageSid, relatedLoadId: loadId })
      return twimlReply(`⚠️ Invalid bid amount in "${messageText}". Please reply like: ${load.reference_code} 24000`)
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
      return twimlReply(`⚠️ Bid failed: ${error.message}`)
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

    // Return instant confirmation TwiML reply with portal link
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://ramnath-logistics.vercel.app'
    return twimlReply(
      `✅ Bid of ₹${parsed.amountRupees.toLocaleString('en-IN')} recorded for Load #${load.reference_code}!\n\n` +
      `View live auction rank & status:\n${baseUrl}/t/loads/${loadId}`
    )
  } catch (err) {
    console.error('[twilio-webhook] Processing error:', err)
    return twimlReply('⚠️ System error processing your bid.')
  }
}

// --- signature -------------------------------------------------------------

// Twilio's request-validation scheme (X-Twilio-Signature):
//   1. Start with the full URL Twilio requested, query string included.
//   2. Append every POST param as `key + value`, keys sorted alphabetically,
//      with no separators of any kind.
//   3. HMAC-SHA1 that string, keyed by the account's AUTH TOKEN, base64.
// Note it is SHA1 and base64 here — that's Twilio's spec, not a copy/paste
// slip from the Interakt webhook's SHA256-hex scheme.
function verifyTwilioSignature(request: Request, params: URLSearchParams): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) {
    console.error('[twilio-webhook] TWILIO_AUTH_TOKEN is not set — refusing')
    return false
  }

  const header = request.headers.get('x-twilio-signature')
  if (!header) return false

  let payload = twilioRequestUrl(request)
  for (const key of [...new Set(params.keys())].sort()) {
    for (const value of params.getAll(key)) {
      payload += key + value
    }
  }

  const expected = createHmac('sha1', authToken).update(payload, 'utf8').digest('base64')

  // Constant-time compare; timingSafeEqual throws on length mismatch, so guard.
  const a = Buffer.from(header, 'base64')
  const b = Buffer.from(expected, 'base64')
  if (a.length !== b.length || a.length === 0) return false
  return timingSafeEqual(a, b)
}

// The signature is computed over the URL exactly as Twilio called it, so this
// has to reproduce that string byte for byte. Behind Cloudflare the incoming
// `request.url` is normally already the public https URL, but we prefer the
// forwarded proto/host headers when present. Set TWILIO_WEBHOOK_URL to pin it
// verbatim if a proxy ever rewrites the URL and signatures start failing.
function twilioRequestUrl(request: Request): string {
  const override = process.env.TWILIO_WEBHOOK_URL
  if (override) return override

  const url = new URL(request.url)
  const forwardedProto = request.headers.get('x-forwarded-proto')
  const host = request.headers.get('host')
  if (forwardedProto) url.protocol = `${forwardedProto.split(',')[0].trim()}:`
  if (host) url.host = host
  return url.toString()
}

function twimlReply(message: string): Response {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`
  return new Response(xml, {
    headers: { 'Content-Type': 'text/xml' },
    status: 200,
  })
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
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
