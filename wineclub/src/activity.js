// Actividad: who changed what, from the audit log. Every write records the signed-in account
// (Google sign-in per person), so this is the registry of who marked boxes as shipped or handed over.
import { esc, page, STATUS_LABEL } from './ui.js';

const TZ = 'America/Mexico_City';
const when = (at) => {
  const d = new Date(at.replace(' ', 'T') + 'Z');
  return isNaN(d) ? at : new Intl.DateTimeFormat('es-MX', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d);
};
const parse = (j) => { try { return j ? JSON.parse(j) : {}; } catch { return {}; } };

// One plain sentence per change.
export function describe(a) {
  if (a.entity === 'fulfillment') {
    const b = parse(a.before_json), f = parse(a.after_json);
    const n = a.entity_id?.split(':')[1];
    const box = `caja #${n}`;
    if (f.status && f.status !== b.status) {
      const label = (STATUS_LABEL[f.status] || f.status).toLowerCase();
      const extra = [f.done_on && ['handed', 'shipped', 'delivered'].includes(f.status) ? `fecha ${f.done_on}` : null,
        f.handled_by && f.handled_by !== a.who ? `entregó ${f.handled_by}` : null].filter(Boolean).join(' · ');
      return `Marcó la ${box} como “${label}”${extra ? ` (${extra})` : ''}`;
    }
    if (!f.status && b.status) return `Reabrió la ${box}`;
    return `${a.action[0].toUpperCase()}${a.action.slice(1)} · ${box}`;
  }
  return a.action[0].toUpperCase() + a.action.slice(1);
}

export async function activityData(env, url) {
  const who = (url.searchParams.get('quien') || '').toLowerCase();
  const onlyBoxes = url.searchParams.get('tipo') !== 'todo';
  const rows = (await env.DB.prepare(`SELECT a.*, m.id AS member_id, m.name AS member_name FROM audit_log a
      LEFT JOIN subscriptions s ON a.entity='fulfillment' AND s.id = CAST(substr(a.entity_id, 1, instr(a.entity_id, ':') - 1) AS INTEGER)
      LEFT JOIN members m ON m.id = COALESCE(s.member_id, CASE WHEN a.entity='member' THEN CAST(a.entity_id AS INTEGER) END)
      WHERE (?1 = '' OR a.who = ?1) AND (?2 = 0 OR a.entity = 'fulfillment')
      ORDER BY a.id DESC LIMIT 200`).bind(who, onlyBoxes ? 1 : 0).all()).results;
  const people = (await env.DB.prepare(`SELECT who, COUNT(*) AS n, MAX(at) AS last FROM audit_log
      WHERE entity='fulfillment' AND at >= datetime('now','-30 days') GROUP BY who ORDER BY n DESC`).all()).results;
  return { rows, people, who, onlyBoxes };
}

export function activityPage({ env, user, data }) {
  const { rows, people, who, onlyBoxes } = data;
  const link = (q = who, t = onlyBoxes ? '' : 'todo') => { const p = new URLSearchParams(); if (q) p.set('quien', q); if (t) p.set('tipo', t); const qs = p.toString(); return '/actividad' + (qs ? '?' + qs : ''); };
  const item = (a) => `<div class="act">
    <div class="act-top"><b>${esc(a.who)}</b><span class="muted">${esc(when(a.at))}</span></div>
    <div>${esc(describe(a))}${a.member_name ? ` · <a href="${a.entity === 'fulfillment' ? `/envio/${esc(a.entity_id.replace(':', '/'))}` : `/socio/${a.member_id}`}">${esc(a.member_name)}</a>` : ''}</div>
    ${a.note ? `<div class="small muted">${esc(a.note)}</div>` : ''}</div>`;
  const body = `<h1>Actividad</h1>
  <p class="small muted" style="margin-top:0">Cada cambio queda registrado con la cuenta de Google de quien lo hizo. Hora del centro de México.</p>
  ${people.length ? `<h2 class="qh">Cajas registradas · últimos 30 días</h2><div class="who-list">${people.map(p => `<a class="who-row${who === p.who ? ' on' : ''}" href="${link(who === p.who ? '' : p.who)}"><span>${esc(p.who)}</span><b>${p.n}</b></a>`).join('')}</div>` : ''}
  <nav class="mfilters"><a href="${link(undefined, '')}" ${onlyBoxes ? 'aria-current="page"' : ''}>Solo cajas</a><a href="${link(undefined, 'todo')}" ${!onlyBoxes ? 'aria-current="page"' : ''}>Todos los cambios</a>${who ? `<a href="${link('')}">Quitar filtro: ${esc(who)}</a>` : ''}</nav>
  ${rows.length ? rows.map(item).join('') : '<div class="card empty">Sin cambios registrados.</div>'}
  <p class="small muted">Se muestran los últimos ${rows.length} cambios.</p>
  <style>.act{background:var(--card,#fff);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin:8px 0;overflow-wrap:anywhere}
  .act-top{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 10px;font-size:14px}
  .who-list{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}
  .who-row{display:flex;justify-content:space-between;gap:10px;align-items:center;min-height:44px;padding:8px 12px;border:1px solid var(--line);border-radius:12px;text-decoration:none;color:var(--ink);overflow-wrap:anywhere}
  .who-row.on{border-color:var(--wine);background:var(--wine-soft)}
  .mfilters{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.mfilters a{display:inline-flex;align-items:center;min-height:40px;padding:6px 14px;border:1px solid var(--line);border-radius:999px;text-decoration:none;color:var(--ink);font-weight:600}
  .mfilters a[aria-current]{background:var(--wine);border-color:var(--wine);color:#fff}
  .qh{font-size:15px;font-weight:800;margin:18px 0 6px}</style>`;
  return page({ title: 'Actividad', body, user, env, tab: 'ajustes' });
}
