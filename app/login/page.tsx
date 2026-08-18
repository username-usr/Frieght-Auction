import { Toaster } from 'sonner'
import { BrandMark } from '@/components/brand-mark'
import { LoginForm } from './login-form'

export default function LoginPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-50 px-4 py-12 sm:p-8">
      <div className="pointer-events-none absolute -right-48 -top-48 h-96 w-96 rounded-full bg-blue-100/60 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-48 -left-48 h-96 w-96 rounded-full bg-slate-200/70 blur-3xl" />
      <Toaster richColors position="top-right" closeButton />
      <div className="relative w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <BrandMark href="/login" label="Operator dashboard" priority />
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-lg sm:p-10">
          <div className="mb-7 h-1 w-10 rounded-full bg-blue-600" />
          <h1 className="text-3xl font-semibold text-slate-900">Welcome back</h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Sign in with your email and password to manage loads and freight bidding.
          </p>
          <LoginForm />
        </div>
      </div>
    </main>
  )
}
