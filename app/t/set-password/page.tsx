import { redirect } from 'next/navigation'
import { SetPasswordForm } from './form'

export const dynamic = 'force-dynamic'

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ phone?: string }>
}) {
  const { phone } = await searchParams
  if (!phone) redirect('/t/login')

  return (
    <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <div>
        <div className="mb-6 h-1 w-10 rounded-full bg-blue-600" />
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Set your password
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Phone <span className="font-mono text-slate-900">{phone}</span>.
          First-time setup — choose a password you&apos;ll remember.
        </p>
      </div>
      <SetPasswordForm phone={phone} />
    </div>
  )
}
