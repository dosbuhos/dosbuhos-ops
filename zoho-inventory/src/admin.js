import { layout, esc, fdate, mxn, int, pill } from './ui.js';
import { repSummary, dueInfo, eventFull, eventMoney, holdings } from './data.js';
import { readOnlyEvent } from './rep.js';

const STATUS = { abierto: 'Por reportar', enviado: 'Por revisar', devuelto: 'Devuelto', aprobado: 'Aprobado' };

export async function dashboard(env, user) {
  const { results: reps } = await env.DB.prepare('SELECT * FROM reps WHERE active=1 ORDER BY name').all();
  const cards = [];
  for (const rep of reps) {
    const s = await repSummary(env, rep);
    const varBad = s.lastCount && Math.abs(s.lastCount.variance || 0) > 2;
    cards.push(`<div class="card"><div class="row"><h2 style="margin:0">${esc(rep.name)}</h2><span class="spacer"></span><a class="small" href="/admin/eventos?rep=${rep.id}">Ver eventos</a></div>
      <div class="kpis" style="margin-top:10px">
        <div class="kpi"><div class="v">${int(s.shouldHold)}</div><div class="l">botellas que debería tener</div></div>
        <div class="kpi ${s.noReport ? 'bad' : ''}"><div class="v">${int(s.noReport)}</div><div class="l">botellas sin reporte</div></div>
        <div class="kpi ${s.overdue ? 'bad' : ''}"><div class="v">${int(s.overdue)}</div><div class="l">eventos vencidos (+7 días)</div></div>
        <div class="kpi ${varBad ? 'bad' : ''}"><div class="v">${s.lastCount ? (s.lastCount.variance > 0 ? '+' : '') + int(s.lastCount.variance) : '—'}</div><div class="l">${s.lastCount ? 'varianza del último conteo · ' + fdate(s.lastCount.created_at) : 'sin conteo todavía'}</div></div>
      </div></div>`);
  }
  const pending = (await env.DB.prepare(`SELECT e.*, r.name AS rep FROM events e JOIN reps r ON r.id=e.rep_id WHERE e.status='enviado' ORDER BY e.submitted_at`).all()).results;
  const counts = (await env.DB.prepare(`SELECT c.*, r.name AS rep FROM counts c JOIN reps r ON r.id=c.rep_id WHERE c.status='enviado'`).all()).results;
  const sync = await env.DB.prepare('SELECT * FROM sync_log ORDER BY id DESC LIMIT 1').first();
  const body = `<div class="row"><h1>Muestras</h1><span class="spacer"></span>
    <form method="post" action="/admin/sync" style="margin:0"><button class="btn small ghost">Importar de Zoho ahora</button></form></div>
    <p class="small muted">Última importación: ${sync ? `${esc(sync.ran_at)} UTC · ${sync.ok ? '' : '<span style="color:var(--red)">error: </span>'}${esc(sync.message)}` : 'nunca'}</p>
    ${pending.length ? `<div class="banner amber">${pending.length} ${pending.length === 1 ? 'reporte espera' : 'reportes esperan'} tu revisión</div>
      <div class="card"><table>${pending.map(e => `<tr><td><a href="/admin/evento/${e.id}">${esc(e.name)}</a></td><td>${esc(e.rep)}</td><td>${fdate(e.event_date)}</td></tr>`).join('')}</table></div>` : ''}
    ${counts.length ? `<div class="banner amber">${counts.length} ${counts.length === 1 ? 'conteo espera' : 'conteos esperan'} revisión · <a href="/admin/conteos">revisar</a></div>` : ''}
    ${cards.join('') || '<p class="muted">Agrega un vendedor en <a href="/admin/reps">Vendedores</a>.</p>'}`;
  return layout({ title: 'Resumen', body, user, wide: true, admin: true });
}

export async function eventsTable(env, user, url) {
  const rep = url.searchParams.get('rep'); const st = url.searchParams.get('estado');
  let sql = `SELECT e.*, r.name AS rep_name FROM events e JOIN reps r ON r.id=e.rep_id WHERE 1=1`; const b = [];
  if (rep) { sql += ' AND e.rep_id=?'; b.push(rep); }
  if (st) { sql += ' AND e.status=?'; b.push(st); }
  if (url.searchParams.get('reposiciones') !== '1') sql += ` AND e.kind='evento'`;
  sql += ' ORDER BY e.event_date DESC LIMIT 500';
  const { results: evs } = await env.DB.prepare(sql).bind(...b).all();
  const rows = [];
  let tot = { used: 0, value: 0, contacts: 0, orders: 0, placements: 0, cost: 0 };
  for (const e of evs) {
    const full = await eventFull(env, e.id);
    const m = eventMoney(full); const r = full.report;
    const thumbs = full.photos.slice(0, 3).map(p => `<img src="/foto/${p.id}" style="width:38px;height:38px;object-fit:cover;border-radius:6px">`).join(' ');
    const d = dueInfo(e);
    const statusPill = e.status === 'abierto' && d.state === 'overdue' ? pill('overdue', 'Vencido') : pill(e.status, STATUS[e.status]);
    const bottles = full.lines.reduce((a, l) => a + l.qty, 0);
    if (e.submitted_at) { tot.used += m.used; tot.value += m.bottleValue; tot.contacts += Number(r.contactos) || 0; tot.orders += m.orders; tot.placements += full.placements.length; tot.cost += m.total; }
    rows.push(`<tr><td>${fdate(r.fecha || e.event_date)}</td><td><a href="/admin/evento/${e.id}">${esc(r.nombre || e.name)}</a><div class="small muted">${esc(e.rep_name)}${e.so_number ? ' · ' + esc(e.so_number) : ''}</div></td>
      <td>${esc(r.tipo || (e.kind === 'reposicion' ? 'Reposición' : ''))}</td><td class="n">${e.submitted_at ? int(m.used) : int(bottles) + '*'}</td><td class="n">${e.submitted_at ? mxn(m.bottleValue) : ''}</td>
      <td class="n">${e.submitted_at ? mxn(m.total) : ''}</td><td class="n">${e.submitted_at ? int(r.contactos) : ''}</td><td class="n">${e.submitted_at ? int(full.placements.length) : ''}</td><td class="n">${e.submitted_at ? mxn(m.orders) : ''}</td>
      <td class="n">${m.roi !== null && e.submitted_at ? m.roi.toFixed(1) + '×' : ''}</td><td>${thumbs}</td><td>${statusPill}</td></tr>`);
  }
  const { results: reps } = await env.DB.prepare('SELECT id, name FROM reps ORDER BY name').all();
  const body = `<h1>Eventos</h1>
  <form class="row" method="get" style="margin-bottom:10px">
    <select name="rep" style="max-width:220px"><option value="">Todos los vendedores</option>${reps.map(r => `<option value="${r.id}" ${String(r.id) === rep ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
    <select name="estado" style="max-width:180px"><option value="">Todos los estados</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === st ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <label style="font-weight:400;display:flex;gap:6px;align-items:center;margin:0"><input type="checkbox" name="reposiciones" value="1" style="width:auto" ${url.searchParams.get('reposiciones') === '1' ? 'checked' : ''}>Incluir reposiciones</label>
    <button class="btn small ghost">Filtrar</button><span class="spacer"></span><a class="small" href="/admin/eventos.csv">Descargar CSV</a></form>
  <div class="card scroll"><table><tr><th>Fecha</th><th>Evento</th><th>Tipo</th><th class="n">Botellas</th><th class="n">Valor botellas</th><th class="n">Costo total</th><th class="n">Contactos</th><th class="n">Colocaciones</th><th class="n">Pedidos</th><th class="n">Retorno</th><th>Fotos</th><th>Estado</th></tr>
  ${rows.join('')}<tr><th colspan="3">Total de eventos reportados</th><th class="n">${int(tot.used)}</th><th class="n">${mxn(tot.value)}</th><th class="n">${mxn(tot.cost)}</th><th class="n">${int(tot.contacts)}</th><th class="n">${int(tot.placements)}</th><th class="n">${mxn(tot.orders)}</th><th class="n">${tot.cost ? (tot.orders / tot.cost).toFixed(1) + '×' : ''}</th><th></th><th></th></tr></table>
  <p class="small muted">* Botellas en la orden, aún sin reporte. Retorno = pedidos ÷ (valor de botellas a precio de lista + gastos).</p></div>`;
  return layout({ title: 'Eventos', body, user, wide: true, admin: true });
}

export async function eventsCsv(env) {
  const { results: evs } = await env.DB.prepare(`SELECT e.id FROM events e WHERE kind='evento' ORDER BY event_date`).all();
  const rows = [['evento_id', 'vendedor', 'orden_zoho', 'fecha', 'evento', 'tipo', 'lugar', 'ciudad', 'estado', 'vino', 'botellas', 'servidas', 'regaladas', 'a_quien_regalo', 'vendidas', 'a_quien_vendio', 'rotas', 'devueltas', 'le_quedan', 'personas', 'contactos', 'pedidos_mxn', 'costos_mxn']];
  for (const { id } of evs) {
    const e = await eventFull(env, id); const r = e.report; const m = eventMoney(e);
    for (const l of e.lines) rows.push([e.id, e.rep_name, e.so_number || '', r.fecha || e.event_date, r.nombre || e.name, r.tipo || '', r.lugar || '', r.ciudad || '', e.status, l.wine, l.qty, l.poured, l.gifted, l.gifted_to || '', l.sold, l.sold_to || '', l.broken, l.returned, l.kept, r.personas || '', r.contactos || '', m.orders, m.costs]);
  }
  const csv = '﻿' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="eventos_muestras.csv"' } });
}

export async function eventReview(env, user, id) {
  const ev = await eventFull(env, id);
  if (!ev) return null;
  const actions = ev.status === 'enviado' ? `<div class="card"><form method="post" action="/admin/evento/${ev.id}/revisar">
    <label style="margin-top:0">Comentario (obligatorio si lo devuelves)</label><textarea name="note"></textarea>
    <div class="row" style="margin-top:10px"><button class="btn" name="accion" value="aprobar">Aprobar</button><button class="btn ghost" name="accion" value="devolver">Devolver con comentario</button></div></form></div>`
    : ev.status === 'aprobado' && ev.reviewed_by ? `<p class="small muted">Aprobado por ${esc(ev.reviewed_by)} · ${esc(ev.reviewed_at || '')}. Los reportes aprobados ya no se pueden editar.</p>` : ' ';
  return readOnlyEvent(env, user, ev, actions);
}

export async function winesOut(env, user) {
  const { results: reps } = await env.DB.prepare('SELECT * FROM reps WHERE active=1 ORDER BY name').all();
  const map = {};
  for (const r of reps) for (const h of await holdings(env, r.id)) { map[h.wine] = map[h.wine] || {}; map[h.wine][r.id] = h.qty; }
  const used = (await env.DB.prepare(`SELECT l.wine, SUM(l.poured+l.gifted+l.sold+l.broken) AS used FROM event_lines l JOIN events e ON e.id=l.event_id
     WHERE e.submitted_at IS NOT NULL AND e.event_date >= date('now','-90 day') GROUP BY l.wine`).all()).results;
  const usedMap = Object.fromEntries(used.map(u => [u.wine, u.used]));
  const wines = Object.keys(map).sort((a, b) => sum(map[b]) - sum(map[a]));
  function sum(o) { return Object.values(o).reduce((a, b) => a + b, 0); }
  const body = `<h1>Vinos con los vendedores</h1><p class="muted">Lo que cada vendedor debería tener hoy, y lo usado en eventos reportados de los últimos 90 días.</p>
  <div class="card scroll"><table><tr><th>Vino</th>${reps.map(r => `<th class="n">${esc(r.name.split(' ')[0])}</th>`).join('')}<th class="n">Total en la calle</th><th class="n">Usado 90 días</th></tr>
  ${wines.map(w => `<tr><td>${esc(w)}</td>${reps.map(r => `<td class="n">${map[w][r.id] ? int(map[w][r.id]) : ''}</td>`).join('')}<td class="n"><strong>${int(sum(map[w]))}</strong></td><td class="n">${int(usedMap[w])}</td></tr>`).join('')}
  </table></div>`;
  return layout({ title: 'Vinos', body, user, wide: true, admin: true });
}

export async function countsPage(env, user) {
  const { results: counts } = await env.DB.prepare(`SELECT c.*, r.name AS rep FROM counts c JOIN reps r ON r.id=c.rep_id ORDER BY c.id DESC LIMIT 30`).all();
  const parts = [];
  for (const c of counts) {
    const { results: lines } = await env.DB.prepare('SELECT * FROM count_lines WHERE count_id=? ORDER BY wine').bind(c.id).all();
    const photos = (await env.DB.prepare('SELECT id FROM photos WHERE count_id=?').bind(c.id).all()).results;
    const variance = lines.reduce((a, l) => a + l.counted - l.expected, 0);
    const round = lines.filter(l => l.counted > 0).length >= 3 && lines.filter(l => l.counted > 0).every(l => l.counted % 6 === 0);
    parts.push(`<div class="card"><div class="row"><h2 style="margin:0">${esc(c.rep)} · ${c.kind === 'inicial' ? 'conteo inicial' : 'conteo'} del ${fdate(c.created_at)}</h2><span class="spacer"></span>${pill(c.status === 'enviado' ? 'enviado' : c.status, c.status === 'enviado' ? 'Por revisar' : c.status === 'aprobado' ? 'Aprobado' : 'Devuelto')}</div>
      ${Math.abs(variance) > 2 ? `<div class="banner red">Diferencia de ${variance > 0 ? '+' : ''}${variance} botellas contra lo que debería tener.</div>` : ''}
      ${round ? '<div class="banner amber">Todas las cantidades son múltiplos de 6: revisa que sea un conteo real.</div>' : ''}
      <div class="scroll"><table><tr><th>Vino</th><th class="n">Debería tener</th><th class="n">Contó</th><th class="n">Diferencia</th></tr>
      ${lines.map(l => { const d = l.counted - l.expected; return `<tr><td>${esc(l.wine)}</td><td class="n">${l.expected}</td><td class="n">${l.counted}</td><td class="n" style="${d ? 'color:var(--red);font-weight:700' : ''}">${d > 0 ? '+' : ''}${d}</td></tr>`; }).join('')}</table></div>
      <div class="photos">${photos.map(p => `<a href="/foto/${p.id}" target="_blank"><img src="/foto/${p.id}"></a>`).join('')}</div>
      ${c.note ? `<p class="small">Nota: ${esc(c.note)}</p>` : ''}
      ${c.status === 'enviado' ? `<form method="post" action="/admin/conteo/${c.id}/revisar"><label>Comentario</label><input name="note">
        <div class="row" style="margin-top:8px"><button class="btn small" name="accion" value="aprobar">Aprobar y ajustar bodega</button><button class="btn small ghost" name="accion" value="devolver">Pedir recontar</button></div>
        <p class="small muted">Al aprobar, lo que debería tener se iguala a lo que contó, y la diferencia queda registrada como ajuste.</p></form>`
        : `<p class="small muted">${esc(c.reviewed_by || '')} ${esc(c.review_note || '')}</p>`}</div>`);
  }
  return layout({ title: 'Conteos', body: `<h1>Conteos</h1>${parts.join('') || '<p class="muted">Sin conteos todavía.</p>'}`, user, wide: true, admin: true });
}

export async function repsPage(env, user) {
  const { results: reps } = await env.DB.prepare('SELECT * FROM reps ORDER BY active DESC, name').all();
  const body = `<h1>Vendedores</h1>
  <div class="card scroll"><table><tr><th>Nombre</th><th>Correo (inicio de sesión)</th><th>Contactos de Zoho</th><th>Importa desde</th><th>Activo</th><th></th></tr>
  ${reps.map(r => { const f = `form="rep${r.id}"`; return `<tr><td><input ${f} name="name" value="${esc(r.name)}"></td><td><input ${f} name="email" value="${esc(r.email)}"></td>
    <td><input ${f} name="zoho" value="${esc(JSON.parse(r.zoho_customer_ids).join(', '))}"></td><td><input ${f} type="date" name="sync_from" value="${esc(r.sync_from)}"></td>
    <td><select ${f} name="active"><option value="1" ${r.active ? 'selected' : ''}>Sí</option><option value="0" ${r.active ? '' : 'selected'}>No</option></select></td>
    <td><form id="rep${r.id}" method="post" action="/admin/reps/${r.id}" style="margin:0"><button class="btn small">Guardar</button></form></td></tr>`; }).join('')}
  </table></div>
  <h2>Agregar vendedor</h2><form class="card" method="post" action="/admin/reps/nuevo"><div class="grid2"><div><label>Nombre</label><input name="name" required></div><div><label>Correo</label><input name="email" type="email" required></div></div>
  <div class="grid2"><div><label>IDs de contacto en Zoho (separados por coma)</label><input name="zoho" placeholder="4898653000004352121"></div><div><label>Importar órdenes desde</label><input type="date" name="sync_from" value="2026-07-10"></div></div>
  <p class="small muted">El correo debe estar también en la política de Cloudflare Access para que pueda entrar.</p><button class="btn">Agregar</button></form>`;
  return layout({ title: 'Vendedores', body, user, wide: true, admin: true });
}
