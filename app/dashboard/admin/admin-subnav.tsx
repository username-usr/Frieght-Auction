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
    <div className="border-b border-slate-200 overflow-x-auto scrollbar-none">
      <nav className="-mb-px flex gap-4 sm:gap-6 whitespace-nowrap">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={
              active
                ? 'border-b-2 border-blue-900 px-1 pb-3 text-sm font-semibold text-blue-900'
                : 'border-b-2 border-transparent px-1 pb-3 text-sm font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900'
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
