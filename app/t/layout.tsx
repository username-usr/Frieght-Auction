import { Toaster } from 'sonner'
import { BrandMark } from '@/components/brand-mark'

// Root layout for the trucker portal. Per-page guards protect authenticated
// routes because login and first-time password setup also live under /t.
export default function TruckerLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-slate-50 antialiased">
      <div className="h-1 bg-blue-600" />
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex min-h-17 max-w-2xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <BrandMark href="/t/loads" label="Trucker portal" priority compact />
          <span className="rounded-full bg-green-50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-green-800">
            Live
          </span>
        </div>
      </header>
      <Toaster richColors position="top-center" closeButton />
      <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
        {children}
      </main>
    </div>
  )
}
