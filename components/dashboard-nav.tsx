'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Loads', exact: true },
  { href: '/dashboard/admin', label: 'Admin', exact: false },
]

export function DashboardNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname() ?? ''

  return (
    <nav aria-label="Operator navigation" className="flex items-center gap-1">
      {NAV_ITEMS.filter((item) => item.label !== 'Admin' || isAdmin).map(
        (item) => {
          const active = item.exact
            ? pathname === item.href || pathname.startsWith('/dashboard/loads')
            : pathname === item.href || pathname.startsWith(`${item.href}/`)

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`relative rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                active
                  ? 'bg-blue-50 text-blue-900'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {item.label}
            </Link>
          )
        }
      )}
    </nav>
  )
}
