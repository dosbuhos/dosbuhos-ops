// Capacity by product, date, time and constrained resource. Resources (seats, guides, spaces) can be shared by several
// products; a reservation holds each resource it needs for its whole occupied window (service duration + buffer), so
// a guide running a 12:00 tour is not also available for a 12:30 tasting, and restaurant seats turn over by duration.
// Unknown capacity is never zero and never unlimited; stale capacity blocks capacity-based scaling.
import type { LocalDate } from './time.ts';
import type { Product } from './measurement.ts';

export type ResourceKind = 'seats' | 'guide' | 'space';
export interface Resource { id: string; kind: ResourceKind; label: string; quantity: number }

/** Availability of a resource over a window on a date (staff schedule). Missing window → resource not available. */
export interface ResourceWindow { resourceId: string; date: LocalDate; startMin: number; endMin: number; quantity: number }

/** perGuest: units per guest (a seat). perSlot: units needed while the slot runs at all (one guide per tour group). */
export interface Requirement { resourceId: string; perGuest: number; perSlot: number }

export interface Slot {
  slotId: string;
  product: Product;
  date: LocalDate;
  startMin: number;               // minutes after local midnight
  durationMin: number;
  bufferMin: number;
  requires: Requirement[];
  maxGuests: number | null;       // product-level cap per slot (e.g. a tour group size), null = no extra cap
  state: 'open' | 'closed' | 'blocked';
  source: 'manual' | 'csv' | 'api';
  sourceUpdatedAt: number | null; // null = never confirmed
}

export interface Reservation { reservationId: string; slotId: string; guests: number; status: 'held' | 'confirmed' | 'cancelled' }

export type SlotStatus = 'open' | 'closed' | 'sold_out' | 'blocked' | 'unknown';
export interface ResolvedSlot {
  slotId: string; product: Product; date: LocalDate; startMin: number;
  status: SlotStatus;
  sellableGuests: number | null;   // null = unknown
  reservedGuests: number;
  remainingGuests: number | null;
  bindingResource: string | null;  // which resource limits it
  stale: boolean;
  reason?: string;
}

export interface FreshnessRule { product: Product; maxAgeMinutes: number }

const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;

function windowQuantity(windows: readonly ResourceWindow[], resourceId: string, date: LocalDate, s: number, e: number): number | null {
  const ws = windows.filter(w => w.resourceId === resourceId && w.date === date);
  if (!ws.length) return null;
  // The resource must cover the whole occupied interval; take the minimum quantity across covering windows.
  const covering = ws.filter(w => w.startMin <= s && w.endMin >= e);
  if (!covering.length) return 0;
  return Math.min(...covering.map(w => w.quantity));
}

export function resolveCapacity(input: {
  resources: readonly Resource[];
  windows: readonly ResourceWindow[];
  slots: readonly Slot[];
  reservations: readonly Reservation[];
  freshness: readonly FreshnessRule[];
  now: number;
}): ResolvedSlot[] {
  const active = input.reservations.filter(r => r.status !== 'cancelled');
  const bySlot = new Map<string, Reservation[]>();
  for (const r of active) bySlot.set(r.slotId, [...(bySlot.get(r.slotId) ?? []), r]);

  return input.slots.map((slot): ResolvedSlot => {
    const reserved = (bySlot.get(slot.slotId) ?? []).reduce((n, r) => n + r.guests, 0);
    const rule = input.freshness.find(f => f.product === slot.product);
    // Stale = entered but older than the product's freshness rule. Never entered is 'unknown', not stale.
    const stale = slot.sourceUpdatedAt !== null && !!rule && input.now - slot.sourceUpdatedAt > rule.maxAgeMinutes * 60_000;
    const base = { slotId: slot.slotId, product: slot.product, date: slot.date, startMin: slot.startMin, reservedGuests: reserved, stale };
    if (slot.state === 'closed') return { ...base, status: 'closed', sellableGuests: 0, remainingGuests: 0, bindingResource: null };
    if (slot.state === 'blocked') return { ...base, status: 'blocked', sellableGuests: 0, remainingGuests: 0, bindingResource: null, reason: 'Blocked by staff' };
    if (slot.sourceUpdatedAt === null) return { ...base, status: 'unknown', sellableGuests: null, remainingGuests: null, bindingResource: null, reason: 'Capacity never confirmed' };

    const s0 = slot.startMin, s1 = slot.startMin + slot.durationMin + slot.bufferMin;
    let cap = slot.maxGuests ?? Number.POSITIVE_INFINITY;
    let binding: string | null = slot.maxGuests !== null ? 'slot limit' : null;
    let unknownResource: string | null = null;

    for (const req of slot.requires) {
      const res = input.resources.find(r => r.id === req.resourceId);
      const qty = res ? windowQuantity(input.windows, req.resourceId, slot.date, s0, s1) : null;
      if (qty === null) { unknownResource = res?.label ?? req.resourceId; continue; }
      // Units of this resource already held by *other* overlapping slots (any product) that share it.
      let usedElsewhere = 0;
      for (const other of input.slots) {
        if (other.slotId === slot.slotId || other.date !== slot.date) continue;
        const oreq = other.requires.find(q => q.resourceId === req.resourceId);
        if (!oreq) continue;
        const o0 = other.startMin, o1 = other.startMin + other.durationMin + other.bufferMin;
        if (!overlaps(s0, s1, o0, o1)) continue;
        const g = (bySlot.get(other.slotId) ?? []).reduce((n, r) => n + r.guests, 0);
        if (g > 0) usedElsewhere += oreq.perGuest * g + oreq.perSlot;
      }
      // A slot that already has guests holds its per-slot units (first booked wins); otherwise it needs them free.
      const free = qty - usedElsewhere - (reserved > 0 ? req.perSlot : 0);
      let capHere: number;
      if (req.perGuest > 0) capHere = reserved > 0 || free >= req.perSlot ? Math.floor(Math.max(0, free - (reserved > 0 ? 0 : req.perSlot)) / req.perGuest) : 0;
      else capHere = reserved > 0 || free >= req.perSlot ? Number.POSITIVE_INFINITY : 0;
      if (capHere < cap) { cap = capHere; binding = res?.label ?? req.resourceId; }
    }
    if (unknownResource) return { ...base, status: 'unknown', sellableGuests: null, remainingGuests: null, bindingResource: unknownResource, reason: `No availability entered for ${unknownResource}` };
    if (!Number.isFinite(cap)) return { ...base, status: 'unknown', sellableGuests: null, remainingGuests: null, bindingResource: null, reason: 'No constraining resource or slot limit configured' };
    const sellable = Math.max(0, Math.floor(cap));
    const remaining = Math.max(0, sellable - reserved);
    return { ...base, status: remaining === 0 ? 'sold_out' : 'open', sellableGuests: sellable, remainingGuests: remaining, bindingResource: binding, ...(stale ? { reason: 'Capacity data is stale' } : {}) };
  });
}

export interface DayProductSummary { date: LocalDate; product: Product; sellable: number; reserved: number; remaining: number; unknownSlots: number; staleSlots: number; status: SlotStatus }

/** Roll slots up to date × product. Products are never summed together (restaurant seats ≠ tasting places). */
export function summarizeDays(slots: readonly ResolvedSlot[]): DayProductSummary[] {
  const map = new Map<string, DayProductSummary>();
  for (const s of slots) {
    const k = `${s.date}|${s.product}`;
    const d = map.get(k) ?? { date: s.date, product: s.product, sellable: 0, reserved: 0, remaining: 0, unknownSlots: 0, staleSlots: 0, status: 'closed' as SlotStatus };
    if (s.status === 'unknown') d.unknownSlots++;
    else { d.sellable += s.sellableGuests ?? 0; d.remaining += s.remainingGuests ?? 0; }
    d.reserved += s.reservedGuests;
    if (s.stale) d.staleSlots++;
    map.set(k, d);
  }
  for (const d of map.values()) {
    const all = slots.filter(s => s.date === d.date && s.product === d.product);
    if (all.every(s => s.status === 'closed')) d.status = 'closed';
    else if (all.every(s => s.status === 'blocked' || s.status === 'closed')) d.status = 'blocked';
    else if (d.unknownSlots > 0 && d.sellable === 0) d.status = 'unknown';
    else if (d.remaining === 0 && d.unknownSlots === 0) d.status = 'sold_out';
    else d.status = 'open';
  }
  return [...map.values()].sort((a, b) => (a.date + a.product < b.date + b.product ? -1 : 1));
}

/** Capacity may justify growth only for products the campaign books, inside its booking horizon, with fresh data. */
export function capacitySupportsGrowth(days: readonly DayProductSummary[], products: readonly Product[], horizon: { from: LocalDate; to: LocalDate }): { ok: boolean; reason: string } {
  const rel = days.filter(d => products.includes(d.product) && d.date >= horizon.from && d.date <= horizon.to);
  if (!rel.length) return { ok: false, reason: 'No capacity entered for the campaign’s products and booking horizon' };
  if (rel.some(d => d.staleSlots > 0)) return { ok: false, reason: 'Capacity for the booking horizon is stale' };
  if (rel.every(d => d.unknownSlots > 0 && d.sellable === 0)) return { ok: false, reason: 'Capacity is unknown for the booking horizon' };
  const remaining = rel.reduce((n, d) => n + d.remaining, 0);
  if (remaining === 0) return { ok: false, reason: 'Booking horizon is sold out' };
  return { ok: true, reason: `${remaining} places open in the booking horizon` };
}
