// Phone-number helpers. Kept in ONE place so the E.164 → (countryCode,
// phoneNumber) split that Interakt's API needs has a single definition.

export type PhoneParts = { countryCode: string; phoneNumber: string }

// Truckers' phones are stored as a single E.164 string (e.g. "+919876543210")
// — see the CHECK constraint on truckers.phone_e164 in 0001_initial_schema.sql.
// Interakt wants the dialing code and the local number as SEPARATE fields.
//
// We deliberately do NOT try to infer an arbitrary country code by length
// (codes are 1–3 digits and can't be split unambiguously from the subscriber
// number). Instead we strip a single KNOWN dialing code the caller supplies
// (from WHATSAPP_DEFAULT_COUNTRY_CODE). Ramnath's truckers are all India-based
// ("+91"), so this is exact for our data. A number under any other code returns
// null so the caller can log-and-skip rather than send to a mangled number.
export function splitE164(
  phoneE164: string | null | undefined,
  defaultCountryCode: string
): PhoneParts | null {
  if (!phoneE164) return null
  const phone = phoneE164.trim()
  const cc = defaultCountryCode.trim()

  // Both must be in "+<digits>" form for the prefix strip to be meaningful.
  if (!phone.startsWith('+') || !cc.startsWith('+')) return null
  if (!phone.startsWith(cc)) return null

  const rest = phone.slice(cc.length)
  // Guard against a too-short / non-numeric remainder.
  if (!/^\d{4,}$/.test(rest)) return null

  return { countryCode: cc, phoneNumber: rest }
}
