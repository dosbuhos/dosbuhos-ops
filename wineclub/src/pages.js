import { esc, fdate, rel, chip, page, bottleList, stateLabel, STATE, STATUS_LABEL, money, cadenceLabel, MESES } from './ui.js';
import { addDays, weekdayMon0, caseSlots, membershipYear, bottlesToText, totalBottles } from './schedule.js';
import { allOccurrences, subOccurrences, subClub, subFlags } from './data.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const shipHref = (o) => `/envio/${o.subId}/${o.k}`;
const prefLabel = (p) => p === 'envio' ? 'Envío a domicilio' : 'Recoge en bodega';
const isManagerNote = (user) => user.isManager ? '' : '<p class="small muted">Solo un administrador puede cambiar esto.</p>';

// ---------- shipment card (the core unit of the app) ----------
export function shipCard(o, today, back) {
  const s = o.sub;
  const st = STATE[o.state];
  const open = ['overdue', 'today', 'upcoming', 'exception'].includes(o.state);
  const chips = [];
  if (o.state === 'upcoming' && ['needs_prep', 'ready'].includes(o.status)) chips.push(chip(STATUS_LABEL[o.status], 'amber'));
  if (o.delayed) chips.push(chip(`Pospuesto · original ${fdate(o.due, today, { weekday: false })}`, 'amber'));
  if (['past_due', 'unpaid'].includes(s.status)) chips.push(chip('Pago vencido', 'amber'));
  if (o.afterEnd || ['canceled', 'manual_ended'].includes(s.status)) chips.push(chip('Suscripción terminada', 'grey'));
  if (o.bottles && o.bottlesTotal !== o.expectedBottles) chips.push(chip(`${o.bottlesTotal} de ${o.expectedBottles} botellas`, 'amber'));
  chips.push(chip(prefLabel(s.delivery_pref), s.delivery_pref === 'envio' ? 'wine' : 'grey'));
  const bottles = o.bottles
    ? `<details class="bottles"><summary>Ver botellas (${o.bottlesTotal})</summary>${bottleList(o.bottles)}</details>`
    : (o.missingAllocation ? `<div class="warn">Falta definir qué botellas lleva · <a href="${shipHref(o)}">resolver</a></div>` : '');
  const primary = s.delivery_pref === 'envio' ? ['shipped', 'Marcar enviado'] : ['handed', 'Entregado en mano'];
  const secondary = s.delivery_pref === 'envio' ? ['handed', 'Entregado en mano'] : ['shipped', 'Marcar enviado'];
  const acts = open ? `<form method="post" action="${shipHref(o)}/estado" class="acts">
    <input type="hidden" name="back" value="${esc(back)}">
    <button class="btn" name="status" value="${primary[0]}">${primary[1]}</button>
    <button class="btn ghost" name="status" value="${secondary[0]}">${secondary[1]}</button></form>` : '';
  return `<article class="card ship ${o.state}" id="e${o.subId}-${o.k}">
  <div class="when"><span class="date">${esc(fdate(o.eff, today))}</span><span class="rel">${esc(rel(o.eff, today))}</span>${chip(stateLabel(o), st.tone)}</div>
  <a class="who" href="${shipHref(o)}"><span class="name">${esc(s.member_name)}</span>
  <span class="meta">${esc(o.club.name)} · Envío #${o.n} · ${plural(o.expectedBottles, 'botella', 'botellas')}</span></a>
  <div class="chips">${chips.join('')}</div>${bottles}${acts}</article>`;
}

function okBanner(okAudit, today) {
  if (!okAudit) return '';
  const after = okAudit.after_json ? JSON.parse(okAudit.after_json) : {};
  const label = after.status ? STATUS_LABEL[after.status] : 'Programado';
  const [subId, k] = okAudit.entity_id.split(':');
  return `<div class="banner green"><span>✓ ${esc(okAudit.member_name || '')} · Envío #${esc(okAudit.n || k)}: ${esc(label)}</span>
  <form method="post" action="/deshacer/${okAudit.id}"><button class="btn ghost">Deshacer</button></form>
  <a href="/envio/${esc(subId)}/${esc(k)}">Agregar pedido, guía o foto</a></div>`;
}

// ---------- agenda ----------
export function agendaPage({ env, user, ctx, url, okAudit }) {
  const today = ctx.today;
  const horizon = Math.min(400, Math.max(14, Number(url.searchParams.get('dias')) || 45));
  const { occ, unmapped } = allOccurrences(ctx, addDays(today, horizon));
  const sortEff = (a, b) => a.eff.localeCompare(b.eff) || a.sub.member_name.localeCompare(b.sub.member_name);
  const endWeek = addDays(today, 6 - weekdayMon0(today));
  const endNext = addDays(endWeek, 7);
  const attention = occ.filter(o => o.state === 'overdue' || o.state === 'exception').sort(sortEff);
  const todays = occ.filter(o => o.state === 'today').sort(sortEff);
  const upcoming = occ.filter(o => o.state === 'upcoming').sort(sortEff);
  const thisWeek = upcoming.filter(o => o.eff <= endWeek);
  const nextWeek = upcoming.filter(o => o.eff > endWeek && o.eff <= endNext);
  const later = upcoming.filter(o => o.eff > endNext);
  const recent = occ.filter(o => o.state === 'done' && (o.f?.done_on || '') >= addDays(today, -7)).sort((a, b) => (b.f.done_on || '').localeCompare(a.f.done_on || ''));
  const back = url.pathname + (url.searchParams.get('dias') ? `?dias=${horizon}` : '');
  const cards = (list) => list.map(o => shipCard(o, today, back)).join('');

  const banners = [];
  if (unmapped.length) banners.push(`<div class="banner red"><span>${plural(unmapped.length, 'suscripción', 'suscripciones')} de Stripe sin club: no se pueden calcular sus envíos
    (${unmapped.slice(0, 4).map(s => esc(s.member_name)).join(', ')}${unmapped.length > 4 ? '…' : ''}).</span>
    ${user.isManager ? '<a href="/clubes#stripe">Asignar club</a>' : '<span class="small">Avisa a un administrador.</span>'}</div>`);
  const sync = ctx.settings.last_sync ? JSON.parse(ctx.settings.last_sync) : null;
  if (user.isManager && sync && !sync.ok) banners.push(`<div class="banner amber"><span>Stripe no se sincronizó: ${esc(sync.error)}</span><a href="/ajustes">Revisar</a></div>`);
  if (!ctx.subs.length) banners.push(`<div class="card empty">Todavía no hay socios.<br>${user.isManager ? (env.STRIPE_SECRET_KEY ? '<a href="/ajustes">Sincroniza con Stripe</a> o agrega uno a mano en <a href="/socios">Socios</a>.' : 'Conecta Stripe en <a href="/ajustes">Ajustes</a> o agrega uno a mano en <a href="/socios">Socios</a>.') : 'Un administrador debe conectar Stripe.'}</div>`);

  const byMonth = new Map();
  for (const o of later) { const key = o.eff.slice(0, 7); if (!byMonth.has(key)) byMonth.set(key, []); byMonth.get(key).push(o); }
  const nAttention = attention.length;
  const body = `
  ${okBanner(okAudit, today)}
  <div class="tiles">
    <a class="tile ${nAttention ? 'red' : ''}" href="#atrasados"><div class="v">${nAttention}</div><div class="l">${nAttention === 1 ? 'Atrasado' : 'Atrasados'}</div></a>
    <a class="tile ${todays.length ? 'wine' : ''}" href="#hoy"><div class="v">${todays.length}</div><div class="l">Hoy</div></a>
    <a class="tile" href="#semana"><div class="v">${thisWeek.length}</div><div class="l">Esta semana</div></a>
  </div>
  ${banners.join('')}
  ${nAttention ? `<div class="sec red" id="atrasados">Requiere atención <span class="n">${nAttention}</span></div>${cards(attention)}` : ''}
  <div class="sec wine" id="hoy">Hoy · ${esc(fdate(today, today))} <span class="n">${todays.length || ''}</span></div>
  ${todays.length ? cards(todays) : '<p class="muted small">Nada para hoy.</p>'}
  <div class="sec" id="semana">Esta semana <span class="n">${thisWeek.length || ''}</span></div>
  ${thisWeek.length ? cards(thisWeek) : '<p class="muted small">Nada más esta semana.</p>'}
  <div class="sec">Próxima semana <span class="n">${nextWeek.length || ''}</span></div>
  ${nextWeek.length ? cards(nextWeek) : '<p class="muted small">Nada la próxima semana.</p>'}
  ${[...byMonth.entries()].map(([key, list]) => `<div class="sec">${MESES[Number(key.slice(5)) - 1]} ${key.slice(0, 4) !== today.slice(0, 4) ? key.slice(0, 4) : ''} <span class="n">${list.length}</span></div>${cards(list)}`).join('')}
  <p class="center"><a class="btn quiet" href="/?dias=${horizon + 90}">Ver más adelante (${horizon + 90} días)</a></p>
  <p class="center small"><a href="/preguntar">Pregúntale al club (asistente)</a></p>
  ${recent.length ? `<details class="more"><summary>Hechos en los últimos 7 días (${recent.length})</summary><div class="rows">${recent.map(o => `
    <a class="row" href="${shipHref(o)}"><div class="main"><div class="t">${esc(o.sub.member_name)} · #${o.n}</div>
    <div class="s">${esc(STATUS_LABEL[o.status])} ${esc(fdate(o.f.done_on, today))}${o.f.order_ref ? ' · ' + esc(o.f.order_ref) : ''}</div></div></a>`).join('')}</div></details>` : ''}`;
  return page({ title: 'Agenda', body, user, env, tab: 'agenda' });
}

// ---------- one shipment ----------
export function shipmentPage({ env, user, ctx, o, photos, history }) {
  const today = ctx.today;
  const s = o.sub, f = o.f || {};
  const st = STATE[o.state];
  const open = ['overdue', 'today', 'upcoming', 'exception'].includes(o.state);
  const act = (status, label, cls = '') => `<button class="btn ${cls}" name="status" value="${status}">${label}</button>`;
  const back = `/envio/${o.subId}/${o.k}`;
  let actions;
  if (open) actions = `<div class="acts">${s.delivery_pref === 'envio' ? act('shipped', 'Marcar enviado') + act('handed', 'Entregado en mano', 'ghost') : act('handed', 'Entregado en mano') + act('shipped', 'Marcar enviado', 'ghost')}</div>
    <div class="acts">${o.status === 'needs_prep' ? act('scheduled', 'Quitar “en preparación”', 'quiet') : act('needs_prep', 'En preparación', 'quiet')}${o.status === 'ready' ? act('scheduled', 'Quitar “listo”', 'quiet') : act('ready', 'Listo', 'quiet')}</div>
    <div class="acts">${o.status === 'exception' ? act('scheduled', 'Quitar excepción', 'quiet') : act('exception', 'Marcar excepción', 'danger')}${act('skipped', 'Omitir este envío', 'quiet')}</div>`;
  else if (o.status === 'shipped') actions = `<div class="acts">${act('delivered', 'Marcar recibido')}${act('scheduled', 'Volver a pendiente', 'quiet')}</div>`;
  else if (o.status) actions = `<div class="acts one">${act('scheduled', 'Volver a pendiente', 'quiet')}</div>`;
  else actions = `<p class="muted small">${o.state === 'paused' ? 'Este envío cae dentro de una pausa.' : 'Este envío es anterior al inicio del registro.'}</p><div class="acts one">${act('handed', 'Registrar como entregado', 'quiet')}</div>`;

  const flags = subFlags(ctx, s).map(x => chip(x.text, x.tone)).join('');
  const addr = s.delivery_address || s.stripe_address;
  const bottlesBlock = o.bottles
    ? `${o.bottlesTotal !== o.expectedBottles ? `<div class="warn amber">${o.bottlesTotal} botellas; el club lleva ${o.expectedBottles}.</div>` : ''}${bottleList(o.bottles)}
       <p class="small muted">${o.bottlesSource === 'case' ? `Caja ${o.slot} de ${esc(o.club.name)}. Se guarda una copia al empezar a trabajar el envío.` : o.bottlesSource === 'custom' ? 'Lista cambiada para este envío.' : 'Copia guardada de la caja de ese momento.'}</p>`
    : `<div class="warn">${o.missingAllocation ? 'Falta definir qué botellas lleva este envío.' : 'Sin detalle de botellas.'}</div>
       <p class="small muted">Defínelo aquí abajo para este envío${user.isManager ? `, o la caja ${o.slot} en <a href="/clubes#club${o.club.id}">${esc(o.club.name)}</a>` : ''}.</p>`;

  const body = `<p><a href="/">← Agenda</a></p>
  <div class="when">${chip(stateLabel(o), st.tone)}</div>
  <h1>${esc(fdate(o.eff, today))} <span class="muted small" style="text-transform:none">· ${esc(rel(o.eff, today))}</span></h1>
  ${o.delayed ? `<p class="small"><b>Pospuesto.</b> Fecha original: ${esc(fdate(o.due, today))}${f.delay_reason ? ' · ' + esc(f.delay_reason) : ''}</p>` : ''}
  <div class="card"><a href="/socio/${s.member_id}" style="font-size:19px;font-weight:700;text-decoration:none">${esc(s.member_name)}</a>
    <div class="muted">${esc(o.club.name)} · Envío #${o.n} · ${plural(o.expectedBottles, 'botella', 'botellas')}</div>
    <div class="chips">${chip(prefLabel(s.delivery_pref), s.delivery_pref === 'envio' ? 'wine' : 'grey')}${flags}</div>
    ${s.delivery_pref === 'envio' || addr ? `<p class="small" style="margin:8px 0 0">${addr ? esc(addr) : '<span class="muted">Sin dirección de entrega</span>'}</p>` : ''}
    ${s.member_phone ? `<p class="small" style="margin:4px 0 0"><a href="tel:${esc(s.member_phone)}">${esc(s.member_phone)}</a></p>` : ''}
  </div>
  <h2>Botellas</h2><div class="card">${bottlesBlock}
    <details class="more"><summary>Cambiar botellas de este envío</summary>
    <form method="post" action="${back}/botellas"><label for="b">Una línea por vino: cantidad y nombre</label>
    <textarea id="b" name="bottles" rows="8" placeholder="2 Tempranillo GR&#10;1 Pet Nat">${esc(bottlesToText(o.bottles))}</textarea>
    <p class="small muted">Deja vacío para volver a la caja del club.</p><button class="btn sm">Guardar botellas</button></form></details></div>
  <h2>Estado</h2><div class="card"><form method="post" action="${back}/estado"><input type="hidden" name="back" value="${back}">${actions}</form>
    ${f.done_on ? `<p class="small muted">${esc(STATUS_LABEL[f.status] || 'Hecho')} el ${esc(fdate(f.done_on, today))}${f.delivered_on ? ` · recibido el ${esc(fdate(f.delivered_on, today))}` : ''}${f.updated_by ? ` · ${esc(f.updated_by)}` : ''}</p>` : ''}</div>
  <h2>Detalles</h2><div class="card"><form method="post" action="${back}/detalles">
    <label for="ref">Pedido Zoho / OC</label><input id="ref" name="order_ref" value="${esc(f.order_ref || '')}" placeholder="OV-02072">
    <div class="grid2"><div><label for="car">Paquetería</label><input id="car" name="carrier" value="${esc(f.carrier || '')}"></div>
    <div><label for="trk">Guía</label><input id="trk" name="tracking" value="${esc(f.tracking || '')}"></div></div>
    <div class="grid2"><div><label for="dn">Entregado / enviado el</label><input id="dn" type="date" name="done_on" value="${esc(f.done_on || '')}"></div>
    <div><label for="dl">Recibido el</label><input id="dl" type="date" name="delivered_on" value="${esc(f.delivered_on || '')}"></div></div>
    <label for="nt">Nota</label><textarea id="nt" name="note">${esc(f.note || '')}</textarea>
    <button class="btn sm" style="margin-top:10px">Guardar detalles</button></form></div>
  <h2>Posponer</h2><div class="card"><form method="post" action="${back}/posponer">
    <p class="small muted" style="margin-top:0">No cambia nada en Stripe. Antes de la nueva fecha no aparece como atrasado.</p>
    <div class="grid2"><div><label for="du">Nueva fecha</label><input id="du" type="date" name="delayed_until" value="${esc(f.delayed_until || '')}" min="${esc(o.due)}"></div>
    <div><label for="dr">Motivo</label><input id="dr" name="delay_reason" value="${esc(f.delay_reason || '')}" placeholder="Lo pidió el socio"></div></div>
    <div class="acts"><button class="btn sm">Posponer</button>${f.delayed_until ? '<button class="btn sm quiet" name="clear" value="1">Quitar posposición</button>' : ''}</div></form></div>
  <h2>Fotos</h2><div class="card">
    ${photos.length ? `<div class="photos">${photos.map(p => `<a href="/foto/${p.id}" target="_blank"><img src="/foto/${p.id}" alt="foto" loading="lazy"></a>`).join('')}</div>` : '<p class="muted small" style="margin:0">Sin fotos.</p>'}
    <label for="photo" class="btn quiet sm" style="margin-top:10px">Agregar foto</label>
    <input id="photo" type="file" accept="image/*" capture="environment" data-url="${back}/foto" style="display:none"><p id="photo-st" class="small muted"></p></div>
  <h2>Pago</h2><div class="card small">${f.paid_on ? `Pagado en Stripe el ${esc(fdate(f.paid_on, today))}${f.paid_amount != null ? ' · ' + money(f.paid_amount, s.price_currency) : ''}` : '<span class="muted">Sin pago de Stripe asociado a este envío.</span>'}</div>
  ${history.length ? `<h2>Historial</h2><div class="card small">${history.map(h => `<div style="padding:4px 0;border-top:1px solid var(--line)">${esc(h.at.slice(0, 16))} · ${esc(h.who)} · ${esc(h.action)}${h.note ? ' · ' + esc(h.note) : ''}</div>`).join('')}</div>` : ''}`;
  return page({ title: `${s.member_name} #${o.n}`, body, user, env, tab: 'agenda' });
}

// ---------- members ----------
export function membersPage({ env, user, ctx, members }) {
  const today = ctx.today;
  const { occ } = allOccurrences(ctx, addDays(today, 400));
  const bySubMember = new Map();
  for (const o of occ) {
    const m = o.sub.member_id;
    if (!bySubMember.has(m)) bySubMember.set(m, { overdue: 0, next: null });
    const r = bySubMember.get(m);
    if (o.state === 'overdue' || o.state === 'exception') r.overdue++;
    if (['today', 'upcoming'].includes(o.state) && (!r.next || o.eff < r.next)) r.next = o.eff;
  }
  const subsBy = new Map();
  for (const s of ctx.subs) { if (!subsBy.has(s.member_id)) subsBy.set(s.member_id, []); subsBy.get(s.member_id).push(s); }
  const isActive = (s) => !['canceled', 'incomplete_expired', 'manual_ended'].includes(s.status) && !(s.ended_on && s.ended_on <= today);
  const row = (m) => {
    const subs = subsBy.get(m.id) || [];
    const clubs = [...new Set(subs.map(s => subClub(ctx, s)?.name || 'Sin club'))].join(', ') || 'Sin suscripción';
    const r = bySubMember.get(m.id) || {};
    const norm = (m.name + ' ' + (m.email || '') + ' ' + clubs).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return `<a class="row" href="/socio/${m.id}" data-s="${esc(norm)}"><div class="main"><div class="t">${esc(m.name)}</div><div class="s">${esc(clubs)}</div></div>
      ${r.overdue ? chip(`${r.overdue} atrasado${r.overdue > 1 ? 's' : ''}`, 'red') : r.next ? `<span class="small muted">${esc(fdate(r.next, today, { weekday: false }))}</span>` : ''}</a>`;
  };
  const active = members.filter(m => (subsBy.get(m.id) || []).some(isActive));
  const ended = members.filter(m => !active.includes(m));
  const clubsOpts = [...ctx.clubs.values()].filter(c => c.active).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  const body = `<h1>Socios <span class="muted small">${active.length} activos</span></h1>
  <div class="search"><input id="q" type="search" placeholder="Buscar por nombre, correo o club" autocomplete="off"></div>
  <div class="rows">${active.map(row).join('') || '<div class="empty">Sin socios activos.</div>'}</div>
  ${ended.length ? `<details class="more"><summary>Terminados (${ended.length})</summary><div class="rows">${ended.map(row).join('')}</div></details>` : ''}
  ${user.isManager ? `<details class="more"><summary>Agregar socio sin Stripe</summary><div class="card"><form method="post" action="/socios/nuevo">
    <p class="small muted" style="margin-top:0">Para socios que no pagan por Stripe (cortesías, pagos en efectivo). Los de Stripe llegan solos.</p>
    <label for="nn">Nombre</label><input id="nn" name="name" required>
    <div class="grid2"><div><label for="ne">Correo</label><input id="ne" name="email" type="email"></div><div><label for="np">Teléfono</label><input id="np" name="phone"></div></div>
    <div class="grid2"><div><label for="nc">Club</label><select id="nc" name="club_id">${clubsOpts}</select></div>
    <div><label for="ns">Primer envío</label><input id="ns" name="start_date" type="date" value="${today}" required></div></div>
    <label for="nd">Entrega</label><select id="nd" name="delivery_pref"><option value="recoge">Recoge en bodega</option><option value="envio">Envío a domicilio</option></select>
    <button class="btn" style="margin-top:12px">Agregar</button></form></div></details>` : ''}`;
  return page({ title: 'Socios', body, user, env, tab: 'socios' });
}

export function memberPage({ env, user, ctx, member, benefits, uses, url }) {
  const today = ctx.today;
  const subs = ctx.subs;
  const all = url.searchParams.get('todo') === '1';
  const subCards = subs.map(s => {
    const club = subClub(ctx, s);
    const flags = subFlags(ctx, s).map(x => chip(x.text, x.tone)).join('');
    let timeline = '<div class="warn">Esta suscripción no tiene club asignado: no se pueden calcular sus envíos.</div>';
    if (club) {
      const occ = subOccurrences(ctx, s, addDays(today, all ? 730 : 365));
      const cut = all ? '0000' : addDays(today, -730);
      const pending = occ.filter(o => ['overdue', 'exception'].includes(o.state));
      const future = occ.filter(o => ['today', 'upcoming'].includes(o.state) && !pending.includes(o));
      const past = occ.filter(o => !pending.includes(o) && !future.includes(o) && o.due >= cut).reverse();
      const hidden = occ.filter(o => !pending.includes(o) && !future.includes(o) && o.due < cut).length;
      const row = (o) => `<a class="row ${o.state}" href="/envio/${o.subId}/${o.k}"><span class="d">${esc(fdate(o.eff, today, { weekday: false }))}</span>
        <div class="main"><div class="t">Envío #${o.n}</div><div class="s">${o.bottles ? plural(o.bottlesTotal, 'botella', 'botellas') : (o.missingAllocation ? 'Faltan botellas' : '')}${o.delayed ? ' · pospuesto' : ''}${o.f?.order_ref ? ' · ' + esc(o.f.order_ref) : ''}</div></div>${chip(stateLabel(o), STATE[o.state].tone)}</a>`;
      timeline = `${pending.length ? `<h3 style="color:var(--red)">Pendientes</h3><div class="rows tl">${pending.map(row).join('')}</div>` : ''}
        <h3>Próximos</h3><div class="rows tl">${future.map(row).join('') || '<div class="empty">Sin envíos próximos.</div>'}</div>
        <h3>Historial</h3><div class="rows tl">${past.map(row).join('') || '<div class="empty">Sin historial.</div>'}</div>
        ${hidden ? `<p><a href="?todo=1">Ver ${plural(hidden, 'envío anterior', 'envíos anteriores')}</a></p>` : ''}`;
    }
    const anchor = s.anchor_override || s.start_date;
    const clubOpts = [...ctx.clubs.values()].map(c => `<option value="${c.id}" ${s.club_id_override === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    const pauses = (ctx.pausesBySub.get(s.id) || []);
    const corrections = user.isManager ? `<details class="more"><summary>Correcciones</summary>
      <form method="post" action="/suscripcion/${s.id}/ajustes" class="card">
        <p class="small muted" style="margin-top:0">Inicio según ${s.stripe_subscription_id ? 'Stripe' : 'registro manual'}: ${esc(s.start_date)}. Nada de esto cambia Stripe.</p>
        <div class="grid2"><div><label>Fecha del envío #1</label><input type="date" name="anchor_override" value="${esc(s.anchor_override || '')}"></div>
        <div><label>Ajuste de numeración</label><input type="number" name="seq_offset" value="${s.seq_offset || 0}" min="-50" max="50">
        <p class="small muted">Ej. +2 si el primer envío de esta suscripción en realidad es el #3.</p></div></div>
        <label>Club</label><select name="club_id_override"><option value="">Según producto de Stripe${s.product_club_id ? ` (${esc(ctx.clubs.get(s.product_club_id)?.name || '')})` : ''}</option>${clubOpts}</select>
        <button class="btn sm" style="margin-top:10px">Guardar correcciones</button></form>
      <form method="post" action="/suscripcion/${s.id}/historico" class="card">
        <b>Registrar historial</b><p class="small muted">Marca como entregados todos los envíos pendientes con fecha anterior a:</p>
        <input type="date" name="before" value="${today}" required><button class="btn sm quiet" style="margin-top:10px">Marcar como entregados</button></form>
      <form method="post" action="/suscripcion/${s.id}/pausa" class="card"><b>Pausas</b>
        ${pauses.map(p => `<div class="small" style="margin:6px 0">${esc(p.from_date)} → ${esc(p.until_date || 'sin fecha')} · ${p.source === 'stripe' ? 'Stripe' : 'manual'}${p.note ? ' · ' + esc(p.note) : ''}</div>`).join('') || '<p class="small muted">Sin pausas.</p>'}
        <div class="grid2"><div><label>Desde</label><input type="date" name="from_date" required></div><div><label>Hasta (sin incluir)</label><input type="date" name="until_date"></div></div>
        <label>Nota</label><input name="note"><button class="btn sm quiet" style="margin-top:10px">Agregar pausa</button></form>
      ${!s.stripe_subscription_id ? `<form method="post" action="/suscripcion/${s.id}/terminar" class="card"><b>Terminar suscripción manual</b>
        <label>Último día</label><input type="date" name="ended_on" value="${esc(s.ended_on || today)}"><button class="btn sm danger" style="margin-top:10px">Terminar</button></form>` : ''}
      </details>` : '';
    return `<div class="card"><div style="font-weight:800;font-size:17px">${club ? esc(club.name) : 'Sin club'}</div>
      <div class="small muted">${club ? `${cadenceLabel(club.cadence_months)} · ${plural(club.bottles, 'botella', 'botellas')} · ` : ''}desde ${esc(fdate(anchor, today))}${s.price_amount != null ? ' · ' + money(s.price_amount, s.price_currency) + (s.billing_interval ? ` cada ${s.billing_interval_count > 1 ? s.billing_interval_count + ' ' : ''}${s.billing_interval === 'month' ? (s.billing_interval_count > 1 ? 'meses' : 'mes') : s.billing_interval}` : '') : ''}
      · ${esc(s.stripe_subscription_id ? 'Stripe: ' + s.status : 'Manual')}</div>
      <div class="chips">${flags}</div>${timeline}${corrections}</div>`;
  }).join('');

  // Benefits for the member's active clubs, counted in the current membership year.
  const activeSub = subs.find(s => subClub(ctx, s) && !['canceled', 'incomplete_expired', 'manual_ended'].includes(s.status)) || subs.find(s => subClub(ctx, s));
  let benefitsHtml = '<p class="muted small">Sin beneficios: no hay club activo.</p>';
  if (activeSub) {
    const club = subClub(ctx, activeSub);
    const year = membershipYear(activeSub.anchor_override || activeSub.start_date, today);
    const mine = benefits.filter(b => b.club_id === club.id && b.active);
    const usedOf = (b) => uses.filter(u => u.benefit_id === b.id && (b.period === 'once' || (u.used_on >= year.start && u.used_on <= year.end))).reduce((t, u) => t + u.qty, 0);
    benefitsHtml = `<p class="small muted" style="margin-top:0">Año de socio: ${esc(fdate(year.start, today, { weekday: false }))} – ${esc(fdate(year.end, today, { weekday: false }))}</p>
      ${mine.map(b => { const used = usedOf(b); const pct = b.quantity ? Math.min(100, Math.round(used / b.quantity * 100)) : 0;
        return `<div style="padding:10px 0;border-top:1px solid var(--line)"><div class="ben"><span>${esc(b.name)}</span>
        <span class="num">${b.quantity != null ? `${fmtQty(used)} de ${fmtQty(b.quantity)} ${esc(b.unit)}` : `${fmtQty(used)} ${esc(b.unit)}`}${b.period === 'once' ? '' : ''}</span></div>
        ${b.quantity ? `<div class="meter"><i style="width:${pct}%;${used > b.quantity ? 'background:var(--red)' : ''}"></i></div>` : ''}</div>`; }).join('') || '<p class="muted small">Este club no tiene beneficios registrados.</p>'}
      ${mine.length ? `<details class="more"><summary>Registrar uso</summary><form method="post" action="/socio/${member.id}/beneficio">
        <label>Beneficio</label><select name="benefit_id">${mine.map(b => `<option value="${b.id}">${esc(b.name)} (${esc(b.unit)})</option>`).join('')}</select>
        <div class="grid2"><div><label>Cantidad</label><input type="number" name="qty" value="1" min="0.01" step="any" required></div>
        <div><label>Fecha</label><input type="date" name="used_on" value="${today}" required></div></div>
        <label>Nota</label><input name="note" placeholder="Visita con 3 invitados"><button class="btn sm" style="margin-top:10px">Registrar</button></form></details>` : ''}
      ${uses.length ? `<details class="more"><summary>Usos registrados (${uses.length})</summary>${uses.map(u => `<div class="small" style="padding:6px 0;border-top:1px solid var(--line);display:flex;gap:8px;align-items:center">
        <span style="flex:1">${esc(u.used_on)} · ${esc(benefits.find(b => b.id === u.benefit_id)?.name || '')} · ${fmtQty(u.qty)}${u.note ? ' · ' + esc(u.note) : ''} <span class="muted">(${esc(u.created_by || '')})</span></span>
        ${user.isManager ? `<form method="post" action="/beneficio-uso/${u.id}/borrar"><button class="btn sm quiet" style="min-height:36px">Quitar</button></form>` : ''}</div>`).join('')}</details>` : ''}`;
  }

  const addr = member.delivery_address || member.stripe_address;
  const body = `<p><a href="/socios">← Socios</a></p><h1>${esc(member.name)}</h1>
  <div class="card"><dl class="kv">
    ${member.email ? `<dt>Correo</dt><dd><a href="mailto:${esc(member.email)}">${esc(member.email)}</a></dd>` : ''}
    ${member.phone ? `<dt>Teléfono</dt><dd><a href="tel:${esc(member.phone)}">${esc(member.phone)}</a></dd>` : ''}
    <dt>Entrega</dt><dd>${esc(prefLabel(member.delivery_pref))}</dd>
    <dt>Dirección</dt><dd>${addr ? esc(addr) : '<span class="muted">—</span>'}</dd>
    ${member.staff_note ? `<dt>Nota</dt><dd>${esc(member.staff_note)}</dd>` : ''}
  </dl>
  <details class="more"><summary>Editar entrega y nota</summary><form method="post" action="/socio/${member.id}/datos">
    <label>Entrega</label><select name="delivery_pref"><option value="recoge" ${member.delivery_pref === 'recoge' ? 'selected' : ''}>Recoge en bodega</option><option value="envio" ${member.delivery_pref === 'envio' ? 'selected' : ''}>Envío a domicilio</option></select>
    <label>Dirección de entrega</label><textarea name="delivery_address" rows="3" placeholder="${esc(member.stripe_address || '')}">${esc(member.delivery_address || '')}</textarea>
    <p class="small muted">Vacío = usar la dirección de Stripe.</p>
    ${member.stripe_customer_id ? '' : `<label>Teléfono</label><input name="phone" value="${esc(member.phone || '')}">`}
    <label>Nota para el equipo</label><textarea name="staff_note" rows="3">${esc(member.staff_note || '')}</textarea>
    <button class="btn sm" style="margin-top:10px">Guardar</button></form></details></div>
  <h2>Envíos</h2>${subCards || '<div class="card empty">Sin suscripciones.</div>'}
  <h2>Beneficios</h2><div class="card">${benefitsHtml}</div>`;
  return page({ title: member.name, body, user, env, tab: 'socios' });
}
const fmtQty = (n) => Number(n).toLocaleString('es-MX', { maximumFractionDigits: 2 });

// ---------- clubs ----------
export function clubsPage({ env, user, ctx, benefits, products, counts }) {
  const today = ctx.today;
  const clubs = [...ctx.clubs.values()];
  const m = user.isManager;
  const clubCard = (c) => {
    const slots = caseSlots(c);
    const slotName = (i) => c.allocation_mode === 'month' ? MESES[i - 1] : `Envío ${i}`;
    const cases = Array.from({ length: slots }, (_, i) => i + 1).map(i => {
      const b = ctx.cases.get(`${c.id}:${i}`);
      const total = b ? totalBottles(b) : 0;
      return `<div style="padding:8px 0;border-top:1px solid var(--line)"><div class="ben"><b>${slotName(i).charAt(0).toUpperCase() + slotName(i).slice(1)}</b>
        ${b ? chip(`${total} botellas`, total === c.bottles ? 'green' : 'amber') : chip('Sin definir', 'red')}</div>
        ${b ? `<div class="small">${b.map(x => `${esc(x.qty)}× ${esc(x.wine)}`).join(' · ')}</div>` : ''}
        ${m ? `<details class="more" style="margin:4px 0"><summary class="small">Editar</summary><form method="post" action="/club/${c.id}/caja/${i}">
        <textarea name="bottles" rows="7" placeholder="2 Tempranillo GR&#10;1 Pet Nat">${esc(bottlesToText(b))}</textarea>
        <button class="btn sm" style="margin-top:8px">Guardar ${slotName(i)}</button></form></details>` : ''}</div>`;
    }).join('');
    const bens = benefits.filter(b => b.club_id === c.id);
    return `<div class="card" id="club${c.id}"><div class="ben"><span style="font-weight:800;font-size:18px">${esc(c.name)}</span>
      <span>${c.legacy ? chip('Cerrado', 'grey') : ''}${c.active ? '' : chip('Inactivo', 'grey')}</span></div>
      <div class="small muted">${plural(c.bottles, 'botella', 'botellas')} · ${cadenceLabel(c.cadence_months)} · ${plural(counts.get(c.id) || 0, 'socio activo', 'socios activos')}</div>
      <h3>Cajas</h3><p class="small muted" style="margin-top:0">${c.allocation_mode === 'month' ? 'La caja depende del mes del envío.' : `El envío #1 lleva la caja 1, el #${slots + 1} vuelve a la caja 1.`} Los envíos ya trabajados guardan su propia copia.</p>${cases}
      <h3>Beneficios</h3>${bens.map(b => `<div style="padding:6px 0;border-top:1px solid var(--line)"><div class="ben"><span>${esc(b.name)}${b.active ? '' : ' <span class="muted">(inactivo)</span>'}</span>
        <span class="num small">${b.quantity != null ? fmtQty(b.quantity) + ' ' : ''}${esc(b.unit)} ${b.period === 'once' ? 'una vez' : 'al año'}</span></div>
        ${m ? `<details class="more" style="margin:2px 0"><summary class="small">Editar</summary><form method="post" action="/beneficio/${b.id}">${benefitFields(b)}<button class="btn sm" style="margin-top:8px">Guardar</button></form></details>` : ''}</div>`).join('') || '<p class="small muted">Ninguno.</p>'}
      ${m ? `<details class="more"><summary class="small">Agregar beneficio</summary><form method="post" action="/club/${c.id}/beneficio">${benefitFields({})}<button class="btn sm" style="margin-top:8px">Agregar</button></form></details>
      <details class="more"><summary class="small">Configuración del club</summary><form method="post" action="/club/${c.id}">
        <label>Nombre</label><input name="name" value="${esc(c.name)}" required>
        <div class="grid2"><div><label>Botellas por envío</label><input type="number" name="bottles" value="${c.bottles}" min="1" max="60" required></div>
        <div><label>Frecuencia</label><select name="cadence_months">${[1, 2, 3, 4, 6, 12].map(n => `<option value="${n}" ${c.cadence_months === n ? 'selected' : ''}>${cadenceLabel(n)}</option>`).join('')}</select></div></div>
        <label>Cajas</label><select name="allocation_mode"><option value="sequence" ${c.allocation_mode === 'sequence' ? 'selected' : ''}>Por número de envío</option><option value="month" ${c.allocation_mode === 'month' ? 'selected' : ''}>Por mes del calendario</option></select>
        <label>Palabras para reconocer el producto en Stripe</label><input name="keywords" value="${esc(c.keywords || '')}" placeholder="bronce">
        <div class="grid2"><label><input type="checkbox" name="legacy" value="1" ${c.legacy ? 'checked' : ''} style="width:auto;min-height:0"> Cerrado a nuevos socios</label>
        <label><input type="checkbox" name="active" value="1" ${c.active ? 'checked' : ''} style="width:auto;min-height:0"> Activo</label></div>
        <button class="btn sm" style="margin-top:8px">Guardar club</button></form></details>` : ''}</div>`;
  };
  const clubOpts = (sel) => `<option value="">— Sin club —</option>${clubs.map(c => `<option value="${c.id}" ${sel === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}`;
  const body = `<h1>Clubes</h1>${clubs.map(clubCard).join('')}
  <h2 id="stripe">Productos de Stripe</h2><div class="card">
    <p class="small muted" style="margin-top:0">Cada producto de Stripe corresponde a un club. Las suscripciones a un producto sin club no generan envíos y aparecen como alerta.</p>
    ${products.length ? products.map(p => `<form method="post" action="/producto/${esc(p.product_id)}" style="padding:8px 0;border-top:1px solid var(--line)">
      <div class="ben"><b>${esc(p.name || p.product_id)}</b>${p.club_id ? chip('Asignado', 'green') : chip('Sin club', 'red')}</div>
      <div class="small muted">${esc(p.product_id)}${p.mapped_by ? ' · ' + esc(p.mapped_by) : ''}</div>
      ${m ? `<div class="grid2" style="margin-top:6px"><select name="club_id">${clubOpts(p.club_id)}</select><button class="btn sm">Guardar</button></div>` : ''}</form>`).join('') : '<p class="small muted">Aún no se ha sincronizado Stripe.</p>'}
    ${isManagerNote(user)}</div>`;
  return page({ title: 'Clubes', body, user, env, tab: 'clubes' });
}
function benefitFields(b) {
  return `<label>Nombre</label><input name="name" value="${esc(b.name || '')}" required>
  <div class="grid2"><div><label>Cantidad (vacío = sin límite)</label><input type="number" step="any" min="0" name="quantity" value="${b.quantity ?? ''}"></div>
  <div><label>Unidad</label><input name="unit" value="${esc(b.unit || 'personas')}"></div></div>
  <div class="grid2"><div><label>Periodo</label><select name="period"><option value="year" ${b.period !== 'once' ? 'selected' : ''}>Por año de socio</option><option value="once" ${b.period === 'once' ? 'selected' : ''}>Una sola vez</option></select></div>
  <div><label>Estado</label><select name="active"><option value="1" ${b.active !== 0 ? 'selected' : ''}>Activo</option><option value="0" ${b.active === 0 ? 'selected' : ''}>Inactivo</option></select></div></div>`;
}

// ---------- settings (managers) ----------
export function settingsPage({ env, user, ctx, auditRows, eventCount, url }) {
  const today = ctx.today;
  const sync = ctx.settings.last_sync ? JSON.parse(ctx.settings.last_sync) : null;
  const hook = ctx.settings.last_webhook ? JSON.parse(ctx.settings.last_webhook) : null;
  const msg = url.searchParams.get('msg');
  const body = `<h1>Ajustes</h1>${msg ? `<div class="banner green">${esc(msg)}</div>` : ''}
  <h2>Stripe</h2><div class="card">
    <dl class="kv"><dt>Llave</dt><dd>${env.STRIPE_SECRET_KEY ? (String(env.STRIPE_SECRET_KEY).startsWith('sk_test') || String(env.STRIPE_SECRET_KEY).startsWith('rk_test') ? chip('Configurada · modo prueba', 'amber') : chip('Configurada', 'green')) : chip('Falta', 'red')}</dd>
    <dt>Última sincronización</dt><dd>${sync ? `${esc(sync.at.slice(0, 16).replace('T', ' '))} UTC · ${sync.ok ? `${sync.subscriptions} suscripciones, ${sync.invoices} pagos` : '<b style="color:var(--red)">' + esc(sync.error) + '</b>'}` : 'Nunca'}</dd>
    <dt>Webhook</dt><dd>${env.STRIPE_WEBHOOK_SECRET ? `Activo${hook ? ` · último ${esc(hook.type)} ${esc(hook.at.slice(0, 16).replace('T', ' '))} · API ${esc(hook.api_version || '?')}` : ' · sin eventos todavía'} · ${eventCount} eventos` : '<span class="muted">No configurado (opcional: se sincroniza cada hora)</span>'}</dd>
    <dt>Versión de API</dt><dd class="small">Solicitudes: 2025-03-31.basil</dd></dl>
    <form method="post" action="/sync" style="margin-top:12px"><button class="btn" ${env.STRIPE_SECRET_KEY ? '' : 'disabled'}>Sincronizar ahora</button></form>
    ${env.STRIPE_SECRET_KEY ? '' : '<p class="small muted">Agrega el secreto <code>STRIPE_SECRET_KEY</code> en Cloudflare (Workers → este Worker → Settings → Variables and Secrets). Usa una llave restringida de solo lectura.</p>'}</div>
  <h2>Inicio del registro</h2><div class="card"><form method="post" action="/ajustes">
    <p class="small muted" style="margin-top:0">Los envíos programados antes de esta fecha sin registro no cuentan como atrasados.</p>
    <input type="date" name="tracking_start" value="${esc(ctx.trackingStart)}" required><button class="btn sm" style="margin-top:10px">Guardar</button></form></div>
  <h2>Respaldo</h2><div class="card"><a class="btn quiet" href="/exportar.json">Exportar datos del club (JSON)</a>
    <p class="small muted">Socios, suscripciones, envíos, correcciones, pospuestos, pedidos, guías, notas, cajas y beneficios. No incluye llaves ni fotos.</p></div>
  <h2>Bitácora</h2><div class="card scroll"><table><tr><th>Fecha (UTC)</th><th>Quién</th><th>Qué</th><th>Dónde</th></tr>
    ${auditRows.map(a => `<tr><td>${esc(a.at.slice(0, 16))}</td><td>${esc(a.who)}</td><td>${esc(a.action)}${a.note ? '<br><span class="muted small">' + esc(a.note) + '</span>' : ''}</td><td>${a.entity === 'fulfillment' ? `<a href="/envio/${esc(a.entity_id.replace(':', '/'))}">envío ${esc(a.entity_id)}</a>` : esc((a.entity || '') + ' ' + (a.entity_id || ''))}</td></tr>`).join('')}</table></div>`;
  return page({ title: 'Ajustes', body, user, env, tab: 'ajustes' });
}

export function simplePage({ env, user, title, html, status = 200 }) {
  const r = page({ title, body: `<div class="card" style="margin-top:20px">${html}</div>`, user, env });
  return new Response(r.body, { status, headers: r.headers });
}

// ---------- optional AI helper ----------
export function askPage({ env, user }) {
  const body = `<p><a href="/">← Agenda</a></p><h1>Pregúntale al club</h1>
  <p class="small muted" style="margin-top:0">Responde con los datos de la app (solo lectura). Para marcar envíos usa la agenda.</p>
  <div id="chat"></div>
  <form id="askf" class="card" style="position:sticky;bottom:calc(var(--nav) + 8px)">
    <textarea id="askq" rows="2" placeholder="¿Quién tiene envíos atrasados?" style="min-height:56px" required></textarea>
    <div class="acts" style="margin-top:8px"><button class="btn" id="askb">Preguntar</button><button type="button" class="btn quiet" id="askc">Borrar</button></div>
  </form>
  <div class="chips" id="sugs">${['¿Qué envíos están atrasados?', '¿Qué sale esta semana?', '¿Qué botellas lleva el próximo envío de …?', '¿Cuál es el historial de …?'].map(t => `<button type="button" class="chip" style="border:0;min-height:36px;cursor:pointer">${esc(t)}</button>`).join('')}</div>
  <script>
  const chat=document.getElementById('chat'),f=document.getElementById('askf'),q=document.getElementById('askq'),b=document.getElementById('askb');let hist=[];
  try{hist=JSON.parse(sessionStorage.getItem('askh')||'[]')}catch{}
  const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  function draw(){chat.innerHTML=hist.map(m=>'<div class="card" style="'+(m.role==='user'?'background:var(--wine-soft);margin-left:15%':'margin-right:6%')+';white-space:pre-wrap">'+esc(m.content)+'</div>').join('');window.scrollTo(0,document.body.scrollHeight)}
  draw();
  document.getElementById('sugs').onclick=e=>{if(e.target.tagName==='BUTTON'){q.value=e.target.textContent.replace('…','');q.focus()}};
  document.getElementById('askc').onclick=()=>{hist=[];try{sessionStorage.removeItem('askh')}catch{}draw()};
  f.onsubmit=async e=>{e.preventDefault();e.stopImmediatePropagation();const v=q.value.trim();if(!v)return;hist.push({role:'user',content:v});q.value='';draw();
    b.disabled=true;b.textContent='Pensando…';
    try{const r=await fetch('/preguntar',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({history:hist})});
      const j=await r.json();hist.push({role:'assistant',content:j.answer||j.error||'Sin respuesta'})}
    catch(err){hist.push({role:'assistant',content:'Error: '+err.message})}
    b.disabled=false;b.textContent='Preguntar';try{sessionStorage.setItem('askh',JSON.stringify(hist.slice(-20)))}catch{}draw()};
  </script>`;
  return page({ title: 'Pregúntale al club', body, user, env, tab: 'agenda' });
}
