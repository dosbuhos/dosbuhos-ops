// Fulfillment flow (one reviewed, atomic "mark shipped / handed to client" action) and the Stripe
// reconciliation screen. Both are deliberately strict: nothing is marked delivered without staff
// confirming it, and no subscription gets a club without a manager confirming it.

import { esc, fdate, rel, chip, page, money, cadenceLabel, STATUS_LABEL } from './ui.js';
import { loadContext, subClub, audit, todayLocal, isIgnored, STAFF_FIELDS, writeFulfillment } from './data.js';
import { totalBottles, isDate, addDays, dueDate, occurrences } from './schedule.js';
import { dateFacts, exactDate } from './visibility.js';
import {billingWarning} from './billing.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const str = (v, max = 300) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const OPEN = ['overdue', 'today', 'upcoming', 'exception'];
const COMO = { shipped: 'Marcar enviado', handed: 'Entregado en mano' };

export const packingProblem = (o) => !o.bottles ? 'missing' : (o.bottlesTotal !== o.expectedBottles ? 'count' : null);

function checklist(list) {
  return `<ul class="blist pack">${(list || []).map((b, i) => `<li><label style="display:flex;gap:12px;align-items:center;width:100%;min-height:36px;margin:0;font-weight:400">
    <input type="checkbox" class="pk" style="width:24px;height:24px;min-height:0;flex:none"><span class="q">${esc(b.qty)}×</span><span>${esc(b.wine)}</span></label></li>`).join('')}</ul>`;
}

// ---------- GET: review + confirm ----------
export function fulfillPage({ env, user, ctx, o, como, error = null, form = {} }) {
  const today = ctx.today, s = o.sub, f = o.f || {};
  como = como === 'shipped' || como === 'handed' ? como : (s.delivery_pref === 'envio' ? 'shipped' : 'handed');
  const problem = packingProblem(o);
  const early = o.eff > today;
  const addr = s.delivery_address || s.stripe_address;
  const v = (k, d = '') => esc(form[k] ?? d);
  const body = `<p><a href="/envio/${o.subId}/${o.k}">← Envío</a></p>
  <h1>${COMO[como]}</h1>
  ${billingWarning(ctx,s,{paid:!!f.paid_on})}
  <div class="card small"><b>Pago de esta caja:</b> ${f.paid_on?`Pago asociado en Stripe el ${esc(exactDate(f.paid_on))}${f.paid_amount!=null?' · '+money(f.paid_amount,s.price_currency):''}`:'Sin pago asociado. Comprueba la factura del periodo en Stripe antes de entregar; esto no demuestra un impago.'}</div>
  ${error ? `<div class="banner red">${esc(error)}</div>` : ''}
  <div class="card">
    <div style="font-size:19px;font-weight:700">${esc(s.member_name)}</div>
    <div class="muted">${esc(o.club.name)} · Envío #${o.n} · ${plural(o.expectedBottles, 'botella', 'botellas')}</div>
    <p class="small muted">Alta: ${esc(exactDate(s.start_date))}</p>
    ${dateFacts(o)}
    <div class="small" style="margin-top:6px"><b>${esc(fdate(o.eff, today))}</b> · ${esc(rel(o.eff, today))}${o.delayed ? ` · pospuesto (original ${esc(fdate(o.due, today))})` : ''}</div>
    <div class="chips">${chip(s.delivery_pref === 'envio' ? 'Envío a domicilio' : 'Recoge en bodega', s.delivery_pref === 'envio' ? 'wine' : 'grey')}</div>
    ${addr ? `<p class="small" style="margin:6px 0 0">${esc(addr)}</p>` : ''}${s.member_phone ? `<p class="small" style="margin:4px 0 0"><a href="tel:${esc(s.member_phone)}">${esc(s.member_phone)}</a></p>` : ''}
  </div>
  <form method="post" action="/envio/${o.subId}/${o.k}/entregar" enctype="multipart/form-data" id="ff">
  <input type="hidden" name="version" value="${f.version || 0}">
  <input type="hidden" name="packing" value="${esc(JSON.stringify(o.bottles))}">
  <h2>Qué lleva la caja ${o.bottles ? `<span class="muted small">(${o.bottlesTotal} de ${o.expectedBottles})</span>` : ''}</h2>
  <div class="card">
    ${o.bottles ? checklist(o.bottles) : ''}
    ${!problem ? `<label style="display:flex;gap:10px;align-items:center"><input type="checkbox" name="packed" value="1" required style="width:24px;height:24px;min-height:0"> Revisé las botellas y cantidades de esta caja</label>` : ''}
    ${problem === 'missing' ? `<div class="warn">No está definido qué botellas lleva este envío.</div>` : ''}
    ${problem === 'count' ? `<div class="warn amber">La caja tiene ${o.bottlesTotal} botellas y el club lleva ${o.expectedBottles}.</div>` : ''}
    ${problem ? `<p class="small muted">Defínelo en <a href="/envio/${o.subId}/${o.k}#botellas">el envío</a>, o registra la entrega con un motivo:</p>
      <label style="display:flex;gap:10px;align-items:center;font-weight:600"><input type="checkbox" name="override" value="1" ${form.override ? 'checked' : ''} style="width:24px;height:24px;min-height:0"> Registrar de todos modos</label>
      <label for="orr">Motivo (obligatorio)</label><input id="orr" name="override_reason" value="${v('override_reason')}" placeholder="Ej. se armó a mano con lo que pidió el socio">` : ''}
  </div>
  ${early ? `<div class="card"><div class="warn amber">Este envío es para el ${esc(fdate(o.eff, today))}, todavía no toca.</div>
    <label style="display:flex;gap:10px;align-items:center;font-weight:600;margin-top:10px"><input type="checkbox" name="early" value="1" ${form.early ? 'checked' : ''} style="width:24px;height:24px;min-height:0"> Sí, se entrega antes de tiempo</label></div>` : ''}
  <h2>Datos de la entrega</h2>
  <div class="card">
    <div class="acts">
      <label class="btn ${como === 'shipped' ? '' : 'ghost'}" style="margin:0"><input type="radio" name="como" value="shipped" ${como === 'shipped' ? 'checked' : ''} style="display:none" onchange="this.form.querySelectorAll('.como').forEach(l=>l.classList.toggle('ghost',!l.querySelector('input').checked));document.getElementById('ship-only').style.display=this.checked?'':'none';document.getElementById('hand-only').style.display=this.checked?'none':''">Enviado</label>
      <label class="btn ${como === 'handed' ? '' : 'ghost'}" style="margin:0"><input type="radio" name="como" value="handed" ${como === 'handed' ? 'checked' : ''} style="display:none" onchange="this.form.querySelectorAll('.como').forEach(l=>l.classList.toggle('ghost',!l.querySelector('input').checked));document.getElementById('ship-only').style.display=this.checked?'none':'';document.getElementById('hand-only').style.display=this.checked?'':'none'">En mano</label>
    </div>
    <div id="hand-only" style="${como === 'handed' ? '' : 'display:none'}"><label for="mt">Cómo se entregó</label>
      <select id="mt" name="method"><option value="pickup" ${form.method !== 'signup' ? 'selected' : ''}>Recogió en bodega</option><option value="signup" ${form.method === 'signup' ? 'selected' : ''}>Se lo llevó al inscribirse</option></select></div>
    <label for="dn">Fecha</label><input id="dn" type="date" name="done_on" value="${v('done_on', today)}" max="${today}" required>
    <label for="ref">Pedido Zoho / OC</label><input id="ref" name="order_ref" value="${v('order_ref', f.order_ref || '')}" placeholder="OV-02072">
    <div id="ship-only" style="${como === 'shipped' ? '' : 'display:none'}"><div class="grid2">
      <div><label for="car">Paquetería</label><input id="car" name="carrier" value="${v('carrier', f.carrier || '')}"></div>
      <div><label for="trk">Guía</label><input id="trk" name="tracking" value="${v('tracking', f.tracking || '')}"></div></div></div>
    <label for="hb">Lo entregó / envió</label><input id="hb" name="handled_by" value="${v('handled_by', f.handled_by || user.email)}">
    <label for="nt">Nota</label><textarea id="nt" name="note" rows="2">${v('note', f.note || '')}</textarea>
    <label for="ph">Foto del envío (opcional)</label><input id="ph" type="file" name="photo" accept="image/*">
    <p class="small muted">Después de confirmar puedes guardar la firma del cliente, un recibo firmado o una captura de WhatsApp en “Comprobantes de recepción”.</p>
  </div>
  <div class="sticky-foot" style="position:sticky;bottom:calc(var(--nav) + 6px);padding:10px 0"><button class="btn" id="ffb">Confirmar</button></div>
  </form>
  <script>
  document.querySelectorAll('#ff label.btn').forEach(l=>l.classList.add('como'));
  const ff=document.getElementById('ff');
  ff.addEventListener('submit',async e=>{const ph=document.getElementById('ph');if(!ph.files[0])return;e.preventDefault();e.stopImmediatePropagation();
    const b=document.getElementById('ffb');b.disabled=true;b.textContent='Guardando…';
    try{const img=await createImageBitmap(ph.files[0]);const s=Math.min(1,1600/Math.max(img.width,img.height));const c=document.createElement('canvas');
    c.width=Math.round(img.width*s);c.height=Math.round(img.height*s);c.getContext('2d').drawImage(img,0,0,c.width,c.height);
    const blob=await new Promise(r=>c.toBlob(r,'image/jpeg',.82));const fd=new FormData(ff);fd.set('photo',blob,'foto.jpg');
    const r=await fetch(ff.action,{method:'POST',body:fd,redirect:'follow'});document.open();document.write(await r.text());document.close();history.replaceState(null,'',r.url)}
    catch(err){b.disabled=false;b.textContent='Confirmar';alert('No se pudo guardar: '+err.message)}});
  </script>`;
  return page({ title: COMO[como], body, user, env, tab: 'agenda' });
}

// ---------- POST: validate + one atomic write ----------
export async function fulfillSubmit(env, user, sh, request) {
  const { sub, club, o } = sh;
  const today = todayLocal(env);
  const fd = await request.formData();
  const form = Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === 'string'));
  const como = form.como === 'shipped' ? 'shipped' : form.como === 'handed' ? 'handed' : null;
  const fail = (error, status = 400) => {
    const r = fulfillPage({ env, user, ctx: sh.ctx, o, como, error, form });
    return new Response(r.body, { status, headers: r.headers });
  };
  if (!como) return fail('Elige si se envió o se entregó en mano.');
  if (!OPEN.includes(o.state)) return fail(`Este envío ya está registrado como "${STATUS_LABEL[o.status] || o.state}". Para cambiarlo, reábrelo desde el envío.`, 409);
  if (!isDate(form.done_on)) return fail('Indica una fecha de entrega válida.');
  const doneOn = form.done_on;
  if (doneOn > today) return fail('La fecha de entrega no puede ser en el futuro.');
  const early = o.eff > today;
  if (early && form.early !== '1') return fail('Este envío todavía no toca. Marca "Sí, se entrega antes de tiempo" para registrarlo.');
  const problem = packingProblem(o);
  if (form.packing !== JSON.stringify(o.bottles)) return fail('La lista de botellas cambió. Recarga y revisa la caja antes de confirmar.', 409);
  if (!problem && form.packed !== '1') return fail('Confirma que revisaste las botellas y cantidades de la caja.');
  const reason = str(form.override_reason, 300);
  if (problem && !(form.override === '1' && reason)) return fail(problem === 'missing'
    ? 'Falta definir qué botellas lleva. Defínelo, o marca "Registrar de todos modos" y escribe el motivo.'
    : `La caja no cuadra (${o.bottlesTotal} de ${o.expectedBottles}). Corrígela, o marca "Registrar de todos modos" y escribe el motivo.`);

  const fields = {
    status: como, done_on: doneOn,
    order_ref: str(form.order_ref, 60), carrier: como === 'shipped' ? str(form.carrier, 60) : null,
    tracking: como === 'shipped' ? str(form.tracking, 80) : null, note: str(form.note, 2000),
    bottles_json: o.f?.bottles_json || (o.bottles ? JSON.stringify(o.bottles) : null),
    override_reason: problem ? reason : null, early: early ? 1 : 0,
    method: como === 'shipped' ? 'courier' : (form.method === 'signup' ? 'signup' : 'pickup'),
    handled_by: str(form.handled_by, 80) || user.email,
  };
  const version = Number(form.version) || 0;
  const photo = fd.get('photo');
  let attachment;
  if (photo && typeof photo !== 'string' && photo.size > 0) {
    if (photo.size > 1_900_000) return fail('La foto pesa demasiado. Reduce su tamaño o registra sin foto.', 413);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(photo.type)) return fail('Usa una foto JPG, PNG o WebP.');
    attachment = { type: photo.type, data: await photo.arrayBuffer() };
  }
  let auditId;
  try {
    ({ auditId } = await writeFulfillment(env, user.email, sub, club, o.k, fields,
      `${como === 'shipped' ? 'enviado' : 'entregado en mano'}${early ? ' (antes de tiempo)' : ''}${problem ? ' (con excepción de caja)' : ''}`,
      { version, note: reason, photo: attachment }));
  } catch (e) { if (e.status === 409) return fail(e.message, 409); throw e; }
  return new Response(null, { status: 303, headers: { location: `/?ok=${auditId}` } });
}

// ---------- reopen (correction) ----------
export async function reopen(env, user, sh, form) {
  const { sub, o } = sh;
  const reason = str(form.reason, 300);
  if (!reason) return 'Escribe por qué se reabre.';
  if (!o.f || !o.f.status) return 'Este envío no está registrado.';
  try {
    await writeFulfillment(env, user.email, sub, sh.club, o.k,
      { status: null, done_on: null, delivered_on: null, override_reason: null, early: 0 }, 'reabrir',
      { version: Number(form.version) || 0, note: reason });
  } catch (e) { if (e.status === 409) return e.message; throw e; }
  return null;
}

// ---------- reconciliation (Stripe product → club) ----------
export async function reconcileData(env) {
  const ctx = await loadContext(env);
  const products = (await env.DB.prepare('SELECT * FROM stripe_products').all()).results;
  const byProduct = new Map();
  for (const s of ctx.subs) {
    const key = s.stripe_product_id || '(manual)';
    if (!byProduct.has(key)) byProduct.set(key, []);
    byProduct.get(key).push(s);
  }
  return { ctx, products, byProduct };
}

// What a club assignment would produce, without writing anything.
export function previewFor(ctx, sub, club) {
  const today = ctx.today;
  const occ = occurrences(sub, club, {
    to: addDays(today, 120), today, trackingStart: ctx.trackingStart,
    fulfillments: ctx.fulByKey.get(sub.id) || new Map(), pauses: ctx.pausesBySub.get(sub.id) || [],
    caseFor: (c, slot) => ctx.cases.get(`${c.id}:${slot}`) || null,
  });
  return {
    anchor: sub.anchor_override || sub.start_date,
    owed: occ.filter(o => o.due <= today && !['pretracking', 'paused', 'skipped'].includes(o.state)).length,
    done: occ.filter(o => o.state === 'done').length,
    overdue: occ.filter(o => o.state === 'overdue' || o.state === 'exception').map(o => o.due),
    pretracking: occ.filter(o => o.state === 'pretracking').length,
    next: occ.find(o => ['today', 'upcoming'].includes(o.state))?.eff || null,
  };
}

const billLabel = (s) => s.billing_interval ? `cada ${s.billing_interval_count > 1 ? s.billing_interval_count + ' ' : ''}${s.billing_interval === 'month' ? (s.billing_interval_count > 1 ? 'meses' : 'mes') : s.billing_interval === 'week' ? 'semana(s)' : s.billing_interval === 'year' ? 'año(s)' : s.billing_interval}` : '—';
const billMonths = (s) => s.billing_interval === 'month' ? s.billing_interval_count : s.billing_interval === 'year' ? 12 * s.billing_interval_count : null;

export function reconcilePage({ env, user, data, url, msg }) {
  const { ctx, products, byProduct } = data;
  const today = ctx.today;
  const clubs = [...ctx.clubs.values()];
  const prodById = new Map(products.map(p => [p.product_id, p]));
  const pickClub = Number(url.searchParams.get('club')) || null;
  const pickProd = url.searchParams.get('producto');
  const groups = [...byProduct.entries()].map(([pid, subs]) => ({ pid, p: prodById.get(pid), subs }));
  const unresolved = groups.filter(g => g.p && !g.p.club_id && g.p.relevance !== 'ignore' && g.subs.some(s => !s.club_id_override && !isIgnored(s)));
  const mapped = groups.filter(g => g.p && g.p.club_id);
  const ignored = groups.filter(g => g.p && g.p.relevance === 'ignore');
  const subRow = (s, club) => {
    const pv = club ? previewFor(ctx, s, club) : null;
    return `<tr><td><a href="/socio/${s.member_id}">${esc(s.member_name)}</a><br><span class="small muted">${esc(s.status)}${s.ended_on ? ' · terminó ' + esc(s.ended_on) : ''}</span></td>
      <td class="small">${esc(fdate(s.anchor_override || s.start_date, today, { weekday: false }))}${s.anchor_override ? ' (ajustada)' : ''}</td>
      <td class="small">${money(s.price_amount, s.price_currency)}<br>${esc(billLabel(s))}</td>
      ${pv ? `<td class="small">${pv.done} hechos · <b style="color:${pv.overdue.length ? 'var(--red)' : 'inherit'}">${pv.overdue.length} atrasados</b>${pv.overdue.length ? `<br>${pv.overdue.map(d => esc(fdate(d, today, { weekday: false }))).join(', ')}` : ''}${pv.pretracking ? `<br><span class="muted">${pv.pretracking} antes del registro</span>` : ''}<br>Próximo: ${pv.next ? esc(fdate(pv.next, today, { weekday: false })) : '—'}</td>` : ''}</tr>`;
  };
  const card = (g, { open }) => {
    const p = g.p;
    const proposed = (pickProd === g.pid && pickClub) || p.club_id || p.suggested_club_id || null;
    const club = proposed ? ctx.clubs.get(proposed) : null;
    const subs = g.subs.filter(s => !s.club_id_override);
    const months = [...new Set(subs.map(billMonths).filter(Boolean))];
    const mismatch = club && months.some(m => m !== club.cadence_months);
    const active = subs.filter(s => ['active', 'past_due', 'trialing', 'unpaid'].includes(s.status)).length;
    return `<div class="card" id="p-${esc(g.pid)}">
      <div class="ben"><b>${esc(p.name || g.pid)}</b>${p.club_id ? chip(ctx.clubs.get(p.club_id)?.name || 'Club', 'green') : p.relevance === 'ignore' ? chip('No es del club', 'grey') : chip('Sin resolver', 'red')}</div>
      <div class="small muted">${esc(g.pid)} · ${plural(subs.length, 'suscripción', 'suscripciones')} (${active} activas)</div>
      ${open ? `
      <form method="get" action="/conciliar" class="grid2" style="margin-top:10px"><input type="hidden" name="producto" value="${esc(g.pid)}">
        <select name="club">${clubs.map(c => `<option value="${c.id}" ${proposed === c.id ? 'selected' : ''}>${esc(c.name)} — ${c.bottles} bot. ${cadenceLabel(c.cadence_months)}</option>`).join('')}</select>
        <button class="btn sm quiet">Ver vista previa</button></form>
      ${club ? `<p class="small" style="margin:10px 0 4px"><b>Vista previa con ${esc(club.name)}</b> · envíos ${cadenceLabel(club.cadence_months)}, ${club.bottles} botellas.
        ${p.suggested_club_id === proposed && !(pickProd === g.pid && pickClub) ? '<span class="muted">(sugerido por el nombre del producto; confírmalo)</span>' : ''}</p>
        ${mismatch ? `<div class="warn amber">El cobro en Stripe es ${esc(billLabel(subs[0]))} y el club envía ${cadenceLabel(club.cadence_months)}. Los envíos siguen el calendario del club.</div>` : ''}` : ''}
      <div class="scroll"><table><tr><th>Socio</th><th>Inicio</th><th>Cobro</th>${club ? '<th>Resultado</th>' : ''}</tr>${subs.map(s => subRow(s, club)).join('')}</table></div>
      ${user.isManager ? `<div class="acts" style="margin-top:10px">
        ${club ? `<form method="post" action="/conciliar/${esc(g.pid)}"><input type="hidden" name="club_id" value="${club.id}"><button class="btn sm">Confirmar: ${esc(club.name)}</button></form>` : '<span></span>'}
        <form method="post" action="/conciliar/${esc(g.pid)}"><input type="hidden" name="ignore" value="1"><button class="btn sm quiet">No es del club</button></form></div>
        <p class="small muted">Confirmar no marca nada como entregado: solo calcula el calendario. Para un socio con otro club, usa “Correcciones” en su ficha.</p>` : '<p class="small muted">Solo un administrador puede confirmar.</p>'}` : `
      <div class="scroll"><table><tr><th>Socio</th><th>Inicio</th><th>Cobro</th></tr>${subs.map(s => subRow(s, null)).join('')}</table></div>
      ${user.isManager ? `<form method="post" action="/conciliar/${esc(g.pid)}" style="margin-top:8px"><input type="hidden" name="reset" value="1"><button class="btn sm quiet">Volver a revisar</button></form>` : ''}`}
    </div>`;
  };
  const overrides = ctx.subs.filter(s => s.club_id_override);
  const unused = products.filter(p => !byProduct.has(p.product_id));
  const body = `<p><a href="/">← Agenda</a></p><h1>Conciliar Stripe</h1>
  ${msg ? `<div class="banner green">${esc(msg)}</div>` : ''}
  <p class="small muted" style="margin-top:0">Cada producto de Stripe con suscripciones debe confirmarse como un club o como “no es del club”. Hasta entonces sus socios no tienen calendario y aparecen bloqueados en la agenda.</p>
  <h2 style="color:var(--red)">Sin resolver (${unresolved.length})</h2>${unresolved.map(g => card(g, { open: true })).join('') || '<div class="card empty">Todo resuelto.</div>'}
  <h2>Asignados (${mapped.length})</h2>${mapped.map(g => card(g, { open: false })).join('') || '<p class="small muted">Ninguno todavía.</p>'}
  ${overrides.length ? `<h2>Club asignado por socio (${overrides.length})</h2><div class="rows">${overrides.map(s => `<a class="row" href="/socio/${s.member_id}"><div class="main"><div class="t">${esc(s.member_name)}</div><div class="s">${esc(ctx.clubs.get(s.club_id_override)?.name || '')} · producto: ${esc(s.product_name || 'manual')}</div></div></a>`).join('')}</div>` : ''}
  ${ignored.length ? `<details class="more"><summary>No son del club (${ignored.length})</summary>${ignored.map(g => card(g, { open: false })).join('')}</details>` : ''}
  ${unused.length ? `<details class="more"><summary>Productos sin suscripciones (${unused.length})</summary><div class="small muted">${unused.map(p => esc(p.name || p.product_id)).join(' · ')}</div></details>` : ''}`;
  return page({ title: 'Conciliar Stripe', body, user, env, tab: 'ajustes' });
}

export async function reconcileSubmit(env, user, pid, form) {
  const p = await env.DB.prepare('SELECT * FROM stripe_products WHERE product_id=?').bind(pid).first();
  if (!p) return 'Producto no encontrado.';
  let after;
  if (form.ignore === '1') after = { club_id: null, relevance: 'ignore' };
  else if (form.reset === '1') after = { club_id: null, relevance: null };
  else {
    const club = await env.DB.prepare('SELECT id, name FROM clubs WHERE id=?').bind(Number(form.club_id)).first();
    if (!club) return 'Club no válido.';
    after = { club_id: club.id, relevance: 'club' };
  }
  await env.DB.prepare(`UPDATE stripe_products SET club_id=?, relevance=?, mapped_by=?, mapped_at=datetime('now') WHERE product_id=?`)
    .bind(after.club_id, after.relevance, user.email, pid).run();
  await audit(env, user.email, after.club_id ? 'confirmar club de producto' : after.relevance === 'ignore' ? 'producto no es del club' : 'producto a revisión',
    'stripe_product', pid, { club_id: p.club_id, relevance: p.relevance }, after, p.name);
  return null;
}
