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
import type { OperatorRole } from '@/lib/types'

// Server actions for the users admin sub-page.
//
// Writes go through the service-role client so the Supabase Auth admin API
// (createUser / deleteUser) is reachable and the operators table writes
// aren't blocked by RLS. Every action is gated by requireAdmin() — which
// also returns the current admin's operator row so the action can compare
// against self for the "can't demote yourself" / "can't archive yourself"
// guards. These guards live in the actions (not just the UI) so a malicious
// or buggy client can't bypass them.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VALID_ROLES: OperatorRole[] = ['admin', 'operator']
const PASSWORD_MIN = 8
const FULL_NAME_MAX = 200

export type OperatorRow = {
  id: string
  email: string
  full_name: string
  role: OperatorRole
  zone_id: string | null
  archived_at: string | null
  created_at: string
}

async function requireAdmin() {
  const { isAdmin, operator } = await getOperatorContext()
  if (!isAdmin || !operator) {
    throw new Error('Admin role required to manage users.')
  }
  return operator
}

function validateRole(value: string): asserts value is OperatorRole {
  if (!VALID_ROLES.includes(value as OperatorRole)) {
    throw new ExpectedActionError('Role must be admin or operator.', 'role')
  }
}

function validateFullName(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new ExpectedActionError('Full name is required.', 'full_name')
  if (trimmed.length > FULL_NAME_MAX) {
    throw new ExpectedActionError(
      `Full name must be ${FULL_NAME_MAX} characters or fewer.`,
      'full_name'
    )
  }
  return trimmed
}

// Returns the validated zone_id (or null). Confirms the zone exists and
// isn't soft-deleted when a non-null id is supplied — prevents UI staleness
// from sneaking a deleted zone into an operator row.
async function validateZoneId(
  zoneId: string | null,
  supabase: ReturnType<typeof createAdminClient>
): Promise<string | null> {
  if (zoneId == null) return null
  if (!UUID_RE.test(zoneId)) {
    throw new ExpectedActionError('Choose a valid zone.', 'zone_id')
  }
  const { data, error } = await supabase
    .from('zones')
    .select('id, deleted_at')
    .eq('id', zoneId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new ExpectedActionError('The selected zone no longer exists.', 'zone_id')
  if (data.deleted_at != null) {
    throw new ExpectedActionError(
      'The selected zone is archived. Choose an active zone.',
      'zone_id'
    )
  }
  return zoneId
}

export type AddOperatorInput = {
  email: string
  full_name: string
  role: OperatorRole
  zone_id: string | null
  password: string
}

async function addOperator(
  input: AddOperatorInput
): Promise<OperatorRow> {
  await requireAdmin()

  const email = input.email.trim().toLowerCase()
  if (!EMAIL_RE.test(email)) {
    throw new ExpectedActionError('Enter a valid email address.', 'email')
  }
  const fullName = validateFullName(input.full_name)
  validateRole(input.role)
  if (typeof input.password !== 'string' || input.password.length < PASSWORD_MIN) {
    throw new ExpectedActionError(
      `Password must be at least ${PASSWORD_MIN} characters.`,
      'password'
    )
  }

  const supabase = createAdminClient()
  const zoneId = await validateZoneId(input.zone_id, supabase)

  // Two-step create: auth user first, then the operators row keyed by the
  // auth user's id. If the operators INSERT fails we delete the auth user
  // so a half-provisioned account can't linger.
  const { data: authData, error: authError } =
    await supabase.auth.admin.createUser({
      email,
      password: input.password,
      email_confirm: true,
    })
  if (authError) {
    if (/already.*registered/i.test(authError.message)) {
      throw new ExpectedActionError(
        'This email address is already registered.',
        'email'
      )
    }
    throw new Error(authError.message)
  }
  if (!authData.user) {
    throw new Error('Auth user creation returned no user.')
  }

  const { data, error: insertError } = await supabase
    .from('operators')
    .insert({
      id: authData.user.id,
      email,
      full_name: fullName,
      role: input.role,
      zone_id: zoneId,
      archived_at: null,
    })
    .select('id, email, full_name, role, zone_id, archived_at, created_at')
    .single()

  if (insertError) {
    // Best-effort rollback. If deletion fails too the auth user is orphaned;
    // the duplicate-email guard above prevents that from blocking a retry
    // because the next attempt will collide and surface a clear error.
    await supabase.auth.admin.deleteUser(authData.user.id)
    throw new Error(insertError.message)
  }
  if (!data) throw new Error('Insert returned no row.')

  revalidatePath('/dashboard/admin/users')
  return data as OperatorRow
}

export async function addOperatorAction(
  input: AddOperatorInput
): Promise<ActionResult<OperatorRow>> {
  try {
    return actionSuccess(await addOperator(input))
  } catch (error) {
    return actionFailure(
      error,
      'Could not add the user. Please try again.',
      'addOperatorAction'
    )
  }
}

export type UpdateOperatorInput = {
  full_name: string
  role: OperatorRole
  zone_id: string | null
}

async function updateOperator(
  id: string,
  input: UpdateOperatorInput
): Promise<OperatorRow> {
  const currentAdmin = await requireAdmin()
  if (!id) throw new Error('id is required.')

  const fullName = validateFullName(input.full_name)
  validateRole(input.role)

  // Self-demote guard. Mirrors the UI's disabled Role dropdown but stops a
  // direct API call too — losing the last admin is a one-way trip that
  // would require service-role intervention to fix.
  if (id === currentAdmin.id && input.role !== 'admin') {
    throw new ExpectedActionError('You cannot demote your own admin account.', 'role')
  }

  const supabase = createAdminClient()
  const zoneId = await validateZoneId(input.zone_id, supabase)

  const { data, error } = await supabase
    .from('operators')
    .update({
      full_name: fullName,
      role: input.role,
      zone_id: zoneId,
    })
    .eq('id', id)
    .select('id, email, full_name, role, zone_id, archived_at, created_at')
    .single()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Update returned no row.')

  revalidatePath('/dashboard/admin/users')
  return data as OperatorRow
}

export async function updateOperatorAction(
  id: string,
  input: UpdateOperatorInput
): Promise<ActionResult<OperatorRow>> {
  try {
    return actionSuccess(await updateOperator(id, input))
  } catch (error) {
    return actionFailure(
      error,
      'Could not update the user. Please try again.',
      'updateOperatorAction'
    )
  }
}

export async function archiveOperatorAction(id: string): Promise<void> {
  const currentAdmin = await requireAdmin()
  if (!id) throw new Error('id is required.')

  // Same one-way concern as self-demote: archiving yourself would lock you
  // out at the next request (the layout's isAdmin check would redirect).
  if (id === currentAdmin.id) {
    throw new Error('Cannot archive yourself.')
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('operators')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .is('archived_at', null)
  if (error) throw new Error(error.message)

  revalidatePath('/dashboard/admin/users')
}

export async function unarchiveOperatorAction(id: string): Promise<void> {
  await requireAdmin()
  if (!id) throw new Error('id is required.')

  // No self-check needed — an admin can't have archived themselves, so the
  // archived row is always someone else's.
  const supabase = createAdminClient()
  const { error } = await supabase
    .from('operators')
    .update({ archived_at: null })
    .eq('id', id)
    .not('archived_at', 'is', null)
  if (error) throw new Error(error.message)

  revalidatePath('/dashboard/admin/users')
}
