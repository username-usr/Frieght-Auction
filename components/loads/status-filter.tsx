import Link from 'next/link'
import type { LoadStatus } from '@/lib/types'

type FilterValue = LoadStatus | 'all'

const FILTERS: { label: string; value: FilterValue }[] = [
  { label: 'Open', value: 'open' },
  { label: 'Awarded', value: 'awarded' },
  { label: 'Cancelled', value: 'cancelled' },
  { label: 'Completed', value: 'completed' },
  { label: 'All', value: 'all' },
]

// URL-driven so the filter survives refresh and is shareable. The selected
// pill renders as a white card on a slate background — matches the rest of
// the slate palette.
export function StatusFilter({ current }: { current: FilterValue }) {
  return (
    <div className="inline-flex rounded-md border border-slate-200 bg-slate-100 p-1">
      {FILTERS.map((f) => {
        const active = f.value === current
        return (
          <Link
            key={f.value}
            href={`/dashboard?status=${f.value}`}
            className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              active
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {f.label}
          </Link>
        )
      })}
    </div>
  )
}
