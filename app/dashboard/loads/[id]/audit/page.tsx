import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  formatAbsoluteIST,
  formatINR,
  formatRelativeTime,
} from '@/lib/format'

type AuditEntry = {
  id: string
  entity_type: 'bid' | 'load' | 'shipment'
  entity_id: string
  action: string
  actor_id: string | null
  actor_role: 'admin' | 'operator' | 'trucker' | 'system' | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  load_id: string | null
  created_at: string
}

type ActorInfo = {
  name: string
  badge: string
}

export default async function AuditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  // Fetch load summary (header) and audit entries in parallel.
  const [loadResult, entriesResult] = await Promise.all([
    supabase
      .from('loads')
      .select('id, origin_city, destination_city, status')
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('bid_audit_log')
      .select(
        'id, entity_type, entity_id, action, actor_id, actor_role, before, after, load_id, created_at'
      )
      .eq('load_id', id)
      .order('created_at', { ascending: false }),
  ])

  if (loadResult.error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-900">
        <p className="font-semibold">Failed to load load.</p>
        <p className="mt-2 font-mono">{loadResult.error.message}</p>
      </div>
    )
  }
  if (!loadResult.data) notFound()

  if (entriesResult.error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-900">
        <p className="font-semibold">Failed to load activity log.</p>
        <p className="mt-2 font-mono">{entriesResult.error.message}</p>
      </div>
    )
  }

  const load = loadResult.data
  const entries = (entriesResult.data ?? []) as AuditEntry[]

  // Collect unique actor ids by role, then batch-fetch names in two queries.
  const operatorIds = new Set<string>()
  const truckerIds = new Set<string>()
  for (const e of entries) {
    if (!e.actor_id) continue
    if (e.actor_role === 'admin' || e.actor_role === 'operator') {
      operatorIds.add(e.actor_id)
    } else if (e.actor_role === 'trucker') {
      truckerIds.add(e.actor_id)
    }
  }

  const actorMap = new Map<string, ActorInfo>()

  if (operatorIds.size > 0) {
    const { data } = await supabase
      .from('operators')
      .select('id, full_name, role')
      .in('id', Array.from(operatorIds))
    for (const op of data ?? []) {
      actorMap.set(op.id, {
        name: op.full_name,
        badge: op.role,
      })
    }
  }

  if (truckerIds.size > 0) {
    const { data } = await supabase
      .from('truckers')
      .select('id, full_name, phone_e164')
      .in('id', Array.from(truckerIds))
    for (const t of data ?? []) {
      actorMap.set(t.id, {
        name: t.full_name ?? `Trucker (${t.phone_e164})`,
        badge: 'trucker',
      })
    }
  }

  const shortId = id.slice(0, 8)

  return (
    <div className="space-y-6">
      <nav className="text-sm">
        <Link
          href="/dashboard"
          className="text-slate-600 hover:text-slate-900"
        >
          Dashboard
        </Link>
        <span className="mx-2 text-slate-400">/</span>
        <Link
          href={`/dashboard/loads/${id}`}
          className="text-slate-600 hover:text-slate-900"
        >
          <span className="font-mono">Load #{shortId}</span>
        </Link>
        <span className="mx-2 text-slate-400">/</span>
        <span className="text-slate-900">Activity log</span>
      </nav>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          Activity log for Load #{shortId}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {load.origin_city} → {load.destination_city} ·{' '}
          <span className="capitalize">{load.status}</span>
        </p>
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        {entries.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">
            No activity recorded yet.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {entries.map((entry) => (
              <TimelineRow
                key={entry.id}
                entry={entry}
                actor={
                  entry.actor_id ? actorMap.get(entry.actor_id) : undefined
                }
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function TimelineRow({
  entry,
  actor,
}: {
  entry: AuditEntry
  actor: ActorInfo | undefined
}) {
  const { name, badge } = resolveActor(entry, actor)
  const description = describeAction(entry)

  return (
    <li className="p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
        <p className="text-sm text-slate-900">
          <span className="font-medium">{name}</span>
          {badge ? (
            <span className="ml-2 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium capitalize text-slate-700">
              {badge}
            </span>
          ) : null}
          <span className="ml-2 text-slate-700">{description}</span>
        </p>
        <div className="font-mono text-xs">
          <p className="text-slate-700">
            {formatAbsoluteIST(entry.created_at)}
          </p>
          <p className="mt-0.5 text-slate-400">
            {formatRelativeTime(entry.created_at)}
          </p>
        </div>
      </div>
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer font-medium text-slate-600 hover:text-slate-900">
          View details
        </summary>
        <div className="mt-2 grid gap-3 lg:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Before
            </p>
            <pre className="mt-1 max-h-80 overflow-auto rounded-md bg-slate-50 p-3 font-mono text-xs text-slate-700">
              {entry.before
                ? JSON.stringify(entry.before, null, 2)
                : '—'}
            </pre>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
              After
            </p>
            <pre className="mt-1 max-h-80 overflow-auto rounded-md bg-slate-50 p-3 font-mono text-xs text-slate-700">
              {entry.after ? JSON.stringify(entry.after, null, 2) : '—'}
            </pre>
          </div>
        </div>
      </details>
    </li>
  )
}

function resolveActor(
  entry: AuditEntry,
  actor: ActorInfo | undefined
): { name: string; badge: string | null } {
  if (actor) return { name: actor.name, badge: actor.badge }
  if (entry.actor_role === 'system') {
    return { name: 'System', badge: 'system' }
  }
  if (entry.actor_id) {
    // Authenticated actor, but we couldn't resolve them to a row (operator
    // deleted, trucker not yet in DB, etc.). Show the role and "(unknown)".
    return { name: '(unknown)', badge: entry.actor_role ?? null }
  }
  return { name: '(unknown)', badge: entry.actor_role ?? null }
}

function describeAction(entry: AuditEntry): string {
  const after = entry.after ?? {}

  switch (entry.action) {
    case 'load_posted':
      return 'Posted this load'
    case 'load_awarded':
      return 'Awarded the load'
    case 'load_cancelled': {
      const reason = typeof after.cancellation_reason === 'string'
        ? after.cancellation_reason
        : null
      return reason
        ? `Cancelled the load — Reason: ${reason}`
        : 'Cancelled the load'
    }
    case 'load_completed':
      return 'Marked the load complete'
    case 'load_updated':
      return 'Updated the load'

    case 'bid_placed': {
      const amount = after.amount_paise
      return typeof amount === 'number'
        ? `Placed a bid of ${formatINR(amount)}`
        : 'Placed a bid'
    }
    case 'bid_won':
      return 'Bid won — awarded to this trucker'
    case 'bid_lost':
      return 'Bid lost'
    case 'bid_withdrawn':
      return 'Withdrew their bid'
    case 'bid_updated':
      return 'Updated bid'

    case 'shipment_created':
      return 'Shipment created'
    case 'shipment_updated':
      return 'Shipment updated'

    default:
      // Fallback for action labels we haven't given prose for yet
      // (bid_active, load_open, *_deleted, etc.). Show the raw code so
      // nothing is lost; we'll iterate on copy as needed.
      return entry.action
  }
}
