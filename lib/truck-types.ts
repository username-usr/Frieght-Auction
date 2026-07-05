import type { TruckType } from '@/lib/types'

// Human labels for the truck_type enum. Single source of truth for
// PROGRAMMATIC labels — places that render a truck type as plain text with no
// CSS `capitalize` to lean on, e.g. WhatsApp template bodies.
//
// Labels intentionally match the operator UI's dropdown options in
// app/dashboard/loads/new/form.tsx (TRUCK_TYPES). Those client-side option
// arrays predate this file and are left as-is; if you later want a single
// definition, they can be derived from this map.
export const TRUCK_TYPE_LABELS: Record<TruckType, string> = {
  open: 'Open',
  container: 'Container',
  trailer: 'Trailer',
  tanker: 'Tanker',
  refrigerated: 'Refrigerated',
  other: 'Other',
}

// Tolerant lookup: falls back to the raw value for any unrecognized string so
// an unexpected enum value never blanks out or throws.
export function truckTypeLabel(truckType: string): string {
  return TRUCK_TYPE_LABELS[truckType as TruckType] ?? truckType
}
