'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export async function sendMagicLink(formData: FormData) {
  const email = (formData.get('email') as string | null)?.trim().toLowerCase()
  if (!email) {
    redirect('/login?error=' + encodeURIComponent('Email is required'))
  }

  // Build the absolute redirect URL Supabase will embed in the magic link.
  // We can't hardcode localhost because the same code runs on Vercel.
  const headersList = await headers()
  const host = headersList.get('host')
  const proto = headersList.get('x-forwarded-proto') ?? 'http'
  const origin = `${proto}://${host}`

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
    },
  })

  if (error) {
    redirect('/login?error=' + encodeURIComponent(error.message))
  }

  redirect('/login?sent=1&email=' + encodeURIComponent(email))
}
