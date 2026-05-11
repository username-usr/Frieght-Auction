'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'

// Renders nothing. Watches for `?posted=<load_id>` arriving on /dashboard,
// fires a success toast once, then strips the param from the URL via
// history.replaceState so back/forward doesn't re-fire it.
//
// Step 3 will replace this with a redirect to /dashboard/loads/<id>, at
// which point this component goes away.
export function PostedToast() {
  const fired = useRef(false)
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    if (fired.current) return
    if (!searchParams.get('posted')) return
    fired.current = true
    toast.success('Load posted')

    const next = new URLSearchParams(searchParams.toString())
    next.delete('posted')
    const qs = next.toString()
    // history.replaceState (rather than router.replace) avoids a full
    // server round-trip just to drop one query param.
    window.history.replaceState({}, '', `${pathname}${qs ? `?${qs}` : ''}`)
  }, [pathname, searchParams])

  return null
}
