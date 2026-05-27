import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import type { LookupOption } from '@/lib/types'
import { NewLoadForm } from './form'

export default async function NewLoadPage() {
  const supabase = await createClient()

  const [products, containers, quantities] = await Promise.all([
    supabase
      .from('product_names')
      .select('id, name')
      .is('deleted_at', null)
      .order('name', { ascending: true }),
    supabase
      .from('container_types')
      .select('id, name')
      .is('deleted_at', null)
      .order('name', { ascending: true }),
    supabase
      .from('quantity_units')
      .select('id, name')
      .is('deleted_at', null)
      .order('name', { ascending: true }),
  ])

  if (products.error) throw new Error(products.error.message)
  if (containers.error) throw new Error(containers.error.message)
  if (quantities.error) throw new Error(quantities.error.message)

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link
          href="/dashboard"
          className="text-sm text-slate-600 hover:text-slate-900"
        >
          ← Back to loads
        </Link>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
          New load
        </h2>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <NewLoadForm
          productOptions={(products.data ?? []) as LookupOption[]}
          containerOptions={(containers.data ?? []) as LookupOption[]}
          quantityUnitOptions={(quantities.data ?? []) as LookupOption[]}
        />
      </div>
    </div>
  )
}
