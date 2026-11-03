// Panel: volumen total por tipo, primeros pasos, HOY (alertas), capacidad por tipo de recipiente, viñedo (campaña, fenología, restricciones).
import { mxToday, all, one } from './lib.js';
import { restrictions } from './vinedo.js';

const KIND_GROUP = { tank: 'tanks', press: 'tanks', foudre: 'foudres', amphora: 'amphorae', egg: 'amphorae', barrel: 'barrels', bin: 'other', keg: 'other', carboy: 'other', tirage_cage: 'other' };

export async function panel(env, board) {
  const today = mxToday();
  const b = await board(env);
  const vs = b.vessels.filter((v) => v.is_active);
  const byType = {};
  for (const v of vs) if (v.stay_id && v.stay_unit === 'L') byType[v.wine_type] = (byType[v.wine_type] || 0) + v.stay_volume;
  const groups = {};
  for (const v of vs) { const g = KIND_GROUP[v.kind] || 'other'; const o = (groups[g] ||= { count: 0, used: 0, liters: 0, capacity: 0 }); o.count++; o.capacity += v.capacity_l; if (v.stay_id) { o.used++; if (v.stay_unit === 'L') o.liters += v.stay_volume; } }
  const [counts, staleFerm, parcels, lastPhen, lastHarvest, lastOps] = await Promise.all([
    one(env, `SELECT (SELECT COUNT(*) FROM vessels) AS vessels, (SELECT COUNT(*) FROM harvest_receptions) AS receptions, (SELECT COUNT(*) FROM lots WHERE status = 'active') AS lots, (SELECT COUNT(*) FROM parcels) AS parcels, (SELECT COUNT(*) FROM finished_products) AS products, (SELECT COUNT(*) FROM operations WHERE status = 'draft') AS drafts`),
    all(env, `SELECT lo.code, lo.id, (SELECT MAX(read_at) FROM ferment_readings fr WHERE fr.lot_id = lo.id) AS last_read FROM lots lo JOIN stays s ON s.lot_id = lo.id AND s.left_at IS NULL WHERE lo.fermentation_done = 0 GROUP BY lo.id`),
    all(env, 'SELECT id, code, variety, area_ha FROM parcels WHERE is_active = 1'),
    all(env, 'SELECT ph.parcel_id, ph.stage, ph.observed_at FROM phenology ph WHERE ph.id IN (SELECT MAX(id) FROM phenology GROUP BY parcel_id)'),
    one(env, 'SELECT season, COUNT(*) AS n, SUM(weight_kg) AS kg FROM harvest_receptions GROUP BY season ORDER BY season DESC LIMIT 1'),
    all(env, "SELECT o.id, o.type, o.op_date, o.operator_name FROM operations o WHERE o.status = 'confirmed' ORDER BY o.op_date DESC, o.id DESC LIMIT 6"),
  ]);
  const stale = staleFerm.filter((l) => !l.last_read || (Date.parse(today) - Date.parse(l.last_read.slice(0, 10))) / 864e5 > 2);
  const alerts = [];
  const topUp = vs.filter((v) => v.flags.includes('rellenar')); if (topUp.length) alerts.push({ kind: 'rellenar', n: topUp.length, text: `${topUp.length} depósitos sin rellenar por completo`, items: topUp.map((v) => v.code) });
  const noLab = vs.filter((v) => v.flags.includes('analisis')); if (noLab.length) alerts.push({ kind: 'analisis', n: noLab.length, text: `${noLab.length} lotes sin análisis desde hace más de 30 días`, items: [...new Set(noLab.map((v) => v.lot_code))] });
  const dirty = vs.filter((v) => v.flags.includes('limpiar')); if (dirty.length) alerts.push({ kind: 'limpiar', n: dirty.length, text: `${dirty.length} depósito${dirty.length > 1 ? 's' : ''} sin limpiar tras el trasiego`, items: dirty.map((v) => v.code) });
  if (stale.length) alerts.push({ kind: 'fermentacion', n: stale.length, text: `${stale.length} fermentaciones sin lectura reciente`, items: stale.map((l) => l.code) });
  const restr = await restrictions(env);
  const steps = [
    { key: 'vessels', title: 'Configurar sus depósitos', text: 'Añada depósitos, barricas y otros recipientes de bodega.', done: counts.vessels > 0, href: '#/depositos' },
    { key: 'harvest', title: 'Registrar la vendimia', text: 'Reciba la uva y cree sus primeros lotes cuando empiece la vendimia.', done: counts.receptions > 0, href: '#/recepcion' },
  ];
  const phenMap = Object.fromEntries(lastPhen.map((p) => [p.parcel_id, p]));
  return { today, total_l: Math.round(b.kpi.liters), by_type: Object.entries(byType).map(([t, l]) => ({ wine_type: t, liters: Math.round(l) })).sort((a, c) => c.liters - a.liters), steps, alerts, groups, capacity: b.kpi, drafts: counts.drafts,
    vineyard: { parcels: parcels.length, area_ha: Math.round(parcels.reduce((a, p) => a + (p.area_ha || 0), 0) * 100) / 100, stages: parcels.map((p) => ({ ...p, stage: phenMap[p.id]?.stage || null, observed_at: phenMap[p.id]?.observed_at || null })), restrictions: restr, last_harvest: lastHarvest },
    recent: lastOps };
}
