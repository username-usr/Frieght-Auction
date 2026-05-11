// Mirror of the enums and tables defined in supabase/migrations/0001_initial_schema.sql.
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

export type Operator = {
  id: string
  email: string
  full_name: string
  role: OperatorRole
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
  created_at: string
  updated_at: string
}

export type Load = {
  id: string
  origin_city: string
  destination_city: string
  truck_type_required: TruckType
  weight_kg: number
  pickup_deadline: string
  reference_price_paise: number | null
  notes: string | null
  status: LoadStatus
  posted_by: string
  created_at: string
  updated_at: string
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
