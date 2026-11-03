// Helpers compartidos por todos los módulos del Worker.
export const VERSION = '0.4.0';
export const MX_OFFSET_H = 6; // San Miguel: UTC-6 todo el año
export const mxToday = () => new Date(Date.now() - MX_OFFSET_H * 3600000).toISOString().slice(0, 10);
export const mxNow = () => new Date(Date.now() - MX_OFFSET_H * 3600000).toISOString().slice(0, 16).replace('T', ' ');

export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const fail = (status, message) => { throw new HttpError(status, message); };
export const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
export const num = (v) => { if (v === '' || v == null) return null; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
export const int = (v) => { const n = num(v); return n == null ? null : Math.round(n); };
export const str = (v) => (v == null ? null : String(v).trim() || null);
export const bool = (v, dflt) => { if (v == null || v === '') return dflt; if (typeof v === 'boolean') return v ? 1 : 0; const s = String(v).trim().toLowerCase(); return ['1', 'si', 'sí', 'sim', 'yes', 'true', 'y', 'on'].includes(s) ? 1 : 0; };
export const round1 = (n) => Math.round(n * 10) / 10;
export const jsonArr = (v) => { if (Array.isArray(v)) return v; if (typeof v === 'string') { try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch { return []; } } return []; };
export const dateOk = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
export const seasonOf = (d) => Number(String(d).slice(0, 4));

// Lee todas las filas de una consulta
export const all = async (env, sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results;
export const one = async (env, sql, ...args) => env.DB.prepare(sql).bind(...args).first();
export const run = async (env, sql, ...args) => env.DB.prepare(sql).bind(...args).run();

// Día biodinámico (calendario de María Thun, aproximado): posición sideral de la Luna → elemento.
// Fruto: Aries, Leo, Sagitario · Raíz: Tauro, Virgo, Capricornio · Flor: Géminis, Libra, Acuario · Hoja: Cáncer, Escorpio, Piscis.
export function biodynamicDay(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const jd = Date.UTC(y, m - 1, d, 18) / 864e5 + 2440587.5; // ~mediodía en México
  const T = (jd - 2451545) / 36525;
  const L = (218.316 + 481267.881 * T) % 360;           // longitud media de la Luna
  const M = (134.963 + 477198.868 * T) % 360;           // anomalía media
  const D = (297.85 + 445267.112 * T) % 360;            // elongación
  const F = (93.272 + 483202.017 * T) % 360;
  const rad = Math.PI / 180;
  let lon = L + 6.289 * Math.sin(M * rad) + 1.274 * Math.sin((2 * D - M) * rad) + 0.658 * Math.sin(2 * D * rad) + 0.214 * Math.sin(2 * M * rad) - 0.186 * Math.sin((357.529 + 35999.05 * T) * rad) - 0.114 * Math.sin(2 * F * rad);
  lon = ((lon - 24.2) % 360 + 360) % 360;               // ayanamsa aproximada (sideral)
  const sign = Math.floor(lon / 30);
  return ['fruto', 'raiz', 'flor', 'hoja'][sign % 4];
}
