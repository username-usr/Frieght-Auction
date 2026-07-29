// Pure parser for an inbound WhatsApp bid message. No I/O — the caller does the
// DB work (confirming the reference code against real loads, placing the bid).
//
// Truckers reply with free-form text like:
//   "7K2M 18500", "7k2m 18500", "Ref 7K2M 18500", "7K2M rs 18500",
//   "7K2M  Rs. 18,500", extra spaces, mixed case.
// We pull out (a) the 4-char load reference code and (b) the rupee amount.

// Reference-code alphabet is fixed by generate_load_reference_code() in
// migration 0015: 4 chars drawn from A–Z and 2–9 EXCLUDING the visually
// ambiguous glyphs I, L, O, 0, 1. This class lists exactly that set.
const REF_ALPHABET = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}$/
// A real code contains at least one letter in practice; requiring one keeps a
// bare 4-digit amount (e.g. "2345") from being mistaken for a code. The final
// authority is still a DB lookup by the caller.
const HAS_LETTER = /[ABCDEFGHJKMNPQRSTUVWXYZ]/

export type ParsedBidMessage = {
  // Best single reference-code candidate (uppercased), or null if none.
  refCode: string | null
  // All format-valid candidates, so the caller can match any against the DB.
  refCandidates: string[]
  // Parsed whole-rupee amount, or null if absent / not a positive whole number.
  amountRupees: number | null
  // The raw numeric token we saw (for diagnostics / distinguishing
  // "no number" from "number we rejected", e.g. a decimal).
  amountRaw: string | null
}

export function parseBidMessage(text: string): ParsedBidMessage {
  const upper = (text ?? '').toUpperCase().trim()

  // Match all potential alphanumeric/hyphenated reference code tokens (e.g., "7K2M", "LOAD-2026-089", "LOAD-001")
  const rawTokens = upper.match(/[A-Z0-9-]+/g) ?? []

  // Filter reference candidates
  const refCandidates: string[] = []
  for (const t of rawTokens) {
    const clean = t.replace(/[^A-Z0-9-]/g, '')
    if (!clean) continue
    // Matches 4-char codes (7K2M), LOAD-prefixed codes (LOAD-2026-089), or 4-12 char alphanumeric codes
    if (
      (clean.length === 4 && HAS_LETTER.test(clean)) ||
      clean.startsWith('LOAD') ||
      (clean.length >= 4 && clean.length <= 16 && /[A-Z]/.test(clean) && /\d/.test(clean))
    ) {
      refCandidates.push(clean)
    }
  }

  const refCode = refCandidates[0] ?? null

  // Remove the chosen code before hunting for the amount so its digits can't be
  // read as money. Then drop thousands-separator commas ("18,500" -> "18500").
  let amountSource = upper
  if (refCode) amountSource = amountSource.split(refCode).join(' ')
  amountSource = amountSource.replace(/,/g, '')

  const numMatch = amountSource.match(/\d+(?:\.\d+)?/)
  const amountRaw = numMatch ? numMatch[0] : null

  let amountRupees: number | null = null
  if (amountRaw !== null) {
    const n = Number(amountRaw)
    // Mirror the web bid form (app/t/loads/[id]/actions.ts): positive WHOLE
    // rupees only. "18500" and "18500.00" pass; "18500.50" is rejected as an
    // invalid amount rather than silently rounded.
    if (Number.isFinite(n) && n > 0 && Number.isInteger(n)) {
      amountRupees = n
    }
  }

  return { refCode, refCandidates, amountRupees, amountRaw }
}
