// What the crew role may write straight to Excellovint through /api/sheets: only the INI (done) cell of an existing
// work-order row in a lot tab, or the same column on "Today's Work Orders" (the app mirrors done marks there).
// Everything else (wording, priority, assignment, dates, new rows, cancel XX) is Eric's and Diane's.
// Results and notes go through /api/entries (new signed rows), not here.
import { accessToken, sheetsBase } from './sheets.js';
import { headerMap } from './xl.js';

const WO_OUT = "Today's Work Orders";
const colIndex = (L) => String(L).toUpperCase().split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

export async function crewSheetsGuard(env, tool, a) {
  const no = 'El equipo solo puede marcar órdenes como hechas. Para notas y valores usa «Anotar resultados y notas».';
  if (tool !== 'update_values') return no;
  const m = String(a.range || '').match(/^'((?:[^']|'')+)'!([A-Z]{1,3})(\d+)$/);
  if (!m) return no;
  const tab = m[1].replace(/''/g, "'"), col = colIndex(m[2]), row = +m[3];
  if (!(/^L\d/i.test(tab) || tab === WO_OUT)) return no;
  const vals = a.values;
  if (!Array.isArray(vals) || vals.length !== 1 || !Array.isArray(vals[0]) || vals[0].length !== 1) return no;
  const v = String(vals[0][0] == null ? '' : vals[0][0]).trim();
  if (/^XX$/i.test(v)) return 'Solo Eric o Diane cancelan órdenes (XX).';
  const r = await fetch(sheetsBase(env) + env.SHEET_ID + '/values/' + encodeURIComponent("'" + tab.replace(/'/g, "''") + "'!A1:Z15"),
    { headers: { authorization: 'Bearer ' + await accessToken(env) } });
  const j = await r.json().catch(() => ({}));
  const hm = headerMap(j.values || []);
  if (!hm || hm.map.ini == null) return no;
  if (col !== hm.map.ini || row <= hm.row + 1) return no;
  return null;
}

// First name for a set of initials, from the staff list (P → Paris, J → Jimena, P/J → Paris y Jimena).
export async function staffName(env, initials, email) {
  try {
    const { results } = await env.DB.prepare("SELECT id, data FROM docs WHERE coll = 'staff'").all();
    const staff = results.map(r => Object.assign({ id: r.id }, JSON.parse(r.data)));
    const one = (t) => { t = String(t || '').toUpperCase(); const s = staff.find(x => String(x.tag || '').toUpperCase() === t || (x.aliases || []).map(a => String(a).toUpperCase()).includes(t)); return s ? s.name : null; };
    const names = String(initials || '').split(/\s*[\/+,&]\s*/).filter(Boolean).map(one);
    if (names.length && names.every(Boolean)) return names.length > 1 ? names.slice(0, -1).join(', ') + ' y ' + names[names.length - 1] : names[0];
  } catch (e) {}
  return email || initials || '';
}

// Every tag and alias for a set of initials (J → JIMENA, J; P/J → PARIS, P, JIMENA, J), to match ASIG cells.
export async function staffTags(env, initials) {
  const toks = String(initials || '').toUpperCase().split(/\s*[\/+,&]\s*/).filter(Boolean), out = new Set(toks);
  try {
    const { results } = await env.DB.prepare("SELECT data FROM docs WHERE coll = 'staff'").all();
    for (const r of results) { const s = JSON.parse(r.data), all = [s.tag].concat(s.aliases || []).map(x => String(x || '').toUpperCase()); if (all.some(a => toks.includes(a))) all.forEach(a => out.add(a)); }
  } catch (e) {}
  return [...out];
}
