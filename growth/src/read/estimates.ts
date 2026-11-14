// Owner-approved estimated value per reservation (net of IVA), by product. Shown in the app with its basis so it
// can be checked and changed; used only for numbers labeled "estimated".
export type EstimateProduct = 'restaurant_visit' | 'tour_tasting';
export interface ValueEstimate { id: string; product: EstimateProduct; valueMinor: number; currency: string; basis: string; sourcePeriod: string; approvedBy: string; approvedAt: number; note: string }

const row = (r: Record<string, unknown>): ValueEstimate => ({
  id: String(r.id), product: r.product as EstimateProduct, valueMinor: Number(r.value_minor), currency: String(r.currency), basis: String(r.basis),
  sourcePeriod: String(r.source_period ?? ''), approvedBy: String(r.approved_by), approvedAt: Number(r.approved_at), note: String(r.note ?? ''),
});

/** The value in use per product (newest approval) plus the full history, newest first. */
export async function loadEstimates(db: D1Database): Promise<Estimates> {
  const costs = await loadCosts(db);
  const rows = (await db.prepare('SELECT * FROM reservation_value_estimates ORDER BY approved_at DESC').all<Record<string, unknown>>().catch(() => ({ results: [] as Record<string, unknown>[] }))).results.map(row);
  const current: Partial<Record<EstimateProduct, ValueEstimate>> = {};
  for (const r of rows) if (!current[r.product]) current[r.product] = r;
  const contribution: Partial<Record<EstimateProduct, number>> = {};
  for (const p of ['restaurant_visit', 'tour_tasting'] as const) { const c = contributionPerReservation(current[p], p, costs.current); if (c !== null) contribution[p] = c; }
  return { current, history: rows, costs, contribution };
}

// ---------- variable cost assumptions ----------
export type CostKey = 'restaurant_cost_pct' | 'tour_cost_pct' | 'payment_fee_pct' | 'opentable_fee_per_reservation';
export const COST_KEYS: CostKey[] = ['restaurant_cost_pct', 'tour_cost_pct', 'payment_fee_pct', 'opentable_fee_per_reservation'];
/** value: basis points for *_pct keys (2100 = 21%), MXN cents for opentable_fee_per_reservation. */
export interface CostAssumption { id: string; key: CostKey; value: number; basis: string; sourcePeriod: string; provisional: boolean; approvedBy: string; approvedAt: number; note: string }
export interface Estimates {
  current: Partial<Record<EstimateProduct, ValueEstimate>>; history: ValueEstimate[];
  costs: { current: Partial<Record<CostKey, CostAssumption>>; history: CostAssumption[] };
  /** Estimated contribution per reservation (MXN cents), only when the value and every cost it needs are set. */
  contribution: Partial<Record<EstimateProduct, number>>;
}

export async function loadCosts(db: D1Database): Promise<Estimates['costs']> {
  const rows = (await db.prepare('SELECT * FROM estimate_costs ORDER BY approved_at DESC').all<Record<string, unknown>>().catch(() => ({ results: [] as Record<string, unknown>[] }))).results.map(r => ({
    id: String(r.id), key: r.key as CostKey, value: Number(r.value), basis: String(r.basis), sourcePeriod: String(r.source_period ?? ''), provisional: r.provisional === 1,
    approvedBy: String(r.approved_by), approvedAt: Number(r.approved_at), note: String(r.note ?? ''),
  }));
  const current: Partial<Record<CostKey, CostAssumption>> = {};
  for (const r of rows) if (!current[r.key]) current[r.key] = r;
  return { current, history: rows };
}

export async function saveCost(db: D1Database, c: { key: CostKey; value: number; basis: string; sourcePeriod: string; provisional: boolean; note: string }, by: string, now: number): Promise<CostAssumption> {
  if (!Number.isSafeInteger(c.value) || c.value < 0 || (c.key.endsWith('_pct') && c.value >= 10_000)) throw new Error('Invalid cost value');
  const id = `cost_${crypto.randomUUID().slice(0, 18)}`;
  await db.prepare('INSERT INTO estimate_costs (id, key, value, basis, source_period, provisional, approved_by, approved_at, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, c.key, c.value, c.basis.slice(0, 500), c.sourcePeriod.slice(0, 80), c.provisional ? 1 : 0, by, now, c.note.slice(0, 300)).run();
  return { id, ...c, approvedBy: by, approvedAt: now };
}

/** value × (1 − product cost% − payment fee%) − OpenTable fee (restaurant only). Null if anything needed is missing. */
export function contributionPerReservation(est: ValueEstimate | undefined, product: EstimateProduct, costs: Partial<Record<CostKey, CostAssumption>>): number | null {
  if (!est) return null;
  const cost = costs[product === 'restaurant_visit' ? 'restaurant_cost_pct' : 'tour_cost_pct'], fee = costs.payment_fee_pct;
  if (!cost || !fee) return null;
  const ot = product === 'restaurant_visit' ? costs.opentable_fee_per_reservation : undefined;
  if (product === 'restaurant_visit' && !ot) return null;
  return Math.round(est.valueMinor * (1 - (cost.value + fee.value) / 10_000)) - (ot?.value ?? 0);
}

export async function saveEstimate(db: D1Database, e: { product: EstimateProduct; valueMinor: number; basis: string; sourcePeriod: string; note: string }, by: string, now: number): Promise<ValueEstimate> {
  if (!Number.isSafeInteger(e.valueMinor) || e.valueMinor <= 0) throw new Error('Value must be a positive amount');
  const id = `est_${crypto.randomUUID().slice(0, 18)}`;
  await db.prepare('INSERT INTO reservation_value_estimates (id, product, value_minor, currency, basis, source_period, approved_by, approved_at, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, e.product, e.valueMinor, 'MXN', e.basis.slice(0, 500), e.sourcePeriod.slice(0, 80), by, now, e.note.slice(0, 300)).run();
  return { id, product: e.product, valueMinor: e.valueMinor, currency: 'MXN', basis: e.basis, sourcePeriod: e.sourcePeriod, approvedBy: by, approvedAt: now, note: e.note };
}
