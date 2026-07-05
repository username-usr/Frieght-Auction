import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatAbsoluteIST } from '@/lib/format'
import { sendTemplateMessage } from '@/lib/interakt'
import { splitE164 } from '@/lib/phone'
import { truckTypeLabel } from '@/lib/truck-types'

// Part 2 — outbound WhatsApp "new load posted" alert.
//
// Fires the Meta-approved `new_load_alert` template to every trucker on a
// load's visibility list right after the load is created. This is ADDITIVE and
// best-effort: it re-reads the freshly-created load with the service-role
// client (the caller has already authenticated the operator) and never throws
// — a WhatsApp outage must not affect a load that was already committed.
//
// Body variable order is FIXED by the approved template. Do not reorder:
//   {{1}} reference_code       (loads.reference_code)          — 0015
//   {{2}} pickup / origin      (loads.origin_address)          — 0015 rename
//   {{3}} drop / destination   (loads.destination_address)     — 0015 rename
//   {{4}} truck type           (loads.truck_type_required)     — 0001
//   {{5}} weight               (load_items.weight_value/unit)  — 0010
//   {{6}} bids-close time       (loads.pickup_deadline)        — 0001
// NOTE on {{6}}: there is no separate "bid close" column in the schema; the
// load stops accepting bids at its pickup_deadline, so that is what we send.

const TEMPLATE_NAME = 'new_load_alert'

export type NewLoadAlertSummary = {
  loadId: string
  recipients: number
  sent: number
  failed: number
}

type LoadRow = {
  reference_code: string
  origin_address: string
  destination_address: string
  truck_type_required: string
  pickup_deadline: string
}

type ItemRow = {
  weight_value: number | string
  weight_unit: string
}

// Sum item weights per unit and render a single human string, e.g.
// "1500 kg" or "1500 kg, 200 liters". Mixed units are kept separate because
// summing kg and liters together would be meaningless.
function formatWeight(items: ItemRow[]): string {
  const byUnit = new Map<string, number>()
  for (const it of items) {
    const v = Number(it.weight_value)
    if (!Number.isFinite(v)) continue
    byUnit.set(it.weight_unit, (byUnit.get(it.weight_unit) ?? 0) + v)
  }
  const parts = [...byUnit.entries()].map(
    ([unit, value]) => `${value} ${unit}`
  )
  return parts.length > 0 ? parts.join(', ') : '—'
}

export async function sendNewLoadAlerts(
  loadId: string
): Promise<NewLoadAlertSummary> {
  const summary: NewLoadAlertSummary = {
    loadId,
    recipients: 0,
    sent: 0,
    failed: 0,
  }

  const defaultCc = process.env.WHATSAPP_DEFAULT_COUNTRY_CODE ?? '+91'
  // Our Interakt WhatsApp business number (E.164), logged as from_phone on
  // outbound rows. Optional — null when unset, never a crash.
  const fromPhone = process.env.WHATSAPP_FROM ?? null
  const admin = createAdminClient()

  // 1. Re-read the load. The create RPC only returned its id.
  const { data: load, error: loadErr } = await admin
    .from('loads')
    .select(
      'reference_code, origin_address, destination_address, truck_type_required, pickup_deadline'
    )
    .eq('id', loadId)
    .maybeSingle<LoadRow>()

  if (loadErr || !load) {
    console.error(
      `[new_load_alert] could not read load ${loadId}: ${loadErr?.message ?? 'not found'}`
    )
    return summary
  }

  // 2. Item weights for {{5}}.
  const { data: items, error: itemsErr } = await admin
    .from('load_items')
    .select('weight_value, weight_unit')
    .eq('load_id', loadId)
  if (itemsErr) {
    // Non-fatal: send with a placeholder weight rather than skip the alert.
    console.error(
      `[new_load_alert] could not read items for load ${loadId}: ${itemsErr.message}`
    )
  }

  // 3. Visibility list → trucker phones. Two-step (ids, then truckers) to keep
  //    the query unambiguous rather than relying on an embed relationship name.
  const { data: visRows, error: visErr } = await admin
    .from('load_trucker_visibility')
    .select('trucker_id')
    .eq('load_id', loadId)
  if (visErr) {
    console.error(
      `[new_load_alert] could not read visibility for load ${loadId}: ${visErr.message}`
    )
    return summary
  }

  const truckerIds = (visRows ?? []).map((r) => r.trucker_id as string)
  if (truckerIds.length === 0) {
    // Posting a load with zero visible truckers sends nothing. (The create
    // action requires >= 1 trucker, so this is a defensive no-op.)
    console.log(`[new_load_alert] load ${loadId} has no visible truckers; nothing to send`)
    return summary
  }

  // Skip blocked truckers: they stay ON the visibility list, but place_trucker_bid
  // rejects their bids (0013), so alerting them just causes confusion. The
  // status column is the trucker_status enum ('active' | 'inactive' | 'blocked')
  // from 0001; we exclude exactly the 'blocked' value here.
  const { data: truckers, error: truckersErr } = await admin
    .from('truckers')
    .select('id, phone_e164, status')
    .in('id', truckerIds)
    .neq('status', 'blocked')
  if (truckersErr) {
    console.error(
      `[new_load_alert] could not read truckers for load ${loadId}: ${truckersErr.message}`
    )
    return summary
  }

  // 4. Build the positional body values ONCE — same for every recipient.
  const bodyValues: string[] = [
    String(load.reference_code),
    String(load.origin_address),
    String(load.destination_address),
    truckTypeLabel(load.truck_type_required),
    formatWeight((items ?? []) as ItemRow[]),
    formatAbsoluteIST(load.pickup_deadline),
  ]
  const bodyForLog = bodyValues.join(' | ')

  summary.recipients = truckers?.length ?? 0

  // 5. Sequential sends. Volume is a handful of truckers per load, so this is
  //    fine (as agreed in the Part 2 brief). Each recipient is isolated in its
  //    own try/catch: one failure NEVER stops the others.
  for (const t of truckers ?? []) {
    const phone = t.phone_e164 as string
    try {
      const parts = splitE164(phone, defaultCc)
      if (!parts) {
        console.error(
          `[new_load_alert] load ${loadId}: cannot split phone for trucker ${t.id} (cc=${defaultCc})`
        )
        summary.failed++
        await logMessage(admin, {
          fromPhone,
          toPhone: phone,
          body: bodyForLog,
          ok: false,
          waMessageId: null,
          loadId,
        })
        continue
      }

      const result = await sendTemplateMessage({
        countryCode: parts.countryCode,
        phoneNumber: parts.phoneNumber,
        templateName: TEMPLATE_NAME,
        bodyValues,
      })

      if (result.ok) {
        summary.sent++
      } else {
        summary.failed++
        console.error(
          `[new_load_alert] load ${loadId}: send failed to ${phone}: ${result.error}`
        )
      }

      await logMessage(admin, {
        fromPhone,
        toPhone: phone,
        body: bodyForLog,
        ok: result.ok,
        waMessageId: result.ok ? result.id : null,
        loadId,
      })
    } catch (err) {
      // Belt-and-suspenders: nothing above is expected to throw, but a single
      // recipient's unexpected error must not abort the rest of the list.
      summary.failed++
      console.error(
        `[new_load_alert] load ${loadId}: unexpected error for ${phone}:`,
        err
      )
    }
  }

  console.log(
    `[new_load_alert] load ${loadId}: recipients=${summary.recipients} sent=${summary.sent} failed=${summary.failed}`
  )
  return summary
}

// Audit every send into whatsapp_messages. Uses the service-role client so it
// bypasses RLS. status maps to the message_status enum: 'sent' once Interakt
// accepted the request (delivery/read arrive later via webhook — Part 3),
// 'failed' otherwise. Logging is itself best-effort.
async function logMessage(
  admin: ReturnType<typeof createAdminClient>,
  args: {
    fromPhone: string | null
    toPhone: string
    body: string
    ok: boolean
    waMessageId: string | null
    loadId: string
  }
): Promise<void> {
  try {
    const { error } = await admin.from('whatsapp_messages').insert({
      direction: 'outbound',
      from_phone: args.fromPhone,
      to_phone: args.toPhone,
      template_name: TEMPLATE_NAME,
      body: args.body,
      wa_message_id: args.waMessageId,
      status: args.ok ? 'sent' : 'failed',
      related_load_id: args.loadId,
    })
    if (error) {
      console.error(
        `[new_load_alert] whatsapp_messages log insert failed for ${args.toPhone}: ${error.message}`
      )
    }
  } catch (err) {
    console.error('[new_load_alert] whatsapp_messages log insert threw:', err)
  }
}
