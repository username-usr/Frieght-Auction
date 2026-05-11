'use client'

import { useCallback, useState } from 'react'

// Tracks which row ids are currently "flashing" (highlighted to show that a
// realtime change just landed on that row). Returns the current set + a
// trigger that adds an id and removes it after `holdMs`. The CSS transition
// timing on the consumer's <tr> is what draws the actual fade.
//
// Used by both loads-table.tsx and bids-table-realtime.tsx so they stay in
// sync visually.
export function useRowFlash(holdMs = 1000) {
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set())

  const flashRow = useCallback(
    (id: string) => {
      setFlashIds((prev) => {
        const next = new Set(prev)
        next.add(id)
        return next
      })
      setTimeout(() => {
        setFlashIds((prev) => {
          if (!prev.has(id)) return prev
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }, holdMs)
    },
    [holdMs]
  )

  return { flashIds, flashRow }
}
