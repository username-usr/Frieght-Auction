'use server'

import { revalidatePath } from 'next/cache'
import { getOperatorContext } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  actionFailure,
  actionSuccess,
  ExpectedActionError,
  type ActionResult,
} from '@/lib/action-result'
import type { TruckType } from '@/lib/types'

// Server actions for the truckers admin sub-page.
//
// All writes use the admin (service_role) Supabase client — truckers RLS
// policies in 0001 require is_operator() and writes from a non-operator
// account would silently no-op. Going through the admin client bypasses RLS
// entirely; the isAdmin() check at the top of each action gates access.
//
// State-toggle actions (suspend / reactivate / archive / unarchive) accept
// just an id so they can be used directly as <form action={fn.bind(null, id)}>
// from the listing page. Next.js will pass FormData as an extra arg after
// the bound id; JS ignores the unused arg.

const VALID_TRUCK_TYPES: TruckType[] = [
  'open',
  'container',
  'trailer',
  'tanker',
  'refrigerated',
  'other',
]

const PHONE_RE = /^\+\d{10,15}$/

export type TruckerRow = {
  id: string
  phone_e164: string
  secondary_phone: string | null
  full_name: string | null
  truck_type: TruckType
  status: 'active' | 'inactive' | 'blocked'
  archived_at: string | null
  created_at: string
}

async function requireAdmin(): Promise<void> {
  const { isAdmin } = await getOperatorContext()
  if (!isAdmin) {
    throw new Error('Admin role required to manage truckers.')
  }
}

function validateTruckType(value: string): asserts value is TruckType {
  if (!VALID_TRUCK_TYPES.includes(value as TruckType)) {
    throw new Error('Invalid truck type.')
  }
}

export type AddTruckerInput = {
  phone_e164: string
  secondary_phone: string | null
  full_name: string | null
  truck_type: TruckType
}

async function addTrucker(
  input: AddTruckerInput
): Promise<TruckerRow> {
  await requireAdmin()

  const phone = input.phone_e164.trim()
  if (!PHONE_RE.test(phone)) {
    throw new ExpectedActionError(
      'Phone must be in E.164 format (e.g. +919876543210).',
      'phone_e164'
    )
  }
  // Secondary phone is optional. When provided it must be the same E.164
  // shape and must differ from the primary — same number on both fields
  // would be confusing and offers no real fallback.
  const secondaryPhone = input.secondary_phone?.trim() || null
  if (secondaryPhone && !PHONE_RE.test(secondaryPhone)) {
    throw new ExpectedActionError(
      'Secondary phone must be in E.164 format (e.g. +919876543210).',
      'secondary_phone'
    )
  }
  if (secondaryPhone && secondaryPhone === phone) {
    throw new ExpectedActionError(
      'Secondary phone must be different from primary phone.',
      'secondary_phone'
    )
  }
  validateTruckType(input.truck_type)
  const fullName = input.full_name?.trim() || null
  if (fullName && fullName.length > 200) {
    throw new ExpectedActionError(
      'Full name must be 200 characters or fewer.',
      'full_name'
    )
  }

  const supabase = createAdminClient()

  // Phone is the trucker's login identifier — uniqueness matters. Reject
  // both active and archived duplicates so we never have two rows with the
  // same phone (FK invariants downstream would be ambiguous).
  const { data: existing, error: lookupErr } = await supabase
    .from('truckers')
    .select('id')
    .eq('phone_e164', phone)
    .maybeSingle()
  if (lookupErr) throw new Error(lookupErr.message)
  if (existing) {
    throw new ExpectedActionError(
      'This phone number is already registered to another trucker.',
      'phone_e164'
    )
  }

  const { data, error } = await supabase
    .from('truckers')
    .insert({
      phone_e164: phone,
      secondary_phone: secondaryPhone,
      full_name: fullName,
      truck_type: input.truck_type,
      status: 'active',
      archived_at: null,
      onboarding_state: {},
      password_hash: null,
    })
    .select(
      'id, phone_e164, secondary_phone, full_name, truck_type, status, archived_at, created_at'
    )
    .single()
  if (error?.code === '23505') {
    throw new ExpectedActionError(
      'This phone number is already registered to another trucker.',
      'phone_e164'
    )
  }
  if (error) throw new Error(error.message)

  revalidatePath('/dashboard/admin/truckers')
  return data as TruckerRow
}

export async function addTruckerAction(
  input: AddTruckerInput
): Promise<ActionResult<TruckerRow>> {
  try {
    return actionSuccess(await addTrucker(input))
  } catch (error) {
    return actionFailure(
      error,
      'Could not add the trucker. Please try again.',
      'addTruckerAction'
    )
  }
}

export type UpdateTruckerInput = {
  secondary_phone: string | null
  full_name: string | null
  truck_type: TruckType
}

async function updateTrucker(
  id: string,
  input: UpdateTruckerInput
): Promise<TruckerRow> {
  await requireAdmin()

  if (!id) throw new Error('id is required.')
  validateTruckType(input.truck_type)
  const fullName = input.full_name?.trim() || null
  if (fullName && fullName.length > 200) {
    throw new ExpectedActionError(
      'Full name must be 200 characters or fewer.',
      'full_name'
    )
  }

  const secondaryPhone = input.secondary_phone?.trim() || null
  if (secondaryPhone && !PHONE_RE.test(secondaryPhone)) {
    throw new ExpectedActionError(
      'Secondary phone must be in E.164 format (e.g. +919876543210).',
      'secondary_phone'
    )
  }

  const supabase = createAdminClient()

  // Secondary-vs-primary collision check uses the row's existing phone
  // (primary is immutable, so we can lock against it without re-fetching
  // the form's primary copy from the client).
  if (secondaryPhone) {
    const { data: existing, error: lookupErr } = await supabase
      .from('truckers')
      .select('phone_e164')
      .eq('id', id)
      .maybeSingle()
    if (lookupErr) throw new Error(lookupErr.message)
    if (existing && existing.phone_e164 === secondaryPhone) {
      throw new ExpectedActionError(
        'Secondary phone must be different from primary phone.',
        'secondary_phone'
      )
    }
  }

  // Only update full_name, truck_type, and secondary_phone. phone, status,
  // archived_at, onboarding_state, and password_hash are managed via
  // dedicated actions or are immutable.
  const { data, error } = await supabase
    .from('truckers')
    .update({
      full_name: fullName,
      truck_type: input.truck_type,
      secondary_phone: secondaryPhone,
    })
    .eq('id', id)
    .select(
      'id, phone_e164, secondary_phone, full_name, truck_type, status, archived_at, created_at'
    )
    .single()
  if (error) throw new Error(error.message)

  revalidatePath('/dashboard/admin/truckers')
  return data as TruckerRow
}

export async function updateTruckerAction(
  id: string,
  input: UpdateTruckerInput
): Promise<ActionResult<TruckerRow>> {
  try {
    return actionSuccess(await updateTrucker(id, input))
  } catch (error) {
    return actionFailure(
      error,
      'Could not update the trucker. Please try again.',
      'updateTruckerAction'
    )
  }
}

export async function suspendTruckerAction(id: string): Promise<void> {
  await requireAdmin()
  if (!id) throw new Error('id is required.')

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('truckers')
    .update({ status: 'blocked' })
    .eq('id', id)
    .eq('status', 'active')
    .is('archived_at', null)
  if (error) throw new Error(error.message)

  revalidatePath('/dashboard/admin/truckers')
}

export async function reactivateTruckerAction(id: string): Promise<void> {
  await requireAdmin()
  if (!id) throw new Error('id is required.')

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('truckers')
    .update({ status: 'active' })
    .eq('id', id)
    .eq('status', 'blocked')
    .is('archived_at', null)
  if (error) throw new Error(error.message)

  revalidatePath('/dashboard/admin/truckers')
}

export async function archiveTruckerAction(id: string): Promise<void> {
  await requireAdmin()
  if (!id) throw new Error('id is required.')

  // Archive is independent of status — a blocked trucker can be archived,
  // and the underlying status is preserved so unarchive returns them to
  // their previous (active or blocked) state.
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('truckers')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .is('archived_at', null)
  if (error) throw new Error(error.message)

  revalidatePath('/dashboard/admin/truckers')
}

export async function unarchiveTruckerAction(id: string): Promise<void> {
  await requireAdmin()
  if (!id) throw new Error('id is required.')

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('truckers')
    .update({ archived_at: null })
    .eq('id', id)
    .not('archived_at', 'is', null)
  if (error) throw new Error(error.message)

  revalidatePath('/dashboard/admin/truckers')
}

export async function resetTruckerPasswordAction(id: string): Promise<void> {
  await requireAdmin()
  if (!id) throw new Error('id is required.')

  const supabase = createAdminClient()
  // Reset the trucker to first-login state. Clearing onboarding_state
  // ensures the password-set flow appears on next login; clearing
  // password_hash means the old password is permanently invalidated.
  // We only operate on non-archived truckers — archived accounts must
  // be unarchived first.
  const { error } = await supabase
    .from('truckers')
    .update({
      password_hash: null,
      onboarding_state: {},
    })
    .eq('id', id)
    .is('archived_at', null)
  if (error) throw new Error(error.message)

  revalidatePath('/dashboard/admin/truckers')
}
