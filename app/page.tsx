import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

// Root URL just routes the user to the right place. Middleware also enforces
// auth on /dashboard, but doing the check here avoids a flash of redirect.
export default async function Home() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  redirect(user ? '/dashboard' : '/login')
}
