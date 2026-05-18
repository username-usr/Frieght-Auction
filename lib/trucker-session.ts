import { createHmac, timingSafeEqual } from 'node:crypto'

// HMAC-signed cookie for the /t (trucker preview) portal. The payload is
// just the trucker uuid plus an issued-at timestamp; we sign the whole
// thing with HMAC-SHA256 and store it verbatim in the cookie. No JWT
// library is used on purpose — this is one-purpose, server-only, and the
// payload is opaque to the client.
//
// Format: `${truckerId}.${issuedAtMs}.${hexMac}`
//
// Rotation: bumping TRUCKER_SESSION_SECRET invalidates every active
// trucker session immediately (existing cookies fail verification).

const COOKIE_NAME = 'trucker_session'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30 // 30 days

export const TRUCKER_COOKIE_NAME = COOKIE_NAME

export function truckerCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  }
}

function getSecret(): string {
  const secret = process.env.TRUCKER_SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error(
      'TRUCKER_SESSION_SECRET is missing or too short (need 32+ chars). ' +
        'Set it in .env.local and Vercel project env vars.'
    )
  }
  return secret
}

function hmac(value: string): string {
  return createHmac('sha256', getSecret()).update(value).digest('hex')
}

export function signTruckerSession(truckerId: string): string {
  const issuedAtMs = Date.now()
  const payload = `${truckerId}.${issuedAtMs}`
  const mac = hmac(payload)
  return `${payload}.${mac}`
}

export type VerifiedTruckerSession = {
  truckerId: string
  issuedAt: Date
}

export function verifyTruckerSession(
  cookieValue: string | undefined
): VerifiedTruckerSession | null {
  if (!cookieValue) return null
  const parts = cookieValue.split('.')
  if (parts.length !== 3) return null
  const [truckerId, issuedAtStr, mac] = parts

  // Constant-time compare on the MAC, then sanity-check the payload shape.
  const expected = hmac(`${truckerId}.${issuedAtStr}`)
  if (mac.length !== expected.length) return null
  const a = Buffer.from(mac, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length === 0 || a.length !== b.length) return null
  if (!timingSafeEqual(a, b)) return null

  const issuedAtMs = Number(issuedAtStr)
  if (!Number.isFinite(issuedAtMs)) return null

  // We also enforce maxAge server-side (defence in depth — a browser that
  // ignored the cookie's Max-Age won't extend the trucker's session beyond
  // 30 days without re-logging-in).
  const ageMs = Date.now() - issuedAtMs
  if (ageMs < 0 || ageMs > MAX_AGE_SECONDS * 1000) return null

  // truckerId must look like a uuid; cheap sanity check.
  if (!/^[0-9a-f-]{36}$/i.test(truckerId)) return null

  return { truckerId, issuedAt: new Date(issuedAtMs) }
}
