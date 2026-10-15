// Migration from the legacy WordPress app (staging.dosbuhos.com/wineclubadmin). Its extracted data lives in
// legacy_members / legacy_shipments. Nothing is written until a manager presses "Importar" on the preview,
// and the import is repeatable: each legacy shipment is imported once (legacy_id is unique), records staff
// already touched are never overwritten, and every conflict is reported instead of guessed.
//
// The legacy app's scheduling is NOT reused: it only kept a "next shipment #" counter, which is why it never
// surfaced Vanessa's missing September shipment. Here legacy shipment #N is attached to scheduled occurrence N
// of the member's Stripe subscription, and the schedule itself comes from the verified engine.

import { esc, fdate, chip, page, cadenceLabel, STATUS_LABEL } from './ui.js';
import { loadContext, subClub, audit, isIgnored } from './data.js';
import { dueDate, daysBetween, totalBottles, slotFor } from './schedule.js';

const CLUB_KEY = { founders: 1, bronce: 2, plata: 3, oro: 4, diamante: 5 };
const METHOD = { 'Took Home at Signup': 'signup', 'Winery Pickup': 'pickup', 'Courier / Delivery': 'courier' };
export const METHOD_LABEL = { signup: 'Se lo llevó al inscribirse', pickup: 'Recogió en bodega', courier: 'Paquetería / entrega' };

export function mapLegacyStatus(status, method) {
  if (status === 'delivered') return method === 'courier' ? 'delivered' : 'handed';
  if (status === 'shipped') return method === 'courier' ? 'shipped' : 'handed';
  return { needs_preparation: 'needs_prep', ready: 'ready', exception: 'exception', scheduled: null }[status] ?? null;
}
const norm = (s) => String(s || '').trim().toLowerCase();

// Build the full migration plan from current data. Pure read.
export async function buildPlan(env) {
  const ctx = await loadContext(env);
  const [lm, ls, members, products] = (await env.DB.batch([
    env.DB.prepare('SELECT * FROM legacy_members ORDER BY name'),
    env.DB.prepare('SELECT * FROM legacy_shipments ORDER BY CAST(legacy_member_id AS INTEGER), shipment_number'),
    env.DB.prepare('SELECT * FROM members'),
    env.DB.prepare('SELECT * FROM stripe_products'),
  ])).map(r => r.results);
  const byEmail = new Map(members.filter(m => m.email).map(m => [norm(m.email), m]));
  const legacyIds = new Set((await env.DB.prepare('SELECT legacy_id FROM fulfillments WHERE legacy_id IS NOT NULL').all()).results.map(r => r.legacy_id));
  const plan = { memberRows: [], shipmentRows: [], productProposals: [], recipeProposals: [], notes: [], stripeOnly: [] };
  const matchedMemberIds = new Set();
  const subFor = new Map(); // legacy member id -> { member, sub }

  for (const l of lm) {
    const m = byEmail.get(norm(l.email));
    const row = { l, member: m || null, sub: null, legacyClub: CLUB_KEY[l.club_key] || null, issues: [] };
    if (!m) row.issues.push('Sin socio de Stripe con ese correo');
    else {
      matchedMemberIds.add(m.id);
      const subs = ctx.subs.filter(s => s.member_id === m.id && !isIgnored(s) && s.product_relevance !== 'ignore');
      const clubSubs = subs.filter(s => !['Test Subscription', 'Programa de Pagos Musa'].includes(s.product_name));
      if (clubSubs.length === 1) row.sub = clubSubs[0];
      else if (clubSubs.length > 1) { row.sub = clubSubs.find(s => ['active', 'past_due', 'trialing'].includes(s.status)) || clubSubs[0]; row.issues.push(`${clubSubs.length} suscripciones; se usa la de ${row.sub.start_date}`); }
      else if (row.legacyClub) row.issues.push('Sin suscripción de club en Stripe');
      if (row.sub) {
        const current = subClub(ctx, row.sub);
        if (row.legacyClub && current && current.id !== row.legacyClub) row.issues.push(`Club distinto: legacy ${l.club_key}, app ${current.name}`);
        if (l.stripe_status && row.sub.status !== l.stripe_status) row.issues.push(`Stripe hoy: ${row.sub.status} (legacy decía ${l.stripe_status})`);
      }
    }
    if (row.sub) subFor.set(l.legacy_id, row);
    plan.memberRows.push(row);
  }

  // Product → club proposals: every legacy member on a product agreeing on the same club is strong evidence.
  const agree = new Map();
  for (const row of plan.memberRows) {
    if (!row.sub?.stripe_product_id || !row.legacyClub) continue;
    const a = agree.get(row.sub.stripe_product_id) || { clubs: new Map(), n: 0 };
    a.clubs.set(row.legacyClub, (a.clubs.get(row.legacyClub) || 0) + 1); a.n++;
    agree.set(row.sub.stripe_product_id, a);
  }
  const subsByProduct = new Map();
  for (const s of ctx.subs) if (s.stripe_product_id) subsByProduct.set(s.stripe_product_id, (subsByProduct.get(s.stripe_product_id) || 0) + 1);
  for (const p of products) {
    const a = agree.get(p.product_id);
    let club = null, evidence = null;
    if (a && a.clubs.size === 1) { club = [...a.clubs.keys()][0]; evidence = `${a.n} socio${a.n > 1 ? 's' : ''} del sistema anterior en este producto, todos en este club`; }
    else if (a && a.clubs.size > 1) evidence = 'Los socios del sistema anterior no coinciden: revisar a mano';
    else if (p.suggested_club_id) { club = p.suggested_club_id; evidence = 'El nombre del producto coincide con el club'; }
    if (!club && !a) continue;
    if (p.club_id === club) continue;
    plan.productProposals.push({ p, club: club ? ctx.clubs.get(club) : null, evidence, subs: subsByProduct.get(p.product_id) || 0, strong: !!(a && a.clubs.size === 1) });
  }

  // Shipments.
  const poSeen = new Map();
  for (const s of ls) if (s.zoho_po) poSeen.set(s.zoho_po, [...(poSeen.get(s.zoho_po) || []), s]);
  for (const s of ls) {
    const row = { s, issues: [], ok: false };
    const mr = subFor.get(s.legacy_member_id);
    const method = METHOD[s.method] || null;
    row.method = method;
    row.status = mapLegacyStatus(s.status, method);
    row.alloc = s.alloc_json ? JSON.parse(s.alloc_json) : null;
    if (!mr) { row.issues.push('Socio sin coincidencia en Stripe'); plan.shipmentRows.push(row); continue; }
    const club = subClub(ctx, mr.sub) || (mr.legacyClub ? ctx.clubs.get(mr.legacyClub) : null);
    row.member = mr.member; row.sub = mr.sub; row.club = club;
    row.k = s.shipment_number - (mr.sub.seq_offset || 0);
    if (!club) { row.issues.push('Sin club: no se puede ubicar en el calendario'); plan.shipmentRows.push(row); continue; }
    row.due = dueDate(mr.sub.anchor_override || mr.sub.start_date, club.cadence_months, row.k);
    row.doneOn = s.fulfilled_at ? s.fulfilled_at.slice(0, 10) : null;
    if (row.doneOn) row.offsetDays = daysBetween(row.due, row.doneOn);
    if (legacyIds.has(s.legacy_id)) { row.already = true; row.ok = true; plan.shipmentRows.push(row); continue; }
    const f = ctx.fulByKey.get(mr.sub.id)?.get(row.k);
    if (f?.status) row.issues.push(`El envío #${s.shipment_number} ya está registrado en la app (${STATUS_LABEL[f.status]}); no se sobrescribe`);
    if (row.alloc && totalBottles(row.alloc) !== club.bottles) row.issues.push(`Caja de ${totalBottles(row.alloc)} botellas; el club lleva ${club.bottles}`);
    if (s.zoho_po && !/\d/.test(s.zoho_po)) row.warn = `El "pedido Zoho" parece un nombre: ${s.zoho_po}`;
    else if (s.zoho_po && poSeen.get(s.zoho_po).length > 1) row.warn = `Pedido ${s.zoho_po} repetido en otro socio`;
    if (row.offsetDays != null && Math.abs(row.offsetDays) > 45) row.warn = (row.warn ? row.warn + ' · ' : '') + `entregado ${row.offsetDays > 0 ? row.offsetDays + ' días después' : -row.offsetDays + ' días antes'} de la fecha calculada`;
    row.ok = row.issues.length === 0;
    plan.shipmentRows.push(row);
  }

  // Box recipes: legacy shipment #N of a club, identical across every member → that club's case N.
  const groups = new Map();
  for (const r of plan.shipmentRows) {
    if (!r.club || !r.alloc) continue;
    const slot = slotFor(r.club, r.s.shipment_number, r.due || '2026-01-01');
    const key = `${r.club.id}:${slot}`;
    const g = groups.get(key) || { club: r.club, slot, allocs: new Set(), n: 0, sample: r.alloc };
    g.allocs.add(r.s.alloc_json); g.n++; groups.set(key, g);
  }
  for (const g of groups.values()) {
    if (ctx.cases.get(`${g.club.id}:${g.slot}`)) continue;
    plan.recipeProposals.push({ ...g, consistent: g.allocs.size === 1 });
  }

  // Stripe members with a club-looking subscription but no legacy history.
  for (const s of ctx.subs) if (!isIgnored(s) && s.product_relevance !== 'ignore' && !matchedMemberIds.has(s.member_id)
    && !['Test Subscription', 'Programa de Pagos Musa'].includes(s.product_name)) plan.stripeOnly.push(s);
  plan.ctx = ctx;
  return plan;
}

export function migrationPage({ env, user, plan, msg }) {
  const today = plan.ctx.today;
  const ok = plan.shipmentRows.filter(r => r.ok && !r.already);
  const done = plan.shipmentRows.filter(r => r.already);
  const blocked = plan.shipmentRows.filter(r => !r.ok);
  const unmatched = plan.memberRows.filter(r => !r.member);
  const memberIssues = plan.memberRows.filter(r => r.member && r.issues.length);
  const shipRow = (r) => `<tr><td>${esc(r.s.legacy_id)}</td><td>${esc(r.member?.name || '#' + r.s.legacy_member_id)}</td><td>#${r.s.shipment_number}</td>
    <td class="small">${r.due ? esc(fdate(r.due, today, { weekday: false })) : '—'}</td>
    <td class="small">${r.status ? esc(STATUS_LABEL[r.status]) : 'pendiente'}${r.doneOn ? ' ' + esc(fdate(r.doneOn, today, { weekday: false })) : ''}${r.method ? '<br>' + esc(METHOD_LABEL[r.method]) : ''}${r.s.handled_by ? ' · ' + esc(r.s.handled_by) : ''}</td>
    <td class="small">${esc(r.s.zoho_po || '')}${r.s.notes ? '<br>' + esc(r.s.notes) : ''}</td>
    <td class="small">${r.issues.map(i => `<span style="color:var(--red)">${esc(i)}</span>`).join('<br>')}${r.warn ? `<span style="color:var(--amber)">${esc(r.warn)}</span>` : ''}</td></tr>`;
  const table = (rows) => `<div class="scroll"><table><tr><th>ID</th><th>Socio</th><th>#</th><th>Fecha calculada</th><th>Legacy</th><th>Pedido / nota</th><th>Revisar</th></tr>${rows.map(shipRow).join('')}</table></div>`;
  const body = `<p><a href="/ajustes">← Ajustes</a></p><h1>Migración del sistema anterior</h1><form method="post" action="/migracion/importar" id="mig">
  ${msg ? `<div class="banner green">${esc(msg)}</div>` : ''}
  <p class="small muted" style="margin-top:0">Fuente: staging.dosbuhos.com/wineclubadmin · ${plan.memberRows.length} socios, ${plan.shipmentRows.length} envíos. Vista previa: nada se escribe hasta presionar “Importar”. Se puede repetir sin duplicar.</p>

  <h2>1 · Club de cada producto de Stripe</h2>
  <div class="card"><p class="small muted" style="margin-top:0">Al confirmar un producto, todos sus socios actuales <b>y los que se inscriban después</b> quedan en ese club automáticamente.</p>
  ${plan.productProposals.length ? `<div class="scroll"><table><tr><th></th><th>Producto de Stripe</th><th>Club propuesto</th><th>Evidencia</th></tr>
    ${plan.productProposals.map(x => `<tr><td>${x.club ? `<input type="checkbox" name="product" value="${esc(x.p.product_id)}" ${x.strong || x.subs ? 'checked' : ''} style="width:22px;height:22px;min-height:0">` : ''}</td>
      <td>${esc(x.p.name)}<br><span class="small muted">${esc(x.p.product_id)} · ${x.subs} suscripciones</span></td>
      <td>${x.club ? `${esc(x.club.name)}<br><span class="small muted">${x.club.bottles} bot. ${cadenceLabel(x.club.cadence_months)}</span>` : '—'}</td>
      <td class="small">${esc(x.evidence || '')}</td></tr>`).join('')}</table></div>` : '<p>Sin propuestas pendientes.</p>'}
  </div>

  <h2>2 · Socios (${plan.memberRows.length})</h2>
  <div class="card small">
    <p style="margin-top:0"><b>${plan.memberRows.filter(r => r.member).length}</b> coinciden por correo con Stripe · <b style="color:${unmatched.length ? 'var(--red)' : 'inherit'}">${unmatched.length}</b> sin coincidencia.</p>
    ${unmatched.length ? `<p><b>Sin coincidencia:</b> ${unmatched.map(r => esc(r.l.name) + (r.l.club_key ? ` (${esc(r.l.club_key)})` : ' (sin club)')).join(', ')}</p>` : ''}
    ${memberIssues.length ? `<p><b>Para revisar:</b></p><ul>${memberIssues.map(r => `<li>${esc(r.l.name)}: ${r.issues.map(esc).join(' · ')}</li>`).join('')}</ul>` : ''}
    ${plan.stripeOnly.length ? `<p><b>En Stripe sin historial en el sistema anterior:</b> ${plan.stripeOnly.map(s => esc(s.member_name) + ` (${esc(s.product_name || '')}, ${esc(s.status)})`).join(', ')}</p>` : ''}
  </div>

  <h2>3 · Envíos a importar (${ok.length})</h2>
  ${ok.length ? table(ok) : '<p class="small muted">Ninguno pendiente.</p>'}
  ${blocked.length ? `<h2 style="color:var(--red)">No se importan (${blocked.length})</h2>${table(blocked)}` : ''}
  ${done.length ? `<details class="more"><summary>Ya importados (${done.length})</summary>${table(done)}</details>` : ''}

  <h2>4 · Cajas de los clubes</h2>
  <div class="card small">${plan.recipeProposals.length ? `<p style="margin-top:0">Se toman de los envíos del sistema anterior solo cuando todos los socios recibieron la misma caja. Solo se llenan cajas vacías.</p>
    ${plan.recipeProposals.map(g => `<div style="padding:6px 0;border-top:1px solid var(--line)"><label style="display:flex;gap:10px;font-weight:600;margin:0">${g.consistent ? `<input type="checkbox" name="recipe" value="${g.club.id}:${g.slot}" checked form="mig" style="width:22px;height:22px;min-height:0">` : ''}
      ${esc(g.club.name)} · caja ${g.slot} ${g.consistent ? `<span class="muted">(${g.n} envíos iguales)</span>` : '<span style="color:var(--red)">(los envíos no coinciden; definir a mano)</span>'}</label>
      ${g.consistent ? `<div>${g.sample.map(b => `${esc(b.qty)}× ${esc(b.wine)}`).join(' · ')}</div>` : ''}</div>`).join('')}` : 'Sin propuestas.'}</div>

  ${user.isManager ? `<div class="sticky-foot" style="position:sticky;bottom:calc(var(--nav) + 6px);padding:10px 0"><button class="btn" form="mig">Importar lo marcado y ${ok.length} envíos</button></div>` : ''}
  </form>`;
  return page({ title: 'Migración', body, user, env, tab: 'ajustes' });
}

export async function runImport(env, user, form) {
  const products = [].concat(form.getAll('product'));
  const recipes = [].concat(form.getAll('recipe'));
  let plan = await buildPlan(env);
  let mapped = 0, imported = 0, recipesSet = 0;
  // 1. Product → club (only proposals still on screen).
  for (const pid of products) {
    const x = plan.productProposals.find(p => p.p.product_id === pid && p.club);
    if (!x) continue;
    await env.DB.prepare(`UPDATE stripe_products SET club_id=?, relevance='club', mapped_by=?, mapped_at=datetime('now') WHERE product_id=?`).bind(x.club.id, user.email, pid).run();
    await audit(env, user.email, 'confirmar club de producto (migración)', 'stripe_product', pid, { club_id: x.p.club_id }, { club_id: x.club.id }, x.evidence);
    mapped++;
  }
  if (mapped) plan = await buildPlan(env); // the schedule changed; recompute where each shipment lands
  // 2. Recipes into empty cases only.
  for (const key of recipes) {
    const g = plan.recipeProposals.find(r => `${r.club.id}:${r.slot}` === key && r.consistent);
    if (!g) continue;
    const res = await env.DB.prepare(`INSERT INTO club_cases (club_id, slot, bottles_json, updated_by) VALUES (?,?,?,?) ON CONFLICT(club_id, slot) DO NOTHING`)
      .bind(g.club.id, g.slot, JSON.stringify(g.sample), user.email + ' (migración)').run();
    if (res.meta.changes) { recipesSet++; await audit(env, user.email, `caja ${g.slot} desde sistema anterior`, 'club', g.club.id, null, { bottles: g.sample }); }
  }
  // 3. Shipments: insert, or fill a row that only holds Stripe payment data. Never overwrite staff work.
  for (const r of plan.shipmentRows) {
    if (!r.ok || r.already) continue;
    const s = r.s;
    const v = {
      status: r.status, done_on: r.doneOn && r.status && ['handed', 'shipped', 'delivered'].includes(r.status) ? r.doneOn : null,
      bottles_json: s.alloc_json || null, order_ref: s.zoho_po || null, tracking: s.tracking || null, note: s.notes || null,
      method: r.method, handled_by: s.handled_by || null, requested_on: s.requested_date || null, legacy_id: s.legacy_id,
    };
    const cols = Object.keys(v);
    const res = await env.DB.prepare(`INSERT INTO fulfillments (subscription_id, k, expected_date, ${cols.join(',')}, updated_by) VALUES (?,?,?,${cols.map(() => '?').join(',')},?)
      ON CONFLICT(subscription_id, k) DO UPDATE SET ${cols.map(c => `${c}=excluded.${c}`).join(',')}, version=version+1, updated_by=excluded.updated_by, updated_at=datetime('now')
      WHERE fulfillments.status IS NULL AND fulfillments.legacy_id IS NULL RETURNING id`)
      .bind(r.sub.id, r.k, r.due, ...cols.map(c => v[c]), `${user.email} (migración)`).first();
    const result = res ? `importado como envío #${r.k} (${r.due})` : 'omitido: ya había registro';
    await env.DB.prepare(`UPDATE legacy_shipments SET imported_at=datetime('now'), result=? WHERE legacy_id=?`).bind(result, s.legacy_id).run();
    if (res) {
      imported++;
      await audit(env, user.email, 'importar envío del sistema anterior', 'fulfillment', `${r.sub.id}:${r.k}`, null, v, `legacy #${s.legacy_id}`);
    }
  }
  for (const m of plan.memberRows) if (m.member && !m.member.legacy_id) await env.DB.prepare('UPDATE members SET legacy_id=? WHERE id=?').bind(m.l.legacy_id, m.member.id).run();
  return `Importado: ${mapped} productos con club, ${recipesSet} cajas, ${imported} envíos.`;
}
