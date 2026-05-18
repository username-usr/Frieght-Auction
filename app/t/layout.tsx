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
    <div className="min-h-screen bg-slate-50">
      <div className="bg-amber-200 text-amber-950">
        <div className="mx-auto max-w-md px-4 py-2 text-center text-xs font-semibold uppercase tracking-widest">
          Trucker Portal — Preview
        </div>
      </div>
      <Toaster richColors position="top-center" closeButton />
      <main className="mx-auto max-w-md px-4 py-6">{children}</main>
    </div>
  )
}
