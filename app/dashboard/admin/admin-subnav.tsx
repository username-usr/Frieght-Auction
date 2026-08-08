'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS: { href: string; label: string }[] = [
  { href: '/dashboard/admin/truckers', label: 'Truckers' },
  { href: '/dashboard/admin/loads', label: 'Loads' },
  { href: '/dashboard/admin/zones', label: 'Zones' },
  { href: '/dashboard/admin/users', label: 'Users' },
]

// Active state is derived from the URL with usePathname() — startsWith()
// rather than equality so future nested routes (e.g. /admin/loads/123) still
// keep the parent tab highlighted.
export function AdminSubNav() {
  const pathname = usePathname() ?? ''

  return (
    <div className="overflow-x-auto scrollbar-none">
      <nav className="inline-flex min-w-full gap-1 rounded-xl border border-slate-200 bg-white p-1.5 whitespace-nowrap sm:min-w-0">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={
              active
                ? 'rounded-lg bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-900'
                : 'rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900'
            }
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
    </div>
  )
}
