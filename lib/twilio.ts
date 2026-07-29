import 'server-only'

// Lightweight, typed wrapper around Twilio's WhatsApp Messages REST API.
// Does not require external npm packages (uses native fetch & URLSearchParams).

export type SendTwilioWhatsAppArgs = {
  toPhone: string // E.164 phone number, e.g. "+919876543210"
  messageBody: string // Text content to send
}

export type SendTwilioResult =
  | { ok: true; sid: string; status: number; raw: unknown }
  | { ok: false; status: number | null; error: string; raw: unknown }

export async function sendTwilioWhatsAppMessage(
  args: SendTwilioWhatsAppArgs
): Promise<SendTwilioResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || '+14155238886'

  if (!accountSid || !authToken || accountSid.includes('your_twilio')) {
    const error = 'TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN is missing in .env.local'
    console.error('[twilio] ' + error)
    return { ok: false, status: null, error, raw: null }
  }

  // Format Twilio WhatsApp numbers: must be prefixed with "whatsapp:"
  const rawFrom = fromNumber.replace('whatsapp:', '').trim()
  const rawTo = args.toPhone.replace('whatsapp:', '').trim()

  const cleanFrom = `whatsapp:${rawFrom.startsWith('+') ? rawFrom : `+${rawFrom}`}`
  const cleanTo = `whatsapp:${rawTo.startsWith('+') ? rawTo : `+${rawTo}`}`

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`
  const authHeader = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`

  const bodyData = new URLSearchParams({
    From: cleanFrom,
    To: cleanTo,
    Body: args.messageBody,
  })

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: bodyData.toString(),
    })

    const text = await res.text()
    let parsed: any = text
    try {
      parsed = JSON.parse(text)
    } catch {
      // keep raw text
    }

    if (res.ok) {
      const sid = parsed?.sid ?? null
      console.log(`[twilio] Sent WhatsApp message sid=${sid} to ${args.toPhone}`)
      return { ok: true, sid, status: res.status, raw: parsed }
    }

    const errorMsg = parsed?.message || `Twilio returned HTTP ${res.status}`
    console.error(`[twilio] Send failed status=${res.status}: ${errorMsg}`)
    return { ok: false, status: res.status, error: errorMsg, raw: parsed }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error(`[twilio] Network error: ${errorMsg}`)
    return { ok: false, status: null, error: errorMsg, raw: null }
  }
}
