// Owner-approved estimated value per reservation (net of IVA), by product. Shown in the app with its basis so it
// can be checked and changed; used only for numbers labeled "estimated".
export type EstimateProduct = 'restaurant_visit' | 'tour_tasting';
export interface ValueEstimate { id: string; product: EstimateProduct; valueMinor: number; currency: string; basis: string; sourcePeriod: string; approvedBy: string; approvedAt: number; note: string }

const row = (r: Record<string, unknown>): ValueEstimate => ({
  id: String(r.id), product: r.product as EstimateProduct, valueMinor: Number(r.value_minor), currency: String(r.currency), basis: String(r.basis),
  sourcePeriod: String(r.source_period ?? ''), approvedBy: String(r.approved_by), approvedAt: Number(r.approved_at), note: String(r.note ?? ''),
});

/** The value in use per product (newest approval) plus the full history, newest first. */
export async function loadEstimates(db: D1Database): Promise<{ current: Partial<Record<EstimateProduct, ValueEstimate>>; history: ValueEstimate[] }> {
  const rows = (await db.prepare('SELECT * FROM reservation_value_estimates ORDER BY approved_at DESC').all<Record<string, unknown>>().catch(() => ({ results: [] as Record<string, unknown>[] }))).results.map(row);
  const current: Partial<Record<EstimateProduct, ValueEstimate>> = {};
  for (const r of rows) if (!current[r.product]) current[r.product] = r;
  return { current, history: rows };
}

export async function saveEstimate(db: D1Database, e: { product: EstimateProduct; valueMinor: number; basis: string; sourcePeriod: string; note: string }, by: string, now: number): Promise<ValueEstimate> {
  if (!Number.isSafeInteger(e.valueMinor) || e.valueMinor <= 0) throw new Error('Value must be a positive amount');
  const id = `est_${crypto.randomUUID().slice(0, 18)}`;
  await db.prepare('INSERT INTO reservation_value_estimates (id, product, value_minor, currency, basis, source_period, approved_by, approved_at, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, e.product, e.valueMinor, 'MXN', e.basis.slice(0, 500), e.sourcePeriod.slice(0, 80), by, now, e.note.slice(0, 300)).run();
  return { id, product: e.product, valueMinor: e.valueMinor, currency: 'MXN', basis: e.basis, sourcePeriod: e.sourcePeriod, approvedBy: by, approvedAt: now, note: e.note };
}
