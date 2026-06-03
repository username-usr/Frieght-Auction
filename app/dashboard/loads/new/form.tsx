'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'
import type {
  LookupOption,
  TruckType,
  TruckerStatus,
  WeightUnit,
} from '@/lib/types'
import { createLoad } from './actions'

// `redirect()` inside a server action surfaces on the client as a thrown
// object whose `digest` starts with "NEXT_REDIRECT". We let Next.js handle
// those (it'll navigate). Anything else is a real error to toast.
function isRedirectError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'digest' in err &&
    typeof (err as { digest: unknown }).digest === 'string' &&
    (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  )
}

const TRUCK_TYPES: { value: TruckType; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'container', label: 'Container' },
  { value: 'trailer', label: 'Trailer' },
  { value: 'tanker', label: 'Tanker' },
  { value: 'refrigerated', label: 'Refrigerated' },
  { value: 'other', label: 'Other' },
]

const WEIGHT_UNITS: { value: WeightUnit; label: string }[] = [
  { value: 'kg', label: 'kg' },
  { value: 'liters', label: 'liters' },
]

const FIELD =
  'mt-1 block w-full rounded-md border-2 border-slate-400 px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-500 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:cursor-not-allowed disabled:bg-slate-50'
const LABEL = 'block text-sm font-medium text-slate-700'
const ERROR = 'mt-1 text-xs text-red-700'

type HeaderErrors = Partial<{
  origin_address: string
  destination_address: string
  pickup_deadline: string
  reference_price: string
  items: string
  truckers: string
}>

type ItemErrors = Partial<{
  product_name_id: string
  container_type_id: string
  quantity_value: string
  quantity_unit_id: string
  weight_value: string
}>

// rowKey is a stable React key used for list reconciliation when items are
// added or removed. It's never sent to the server — the server derives
// position from array index.
type ItemDraft = {
  rowKey: string
  product_name_id: string
  container_type_id: string
  quantity_value: string
  quantity_unit_id: string
  weight_value: string
  weight_unit: WeightUnit
}

function blankItem(): ItemDraft {
  return {
    rowKey:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2),
    product_name_id: '',
    container_type_id: '',
    quantity_value: '',
    quantity_unit_id: '',
    weight_value: '',
    weight_unit: 'kg',
  }
}

export type EligibleTrucker = {
  id: string
  phone_e164: string
  full_name: string | null
  truck_type: TruckType
  status: TruckerStatus
}

type AdditionalDestination = {
  rowKey: string
  address: string
}

function blankDestination(): AdditionalDestination {
  return {
    rowKey:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2),
    address: '',
  }
}

type Props = {
  productOptions: LookupOption[]
  containerOptions: LookupOption[]
  quantityUnitOptions: LookupOption[]
  truckerPool: EligibleTrucker[]
  savedAddresses: string[]
}

export function NewLoadForm({
  productOptions,
  containerOptions,
  quantityUnitOptions,
  truckerPool,
  savedAddresses,
}: Props) {
  const [origin, setOrigin] = useState('')
  const [destination, setDestination] = useState('')
  const [additionalDestinations, setAdditionalDestinations] = useState<
    AdditionalDestination[]
  >([])
  const [truckType, setTruckType] = useState<TruckType>('open')
  const [pickupDeadline, setPickupDeadline] = useState('')
  const [referencePrice, setReferencePrice] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<ItemDraft[]>(() => [blankItem()])
  const [errors, setErrors] = useState<HeaderErrors>({})
  const [itemErrors, setItemErrors] = useState<ItemErrors[]>([{}])
  const [selectedTruckerIds, setSelectedTruckerIds] = useState<Set<string>>(
    () => new Set()
  )
  const [isPending, startTransition] = useTransition()

  function addDestination() {
    setAdditionalDestinations((prev) => [...prev, blankDestination()])
  }

  function removeDestination(idx: number) {
    setAdditionalDestinations((prev) => prev.filter((_, i) => i !== idx))
  }

  function updateDestination(idx: number, address: string) {
    setAdditionalDestinations((prev) =>
      prev.map((d, i) => (i === idx ? { ...d, address } : d))
    )
  }

  // Truckers whose truck_type matches the load's requirement OR who can
  // run any load via the 'open' wildcard. Re-derived on every truckType
  // change.
  const matchingTruckers = useMemo(
    () =>
      truckerPool.filter(
        (t) => t.truck_type === truckType || t.truck_type === 'open'
      ),
    [truckerPool, truckType]
  )
  const activeMatching = useMemo(
    () => matchingTruckers.filter((t) => t.status === 'active'),
    [matchingTruckers]
  )
  const suspendedMatching = useMemo(
    () => matchingTruckers.filter((t) => t.status === 'blocked'),
    [matchingTruckers]
  )

  // Reset selection when the truck type changes — the matching pool just
  // shifted, so previous selections are mostly irrelevant. Default = every
  // active trucker who matches (suspended truckers start unchecked, per
  // brief).
  useEffect(() => {
    setSelectedTruckerIds(new Set(activeMatching.map((t) => t.id)))
  }, [activeMatching])

  function toggleTrucker(id: string) {
    setSelectedTruckerIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllMatching() {
    setSelectedTruckerIds(new Set(matchingTruckers.map((t) => t.id)))
  }

  function deselectAll() {
    setSelectedTruckerIds(new Set())
  }

  function updateItem(idx: number, patch: Partial<ItemDraft>) {
    setItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, ...patch } : it))
    )
  }

  function addItem() {
    setItems((prev) => [...prev, blankItem()])
    setItemErrors((prev) => [...prev, {}])
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx))
    setItemErrors((prev) => prev.filter((_, i) => i !== idx))
  }

  function validate(): { header: HeaderErrors; items: ItemErrors[] } {
    const h: HeaderErrors = {}
    const o = origin.trim()
    const d = destination.trim()

    if (!o) h.origin_address = 'Required'
    if (!d) h.destination_address = 'Required'
    if (o && d && o.toLowerCase() === d.toLowerCase()) {
      h.destination_address = 'Must differ from origin'
    }

    if (!pickupDeadline) h.pickup_deadline = 'Required'
    else if (new Date(pickupDeadline).getTime() <= Date.now()) {
      h.pickup_deadline = 'Must be in the future'
    }

    if (referencePrice.trim()) {
      const refNum = Number(referencePrice)
      if (!Number.isFinite(refNum) || refNum <= 0) {
        h.reference_price = 'Must be greater than 0'
      }
    }

    if (items.length === 0) h.items = 'Add at least one stock item'

    if (selectedTruckerIds.size === 0) {
      h.truckers = 'Select at least one trucker.'
    }

    const itemErrs: ItemErrors[] = items.map((it) => {
      const e: ItemErrors = {}
      if (!it.product_name_id) e.product_name_id = 'Required'
      if (!it.container_type_id) e.container_type_id = 'Required'
      if (!it.quantity_unit_id) e.quantity_unit_id = 'Required'

      const qtyNum = Number(it.quantity_value)
      if (!it.quantity_value.trim()) e.quantity_value = 'Required'
      else if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
        e.quantity_value = 'Must be greater than 0'
      }

      const wNum = Number(it.weight_value)
      if (!it.weight_value.trim()) e.weight_value = 'Required'
      else if (!Number.isFinite(wNum) || wNum <= 0) {
        e.weight_value = 'Must be greater than 0'
      }
      return e
    })

    return { header: h, items: itemErrs }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const v = validate()
    setErrors(v.header)
    setItemErrors(v.items)
    const headerInvalid = Object.keys(v.header).length > 0
    const itemsInvalid = v.items.some((e) => Object.keys(e).length > 0)
    if (headerInvalid || itemsInvalid) return

    startTransition(async () => {
      try {
        await createLoad({
          origin_address: origin.trim(),
          destination_address: destination.trim(),
          truck_type_required: truckType,
          // datetime-local gives a string in browser local time; converting
          // to ISO here normalizes to UTC for storage.
          pickup_deadline: new Date(pickupDeadline).toISOString(),
          reference_price_paise: referencePrice.trim()
            ? Math.round(Number(referencePrice) * 100)
            : null,
          notes: notes.trim() || null,
          items: items.map((it) => ({
            product_name_id: it.product_name_id,
            container_type_id: it.container_type_id,
            quantity_value: Number(it.quantity_value),
            quantity_unit_id: it.quantity_unit_id,
            weight_value: Number(it.weight_value),
            weight_unit: it.weight_unit,
          })),
          trucker_ids: Array.from(selectedTruckerIds),
          // Filter blanks here too so the action doesn't have to second-
          // guess our intent. The action re-numbers positions to be 1-based.
          additional_destinations: additionalDestinations
            .map((d) => d.address.trim())
            .filter((a) => a.length > 0)
            .map((address, idx) => ({ address, position: idx + 1 })),
        })
        // createLoad redirects on success — control never gets here.
      } catch (err) {
        if (isRedirectError(err)) throw err
        const message =
          err instanceof Error ? err.message : 'Unknown error posting load.'
        toast.error(message)
      }
    })
  }

  // Totals are summed per-unit since kg and liters don't convert into a
  // single comparable number.
  const totals = items.reduce(
    (acc, it) => {
      const w = Number(it.weight_value)
      if (Number.isFinite(w) && w > 0) {
        if (it.weight_unit === 'kg') acc.kg += w
        else acc.liters += w
      }
      return acc
    },
    { kg: 0, liters: 0 }
  )

  const noMatchingTruckers = matchingTruckers.length === 0
  const submitDisabled =
    isPending || selectedTruckerIds.size === 0 || noMatchingTruckers

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div>
          <label htmlFor="origin_address" className={LABEL}>
            Origin address <span className="text-red-600">*</span>
          </label>
          <input
            id="origin_address"
            name="origin_address"
            type="text"
            autoComplete="off"
            list="saved-addresses"
            disabled={isPending}
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            placeholder="Plot 12, MIDC Bhosari, Pune"
            className={FIELD}
          />
          {errors.origin_address ? (
            <p className={ERROR}>{errors.origin_address}</p>
          ) : (
            <p className="mt-1 text-xs text-slate-500">Required</p>
          )}
        </div>
        <div>
          <label htmlFor="destination_address" className={LABEL}>
            Destination address <span className="text-red-600">*</span>
          </label>
          <input
            id="destination_address"
            name="destination_address"
            type="text"
            autoComplete="off"
            list="saved-addresses"
            disabled={isPending}
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="Warehouse 4, Hosur Road, Bengaluru"
            className={FIELD}
          />
          {errors.destination_address ? (
            <p className={ERROR}>{errors.destination_address}</p>
          ) : (
            <p className="mt-1 text-xs text-slate-500">Required</p>
          )}

          {additionalDestinations.map((dest, idx) => {
            const inputId = `destination-additional-${dest.rowKey}`
            return (
              <div key={dest.rowKey} className="mt-3">
                <div className="flex items-center justify-between">
                  <label htmlFor={inputId} className={LABEL}>
                    Destination {idx + 2}{' '}
                    <span className="font-normal text-slate-500">
                      — optional
                    </span>
                  </label>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => removeDestination(idx)}
                    className="text-xs font-medium text-red-700 hover:text-red-900 disabled:cursor-not-allowed disabled:text-slate-400"
                  >
                    × Remove
                  </button>
                </div>
                <input
                  id={inputId}
                  type="text"
                  autoComplete="off"
                  list="saved-addresses"
                  disabled={isPending}
                  value={dest.address}
                  onChange={(e) => updateDestination(idx, e.target.value)}
                  placeholder="Next stop address"
                  className={FIELD}
                />
              </div>
            )
          })}

          <button
            type="button"
            disabled={isPending}
            onClick={addDestination}
            className="mt-3 text-sm font-medium text-slate-700 hover:text-slate-900 disabled:cursor-not-allowed disabled:text-slate-400"
          >
            + Add destination
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div>
          <label htmlFor="truck_type_required" className={LABEL}>
            Truck type <span className="text-red-600">*</span>
          </label>
          <select
            id="truck_type_required"
            name="truck_type_required"
            disabled={isPending}
            value={truckType}
            onChange={(e) => setTruckType(e.target.value as TruckType)}
            className={FIELD}
          >
            {TRUCK_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">Required</p>
        </div>
        <div>
          <label htmlFor="pickup_deadline" className={LABEL}>
            Pickup deadline <span className="text-red-600">*</span>
          </label>
          <input
            id="pickup_deadline"
            name="pickup_deadline"
            type="datetime-local"
            disabled={isPending}
            value={pickupDeadline}
            onChange={(e) => setPickupDeadline(e.target.value)}
            className={FIELD}
          />
          {errors.pickup_deadline ? (
            <p className={ERROR}>{errors.pickup_deadline}</p>
          ) : (
            <p className="mt-1 text-xs text-slate-500">Required</p>
          )}
        </div>
      </div>

      <div className="space-y-4 border-t border-slate-200 pt-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Stock items</h2>
          <div className="text-xs text-slate-600">
            Total:{' '}
            <span className="font-medium text-slate-900">
              {totals.kg.toLocaleString('en-IN')} kg
            </span>
            {' • '}
            <span className="font-medium text-slate-900">
              {totals.liters.toLocaleString('en-IN')} liters
            </span>
          </div>
        </div>

        {items.map((item, idx) => {
          const ie = itemErrors[idx] ?? {}
          const idBase = `item-${item.rowKey}`
          return (
            <div
              key={item.rowKey}
              className="space-y-4 rounded-md border border-slate-200 bg-slate-50/40 p-4"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-slate-600">
                  Item {idx + 1}
                </span>
                <button
                  type="button"
                  disabled={isPending || items.length === 1}
                  onClick={() => removeItem(idx)}
                  className="text-xs font-medium text-red-700 hover:text-red-900 disabled:cursor-not-allowed disabled:text-slate-400"
                >
                  Remove
                </button>
              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div>
                  <label htmlFor={`${idBase}-product`} className={LABEL}>
                    Stock item <span className="text-red-600">*</span>
                  </label>
                  <select
                    id={`${idBase}-product`}
                    disabled={isPending}
                    value={item.product_name_id}
                    onChange={(e) =>
                      updateItem(idx, { product_name_id: e.target.value })
                    }
                    className={FIELD}
                  >
                    <option value="" disabled>
                      Select a stock item…
                    </option>
                    {productOptions.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {ie.product_name_id ? (
                    <p className={ERROR}>{ie.product_name_id}</p>
                  ) : null}
                </div>
                <div>
                  <label htmlFor={`${idBase}-container`} className={LABEL}>
                    Container type <span className="text-red-600">*</span>
                  </label>
                  <select
                    id={`${idBase}-container`}
                    disabled={isPending}
                    value={item.container_type_id}
                    onChange={(e) =>
                      updateItem(idx, { container_type_id: e.target.value })
                    }
                    className={FIELD}
                  >
                    <option value="" disabled>
                      Select a container type…
                    </option>
                    {containerOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  {ie.container_type_id ? (
                    <p className={ERROR}>{ie.container_type_id}</p>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div>
                  <label htmlFor={`${idBase}-quantity`} className={LABEL}>
                    Quantity <span className="text-red-600">*</span>
                  </label>
                  <input
                    id={`${idBase}-quantity`}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    disabled={isPending}
                    value={item.quantity_value}
                    onChange={(e) =>
                      updateItem(idx, { quantity_value: e.target.value })
                    }
                    placeholder="50"
                    className={FIELD}
                  />
                  {ie.quantity_value ? (
                    <p className={ERROR}>{ie.quantity_value}</p>
                  ) : null}
                </div>
                <div>
                  <label htmlFor={`${idBase}-quantity-unit`} className={LABEL}>
                    Quantity unit <span className="text-red-600">*</span>
                  </label>
                  <select
                    id={`${idBase}-quantity-unit`}
                    disabled={isPending}
                    value={item.quantity_unit_id}
                    onChange={(e) =>
                      updateItem(idx, { quantity_unit_id: e.target.value })
                    }
                    className={FIELD}
                  >
                    <option value="" disabled>
                      Select a unit…
                    </option>
                    {quantityUnitOptions.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                  {ie.quantity_unit_id ? (
                    <p className={ERROR}>{ie.quantity_unit_id}</p>
                  ) : null}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div>
                  <label htmlFor={`${idBase}-weight`} className={LABEL}>
                    Weight <span className="text-red-600">*</span>
                  </label>
                  <input
                    id={`${idBase}-weight`}
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    disabled={isPending}
                    value={item.weight_value}
                    onChange={(e) =>
                      updateItem(idx, { weight_value: e.target.value })
                    }
                    placeholder="10000"
                    className={FIELD}
                  />
                  {ie.weight_value ? (
                    <p className={ERROR}>{ie.weight_value}</p>
                  ) : null}
                </div>
                <div>
                  <label htmlFor={`${idBase}-weight-unit`} className={LABEL}>
                    Weight unit
                  </label>
                  <select
                    id={`${idBase}-weight-unit`}
                    disabled={isPending}
                    value={item.weight_unit}
                    onChange={(e) =>
                      updateItem(idx, {
                        weight_unit: e.target.value as WeightUnit,
                      })
                    }
                    className={FIELD}
                  >
                    {WEIGHT_UNITS.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )
        })}

        <button
          type="button"
          disabled={isPending}
          onClick={addItem}
          className="rounded-md border border-dashed border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          + Add stock item
        </button>
        {errors.items ? <p className={ERROR}>{errors.items}</p> : null}
      </div>

      <div className="space-y-3 border-t border-slate-200 pt-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Truckers</h2>
          <span className="text-xs text-slate-600">
            <span className="font-medium text-slate-900">
              {selectedTruckerIds.size}
            </span>
            {' / '}
            {matchingTruckers.length} selected
          </span>
        </div>

        {noMatchingTruckers ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            No truckers available for this truck type. Add truckers in admin
            first, or choose a different truck type.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                disabled={isPending}
                onClick={selectAllMatching}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Select all
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={deselectAll}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Deselect all
              </button>
              <p className="text-slate-500">
                Suspended truckers can be invited but can&apos;t bid until
                reactivated.
              </p>
            </div>

            <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
              {activeMatching.map((t) => (
                <TruckerCheckbox
                  key={t.id}
                  trucker={t}
                  checked={selectedTruckerIds.has(t.id)}
                  disabled={isPending}
                  onToggle={() => toggleTrucker(t.id)}
                />
              ))}
              {suspendedMatching.length > 0 ? (
                <li className="bg-slate-50 px-3 py-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                  Suspended
                </li>
              ) : null}
              {suspendedMatching.map((t) => (
                <TruckerCheckbox
                  key={t.id}
                  trucker={t}
                  checked={selectedTruckerIds.has(t.id)}
                  disabled={isPending}
                  onToggle={() => toggleTrucker(t.id)}
                  suspended
                />
              ))}
            </ul>
          </>
        )}

        {errors.truckers ? <p className={ERROR}>{errors.truckers}</p> : null}
      </div>

      <div>
        <label htmlFor="reference_price" className={LABEL}>
          Reference price (₹){' '}
          <span className="font-normal text-slate-500">— optional</span>
        </label>
        <input
          id="reference_price"
          name="reference_price"
          type="number"
          inputMode="decimal"
          min={1}
          step={1}
          disabled={isPending}
          value={referencePrice}
          onChange={(e) => setReferencePrice(e.target.value)}
          placeholder="14000"
          className={FIELD}
        />
        {errors.reference_price ? (
          <p className={ERROR}>{errors.reference_price}</p>
        ) : (
          <p className="mt-1 text-xs text-slate-500">
            What you expected to pay. Used for analytics; never shown to truckers.
          </p>
        )}
      </div>

      <div>
        <label htmlFor="notes" className={LABEL}>
          Notes <span className="font-normal text-slate-500">— optional</span>
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          disabled={isPending}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Special instructions, contact at pickup, etc."
          className={FIELD}
        />
      </div>

      <div className="flex items-center gap-3 border-t border-slate-200 pt-5">
        <button
          type="submit"
          disabled={submitDisabled}
          className="rounded-md bg-blue-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? 'Posting…' : 'Post load'}
        </button>
        <Link
          href="/dashboard"
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancel
        </Link>
      </div>

      {/* Shared datalist referenced by origin + primary destination +
        each additional destination input. Browser-native autocomplete —
        no third-party dropdown library needed. */}
      <datalist id="saved-addresses">
        {savedAddresses.map((a) => (
          <option key={a} value={a} />
        ))}
      </datalist>
    </form>
  )
}

function TruckerCheckbox({
  trucker,
  checked,
  disabled,
  onToggle,
  suspended,
}: {
  trucker: EligibleTrucker
  checked: boolean
  disabled: boolean
  onToggle: () => void
  suspended?: boolean
}) {
  const inputId = `trucker-${trucker.id}`
  return (
    <li>
      <label
        htmlFor={inputId}
        className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50 ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
      >
        <input
          id={inputId}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
          className="h-4 w-4 rounded border-slate-300 text-blue-900 focus:ring-blue-900"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-900">
              {trucker.full_name ?? 'Unnamed trucker'}
            </span>
            {suspended ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                suspended
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
            <span className="font-mono">{trucker.phone_e164}</span>
            <span>·</span>
            <span className="capitalize">{trucker.truck_type}</span>
          </div>
        </div>
      </label>
    </li>
  )
}
