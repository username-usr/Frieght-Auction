// Display helpers shared between server and client components.

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

// Currency is stored in paise (1 INR = 100 paise) per Phase 1 schema.
// Returns "₹14,000" — Indian comma grouping, no decimals.
// Pass null/undefined for "—" to render the empty cell.
export function formatINR(paise: number | null | undefined): string {
  if (paise == null) return '—'
  return INR.format(paise / 100)
}

// "just now" / "5 minutes ago" / "2 hours ago" / "3 days ago".
// Falls back to absolute date past 30 days. Custom rather than date-fns to
// avoid an extra dep — the rule set is small.
export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000)

  if (seconds < 30) return 'just now'
  if (seconds < 60) return `${seconds} seconds ago`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`

  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`

  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

const IST_FMT = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

// "8 May 2026, 14:30 IST" — used for pickup deadlines and other absolute
// timestamps where ambiguity around timezone matters.
export function formatAbsoluteIST(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return `${IST_FMT.format(d)} IST`
}
