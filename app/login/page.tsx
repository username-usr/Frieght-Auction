import { Toaster } from 'sonner'
import { LoginForm } from './login-form'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string; email?: string }>
}) {
  const { sent, email } = await searchParams

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <Toaster richColors position="top-right" closeButton />
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
            Enter your email for a magic link, or sign in with a password.
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
            <LoginForm />
          )}
        </div>
      </div>
    </main>
  )
}
