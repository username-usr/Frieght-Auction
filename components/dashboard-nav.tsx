'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { BrandMark } from '@/components/brand-mark'

type NavItem = {
  href: string
  label: string
  exact?: boolean
  icon: React.ReactNode
}

export function SidebarNav({
  isAdmin,
  operator,
  signOutAction,
}: {
  isAdmin: boolean
  operator: { full_name: string; email?: string; role: string }
  signOutAction: () => Promise<void>
}) {
  const pathname = usePathname() ?? ''
  const [mobileOpen, setMobileOpen] = useState(false)

  const navItems: NavItem[] = [
    {
      href: '/dashboard',
      label: 'Loads',
      exact: true,
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      ),
    },
    {
      href: '/dashboard/loads/new',
      label: 'Post New Load',
      exact: false,
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 4v16m8-8H4" />
        </svg>
      ),
    },
  ]

  if (isAdmin) {
    navItems.push(
      {
        href: '/dashboard/admin/truckers',
        label: 'Fleet & Truckers',
        icon: (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M8 17a2 2 0 100 4 2 2 0 000-4zm10 0a2 2 0 100 4 2 2 0 000-4zM4 9h11v6H4V9zm11 0h3l3 3v3h-6V9z" />
          </svg>
        ),
      },
      {
        href: '/dashboard/admin/loads',
        label: 'Cargo & Items',
        icon: (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        ),
      },
      {
        href: '/dashboard/admin/zones',
        label: 'Zones & Locations',
        icon: (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        ),
      },
      {
        href: '/dashboard/admin/users',
        label: 'Operators & Users',
        icon: (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
        ),
      }
    )
  }

  const renderNavLinks = () => (
    <nav className="mt-1 space-y-0.5 px-2.5">
      {navItems.map((item) => {
        const isActive = item.exact
          ? pathname === item.href || (item.href === '/dashboard' && pathname.startsWith('/dashboard/loads/'))
          : pathname === item.href || pathname.startsWith(`${item.href}/`)

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileOpen(false)}
            className={`group flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-all ${
              isActive
                ? 'bg-blue-600 text-white shadow-xs font-semibold'
                : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900'
            }`}
          >
            <span className={isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-600 transition-colors'}>
              {item.icon}
            </span>
            <span>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:flex lg:w-60 lg:flex-col lg:border-r lg:border-slate-200 lg:bg-white">
        {/* Brand Logo Header */}
        <div className="flex h-16 items-center border-b border-slate-200/80 bg-white px-4.5">
          <BrandMark href="/dashboard" label="Freight Platform" compact priority />
        </div>

        {/* Navigation items */}
        <div className="flex-1 overflow-y-auto py-3">
          <div className="px-3.5 mb-1.5">
            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Navigation</span>
          </div>
          {renderNavLinks()}
        </div>

        {/* User Footer */}
        <div className="border-t border-slate-200/80 p-3 bg-white">
          <div className="flex items-center gap-2.5 rounded-lg bg-slate-100/70 border border-slate-200/60 p-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold uppercase text-white shadow-xs">
              {operator.full_name.trim().charAt(0) || 'R'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-slate-900">{operator.full_name}</p>
              <p className="truncate text-[9px] font-bold uppercase tracking-wider text-blue-700">{operator.role}</p>
            </div>
            <form action={signOutAction}>
              <button
                type="submit"
                title="Sign Out"
                className="rounded-md p-1 text-slate-400 hover:bg-slate-200/80 hover:text-slate-700 transition-colors"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </form>
          </div>
        </div>
      </aside>

      {/* Mobile Top Header */}
      <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur-md lg:hidden">
        <BrandMark href="/dashboard" label="Freight Platform" compact priority />
        <button
          type="button"
          onClick={() => setMobileOpen(!mobileOpen)}
          className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
          aria-label="Toggle Navigation"
        >
          {mobileOpen ? (
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="relative flex w-4/5 max-w-xs flex-1 flex-col bg-white pt-4 pb-4 shadow-xl">
            <div className="flex items-center justify-between px-4 pb-3 border-b border-slate-200">
              <span className="text-xs font-bold text-slate-900">Navigation</span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-md p-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-2">
              {renderNavLinks()}
            </div>
            <div className="border-t border-slate-200 p-3 bg-slate-50/50">
              <div className="flex items-center justify-between">
                <div className="min-w-0 pr-2">
                  <p className="truncate text-xs font-semibold text-slate-900">{operator.full_name}</p>
                  <p className="text-[9px] font-bold text-blue-700 uppercase tracking-wider">{operator.role}</p>
                </div>
                <form action={signOutAction}>
                  <button
                    type="submit"
                    className="rounded-md bg-slate-200/80 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-300/80 transition-colors"
                  >
                    Sign out
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
