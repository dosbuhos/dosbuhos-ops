// The counting rules. Pure functions, so the tolerances and the rotation queue can be tested without a database.

// Bottles from what the counter actually sees on the floor: pallets, loose cases, loose bottles.
// `caja` is bottles per case, `tarima` cases per pallet. A SKU with no standard pallet counts cases only.
export function total({ tarimas = 0, cajas = 0, sueltas = 0 }, { botellas_caja = 12, cajas_tarima = 0 } = {}) {
  const t = Math.max(0, Math.trunc(Number(tarimas) || 0));
  const c = Math.max(0, Math.trunc(Number(cajas) || 0));
  const s = Math.max(0, Math.trunc(Number(sueltas) || 0));
  const porCaja = Math.max(1, Math.trunc(Number(botellas_caja) || 12));
  const porTarima = Math.max(0, Math.trunc(Number(cajas_tarima) || 0));
  return t * porTarima * porCaja + c * porCaja + s;
}

// How serious a difference is. Red also when the count leaves the SKU negative: the floor is right, the ledger is not.
// `tol` comes from ajustes_app so it can change without a deploy.
export function semaforo(variacion, saldo, tol) {
  const v = Math.abs(Number(variacion) || 0);
  if (v === 0) return 'verde';
  const rojo = Math.max(1, Number(tol.rojo) || 6);
  const pct = Math.max(0, Number(tol.pct) || 0);
  const porPct = pct > 0 && saldo > 0 ? Math.ceil((saldo * pct) / 100) : Infinity;
  if (Number(saldo) < 0) return 'rojo';
  if (v >= Math.min(rojo, porPct)) return 'rojo';
  return v >= Math.max(1, Number(tol.ambar) || 1) ? 'ambar' : 'verde';
}

export const MOTIVOS = [
  'conteo anterior equivocado',
  'caja incompleta',
  'rotura no registrada',
  'traspaso no registrado',
  'salida sin documento',
  'SKU confundido en el acomodo',
  'no sé',
];

// What a count line needs before it can be submitted. Returns '' when it is fine.
export function revisa(linea, nivel) {
  if (!Number.isInteger(linea.contado) || linea.contado < 0) return 'Falta el conteo';
  if (nivel === 'verde') return '';
  if (!linea.motivo || !MOTIVOS.includes(linea.motivo)) return 'Falta el motivo de la diferencia';
  if (nivel === 'rojo' && !linea.foto) return 'Una diferencia de este tamaño necesita foto';
  return '';
}

const dia = 86400000;
export const diasEntre = (a, b) => (!a ? 9999 : Math.floor((Date.parse(b) - Date.parse(a)) / dia));

// The rotation queue: what has to be counted even though nobody pulled it.
// A SKU enters when it has gone too long uncounted, when it is one of the ten largest and has gone a shorter while,
// or when its last two counts both came back with a variance — something about that SKU or its position is wrong.
export function rotacion(skus, hoy, { dias_rotacion = 45, dias_rotacion_top = 30 } = {}) {
  const top = [...skus].sort((a, b) => (b.saldo || 0) - (a.saldo || 0)).slice(0, 10).map((s) => s.item_id);
  const out = [];
  for (const s of skus) {
    if (!s.activo) continue;
    const d = diasEntre(s.contado_at, hoy);
    let razon = '';
    if (!s.contado_at) razon = 'nunca contado';
    else if (s.variaciones_seguidas >= 2) razon = 'dos diferencias seguidas';
    else if (top.includes(s.item_id) && d >= Number(dias_rotacion_top)) razon = `${d} días, de los diez mayores`;
    else if (d >= Number(dias_rotacion)) razon = `${d} días sin contar`;
    if (razon) out.push({ ...s, dias: d, razon });
  }
  return out.sort((a, b) => b.dias - a.dias);
}
