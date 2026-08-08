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
    <div className="scrollbar-none flex max-w-full gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 sm:inline-flex">
      {FILTERS.map((f) => {
        const active = f.value === current
        return (
          <Link
            key={f.value}
            href={`/dashboard?status=${f.value}`}
            className={`shrink-0 rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors ${
              active
                ? 'bg-blue-50 text-blue-900'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            {f.label}
          </Link>
        )
      })}
    </div>
  )
}
