import { esc, fdate, rel, chip, page, bottleList, stateLabel, STATE, STATUS_LABEL, money, cadenceLabel, MESES } from './ui.js';
import { addDays, weekdayMon0, caseSlots, membershipYear, bottlesToText, totalBottles, daysBetween } from './schedule.js';
import { allOccurrences, subOccurrences, subClub, subFlags, isIgnored } from './data.js';
import { exactDate, joinedDate, dateFacts, scheduleRow, recordedPending, visibleStatus } from './visibility.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const shipHref = (o) => `/envio/${o.subId}/${o.k}`;
const prefLabel = (p) => p === 'envio' ? 'Envío a domicilio' : 'Recoge en bodega';
const isManagerNote = (user) => user.isManager ? '' : '<p class="small muted">Solo un administrador puede cambiar esto.</p>';

// ---------- shipment card (the core unit of the app) ----------
export function shipCard(o, today, back) {
  const s = o.sub;
  const st = STATE[o.state];
  const actionable = ['overdue', 'today', 'exception'].includes(o.state); // future shipments: no fulfill button on the card
  const chips = [];
  if (['needs_prep', 'ready'].includes(o.status)) chips.push(chip(STATUS_LABEL[o.status], 'amber'));
  if (o.delayed) chips.push(chip(`Pospuesto · original ${fdate(o.due, today, { weekday: false })}`, 'amber'));
  if (['past_due', 'unpaid'].includes(s.status)) chips.push(chip('Pago vencido', 'amber'));
  if (o.afterEnd || ['canceled', 'manual_ended'].includes(s.status)) chips.push(chip('Suscripción terminada', 'grey'));
  if (o.bottles && o.bottlesTotal !== o.expectedBottles) chips.push(chip(`${o.bottlesTotal} de ${o.expectedBottles} botellas`, 'amber'));
  chips.push(chip(prefLabel(s.delivery_pref), s.delivery_pref === 'envio' ? 'wine' : 'grey'));
  const bottles = o.bottles
    ? `<details class="bottles"><summary>${actionable ? 'Ver / empacar esta caja' : 'Ver botellas'} (${o.bottlesTotal})</summary>${bottleList(o.bottles)}</details>`
    : (o.missingAllocation ? `<div class="warn">Falta definir qué botellas lleva · <a href="${shipHref(o)}#botellas">resolver</a></div>` : '');
  const como = s.delivery_pref === 'envio' ? ['shipped', 'Marcar enviado'] : ['handed', 'Entregado en mano'];
  const f = o.f || {};
  const ref = actionable ? `<details class="more" style="margin:8px 0 0"><summary class="small">${f.order_ref || f.tracking ? `Pedido ${esc(f.order_ref || '')}${f.tracking ? ' · guía ' + esc(f.tracking) : ''}` : 'Agregar pedido Zoho / guía'}</summary>
    <form method="post" action="${shipHref(o)}/ref" class="grid2"><input type="hidden" name="back" value="${esc(back)}"><input type="hidden" name="version" value="${f.version || 0}">
    <input name="order_ref" value="${esc(f.order_ref || '')}" placeholder="Pedido Zoho (OV-…)"><input name="tracking" value="${esc(f.tracking || '')}" placeholder="Guía (opcional)">
    <button class="btn sm quiet">Guardar</button></form></details>` : '';
  const acts = actionable
    ? `${ref}<div class="acts one"><a class="btn" href="${shipHref(o)}/entregar?como=${como[0]}">${como[1]}</a></div>`
    : (o.state === 'upcoming' ? `<div class="acts one"><a class="btn quiet sm" href="${shipHref(o)}">Ver envío</a></div>` : '');
  const late = o.state === 'overdue' ? plural(daysBetween(o.eff, today), 'día de atraso', 'días de atraso') : rel(o.eff, today);
  return `<article class="card ship ${o.state}${o.state === 'overdue' && !recordedPending(o) ? ' unverified' : ''}" id="e${o.subId}-${o.k}">
  <div class="when"><span class="date">${esc(fdate(o.eff, today))}</span><span class="rel">${esc(late)}</span>${chip(visibleStatus(o), o.state === 'overdue' && !recordedPending(o) ? 'amber' : st.tone)}</div>
  <a class="who" href="${shipHref(o)}"><span class="name">${esc(s.member_name)}</span>
  <span class="meta">${esc(o.club.name)} · Envío #${o.n} · ${plural(o.expectedBottles, 'botella', 'botellas')}</span></a>
  <p class="small muted date-context">Alta ${esc(exactDate(s.start_date))} · ${esc(cadenceLabel(o.club.cadence_months))}</p>
  <p class="small date-context">Previsto: <b>${esc(exactDate(o.due))}</b>${o.delayed ? ' · reprogramado' : ''}</p>
  <a class="small calendar-link" href="/socio/${s.member_id}#calendario">Ver alta y calendario del socio →</a>
  <div class="chips">${chips.join('')}</div>${o.delayed && f.delay_reason ? `<p class="small">${esc(f.delay_reason)}</p>` : ''}${bottles}${acts}
  ${['overdue','today','upcoming','exception'].includes(o.state) ? `<p class="small"><a href="${shipHref(o)}#aplazar">${o.delayed ? 'Cambiar / quitar aplazamiento' : 'Aplazar esta entrega'}</a></p>` : ''}</article>`;
}

function okBanner(okAudit, today) {
  if (!okAudit) return '';
  const after = okAudit.after_json ? JSON.parse(okAudit.after_json) : {};
  const label = after.status ? STATUS_LABEL[after.status] : 'Programado';
  const [subId, k] = okAudit.entity_id.split(':');
  return `<div class="banner green"><span>✓ ${esc(okAudit.member_name || '')} · Envío #${esc(okAudit.n || k)}: ${esc(label)}</span>
  <form method="post" action="/deshacer/${okAudit.id}"><button class="btn ghost">Deshacer</button></form>
  <a href="/envio/${esc(subId)}/${esc(k)}">Ver envío</a></div>`;
}

const RANGES = [[14, '2 semanas'], [30, '1 mes'], [90, '3 meses'], [180, '6 meses'], [365, '1 año']];

// ---------- agenda ----------
export function agendaPage({ env, user, ctx, url, okAudit }) {
  const today = ctx.today;
  const requestedRange = Number(url.searchParams.get('dias')) || 30;
  const horizon = RANGES.find(([d]) => d >= requestedRange)?.[0] || 365;
  const { occ, unmapped } = allOccurrences(ctx, addDays(today, 400));
  const sortEff = (a, b) => a.eff.localeCompare(b.eff) || a.sub.member_name.localeCompare(b.sub.member_name);
  const endWeek = addDays(today, 6 - weekdayMon0(today));
  const endNext = addDays(endWeek, 7);
  const attention = occ.filter(o => o.state === 'overdue' || o.state === 'exception').sort(sortEff);
  const todays = occ.filter(o => o.state === 'today').sort(sortEff);
  const upcomingAll = occ.filter(o => o.state === 'upcoming').sort(sortEff);
  const thisWeek = upcomingAll.filter(o => o.eff <= endWeek);
  const nextWeek = upcomingAll.filter(o => o.eff > endWeek && o.eff <= endNext);
  // Beyond next week: everything inside the chosen range, and never fewer than the next 8 shipments.
  const beyond = upcomingAll.filter(o => o.eff > endNext);
  const later = beyond.filter((o, i) => o.eff <= addDays(today, horizon) || i < 8);
  const recent = occ.filter(o => o.state === 'done' && (o.f?.done_on || '') >= addDays(today, -7)).sort((a, b) => (b.f.done_on || '').localeCompare(a.f.done_on || ''));
  const back = url.pathname + (url.searchParams.get('dias') ? `?dias=${horizon}` : '');
  const cards = (list) => list.map(o => shipCard(o, today, back)).join('');
  const blocked = unmapped; // includes ended subscriptions: they may still owe shipments from before they ended
  const incomplete = blocked.length > 0;

  const banners = [];
  const sync = ctx.settings.last_sync ? JSON.parse(ctx.settings.last_sync) : null;
  if (user.isManager && sync && !sync.ok) banners.push(`<div class="banner amber"><span>Stripe no se sincronizó: ${esc(sync.error)}</span><a href="/ajustes">Revisar</a></div>`);
  if (!ctx.subs.length) banners.push(`<div class="card empty">Todavía no hay socios.<br>${user.isManager ? 'Sincroniza Stripe en <a href="/ajustes">Ajustes</a>.' : 'Un administrador debe conectar Stripe.'}</div>`);

  const byMonth = new Map();
  for (const o of later) { const key = o.eff.slice(0, 7); if (!byMonth.has(key)) byMonth.set(key, []); byMonth.get(key).push(o); }
  const nA = attention.length;
  const registered = attention.filter(recordedPending).length;
  const recordedOpen = occ.filter(o=>recordedPending(o) && ['overdue','exception','today','upcoming'].includes(o.state)).length;
  const nextSeven = todays.length + upcomingAll.filter(o=>o.eff<=addDays(today,7)).length;
  const gapNote = incomplete ? ` <span class="small" style="text-transform:none;letter-spacing:0">· incompleto: faltan ${plural(blocked.length, 'socio', 'socios')} sin calendario</span>` : '';
  const empty = (what) => `<p class="muted small">${what}${incomplete ? ` entre los socios con calendario. <b style="color:var(--red)">${plural(blocked.length, 'socio está bloqueado', 'socios están bloqueados')}</b> y podrían tener envíos pendientes.` : '.'}</p>`;
  const body = `
  ${okBanner(okAudit, today)}
  <div class="tiles">
    <a class="tile ${recordedOpen ? 'red' : ''}" href="/envios?f=registrados"><div class="v">${recordedOpen}</div><div class="l">Pendientes registrados</div></a>
    <a class="tile ${nA - registered || incomplete ? 'wine' : ''}" href="/revision#sin-registro"><div class="v">${nA - registered}${incomplete ? '+' : ''}</div><div class="l">Por comprobar${incomplete ? ' · incompleto' : ''}</div></a>
    <a class="tile" href="#proximos"><div class="v">${nextSeven}</div><div class="l">Próximos 7 días</div></a>
  </div>
  ${nA ? `<div class="banner amber"><span><b>${registered} con pendiente registrado · ${nA - registered} sin registro de entrega.</b><br>Son fechas calculadas; hay que comprobar el historial antes de confirmar que falta una entrega.</span><a href="/revision">Revisar diferencias →</a></div>` : ''}
  <div class="jump-links agenda-jumps"><a href="#atrasados">Fechas vencidas</a><a href="#proximos">Próximos envíos</a><a href="/socios">Altas y calendarios</a></div>
  ${banners.join('')}
  ${incomplete ? `<div class="sec red" id="bloqueados">Calendarios bloqueados <span class="n">${blocked.length}</span></div>
    <div class="card" style="border-left:6px solid var(--red)"><p style="margin:0 0 8px">Estas suscripciones de Stripe no tienen club confirmado, así que la app <b>no puede calcular sus envíos</b>. Sus atrasados no están incluidos arriba.</p>
    <div class="rows" style="margin:0">${blocked.map(s => `<a class="row" href="${user.isManager ? `/conciliar#p-${esc(s.stripe_product_id || '')}` : `/socio/${s.member_id}`}"><div class="main"><div class="t">${esc(s.member_name)}</div>
      <div class="s">${esc(s.product_name || 'sin producto')} · desde ${esc(fdate(s.anchor_override || s.start_date, today, { weekday: false }))} · ${esc(s.status)}</div></div>${chip('Resolver', 'red')}</a>`).join('')}</div>
    ${user.isManager ? '<a class="btn" style="margin-top:10px" href="/conciliar">Conciliar Stripe</a>' : '<p class="small muted">Avisa a un administrador para que lo resuelva.</p>'}</div>` : ''}
  <div class="sec red" id="atrasados">Fechas vencidas sin entrega registrada <span class="n">${nA}</span>${gapNote}</div>
  ${nA ? cards(attention) : empty('Sin envíos atrasados')}
  <div class="sec wine" id="hoy">Hoy · ${esc(fdate(today, today))} <span class="n">${todays.length || ''}</span></div>
  ${todays.length ? cards(todays) : empty('Nada para hoy')}
  <div id="proximos"></div><div class="sec" id="semana">Esta semana <span class="n">${thisWeek.length || ''}</span></div>
  ${thisWeek.length ? cards(thisWeek) : empty('Nada más esta semana')}
  <div class="sec">Próxima semana <span class="n">${nextWeek.length || ''}</span></div>
  ${nextWeek.length ? cards(nextWeek) : empty('Nada la próxima semana')}
  ${[...byMonth.entries()].map(([key, list]) => `<div class="sec">${MESES[Number(key.slice(5)) - 1]} ${key.slice(0, 4) !== today.slice(0, 4) ? key.slice(0, 4) : ''} <span class="n">${list.length}</span></div>${cards(list)}`).join('')}
  <form method="get" action="/" class="card" style="display:flex;gap:10px;align-items:center"><label for="dias" style="margin:0;white-space:nowrap">Mostrar</label>
    <select id="dias" name="dias" onchange="this.form.submit()">${RANGES.map(([d, l]) => `<option value="${d}" ${d === horizon ? 'selected' : ''}>${l}</option>`).join('')}</select></form>
  <p class="center small"><a href="/preguntar">Pregúntale al club (asistente)</a></p>
  ${recent.length ? `<details class="more"><summary>Hechos en los últimos 7 días (${recent.length})</summary><div class="rows">${recent.map(o => `
    <a class="row" href="${shipHref(o)}"><div class="main"><div class="t">${esc(o.sub.member_name)} · #${o.n}</div>
    <div class="s">${esc(attribution(o.f, today))}${o.f.order_ref ? ' · ' + esc(o.f.order_ref) : ''}</div></div></a>`).join('')}</div></details>` : ''}`;
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
  const early = o.eff > today;
  const link = (como, label, cls = '') => `<a class="btn ${cls}" href="${back}/entregar?como=${como}">${label}</a>`;
  let actions;
  if (open) actions = `<p><a href="#aplazar">${o.delayed ? 'Cambiar / quitar aplazamiento' : 'Aplazar esta entrega'}</a></p>${early ? '<p class="small muted" style="margin-top:0">Todavía no toca. Si se entrega antes, el registro te pedirá confirmarlo.</p>' : ''}
    <div class="acts">${s.delivery_pref === 'envio' ? link('shipped', early ? 'Enviar antes de tiempo' : 'Marcar enviado') + link('handed', 'Entregado en mano', 'ghost') : link('handed', early ? 'Entregar antes de tiempo' : 'Entregado en mano') + link('shipped', 'Marcar enviado', 'ghost')}</div>
    <form method="post" action="${back}/estado"><input type="hidden" name="version" value="${f.version || 0}"><input type="hidden" name="back" value="${back}">
    <div class="acts">${o.status === 'needs_prep' ? act('scheduled', 'Quitar “en preparación”', 'quiet') : act('needs_prep', 'En preparación', 'quiet')}${o.status === 'ready' ? act('scheduled', 'Quitar “listo”', 'quiet') : act('ready', 'Listo', 'quiet')}</div>
    <div class="acts">${o.status === 'exception' ? act('scheduled', 'Quitar excepción', 'quiet') : act('exception', 'Marcar excepción', 'danger')}${act('skipped', 'Omitir este envío', 'quiet')}</div></form>`;
  else if (o.status) actions = `${o.status === 'shipped' ? `<form method="post" action="${back}/estado"><input type="hidden" name="version" value="${f.version || 0}"><input type="hidden" name="back" value="${back}"><div class="acts one">${act('delivered', 'Marcar recibido por el socio')}</div></form>` : ''}
    <details class="more"><summary>Reabrir para corregir</summary><form method="post" action="${back}/reabrir">
    <input type="hidden" name="version" value="${f.version || 0}"><label>Motivo (obligatorio)</label><input name="reason" required placeholder="Ej. se marcó por error">
    <p class="small muted">Vuelve a quedar pendiente. Los datos de pedido y guía se conservan y el cambio queda en el historial.</p><button class="btn sm danger">Reabrir</button></form></details>`;
  else actions = `<p class="muted small" style="margin-top:0">${o.state === 'paused' ? 'Este envío cae dentro de una pausa.' : 'Este envío es anterior al inicio del registro.'}</p><div class="acts one">${link('handed', 'Registrar entrega', 'quiet')}</div>`;

  const flags = subFlags(ctx, s).map(x => chip(x.text, x.tone)).join('');
  const addr = s.delivery_address || s.stripe_address;
  const bottlesBlock = o.bottles
    ? `${o.bottlesTotal !== o.expectedBottles ? `<div class="warn amber">${o.bottlesTotal} botellas; el club lleva ${o.expectedBottles}.</div>` : ''}${bottleList(o.bottles)}
       <p class="small muted">${o.bottlesSource === 'case' ? `Caja ${o.slot} de ${esc(o.club.name)}. Se guarda una copia al empezar a trabajar el envío.` : o.bottlesSource === 'custom' ? 'Lista cambiada para este envío.' : 'Copia guardada de la caja de ese momento.'}</p>`
    : `<div class="warn">${o.missingAllocation ? 'Falta definir qué botellas lleva este envío.' : 'Sin detalle de botellas.'}</div>
       <p class="small muted">Defínelo aquí abajo para este envío${user.isManager ? `, o la caja ${o.slot} en <a href="/clubes#club${o.club.id}">${esc(o.club.name)}</a>` : ''}.</p>`;

  const body = `<p><a href="/">← Agenda</a></p>
  <div class="when">${chip(visibleStatus(o), o.state === 'overdue' && !recordedPending(o) ? 'amber' : st.tone)}</div>
  <h1>Envío #${o.n} · ${esc(s.member_name)}</h1>
  <div class="card"><div class="small muted">Alta de esta suscripción: <b>${esc(exactDate(s.start_date))}</b> · ${esc(cadenceLabel(o.club.cadence_months))}</div>${dateFacts(o)}
  <a class="small calendar-link" href="/socio/${s.member_id}#calendario">Ver el calendario completo →</a></div>
  ${o.delayed ? `<p class="small"><b>Pospuesto.</b> Fecha original: ${esc(fdate(o.due, today))}${f.delay_reason ? ' · ' + esc(f.delay_reason) : ''}</p>` : ''}
  <div class="card"><a href="/socio/${s.member_id}" style="font-size:19px;font-weight:700;text-decoration:none">${esc(s.member_name)}</a>
    <div class="muted">${esc(o.club.name)} · Envío #${o.n} · ${plural(o.expectedBottles, 'botella', 'botellas')}</div>
    <div class="chips">${chip(prefLabel(s.delivery_pref), s.delivery_pref === 'envio' ? 'wine' : 'grey')}${flags}</div>
    ${s.delivery_pref === 'envio' || addr ? `<p class="small" style="margin:8px 0 0">${addr ? esc(addr) : '<span class="muted">Sin dirección de entrega</span>'}</p>` : ''}
    ${s.member_phone ? `<p class="small" style="margin:4px 0 0"><a href="tel:${esc(s.member_phone)}">${esc(s.member_phone)}</a></p>` : ''}
  </div>
  <h2 id="botellas">Botellas</h2><div class="card">${bottlesBlock}
    <details class="more"><summary>Cambiar botellas de este envío</summary>
    <form method="post" action="${back}/botellas"><input type="hidden" name="version" value="${f.version || 0}"><label for="b">Una línea por vino: cantidad y nombre</label>
    <textarea id="b" name="bottles" rows="8" placeholder="2 Tempranillo GR&#10;1 Pet Nat">${esc(bottlesToText(o.bottles))}</textarea>
    <label for="bm">Motivo del cambio (obligatorio si cambias botellas)</label><input id="bm" name="motivo" placeholder="Ej. sustitución pedida por el socio">
    <p class="small muted">Deja la lista vacía para volver a la caja del club.</p><button class="btn sm">Guardar botellas</button></form></details></div>
  <h2>Estado</h2><div class="card">${actions}
    ${f.status ? `<p class="small muted">${esc(attribution(f, today))}${f.delivered_on ? ` · recibido el ${esc(fdate(f.delivered_on, today))}` : ''}${f.override_reason ? ` · excepción: ${esc(f.override_reason)}` : ''}${f.legacy_id ? ` · importado del sistema anterior (#${esc(f.legacy_id)})` : ''}</p>` : ''}</div>
  <h2>Detalles</h2><div class="card"><form method="post" action="${back}/detalles">
    <input type="hidden" name="version" value="${f.version || 0}">
    <label for="ref">Pedido Zoho / OC</label><input id="ref" name="order_ref" value="${esc(f.order_ref || '')}" placeholder="OV-02072">
    <div class="grid2"><div><label for="car">Paquetería</label><input id="car" name="carrier" value="${esc(f.carrier || '')}"></div>
    <div><label for="trk">Guía</label><input id="trk" name="tracking" value="${esc(f.tracking || '')}"></div></div>
    <div class="grid2"><div><label for="dn">Entregado / enviado el</label><input id="dn" type="date" name="done_on" value="${esc(f.done_on || '')}"></div>
    <div><label for="dl">Recibido el</label><input id="dl" type="date" name="delivered_on" value="${esc(f.delivered_on || '')}"></div></div>
    <label for="nt">Nota</label><textarea id="nt" name="note">${esc(f.note || '')}</textarea>
    <button class="btn sm" style="margin-top:10px">Guardar detalles</button></form></div>
  ${open ? `<h2 id="aplazar">Aplazar esta entrega</h2><div class="card"><form method="post" action="${back}/posponer">
    <input type="hidden" name="version" value="${f.version || 0}">
    <p class="small" style="margin-top:0">Solo cambia esta entrega. Conserva la fecha original, los siguientes envíos y la facturación de Stripe. Antes de la nueva fecha no cuenta como atrasada.</p>
    <p class="small">Fecha original: <b>${esc(exactDate(o.due))}</b></p>
    <div class="grid2"><div><label for="du">Entregar a partir del</label><input id="du" type="date" name="delayed_until" value="${esc(f.delayed_until || '')}" min="${esc(addDays(o.due,1) > today ? addDays(o.due,1) : today)}" required></div>
    <div><label for="dr">Motivo del aplazamiento</label><input id="dr" name="delay_reason" value="${esc(f.delay_reason || '')}" maxlength="200" required placeholder="El socio está de viaje"></div></div>
    <p class="small muted">Si se cruza con el siguiente envío, ambos siguen pendientes por separado.</p>
    <div class="acts"><button class="btn sm">Guardar aplazamiento</button>${f.delayed_until ? '<button class="btn sm quiet" name="clear" value="1" formnovalidate>Quitar aplazamiento</button>' : ''}</div></form></div>` : ''}
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
    const norm = (m.name + ' ' + (m.email || '') + ' ' + (m.phone || '') + ' ' + clubs).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const joined = joinedDate(ctx, m.id);
    return `<a class="row member-row" href="/socio/${m.id}" data-s="${esc(norm)}"><div class="main"><div class="t">${esc(m.name)}</div><div class="s">${esc(clubs)}</div>
      <div class="small joined">Alta registrada: <b>${joined ? esc(exactDate(joined)) : 'Por confirmar'}</b></div>
      ${r.next ? `<div class="small muted">Próxima fecha: ${esc(exactDate(r.next))}</div>` : ''}</div>
      ${r.overdue ? chip(`${r.overdue} por revisar`, 'amber') : ''}</a>`;
  };
  const active = members.filter(m => (subsBy.get(m.id) || []).some(isActive));
  const ended = members.filter(m => !active.includes(m));
  const clubsOpts = [...ctx.clubs.values()].filter(c => c.active).map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  const body = `<h1>Socios <span class="muted small">${active.length} activos</span></h1>
  <div class="search"><input id="q" type="search" placeholder="Buscar nombre, teléfono, correo o club" aria-label="Buscar socios" autocomplete="off"></div>
  <p id="search-results" class="small muted" aria-live="polite">${active.length} activos · ${ended.length} terminados</p>
  <div class="rows">${active.map(row).join('') || '<div class="empty">Sin socios activos.</div>'}</div>
  ${ended.length ? `<details class="more" data-search-group><summary>Terminados (${ended.length})</summary><div class="rows">${ended.map(row).join('')}</div></details>` : ''}
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
    let timeline = isIgnored(s) ? '<p class="small muted">Producto fuera del club. No genera envíos.</p>' : '<div class="warn">Esta suscripción no tiene club asignado: no se pueden calcular sus envíos.</div>';
    if (club) {
      const occ = subOccurrences(ctx, s, addDays(today, all ? 730 : 365));
      const cut = all ? '0000' : addDays(today, -730);
      const pending = occ.filter(o => ['overdue', 'exception'].includes(o.state));
      const future = occ.filter(o => ['today', 'upcoming'].includes(o.state)).sort((a,b)=>a.eff.localeCompare(b.eff));
      const completed = occ.filter(o => o.state === 'done');
      const visible = occ.filter(o => o.due >= cut && (o.due <= today || future.slice(0,4).includes(o) || o.state === 'done'));
      const rest = occ.filter(o => !visible.includes(o));
      const last = [...completed].filter(o=>o.f?.done_on).sort((a,b)=>b.f.done_on.localeCompare(a.f.done_on))[0];
      const anchor = s.anchor_override || s.start_date;
      timeline = `<dl class="date-facts membership-facts">
        <div><dt>Alta de esta suscripción</dt><dd>${esc(exactDate(s.start_date))}</dd></div>
        <div><dt>Primer envío previsto</dt><dd>${esc(exactDate(anchor))}${s.anchor_override ? ' · ajustado' : ''}</dd></div>
        <div><dt>Frecuencia de envíos</dt><dd>Cada ${club.cadence_months === 1 ? 'mes' : club.cadence_months + ' meses'} · ${club.bottles} botellas</dd></div>
        ${pending.length ? `<div><dt>Fecha vencida más antigua</dt><dd>${esc(exactDate(pending[0].due))}</dd></div>` : ''}
        <div><dt>Próxima fecha futura</dt><dd>${future[0] ? esc(exactDate(future[0].due)) : 'Sin fecha futura'}</dd></div>
        ${future[0]?.delayed ? `<div><dt>Siguiente fecha reprogramada</dt><dd>${esc(exactDate(future[0].eff))}</dd></div>` : ''}
        <div><dt>Última entrega registrada</dt><dd>${last ? esc(exactDate(last.f.done_on)) : 'Sin entrega registrada'}</dd></div>
      </dl>
      <div class="chips">${chip(plural(completed.length, 'hecho', 'hechos'), 'green')}${pending.length ? chip(`${pending.length} fechas vencidas sin entrega registrada`, 'amber') : chip('Sin fechas vencidas', 'green')}</div>
      <p class="small muted">Fechas calculadas desde el primer envío, cada ${club.cadence_months === 1 ? 'mes' : club.cadence_months + ' meses'}. Una entrega tardía no cambia automáticamente las fechas siguientes.${Number(anchor.slice(8)) > 28 ? ' Si el día no existe en un mes, se usa su último día.' : ''}</p>
      <h3>Calendario esperado y entregas reales</h3>
      <p class="small muted">Ordenado por fecha prevista. “Sin entrega registrada” requiere comprobar el historial; no confirma que la caja nunca se haya entregado.</p>
      <div class="schedule-list">${visible.map(scheduleRow).join('') || '<p class="empty">Sin envíos en este período.</p>'}</div>
      ${rest.length ? `<details class="more"><summary>Ver ${rest.length} fechas más (históricas y futuras)</summary><div class="schedule-list">${rest.map(scheduleRow).join('')}</div></details>` : ''}`;
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
      <p class="small muted">Para registrar historial, abre el envío y confirma su fecha real de entrega. <a href="/migracion">Revisar historial del sistema anterior</a>.</p>
      <form method="post" action="/suscripcion/${s.id}/pausa" class="card"><b>Pausas</b>
        ${pauses.map(p => `<div class="small" style="margin:6px 0">${esc(p.from_date)} → ${esc(p.until_date || 'sin fecha')} · ${p.source === 'stripe' ? 'Stripe' : 'manual'}${p.note ? ' · ' + esc(p.note) : ''}</div>`).join('') || '<p class="small muted">Sin pausas.</p>'}
        <div class="grid2"><div><label>Desde</label><input type="date" name="from_date" required></div><div><label>Hasta (sin incluir)</label><input type="date" name="until_date"></div></div>
        <label>Nota</label><input name="note"><button class="btn sm quiet" style="margin-top:10px">Agregar pausa</button></form>
      ${!s.stripe_subscription_id ? `<form method="post" action="/suscripcion/${s.id}/terminar" class="card"><b>Terminar suscripción manual</b>
        <label>Último día</label><input type="date" name="ended_on" value="${esc(s.ended_on || today)}"><button class="btn sm danger" style="margin-top:10px">Terminar</button></form>` : ''}
      </details>` : '';
    return `<div class="card"><div style="font-weight:800;font-size:17px">${club ? esc(club.name) : 'Sin club'}</div>
      <div class="small muted">Cobro: ${s.price_amount != null ? money(s.price_amount, s.price_currency) + (s.billing_interval ? ` cada ${s.billing_interval_count > 1 ? s.billing_interval_count + ' ' : ''}${s.billing_interval === 'month' ? (s.billing_interval_count > 1 ? 'meses' : 'mes') : s.billing_interval}` : '') : 'Sin importe registrado'}
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
        <label for="benefit-handler">Atendido / entregado por</label><input id="benefit-handler" name="handled_by" value="${esc(user.email)}" maxlength="120" required>
        <p class="small muted">Si otra persona entregó el kit o atendió la visita, escribe su nombre. Registrado por: ${esc(user.email)} (se guarda automáticamente).</p>
        <label>Nota</label><input name="note" placeholder="Visita con 3 invitados"><button class="btn sm" style="margin-top:10px">Registrar</button></form></details>` : ''}
      ${uses.length ? `<details class="more" open><summary>Usos registrados (${uses.length})</summary>${uses.map(u => `<div class="small" style="padding:10px 0;border-top:1px solid var(--line);display:flex;gap:8px;align-items:center">
        <div style="flex:1;min-width:0;overflow-wrap:anywhere"><b>${esc(exactDate(u.used_on))} · ${esc(benefits.find(b => b.id === u.benefit_id)?.name || '')} · ${fmtQty(u.qty)}</b>
        <div>Atendido / entregado por: <b>${esc(u.handled_by || 'Sin registrar en el historial anterior')}</b></div>
        <div class="muted">Registrado por: ${esc(u.created_by || 'Sin registrar')}${u.created_at ? ' · ' + esc(u.created_at) + ' UTC' : ''}</div>
        ${u.note ? `<div>${esc(u.note)}</div>` : ''}</div>
        ${user.isManager ? `<form method="post" action="/beneficio-uso/${u.id}/borrar"><button class="btn sm quiet" style="min-height:36px">Quitar</button></form>` : ''}</div>`).join('')}</details>` : ''}`;
  }

  const addr = member.delivery_address || member.stripe_address;
  const joined = joinedDate(ctx, member.id);
  const body = `<p><a href="/socios">← Socios</a></p><h1>${esc(member.name)}</h1>
  <div class="card enrollment"><div class="eyebrow">Primera alta del club registrada</div><div class="enrollment-date">${joined ? esc(exactDate(joined)) : 'Por confirmar'}</div>
  <p class="small muted">Según el inicio de las suscripciones del club${subs.some(s=>s.stripe_subscription_id) ? ' en Stripe' : ''}. Es independiente de los ajustes del primer envío.</p>
  <div class="jump-links"><a href="#calendario">Ver calendario</a><a href="#contacto" onclick="document.getElementById('contacto').open=true">Contacto y entrega</a></div></div>
  ${member.staff_note ? `<div class="banner amber">${esc(member.staff_note)}</div>` : ''}
  <h2 id="calendario">Alta y calendario de envíos</h2>${subCards || '<div class="card empty">Sin suscripciones.</div>'}
  <details class="more card" id="contacto"><summary>Contacto y forma de entrega</summary><dl class="kv">
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
    <button class="btn sm" style="margin-top:10px">Guardar</button></form></details></details>
  <details class="more card" id="beneficios" ${url?.searchParams.has('beneficio') ? 'open' : ''}><summary>Beneficios y usos registrados</summary>${benefitsHtml}</details>`;
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
      ${m ? `<details class="more"><summary class="small">Configuración del club</summary><form method="post" action="/club/${c.id}">
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
  ${m ? '<p class="small"><a href="/conciliar">Productos de Stripe → Conciliar</a> · <a href="/ajustes/beneficios">Beneficios de cada club</a></p>' : ''}`;
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
  <div class="rows"><a class="row" href="/conciliar"><div class="main"><div class="t">Conciliar Stripe</div><div class="s">Productos de Stripe → club</div></div></a>
  <a class="row" href="/migracion"><div class="main"><div class="t">Migración del sistema anterior</div><div class="s">Historial de envíos de wineclubadmin</div></div></a>
  <a class="row" href="/ajustes/beneficios"><div class="main"><div class="t">Beneficios por club</div><div class="s">Qué incluye cada club</div></div></a></div>
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

// ---------- benefits administration (managers; outside the daily logistics flow) ----------
export function benefitsPage({ env, user, ctx, benefits }) {
  const clubs = [...ctx.clubs.values()];
  const body = `<p><a href="/ajustes">← Ajustes</a></p><h1>Beneficios por club</h1>
  <p class="small muted" style="margin-top:0">Lo que cada club incluye y se cuenta por socio. El uso se registra en la ficha de cada socio.</p>
  ${clubs.map(c => `<div class="card" id="club${c.id}"><div style="font-weight:800;font-size:17px">${esc(c.name)}</div>
    ${benefits.filter(b => b.club_id === c.id).map(b => `<div style="padding:6px 0;border-top:1px solid var(--line)"><div class="ben"><span>${esc(b.name)}${b.active ? '' : ' <span class="muted">(inactivo)</span>'}</span>
      <span class="num small">${b.quantity != null ? fmtQty(b.quantity) + ' ' : ''}${esc(b.unit)} ${b.period === 'once' ? 'una vez' : 'al año'}</span></div>
      <details class="more" style="margin:2px 0"><summary class="small">Editar</summary><form method="post" action="/beneficio/${b.id}">${benefitFields(b)}<button class="btn sm" style="margin-top:8px">Guardar</button></form></details></div>`).join('') || '<p class="small muted">Ninguno.</p>'}
    <details class="more"><summary class="small">Agregar beneficio</summary><form method="post" action="/club/${c.id}/beneficio">${benefitFields({})}<button class="btn sm" style="margin-top:8px">Agregar</button></form></details></div>`).join('')}`;
  return page({ title: 'Beneficios', body, user, env, tab: 'ajustes' });
}

const METHOD_ES = { signup: 'se lo llevó al inscribirse', pickup: 'recogió en bodega', courier: 'paquetería' };
export const attribution = (f, today) => f && f.status ? [STATUS_LABEL[f.status], f.done_on ? fdate(f.done_on, today, { weekday: false }) : null,
  f.method ? METHOD_ES[f.method] : null, f.handled_by || f.updated_by ? 'por ' + (f.handled_by || f.updated_by) : null].filter(Boolean).join(' · ') : '';

const FILTERS = [['todos', 'Todos'], ['atrasados', 'Fechas vencidas'], ['pendientes', 'Pendientes'], ['registrados', 'Pendientes registrados'], ['programados', 'Programados'], ['prep', 'En preparación'], ['listos', 'Listos'],
  ['enviados', 'Enviados'], ['entregados', 'Entregados'], ['excepciones', 'Excepciones']];
const FILTER_FN = {
  todos: () => true,
  atrasados: o => o.state === 'overdue' || o.state === 'exception',
  pendientes: o => ['today', 'upcoming', 'overdue', 'exception'].includes(o.state),
  registrados: o => recordedPending(o) && ['today','upcoming','overdue','exception'].includes(o.state),
  programados: o => ['today', 'upcoming'].includes(o.state),
  prep: o => o.status === 'needs_prep', listos: o => o.status === 'ready',
  enviados: o => o.status === 'shipped', entregados: o => o.status === 'handed' || o.status === 'delivered',
  excepciones: o => o.status === 'exception' || (o.f?.override_reason),
};

// ---------- searchable shipment list ----------
export function shipmentsPage({ env, user, ctx, url }) {
  const today = ctx.today;
  const filter = FILTER_FN[url.searchParams.get('f')] ? url.searchParams.get('f') : 'pendientes';
  const { occ } = allOccurrences(ctx, addDays(today, 120));
  const list = occ.filter(o => o.state !== 'pretracking' || o.status).filter(FILTER_FN[filter]);
  const open = (o) => ['overdue', 'exception', 'today', 'upcoming'].includes(o.state);
  list.sort((a, b) => open(a) !== open(b) ? (open(a) ? -1 : 1) : open(a) ? a.eff.localeCompare(b.eff) : (b.f?.done_on || b.due).localeCompare(a.f?.done_on || a.due));
  const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const body = `<h1>Envíos <span class="muted small">${list.length}</span></h1>
  <div class="search"><input id="q" type="search" placeholder="Buscar socio, club, pedido o guía" aria-label="Buscar envíos" autocomplete="off"></div>
  <div class="chips" style="margin-bottom:8px">${FILTERS.map(([k, l]) => `<a class="chip ${k === filter ? 'wine' : ''}" style="text-decoration:none;padding:7px 12px" href="/envios?f=${k}">${l}</a>`).join('')}</div>
  <p id="search-results" class="small muted" aria-live="polite">${list.length} envíos en este filtro</p>
  <div class="rows tl">${list.map(o => `<a class="row ${o.state}" href="${shipHref(o)}" data-s="${esc(norm([o.sub.member_name, o.club.name, o.f?.order_ref, o.f?.tracking, o.sub.member_email, o.sub.member_phone, o.due, exactDate(o.due)].join(' ')))}">
    <span class="d"><span class="small muted">${o.state === 'done' && o.f?.done_on ? 'Real' : 'Previsto'}</span><br>${esc(exactDate(o.state === 'done' ? o.f?.done_on || o.due : o.due))}</span>
    <div class="main"><div class="t">${esc(o.sub.member_name)}</div><div class="s">${esc(o.club.name)} · #${o.n}</div>
    <div class="s">Alta: ${esc(exactDate(o.sub.start_date))}</div>
    ${o.state === 'done' ? `<div class="s">Previsto: ${esc(exactDate(o.due))}<br>${esc(attribution(o.f, today))}</div>` : o.delayed ? `<div class="s">Reprogramado: ${esc(exactDate(o.eff))}</div>` : ''}${o.f?.order_ref ? `<div class="s">Pedido: ${esc(o.f.order_ref)}</div>` : ''}</div>
    ${chip(visibleStatus(o), o.state === 'overdue' && !recordedPending(o) ? 'amber' : STATE[o.state].tone)}</a>`).join('') || '<div class="empty">Ningún envío con este filtro.</div>'}</div>`;
  return page({ title: 'Envíos', body, user, env, tab: 'envios' });
}

// ---------- expected dates versus recorded legacy work ----------
export function reviewPage({ env, user, ctx }) {
  const { occ } = allOccurrences(ctx, addDays(ctx.today, 400));
  const overdue = occ.filter(o=>['overdue','exception'].includes(o.state)).sort((a,b)=>a.due.localeCompare(b.due));
  const registered = overdue.filter(recordedPending);
  const unknown = overdue.filter(o=>!recordedPending(o));
  const rows = (list) => list.map(o=>{
    const last = occ.filter(x=>x.subId===o.subId && x.state==='done' && x.f?.done_on).sort((a,b)=>b.f.done_on.localeCompare(a.f.done_on))[0];
    const legacy = ctx.legacyMembers?.get(o.sub.member_legacy_id);
    return `<article class="card review-card"><div class="schedule-top"><a href="/socio/${o.sub.member_id}#calendario"><b>${esc(o.sub.member_name)}</b></a>${chip(recordedPending(o) ? STATUS_LABEL[o.status] : 'Sin registro de entrega', recordedPending(o) ? 'red' : 'amber')}</div>
      <p class="small muted">${esc(o.club.name)} · Envío #${o.n} · Alta ${esc(exactDate(o.sub.start_date))}</p>
      ${dateFacts(o)}<p class="small">Última entrega: <b>${last ? esc(exactDate(last.f.done_on)) + ' · #' + last.n : 'Sin registro'}</b></p>
      ${legacy ? `<p class="small muted">El sistema anterior señala siguiente envío #${legacy.next_shipment_number || '—'}. El contador no confirma una entrega.</p>
        <a class="small" href="https://staging.dosbuhos.com/wineclubadmin/?view=member&amp;id=${encodeURIComponent(legacy.legacy_id)}" target="_blank" rel="noopener">Consultar historial anterior ↗</a>` : '<p class="small muted">Sin historial en el sistema anterior.</p>'}
      <a class="btn sm quiet" style="margin-top:12px" href="/envio/${o.subId}/${o.k}">Revisar envío y registrar datos reales</a></article>`;
  }).join('');
  return page({ title:'Revisar fechas vencidas', env, user, tab:'agenda', body:`<p><a href="/">← Agenda</a></p><h1>Revisar fechas vencidas</h1>
    <div class="banner amber">${overdue.length} fechas previstas han pasado sin una entrega registrada. Eso no confirma ${overdue.length} entregas realmente pendientes.</div>
    <p>El calendario sigue el inicio de cada suscripción y la frecuencia del club. Aquí se comparan las entregas registradas con las fechas calculadas; un contador de envío no prueba una entrega.</p>
    <h2>Con trabajo pendiente registrado (${registered.length})</h2>${rows(registered) || '<p class="small muted">Ninguno.</p>'}
    <h2 id="sin-registro">Sin registro: comprobar historial (${unknown.length})</h2><p class="small muted">Puede faltar una entrega histórica o una corrección de fechas. No se marca nada como entregado automáticamente.</p>${rows(unknown) || '<p class="small muted">Ninguno.</p>'}` });
}
