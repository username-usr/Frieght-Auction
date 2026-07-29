'use client'

import type { BidRowData } from '@/components/loads/bids-table-realtime'

export function ExportBidsButton({
  loadRefCode,
  bids,
  referencePricePaise,
}: {
  loadRefCode: string
  bids: BidRowData[]
  referencePricePaise: number | null
}) {
  const handleExportCSV = () => {
    if (bids.length === 0) return

    const headers = [
      'Bid ID',
      'Trucker Name',
      'Trucker Phone',
      'Truck Type',
      'Placed Via',
      'Bid Amount (INR)',
      'Reference Price (INR)',
      'Savings vs Target (INR)',
      'Status',
      'Submitted At',
    ]

    const rows = bids.map((b) => {
      const isManual = b.message_text?.toLowerCase().includes('manual')
      const channel = isManual ? 'Phone Call' : 'WhatsApp / Web'
      const amountRupees = b.amount_paise / 100
      const refRupees = referencePricePaise ? referencePricePaise / 100 : null
      const savingsRupees = refRupees ? refRupees - amountRupees : null

      return [
        b.id,
        `"${b.trucker?.full_name ?? 'Trucker'}"`,
        `"${b.trucker?.phone_e164 ?? ''}"`,
        `"${b.trucker?.truck_type ?? ''}"`,
        `"${channel}"`,
        amountRupees,
        refRupees ?? 'N/A',
        savingsRupees !== null ? savingsRupees : 'N/A',
        b.status,
        `"${new Date(b.created_at).toLocaleString('en-IN')}"`,
      ]
    })

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `bids_report_${loadRefCode}_${Date.now()}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <button
      type="button"
      onClick={handleExportCSV}
      disabled={bids.length === 0}
      className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 transition-colors"
    >
      <svg className="h-3.5 w-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
      </svg>
      Export CSV
    </button>
  )
}
