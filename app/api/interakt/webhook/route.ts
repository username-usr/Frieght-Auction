import { createHmac, timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseBidMessage } from '@/lib/parse-bid-message'

// Inbound WhatsApp webhook (Part 3). Interakt POSTs a customer's reply here; we
// verify the signature, parse a "<REF> <AMOUNT>" bid out of the text, and place
// it through the EXISTING place_trucker_bid RPC — never a direct bids insert.
//
// Contract with Interakt:
//   * We MUST return 200 within 3s for any validly-signed request, even when
//     the message isn't a usable bid, or Interakt will keep retrying. The ONLY
//     non-200 is 401 for a bad/absent signature.
//   * Signature: header "Interakt-Signature: sha256=<hex>", where <hex> is the
//     SHA256 HMAC of the RAW request body keyed by INTERAKT_WEBHOOK_SECRET.
//
// node:crypto forces the Node runtime (not edge).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Interakt's incoming-message payload (confirmed against Interakt's
// "Webhooks for Customer Messages & Sent Template status" docs):
//   { type: "message_received",
//     data: {
//       customer: { channel_phone_number: "917003705584", ... },
//       message:  { id, message_content_type: "Text", message: "7K2M 18500" } } }
// channel_phone_number has NO leading "+"; we add it to match phone_e164.
type InteraktInbound = {
  type?: string
  data?: {
    customer?: { channel_phone_number?: string }
    message?: {
      id?: string
      chat_message_type?: string
      message_content_type?: string
      message?: string
    }
  }
}

// message_status enum has no inbound-specific value; 'delivered' = "reached us".
const INBOUND_STATUS = 'delivered'

export async function POST(request: Request): Promise<Response> {
  // 1. RAW body first — the signature is over these exact bytes.
  const rawBody = await request.text()

  // 2. Verify signature. This is the only gate that can reject (401).
  const signature = request.headers.get('interakt-signature')
  if (!verifySignature(rawBody, signature)) {
    console.warn('[interakt-webhook] signature verification failed → 401')
    return new Response('Invalid signature', { status: 401 })
  }

  // 3. Everything past this point is best-effort. A validly-signed request
  //    ALWAYS gets a 200 — we never let a processing error trigger a retry.
  try {
    await processInbound(rawBody)
  } catch (err) {
    console.error('[interakt-webhook] processing error (still returning 200):', err)
  }
  return new Response('OK', { status: 200 })
}

// --- signature -------------------------------------------------------------

function verifySignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.INTERAKT_WEBHOOK_SECRET
  if (!secret) {
    // Can't verify without the shared secret — refuse rather than trust.
    console.error('[interakt-webhook] INTERAKT_WEBHOOK_SECRET is not set')
    return false
  }
  if (!header) return false

  // Accept "sha256=<hex>" (spec) or a bare hex digest, just in case.
  const received = header.startsWith('sha256=') ? header.slice(7) : header

  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')

  // Constant-time compare; timingSafeEqual throws on length mismatch, so guard.
  const a = Buffer.from(received, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length !== b.length || a.length === 0) return false
  return timingSafeEqual(a, b)
}

// --- processing ------------------------------------------------------------

async function processInbound(rawBody: string): Promise<void> {
  let payload: InteraktInbound
  try {
    payload = JSON.parse(rawBody) as InteraktInbound
  } catch {
    console.warn('[interakt-webhook] body is not valid JSON; ignoring')
    return
  }

  // Only handle inbound customer text messages. Status-update callbacks
  // (delivery/read for our outbound sends) also hit this URL — ack and skip.
  if (payload.type !== 'message_received') {
    console.log(`[interakt-webhook] ignoring event type=${payload.type ?? 'unknown'}`)
    return
  }

  const rawPhone = payload.data?.customer?.channel_phone_number ?? ''
  const digits = rawPhone.replace(/[^\d]/g, '')
  const fromPhone = digits ? `+${digits}` : ''
  const text = payload.data?.message?.message ?? ''
  const waMessageId = payload.data?.message?.id ?? null
  const contentType = payload.data?.message?.message_content_type ?? ''
  const toPhone = process.env.WHATSAPP_FROM ?? null

  const admin = createAdminClient()

  // Non-text messages (images, location, etc.) can't be bids. Log the inbound
  // for the trail, then stop.
  if (contentType && contentType !== 'Text') {
    console.log(`[interakt-webhook] non-text message (${contentType}); logging only`)
    await logInbound(admin, { fromPhone, toPhone, body: text, waMessageId })
    return
  }

  // Resolve the trucker by phone. If unknown, we can't attribute a bid — log
  // and stop. (Reply decision: none for now — see the route's docstring / PR
  // notes. A 24h customer-service window is open, so a reply COULD be added.)
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
    console.warn(`[interakt-webhook] unknown trucker phone ${fromPhone}; logging only`)
    await logInbound(admin, { fromPhone, toPhone, body: text, waMessageId })
    return
  }

  // Parse "<REF> <AMOUNT>" out of the text.
  const parsed = parseBidMessage(text)

  if (parsed.refCandidates.length === 0) {
    console.warn(`[interakt-webhook] no ref code in "${text}" from ${fromPhone}`)
    await logInbound(admin, { fromPhone, toPhone, body: text, waMessageId })
    return
  }

  // Resolve the reference code to a real load. Match any candidate; read status
  // so we can tell "unknown code" from "known but closed".
  const { data: loads } = await admin
    .from('loads')
    .select('id, status')
    .in('reference_code', parsed.refCandidates)

  const load = loads?.[0] ?? null
  if (!load) {
    console.warn(
      `[interakt-webhook] ref ${parsed.refCandidates.join('/')} matches no load (from ${fromPhone})`
    )
    await logInbound(admin, { fromPhone, toPhone, body: text, waMessageId })
    return
  }
  const loadId = load.id as string

  // Visibility: place_trucker_bid does NOT enforce the per-load whitelist, so
  // we do it here. A trucker may only bid on a load they were made visible to.
  const { data: vis } = await admin
    .from('load_trucker_visibility')
    .select('load_id')
    .eq('load_id', loadId)
    .eq('trucker_id', truckerId)
    .maybeSingle()
  if (!vis) {
    console.warn(`[interakt-webhook] load ${loadId} not visible to trucker ${truckerId}`)
    await logInbound(admin, { fromPhone, toPhone, body: text, waMessageId, relatedLoadId: loadId })
    return
  }

  // Amount must be present and a positive whole rupee value.
  if (parsed.amountRupees === null) {
    console.warn(
      `[interakt-webhook] bad amount (raw=${parsed.amountRaw ?? 'none'}) for load ${loadId}`
    )
    await logInbound(admin, { fromPhone, toPhone, body: text, waMessageId, relatedLoadId: loadId })
    return
  }

  // Load-open check is ultimately enforced inside place_trucker_bid (row-locked),
  // which is the authority. We call it and mirror its outcome.
  const amountPaise = parsed.amountRupees * 100
  const { data: bidId, error } = await admin.rpc('place_trucker_bid', {
    p_trucker_id: truckerId,
    p_load_id: loadId,
    p_amount_paise: amountPaise,
  })

  if (error) {
    // 'Load is no longer open', 'Trucker account is not active', etc. The bid
    // was NOT placed; log with the load but no bid id.
    console.warn(`[interakt-webhook] place_trucker_bid rejected: ${error.message}`)
    await logInbound(admin, { fromPhone, toPhone, body: text, waMessageId, relatedLoadId: loadId })
    return
  }

  // Success — this covers a first bid AND a revision (the RPC upserts the
  // active bid in place and returns its id; never a double insert).
  console.log(
    `[interakt-webhook] bid ${bidId} placed on load ${loadId} by trucker ${truckerId} (₹${parsed.amountRupees})`
  )
  await logInbound(admin, {
    fromPhone,
    toPhone,
    body: text,
    waMessageId,
    relatedLoadId: loadId,
    relatedBidId: (bidId as string) ?? null,
  })
}

// --- logging ---------------------------------------------------------------

// One inbound row per received message. related_load_id / related_bid_id are
// filled in as far as we got. Best-effort: a logging failure never changes the
// 200 response.
async function logInbound(
  admin: ReturnType<typeof createAdminClient>,
  args: {
    fromPhone: string
    toPhone: string | null
    body: string
    waMessageId: string | null
    relatedLoadId?: string | null
    relatedBidId?: string | null
  }
): Promise<void> {
  try {
    const { error } = await admin.from('whatsapp_messages').insert({
      direction: 'inbound',
      from_phone: args.fromPhone || null,
      to_phone: args.toPhone,
      body: args.body,
      wa_message_id: args.waMessageId,
      status: INBOUND_STATUS,
      related_load_id: args.relatedLoadId ?? null,
      related_bid_id: args.relatedBidId ?? null,
    })
    if (error) {
      console.error(`[interakt-webhook] inbound log insert failed: ${error.message}`)
    }
  } catch (err) {
    console.error('[interakt-webhook] inbound log insert threw:', err)
  }
}
