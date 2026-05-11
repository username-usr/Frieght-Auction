import { sendMagicLink } from './actions'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string; email?: string }>
}) {
  const { error, sent, email } = await searchParams

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900">
            Ramnath Logistics
          </h2>
          <p className="mt-1 text-xs font-medium uppercase tracking-widest text-slate-500">
            Operator Dashboard
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Sign in</h1>
          <p className="mt-2 text-sm text-slate-700">
            Enter your email and we&apos;ll send you a magic link.
          </p>

        {sent ? (
          <div className="mt-6 rounded-md bg-green-50 p-4 text-sm text-green-900">
            <p className="font-medium">Check your inbox.</p>
            <p className="mt-1">
              We sent a sign-in link
              {email ? (
                <>
                  {' '}to <span className="font-mono">{email}</span>
                </>
              ) : null}
              . You can close this tab once you click the link.
            </p>
          </div>
        ) : (
          <form action={sendMagicLink} className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-slate-700"
              >
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="you@ramnath.in"
                className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-500 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2"
            >
              Send magic link
            </button>
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
          </form>
        )}
        </div>
      </div>
    </main>
  )
}
