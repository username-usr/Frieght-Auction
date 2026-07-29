'use client'

import { useState, useTransition } from 'react'
import { broadcastWhatsAppAlertAction } from './actions'

export function BroadcastWhatsAppButton({ loadId }: { loadId: string }) {
  const [isPending, startTransition] = useTransition()
  const [statusMsg, setStatusMsg] = useState<string | null>(null)

  const handleBroadcast = () => {
    startTransition(async () => {
      setStatusMsg(null)
      try {
        const summary = await broadcastWhatsAppAlertAction(loadId)
        setStatusMsg(`Sent to ${summary.sent}/${summary.recipients} truckers`)
        setTimeout(() => setStatusMsg(null), 5000)
      } catch (err) {
        setStatusMsg(err instanceof Error ? err.message : 'Broadcast failed')
      }
    })
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={handleBroadcast}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 shadow-sm hover:bg-emerald-100 disabled:opacity-60 transition-colors"
      >
        <svg className="h-3.5 w-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
        </svg>
        {isPending ? 'Sending WhatsApp…' : 'Send WhatsApp Alert'}
      </button>

      {statusMsg && (
        <span className="absolute top-full left-0 mt-1 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-bold text-white shadow-lg">
          {statusMsg}
        </span>
      )}
    </div>
  )
}
