// Lecturas y utilidades compartidas del núcleo (recipientes, lotes, estancias).
import { fail } from './lib.js';

const WINE_ABBR = { tinto: 'TI', blanco: 'BL', rosado: 'RO', espumoso: 'ES', base_blanco: 'BB', base_rosado: 'BR', naranja: 'NA', piquette: 'PQ' };

export async function vesselsWithStays(env) {
  const sql = `
    SELECT v.*, l.name AS location_name, l.room AS location_room,
           s.id AS stay_id, s.volume AS stay_volume, s.unit AS stay_unit, s.entered_at AS stay_entered_at,
           lo.id AS lot_id, lo.code AS lot_code, lo.wine_type, lo.vintage, lo.varieties, lo.phase, lo.fermentation_done
    FROM vessels v
    LEFT JOIN locations l ON l.id = v.location_id
    LEFT JOIN stays s ON s.vessel_id = v.id AND s.left_at IS NULL
    LEFT JOIN lots lo ON lo.id = s.lot_id
    ORDER BY v.code`;
  return (await env.DB.prepare(sql).all()).results;
}

export async function lotsWithVolume(env) {
  const sql = `
    SELECT lo.*, COALESCE(SUM(s.volume), 0) AS volume,
           GROUP_CONCAT(v.code, ', ') AS vessel_codes, COUNT(s.id) AS vessel_count
    FROM lots lo
    LEFT JOIN stays s ON s.lot_id = lo.id AND s.left_at IS NULL
    LEFT JOIN vessels v ON v.id = s.vessel_id
    GROUP BY lo.id ORDER BY lo.status, lo.code`;
  return (await env.DB.prepare(sql).all()).results;
}

export async function nextLotCode(env, wineType, vintage) {
  const y = String((vintage || new Date().getFullYear()) % 100).padStart(2, '0');
  const prefix = `${y}-${WINE_ABBR[wineType] || 'LT'}-`;
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM lots WHERE code LIKE ?').bind(prefix + '%').first();
  let n = (r.n || 0) + 1, code;
  do { code = prefix + String(n).padStart(3, '0'); n++; } while (await env.DB.prepare('SELECT 1 FROM lots WHERE code = ?').bind(code).first());
  return code;
}

// Numeración de lotes según Configuración › Códigos de lote (estándar: L + año + número, p. ej. L260001).
export async function newLotCode(env, wineType, vintage) {
  const c = await env.DB.prepare('SELECT lot_numbering, lot_pattern FROM company WHERE id = 1').first().catch(() => null);
  if (c && c.lot_numbering === 'custom' && c.lot_pattern) {
    const y = String(vintage || new Date().getFullYear());
    const base = c.lot_pattern.replace('{YYYY}', y).replace('{YY}', y.slice(2)).replace('{TIPO}', WINE_ABBR[wineType] || 'LT');
    const prefix = base.replace(/\{N+\}.*$/, '');
    const width = (base.match(/\{(N+)\}/) || [, 'NNN'])[1].length;
    const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM lots WHERE code LIKE ?').bind(prefix + '%').first();
    let n = (r.n || 0) + 1, code;
    do { code = base.replace(/\{N+\}/, String(n).padStart(width, '0')); n++; } while (await env.DB.prepare('SELECT 1 FROM lots WHERE code = ?').bind(code).first());
    return code;
  }
  return nextLotCode(env, wineType, vintage);
}

// Crea un lote y su estancia inicial en un recipiente vacío (saldos de apertura, recepción de uva).
export function lotAndStayStmts(env, { code, wine_type, vintage, varieties, phase, creation_method, unit, fermentation_done, notes, parcel_id, reception_id, vessel_id, volume, date }) {
  return [
    env.DB.prepare('INSERT INTO lots (code, wine_type, vintage, varieties, phase, creation_method, unit, fermentation_done, notes, parcel_id, reception_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(code, wine_type || 'blanco', vintage ?? null, varieties ?? null, phase || 'crianza', creation_method || 'manual', unit || 'L', fermentation_done ?? 1, notes ?? null, parcel_id ?? null, reception_id ?? null),
    env.DB.prepare('INSERT INTO stays (lot_id, vessel_id, entered_at, volume_in, volume, unit) VALUES ((SELECT id FROM lots WHERE code = ?), ?, ?, ?, ?, ?)')
      .bind(code, vessel_id, date, volume, volume, unit || 'L'),
  ];
}
export async function occupiedCodes(env, vids) {
  if (!vids.length) return [];
  return (await env.DB.prepare(`SELECT v.code FROM stays s JOIN vessels v ON v.id = s.vessel_id WHERE s.left_at IS NULL AND s.vessel_id IN (${vids.map(() => '?').join(',')})`).bind(...vids).all()).results.map((r) => r.code);
}
