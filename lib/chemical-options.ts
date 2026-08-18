import { createAdminClient } from '@/lib/supabase/admin'
import type { LookupOption } from '@/lib/types'

export const DEFAULT_CHEMICAL_PRODUCTS = [
  'Caustic Soda Lye',
  'Hydrochloric Acid (HCL 33%)',
  'Ethyl Acetate',
  'Toluene (Industrial Grade)',
  'Acetone',
  'Methanol (Pure Grade)',
  'Soda Ash Dense',
  'Sulphuric Acid (98%)',
  'Nitric Acid (68%)',
  'Polypropylene Glycol (PPG)',
  'Liquid Resins',
  'Industrial Solvents',
]

export const DEFAULT_CHEMICAL_CONTAINERS = [
  'ISO Tank Container (20ft)',
  'IBC Tote (1000L)',
  'HDPE Chemical Drum (210L)',
  'Steel Drum (200L)',
  'Road Tanker (24,000L)',
  'Road Tanker (18,000L)',
  'Jumbo Bag (1 MT)',
  'HDPE Bag (50 kg)',
  'Carboy (50L)',
]

export const DEFAULT_CHEMICAL_UNITS = [
  'Drums',
  'IBC Totes',
  'ISO Tanks',
  'Tankers',
  'Bags',
  'Carboys',
  'Metric Tonnes (MT)',
  'Liters',
  'Kilograms (Kg)',
]

export async function ensureChemicalLookupOptions(): Promise<{
  products: LookupOption[]
  containers: LookupOption[]
  quantities: LookupOption[]
}> {
  const admin = createAdminClient()

  // 1. Products
  const { data: existingProducts } = await admin
    .from('product_names')
    .select('id, name')
    .is('deleted_at', null)

  const existingProdNames = new Set((existingProducts ?? []).map((p) => p.name))
  const newProducts = DEFAULT_CHEMICAL_PRODUCTS.filter((p) => !existingProdNames.has(p))
  if (newProducts.length > 0) {
    await admin.from('product_names').insert(newProducts.map((name) => ({ name })))
  }

  // 2. Containers
  const { data: existingContainers } = await admin
    .from('container_types')
    .select('id, name')
    .is('deleted_at', null)

  const existingContNames = new Set((existingContainers ?? []).map((c) => c.name))
  const newContainers = DEFAULT_CHEMICAL_CONTAINERS.filter((c) => !existingContNames.has(c))
  if (newContainers.length > 0) {
    await admin.from('container_types').insert(newContainers.map((name) => ({ name })))
  }

  // 3. Units
  const { data: existingUnits } = await admin
    .from('quantity_units')
    .select('id, name')
    .is('deleted_at', null)

  const existingUnitNames = new Set((existingUnits ?? []).map((u) => u.name))
  const newUnits = DEFAULT_CHEMICAL_UNITS.filter((u) => !existingUnitNames.has(u))
  if (newUnits.length > 0) {
    await admin.from('quantity_units').insert(newUnits.map((name) => ({ name })))
  }

  // Fetch complete lists
  const [resP, resC, resQ] = await Promise.all([
    admin.from('product_names').select('id, name').is('deleted_at', null).order('name', { ascending: true }),
    admin.from('container_types').select('id, name').is('deleted_at', null).order('name', { ascending: true }),
    admin.from('quantity_units').select('id, name').is('deleted_at', null).order('name', { ascending: true }),
  ])

  return {
    products: (resP.data ?? []) as LookupOption[],
    containers: (resC.data ?? []) as LookupOption[],
    quantities: (resQ.data ?? []) as LookupOption[],
  }
}
