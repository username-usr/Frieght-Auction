// Mirror of the enums and tables defined in supabase/migrations/.
// Keep this in sync when the schema changes. Running `pnpm supabase gen types typescript`
// is the more thorough alternative once the project grows; for now the surface is small
// enough to maintain by hand.

export type TruckType =
  | 'open'
  | 'container'
  | 'trailer'
  | 'tanker'
  | 'refrigerated'
  | 'other'

export type LoadStatus = 'open' | 'awarded' | 'cancelled' | 'completed'
export type BidStatus = 'active' | 'won' | 'lost' | 'withdrawn'
export type DeliveryStatus =
  | 'pending_pickup'
  | 'in_transit'
  | 'delivered'
  | 'cancelled'
export type OperatorRole = 'admin' | 'operator'
export type TruckerStatus = 'active' | 'inactive' | 'blocked'
export type MessageDirection = 'inbound' | 'outbound'
export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed'

// Closed set enforced by a CHECK constraint on loads.weight_unit (0008).
// Not a Postgres enum because the values are unlikely to grow and a CHECK is
// easier to evolve.
export type WeightUnit = 'kg' | 'liters'

// Shape of a single row from any of the admin-managed lookup tables
// (product_names, container_types, quantity_units, zones). Used by dropdowns
// across the new-load form and the /dashboard/admin UI.
export type LookupOption = {
  id: string
  name: string
}

export type Operator = {
  id: string
  email: string
  full_name: string
  role: OperatorRole
  zone_id: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

export type Trucker = {
  id: string
  phone_e164: string
  full_name: string | null
  truck_type: TruckType
  home_base_city: string | null
  status: TruckerStatus
  onboarding_state: Record<string, unknown>
  archived_at: string | null
  created_at: string
  updated_at: string
}

// Admin-managed lookup of regional zones (migration 0014). Soft-delete via
// deleted_at; rows with deleted_at IS NULL are the "active" set surfaced in
// dropdowns and the admin list.
export type Zone = {
  id: string
  name: string
  created_at: string
  deleted_at: string | null
}

export type Load = {
  id: string
  reference_code: string
  origin_address: string
  destination_address: string
  truck_type_required: TruckType
  pickup_deadline: string
  reference_price_paise: number | null
  notes: string | null
  status: LoadStatus
  posted_by: string
  zone_id: string | null
  created_at: string
  updated_at: string
}

// One product on a load. Each load has 1+ items (migration 0010).
// `position` gives a stable display order within a load.
//
// weight_value and quantity_value are NUMERIC in Postgres. supabase-js may
// return numeric columns as strings to preserve precision; consumers that
// read these from the API should call Number() at the display boundary.
// We type them as `number` here to keep the canonical type clean — pages
// that read raw API rows declare their own `number | string` row shapes.
export type LoadItem = {
  id: string
  load_id: string
  position: number
  product_name_id: string
  container_type_id: string
  quantity_value: number
  quantity_unit_id: string
  weight_value: number
  weight_unit: WeightUnit
  created_at: string
}

// Per-load whitelist of truckers that may see the load (migration 0015).
// Composite primary key (load_id, trucker_id); no surrogate id column.
export type LoadTruckerVisibility = {
  load_id: string
  trucker_id: string
  created_at: string
}

export type Bid = {
  id: string
  load_id: string
  trucker_id: string
  amount_paise: number
  message_text: string | null
  status: BidStatus
  created_at: string
}

export type Shipment = {
  id: string
  load_id: string
  winning_bid_id: string
  awarded_by: string
  awarded_at: string
  delivery_status: DeliveryStatus
}
