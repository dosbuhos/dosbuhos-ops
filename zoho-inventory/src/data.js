// Shared queries.

export const USED = '(l.poured + l.gifted + l.sold + l.returned + l.broken)';

// What each rep should have on hand, per wine.
export async function holdings(env, repId) {
  const { results } = await env.DB.prepare(`
    WITH mv AS (
      SELECT l.wine, SUM(CASE WHEN l.received=1 THEN l.qty ELSE 0 END)
                   - SUM(CASE WHEN e.submitted_at IS NOT NULL THEN ${USED} ELSE 0 END) AS q
      FROM event_lines l JOIN events e ON e.id=l.event_id
      WHERE e.rep_id=?1 GROUP BY l.wine
      UNION ALL
      SELECT wine, SUM(qty) FROM adjustments WHERE rep_id=?1 GROUP BY wine
    )
    SELECT wine, SUM(q) AS qty FROM mv GROUP BY wine HAVING SUM(q) <> 0 ORDER BY wine`).bind(repId).all();
  return results;
}

export function dueInfo(ev) {
  if (ev.kind !== 'evento' || ['enviado', 'aprobado'].includes(ev.status)) return { label: '', state: 'ok' };
  const d = new Date(ev.event_date + 'T12:00:00Z');
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days > 7) return { label: `Vencido hace ${days - 3} días`, state: 'overdue', days };
  if (days > 3) return { label: `Debía entregarse hace ${days - 3} días`, state: 'late', days };
  return { label: `Vence en ${Math.max(0, 3 - days)} días`, state: 'due', days };
}

export async function repSummary(env, rep) {
  const hold = await holdings(env, rep.id);
  const shouldHold = hold.reduce((a, h) => a + h.qty, 0);
  const open = (await env.DB.prepare(`
    SELECT e.*, (SELECT SUM(qty) FROM event_lines WHERE event_id=e.id) AS bottles
    FROM events e WHERE e.rep_id=? AND e.kind='evento' AND e.status IN ('abierto','devuelto') ORDER BY e.event_date`).bind(rep.id).all()).results;
  const noReport = open.reduce((a, e) => a + (e.bottles || 0), 0);
  const overdue = open.filter(e => dueInfo(e).state === 'overdue').length;
  const lastCount = await env.DB.prepare(`
    SELECT c.*, (SELECT SUM(counted-expected) FROM count_lines WHERE count_id=c.id) AS variance,
           (SELECT SUM(ABS(counted-expected)) FROM count_lines WHERE count_id=c.id) AS absvar
    FROM counts c WHERE rep_id=? ORDER BY id DESC LIMIT 1`).bind(rep.id).first();
  return { hold, shouldHold, open, noReport, overdue, lastCount };
}

export async function eventFull(env, id) {
  const ev = await env.DB.prepare('SELECT e.*, r.name AS rep_name, r.email AS rep_email FROM events e JOIN reps r ON r.id=e.rep_id WHERE e.id=?').bind(id).first();
  if (!ev) return null;
  ev.report = JSON.parse(ev.report || '{}');
  ev.lines = (await env.DB.prepare(`SELECT l.*, COALESCE(w.price,0) AS price FROM event_lines l LEFT JOIN wines w ON w.item_id=l.item_id WHERE event_id=? ORDER BY l.id`).bind(id).all()).results;
  ev.photos = (await env.DB.prepare('SELECT * FROM photos WHERE event_id=? ORDER BY id').bind(id).all()).results;
  ev.leads = (await env.DB.prepare('SELECT * FROM leads WHERE event_id=? ORDER BY id').bind(id).all()).results;
  ev.placements = (await env.DB.prepare('SELECT * FROM placements WHERE event_id=? ORDER BY id').bind(id).all()).results;
  return ev;
}

// Numbers for the event: bottles used, their list value, costs, return.
export function eventMoney(ev) {
  const used = ev.lines.reduce((a, l) => a + l.poured + l.gifted + l.sold + l.broken, 0);
  const bottleValue = ev.lines.reduce((a, l) => a + (l.poured + l.gifted + l.sold + l.broken) * (l.price || 0), 0);
  const r = ev.report || {};
  const costs = ['cuota', 'viaticos', 'otros_costos'].reduce((a, k) => a + (Number(r[k]) || 0), 0);
  const orders = Number(r.pedidos_mxn) || 0;
  const total = bottleValue + costs;
  return { used, bottleValue, costs, total, orders, roi: total > 0 ? orders / total : null };
}

export function validateEvent(ev) {
  const errs = [];
  const r = ev.report || {};
  if (!r.fecha) errs.push('Falta la fecha real del evento.');
  if (!r.lugar) errs.push('Falta el lugar o la cuenta.');
  if (!r.tipo) errs.push('Falta el tipo de evento.');
  for (const l of ev.lines) {
    const sum = l.poured + l.gifted + l.sold + l.returned + l.broken + l.kept;
    if (sum !== l.qty) errs.push(`${l.wine}: ${sum < l.qty ? 'faltan' : 'sobran'} ${Math.abs(l.qty - sum)} botellas por explicar.`);
    if (l.gifted > 0 && !(l.gifted_to || '').trim()) errs.push(`${l.wine}: indica a quién regalaste (nombre y negocio).`);
    if (l.sold > 0 && !(l.sold_to || '').trim()) errs.push(`${l.wine}: indica a quién vendiste y la orden o factura.`);
  }
  const kinds = new Set(ev.photos.map(p => p.kind));
  if (!kinds.has('montaje')) errs.push('Falta la foto del montaje con las botellas.');
  if (!kinds.has('botellas')) errs.push('Falta la foto de las botellas abiertas o vacías con la etiqueta visible.');
  if (ev.lines.some(l => l.broken > 0) && !kinds.has('rotas')) errs.push('Hay botellas rotas: sube una foto.');
  if (r.personas === undefined || r.personas === '') errs.push('Indica cuántas personas probaron el vino.');
  if (!r.calificacion) errs.push('Califica el evento del 1 al 5.');
  return errs;
}
