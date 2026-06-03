import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

// Fetch up to 200 most recently saved addresses for the new-load form's
// <datalist> autocomplete. The cap keeps the payload small even after
// years of use — operators will only ever scan the first dozen anyway.
//
// Returns just the address strings (no id needed for autocomplete). Sorted
// newest-first so addresses an operator just posted bubble to the top.
export async function getSavedAddresses(): Promise<string[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('saved_addresses')
    .select('address')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => r.address as string)
}

// Idempotent "remember" — UPSERT with ignoreDuplicates so re-posting the
// same address doesn't pile up rows or error on the UNIQUE constraint.
// Called from the create-load action for origin + every destination after
// the load row has been written successfully.
//
// Accepts any SupabaseClient (authenticated or admin) because saved_addresses
// RLS allows operators to INSERT — the same authenticated client that did
// the load INSERT also has the right grant here. Pass whichever client the
// caller already has open.
export async function rememberAddress(
  supabase: SupabaseClient,
  address: string
): Promise<void> {
  const trimmed = address.trim()
  if (!trimmed) return
  await supabase
    .from('saved_addresses')
    .upsert(
      { address: trimmed },
      { onConflict: 'address', ignoreDuplicates: true }
    )
}
