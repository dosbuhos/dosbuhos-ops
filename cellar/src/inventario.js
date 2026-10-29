// Inventario (supplies) ↔ Excellovint tabs "Inventarios" (one row per product, stock computed by formulas)
// and "Inventarios - Movimientos" (a ledger: FECHA, PRODUCTO, TIPO ENTRADA/SALIDA/CONTEO, CANTIDAD, UNIDAD, LOTE / USO, QUIÉN, NOTAS).
// Stock = last CONTEO + ENTRADAS − SALIDAS after it (formula in the sheet, so the sheet works on its own too).
// The app never writes the formula columns (Inventarios E, G, H, I; Movimientos E).
import { accessToken } from './sheets.js';

const CAT = 'Inventarios', MOV = 'Inventarios - Movimientos';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets/';
const cell = (v) => String(v == null ? '' : v).trim();
const q = (t) => "'" + t.replace(/'/g, "''") + "'";
const toSheetDate = (iso) => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return +m[2] + '/' + +m[3] + '/' + m[1]; const d = new Date(); return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear(); };
const fromSheetDate = (s) => { const m = cell(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? m[3] + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0') : ''; };
const num = (s) => { const n = parseFloat(cell(s).replace(/,/g, '')); return isNaN(n) ? null : n; };
const TIPOS = ['ENTRADA', 'SALIDA', 'CONTEO'];

async function gs(env, path, init = {}) {
  const r = await fetch(SHEETS + env.SHEET_ID + path, Object.assign({}, init, { headers: { authorization: 'Bearer ' + await accessToken(env), 'content-type': 'application/json' } }));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || 'Google Sheets error ' + r.status);
  return j;
}
const batchPut = (env, data) => gs(env, '/values:batchUpdate', { method: 'POST', body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }) });
// Next free row = after the last row with something in column A (formula columns hold "" further down).
const nextRow = (vals) => { let last = 1; vals.forEach((r, i) => { if (cell(r && r[0])) last = i + 1; }); return last + 1; };

export async function readInventory(env) {
  const j = await gs(env, '/values:batchGet?ranges=' + encodeURIComponent(q(CAT) + '!A1:L300') + '&ranges=' + encodeURIComponent(q(MOV) + '!A1:H5000'));
  const [cat, mov] = (j.valueRanges || []).map(v => v.values || []);
  if (!cat || !cat.length) return { items: [], movements: [], missing: true };
  const items = cat.slice(1).map((r, i) => ({ row: i + 2, producto: cell(r[0]), categoria: cell(r[1]), unidad: cell(r[2]), presentacion: cell(r[3]), stock: num(r[4]), minimo: num(r[5]), estado: cell(r[6]), ultimoConteo: fromSheetDate(r[7]) || cell(r[7]), uso30: num(r[8]), proveedor: cell(r[9]), ubicacion: cell(r[10]), notas: cell(r[11]) })).filter(x => x.producto);
  const movements = (mov || []).slice(1).map((r, i) => ({ row: i + 2, fecha: fromSheetDate(r[0]), producto: cell(r[1]), tipo: cell(r[2]).toUpperCase(), cantidad: num(r[3]), unidad: cell(r[4]), uso: cell(r[5]), quien: cell(r[6]), notas: cell(r[7]) })).filter(m => m.producto && m.tipo);
  return { items, movements };
}

export async function addMovement(env, b, initials) {
  const producto = cell(b.producto), tipo = cell(b.tipo).toUpperCase(), cantidad = num(b.cantidad);
  if (!producto || !TIPOS.includes(tipo) || cantidad == null || cantidad < 0) throw new Error('Falta producto, tipo o cantidad.');
  const j = await gs(env, '/values/' + encodeURIComponent(q(MOV) + '!A1:A5000'));
  const row = nextRow(j.values || []);
  await batchPut(env, [
    { range: q(MOV) + '!A' + row + ':D' + row, values: [[toSheetDate(b.fecha), producto, tipo, cantidad]] },
    { range: q(MOV) + '!F' + row + ':H' + row, values: [[cell(b.uso).toUpperCase(), initials || '', cell(b.notas).toUpperCase()]] },
  ]);
  return { ok: true, row };
}

// Add a product (no row) or edit one (row = its row in Inventarios). Only the typed columns are written.
export async function saveItem(env, b) {
  const producto = cell(b.producto).toUpperCase();
  if (!producto) throw new Error('Falta el nombre del producto.');
  let row = +b.row || 0;
  if (!row) {
    const j = await gs(env, '/values/' + encodeURIComponent(q(CAT) + '!A1:A300'));
    const vals = j.values || [];
    if (vals.some(r => cell(r && r[0]).toUpperCase() === producto)) throw new Error('Ese producto ya está en el inventario.');
    row = nextRow(vals);
  }
  const minimo = num(b.minimo);
  await batchPut(env, [
    { range: q(CAT) + '!A' + row + ':D' + row, values: [[producto, cell(b.categoria).toUpperCase(), cell(b.unidad), cell(b.presentacion)]] },
    { range: q(CAT) + '!F' + row, values: [[minimo == null ? '' : minimo]] },
    { range: q(CAT) + '!J' + row + ':L' + row, values: [[cell(b.proveedor), cell(b.ubicacion).toUpperCase(), cell(b.notas).toUpperCase()]] },
  ]);
  return { ok: true, row };
}
