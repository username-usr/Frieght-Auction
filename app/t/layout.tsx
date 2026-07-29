import { Toaster } from 'sonner'

// Root layout for the trucker preview portal. Unlike /dashboard, this
// layout does NOT enforce auth — the login and set-password pages live
// underneath it and need to render without a session. Per-page guards
// (requireTrucker() in lib/trucker.ts) protect the authenticated pages.

export default function TruckerLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-slate-50 antialiased selection:bg-slate-900 selection:text-white">
      <div className="bg-amber-200 text-amber-950">
        <div className="mx-auto max-w-2xl px-3 sm:px-6 py-2 text-center text-[11px] sm:text-xs font-semibold uppercase tracking-widest">
          Trucker Portal — Live Platform
        </div>
      </div>
      <Toaster richColors position="top-center" closeButton />
      <main className="mx-auto w-full max-w-2xl px-3 sm:px-6 py-4 sm:py-6 space-y-5">{children}</main>
    </div>
  )
}
