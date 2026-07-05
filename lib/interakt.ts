import 'server-only'

// Thin, typed wrapper around Interakt's "send WhatsApp template" API.
//
// Scope: this file knows how to talk to Interakt and nothing about loads,
// bids, or truckers. Callers (Part 2 / Part 4) map domain data to the
// positional bodyValues array and pass it in. No business logic here.
//
// Endpoint: POST https://api.interakt.ai/v1/public/message/
//   - This single call BOTH upserts the contact AND sends the template.
//     Interakt's docs describe a separate /track/users/ upsert, but the
//     /message/ endpoint creates the contact on the fly, so we don't need
//     a second call for our use case. (Confirmed against Interakt's
//     "Send WhatsApp Template API" docs, June 2026.)
//   - Auth header is "Basic <API_KEY>". The key Interakt issues is already
//     in the form their API expects, so we pass it through verbatim — we do
//     NOT base64-encode it ourselves.
//   - The send response does NOT carry delivery status; that arrives later
//     via webhook. We only report whether Interakt accepted the request.

const INTERAKT_SEND_URL = 'https://api.interakt.ai/v1/public/message/'

// Retry policy for 429 (rate limit). Small and bounded — at our volume a
// few sends per load — we just want to ride out a brief throttle, not build
// a queue.
const MAX_ATTEMPTS = 3
const BASE_BACKOFF_MS = 500

export type SendTemplateArgs = {
  // Dialing code WITHOUT the leading load fields — e.g. "+91". Interakt wants
  // countryCode and phoneNumber as separate fields.
  countryCode: string
  // Local subscriber number, no country code — e.g. "9876543210".
  phoneNumber: string
  // Meta-approved template name, e.g. "new_load_alert".
  templateName: string
  // Values for {{1}}, {{2}}, ... IN ORDER. Interakt only accepts strings.
  bodyValues: string[]
}

export type SendTemplateResult =
  | {
      ok: true
      // Interakt's message/request id when present; null if the response
      // didn't include one. Never throw on a missing id.
      id: string | null
      status: number
      raw: unknown
    }
  | {
      ok: false
      // HTTP status if we got a response; null on a network/transport error.
      status: number | null
      error: string
      raw: unknown
    }

function backoffDelay(attempt: number, retryAfterHeader: string | null): number {
  // Honour Retry-After (seconds) if Interakt sends one; otherwise exponential.
  if (retryAfterHeader) {
    const secs = Number(retryAfterHeader)
    if (Number.isFinite(secs) && secs >= 0) return secs * 1000
  }
  return BASE_BACKOFF_MS * 2 ** (attempt - 1)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function sendTemplateMessage(
  args: SendTemplateArgs
): Promise<SendTemplateResult> {
  const apiKey = process.env.INTERAKT_API_KEY
  if (!apiKey) {
    // Configuration error, not a per-send failure. Surface it as a failed
    // result so callers can log-and-continue without crashing the request.
    const error = 'INTERAKT_API_KEY missing — cannot send WhatsApp template'
    console.error('[interakt] ' + error)
    return { ok: false, status: null, error, raw: null }
  }

  const payload = {
    countryCode: args.countryCode,
    phoneNumber: args.phoneNumber,
    type: 'Template' as const,
    template: {
      name: args.templateName,
      languageCode: 'en',
      bodyValues: args.bodyValues,
    },
  }

  let lastError = 'unknown error'
  let lastStatus: number | null = null
  let lastRaw: unknown = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response
    try {
      res = await fetch(INTERAKT_SEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
    } catch (err) {
      // Network/transport error — not an HTTP status. Retry within budget.
      lastError = err instanceof Error ? err.message : String(err)
      lastStatus = null
      lastRaw = null
      console.error(
        `[interakt] send transport error (attempt ${attempt}/${MAX_ATTEMPTS}) ` +
          `template=${args.templateName}: ${lastError}`
      )
      if (attempt < MAX_ATTEMPTS) {
        await sleep(backoffDelay(attempt, null))
        continue
      }
      break
    }

    // Parse the body once, tolerant of non-JSON responses.
    const text = await res.text()
    let body: unknown = text
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      // leave body as the raw text
    }
    lastStatus = res.status
    lastRaw = body

    if (res.status === 429 && attempt < MAX_ATTEMPTS) {
      const delay = backoffDelay(attempt, res.headers.get('retry-after'))
      console.warn(
        `[interakt] 429 rate limited (attempt ${attempt}/${MAX_ATTEMPTS}) ` +
          `template=${args.templateName}, retrying in ${delay}ms`
      )
      await sleep(delay)
      continue
    }

    if (res.ok) {
      const id = extractId(body)
      console.log(
        `[interakt] sent template=${args.templateName} status=${res.status} id=${id ?? 'none'}`
      )
      return { ok: true, id, status: res.status, raw: body }
    }

    // Non-2xx, non-retryable (or out of attempts). Report and stop.
    lastError = `Interakt returned HTTP ${res.status}`
    console.error(
      `[interakt] send failed template=${args.templateName} status=${res.status} body=${text}`
    )
    return { ok: false, status: res.status, error: lastError, raw: body }
  }

  // Exhausted attempts (all 429s or transport errors).
  console.error(
    `[interakt] send giving up after ${MAX_ATTEMPTS} attempts ` +
      `template=${args.templateName}: ${lastError}`
  )
  return { ok: false, status: lastStatus, error: lastError, raw: lastRaw }
}

// Interakt's success body has historically used "id"; tolerate a couple of
// shapes and fall back to null rather than assuming a fixed schema.
function extractId(body: unknown): string | null {
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>
    if (typeof o.id === 'string') return o.id
    if (typeof o.messageId === 'string') return o.messageId
  }
  return null
}
