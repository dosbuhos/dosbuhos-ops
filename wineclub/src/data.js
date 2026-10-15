import { occurrences, localDate, dueDate } from './schedule.js';

export const tzOf = (env) => env.TIMEZONE || 'America/Mexico_City';
export const todayLocal = (env) => env.APP_ENV === 'test' && env.DEV_USER && env.TEST_TODAY
  ? env.TEST_TODAY : localDate(new Date(), tzOf(env));

export async function getSetting(env, key, fallback = null) {
  const r = await env.DB.prepare('SELECT value FROM settings WHERE key=?').bind(key).first();
  return r ? r.value : fallback;
}
export async function setSetting(env, key, value) {
  await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key, value).run();
}

export async function audit(env, who, action, entity, entityId, before = null, after = null, note = null) {
  const r = await env.DB.prepare('INSERT INTO audit_log (who, action, entity, entity_id, before_json, after_json, note) VALUES (?,?,?,?,?,?,?) RETURNING id')
    .bind(who, action, entity, entityId == null ? null : String(entityId), before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, note).first();
  return r.id;
}

export async function clubForSub(env, sub) {
  let id = sub.club_id_override || sub.product_club_id;
  if (!id && sub.stripe_product_id) id = (await env.DB.prepare('SELECT club_id FROM stripe_products WHERE product_id=?').bind(sub.stripe_product_id).first())?.club_id;
  return id ? env.DB.prepare('SELECT * FROM clubs WHERE id=?').bind(id).first() : null;
}

const SUB_SQL = `SELECT s.*, m.name AS member_name, m.email AS member_email, m.phone AS member_phone, m.delivery_pref,
  m.delivery_address, m.stripe_address, m.legacy_id AS member_legacy_id, p.club_id AS product_club_id, p.name AS product_name, p.relevance AS product_relevance, p.suggested_club_id AS product_suggested_club_id
  FROM subscriptions s JOIN members m ON m.id=s.member_id LEFT JOIN stripe_products p ON p.product_id=s.stripe_product_id`;

// Everything needed to compute every member's schedule. ~6 small queries; fine for a club this size.
export async function loadContext(env, { memberId = null } = {}) {
  const subQ = memberId ? env.DB.prepare(SUB_SQL + ' WHERE s.member_id=?').bind(memberId) : env.DB.prepare(SUB_SQL);
  const fulQ = memberId ? env.DB.prepare('SELECT f.* FROM fulfillments f JOIN subscriptions s ON s.id=f.subscription_id WHERE s.member_id=?').bind(memberId) : env.DB.prepare('SELECT * FROM fulfillments');
  const [clubs, cases, subs, fuls, pauses, settings, legacyMembers] = (await env.DB.batch([
    env.DB.prepare('SELECT * FROM clubs ORDER BY sort, id'),
    env.DB.prepare('SELECT * FROM club_cases'),
    subQ, fulQ,
    env.DB.prepare('SELECT * FROM pauses ORDER BY from_date'),
    env.DB.prepare('SELECT * FROM settings'),
    env.DB.prepare('SELECT legacy_id, name, next_shipment_number, extracted_at FROM legacy_members'),
  ])).map(r => r.results);
  const ctx = {
    clubs: new Map(clubs.map(c => [c.id, c])),
    cases: new Map(),
    subs,
    fulByKey: new Map(),
    pausesBySub: new Map(),
    settings: Object.fromEntries(settings.map(s => [s.key, s.value])),
    today: todayLocal(env),
    legacyMembers: new Map(legacyMembers.map(m=>[m.legacy_id,m])),
  };
  for (const c of cases) { try { ctx.cases.set(`${c.club_id}:${c.slot}`, JSON.parse(c.bottles_json)); } catch { /* skip bad row */ } }
  for (const f of fuls) {
    if (!ctx.fulByKey.has(f.subscription_id)) ctx.fulByKey.set(f.subscription_id, new Map());
    ctx.fulByKey.get(f.subscription_id).set(f.k, f);
  }
  for (const p of pauses) {
    if (!ctx.pausesBySub.has(p.subscription_id)) ctx.pausesBySub.set(p.subscription_id, []);
    ctx.pausesBySub.get(p.subscription_id).push(p);
  }
  ctx.trackingStart = ctx.settings.tracking_start || '0000-01-01';
  return ctx;
}

export function subClub(ctx, sub) {
  const id = sub.club_id_override || sub.product_club_id;
  return id ? ctx.clubs.get(id) || null : null;
}

export function subOccurrences(ctx, sub, to) {
  const club = subClub(ctx, sub);
  if (!club) return null;
  return occurrences(sub, club, {
    to, today: ctx.today, trackingStart: ctx.trackingStart,
    fulfillments: ctx.fulByKey.get(sub.id) || new Map(),
    pauses: ctx.pausesBySub.get(sub.id) || [],
    caseFor: (c, slot) => ctx.cases.get(`${c.id}:${slot}`) || null,
  }).map(o => ({ ...o, sub, club }));
}

// A subscription is outside the club entirely when its Stripe product was marked "not a club product"
// (and no manager override puts it in a club), or its first payment never completed.
export const isIgnored = (s) => s.status === 'incomplete_expired' || (s.product_relevance === 'ignore' && !s.club_id_override);

export function allOccurrences(ctx, to) {
  const occ = [], unmapped = [];
  for (const s of ctx.subs) {
    if (isIgnored(s)) continue;
    const list = subOccurrences(ctx, s, to);
    if (!list) { unmapped.push(s); continue; }
    occ.push(...list);
  }
  return { occ, unmapped };
}

// Problems the app must surface rather than silently "fix".
export function subFlags(ctx, sub) {
  const flags = [];
  if (!subClub(ctx, sub)) flags.push({ tone: 'red', text: 'Suscripción sin club asignado' });
  if (sub.missing_in_stripe) flags.push({ tone: 'red', text: 'Ya no aparece en Stripe' });
  if (['past_due', 'unpaid'].includes(sub.status)) flags.push({ tone: 'amber', text: 'Pago vencido en Stripe' });
  if (sub.status === 'incomplete') flags.push({ tone: 'amber', text: 'Primer pago incompleto' });
  if (['canceled', 'manual_ended'].includes(sub.status) || (sub.ended_on && sub.ended_on <= ctx.today)) flags.push({ tone: 'grey', text: 'Suscripción terminada' + (sub.ended_on ? ` (${sub.ended_on})` : '') });
  else if (sub.cancel_at) flags.push({ tone: 'amber', text: `Se cancela el ${sub.cancel_at}` });
  if (sub.anchor_override) flags.push({ tone: 'grey', text: 'Fecha de inicio ajustada' });
  if (sub.seq_offset) flags.push({ tone: 'grey', text: `Numeración ajustada (${sub.seq_offset > 0 ? '+' : ''}${sub.seq_offset})` });
  if (sub.club_id_override) flags.push({ tone: 'grey', text: 'Club asignado a mano' });
  const open = (ctx.pausesBySub.get(sub.id) || []).find(p => p.from_date <= ctx.today && (!p.until_date || p.until_date > ctx.today));
  if (open) flags.push({ tone: 'amber', text: `En pausa${open.until_date ? ' hasta ' + open.until_date : ''}` });
  return flags;
}

// ---------- fulfillment writes ----------
export const STAFF_FIELDS = ['status', 'delayed_until', 'delay_reason', 'bottles_json', 'bottles_custom', 'order_ref', 'carrier', 'tracking', 'done_on', 'delivered_on', 'note', 'override_reason', 'early', 'method', 'handled_by', 'requested_on'];

export async function getSub(env, subId) {
  return env.DB.prepare(SUB_SQL + ' WHERE s.id=?').bind(subId).first();
}

// Create or update the fulfillment record for (subscription, k). Every change is audited with before/after,
// and the audit id is returned so the change can be undone.
export async function writeFulfillment(env, who, sub, club, k, fields, action, options = {}) {
  for (const c of Object.keys(fields)) if (!STAFF_FIELDS.includes(c)) throw new Error('bad field ' + c);
  const before = await env.DB.prepare('SELECT * FROM fulfillments WHERE subscription_id=? AND k=?').bind(sub.id, k).first();
  const cols = Object.keys(fields);
  const version = options.version ?? before?.version ?? 0;
  const token = crypto.randomUUID();
  let write;
  if (before) {
    write = env.DB.prepare(`UPDATE fulfillments SET ${cols.map(c => `${c}=?`).join(',')}, version=version+1, last_change=?, updated_by=?, updated_at=datetime('now') WHERE id=? AND version=? RETURNING *`)
      .bind(...cols.map(c => fields[c]), token, who, before.id, version);
  } else {
    const expected = dueDate(sub.anchor_override || sub.start_date, club.cadence_months, k);
    if (version !== 0) throw new StaffConflict();
    write = env.DB.prepare(`INSERT INTO fulfillments (subscription_id, k, expected_date, ${cols.join(',')}, version, last_change, updated_by) VALUES (?,?,?,${cols.map(() => '?').join(',')},1,?,?) ON CONFLICT(subscription_id,k) DO NOTHING RETURNING *`)
      .bind(sub.id, k, expected, ...cols.map(c => fields[c]), token, who);
  }
  const pick = (r) => r ? Object.fromEntries(STAFF_FIELDS.map(c => [c, r[c] ?? null])) : null;
  const queries = [write, env.DB.prepare(`INSERT INTO audit_log (who,action,entity,entity_id,before_json,after_json,note)
    SELECT ?,?,'fulfillment',?,?,?,? WHERE EXISTS(SELECT 1 FROM fulfillments WHERE last_change=?) RETURNING id`)
    .bind(who, action, `${sub.id}:${k}`, before ? JSON.stringify(pick(before)) : null, JSON.stringify(pick({ ...before, ...fields })), options.note || null, token)];
  if (options.photo) queries.push(env.DB.prepare(`INSERT INTO photos (fulfillment_id,content_type,data,uploaded_by)
    SELECT id,?,?,? FROM fulfillments WHERE last_change=?`).bind(options.photo.type, options.photo.data, who, token));
  const results = await env.DB.batch(queries);
  const after = results[0].results[0];
  if (!after) throw new StaffConflict();
  const auditId = results[1].results[0].id;
  return { before, after, auditId };
}

export class StaffConflict extends Error {
  constructor() { super('Otra persona cambió este envío. Recarga la página antes de guardar.'); this.status = 409; }
}

export async function undoFulfillment(env, who, auditRow) {
  const [subId, k] = String(auditRow.entity_id).split(':').map(Number);
  const before = auditRow.before_json ? JSON.parse(auditRow.before_json) : null;
  const restore = Object.fromEntries(STAFF_FIELDS.map(c => [c, before ? (before[c] ?? (c === 'bottles_custom' || c === 'early' ? 0 : null)) : (c === 'bottles_custom' || c === 'early' ? 0 : null)]));
  const cur = await env.DB.prepare('SELECT * FROM fulfillments WHERE subscription_id=? AND k=?').bind(subId, k).first();
  if (!cur) return;
  await env.DB.prepare(`UPDATE fulfillments SET ${STAFF_FIELDS.map(c => `${c}=?`).join(',')}, version=version+1, updated_by=?, updated_at=datetime('now') WHERE id=?`)
    .bind(...STAFF_FIELDS.map(c => restore[c]), who, cur.id).run();
  await audit(env, who, 'deshacer', 'fulfillment', auditRow.entity_id, Object.fromEntries(STAFF_FIELDS.map(c => [c, cur[c]])), restore, `Deshace el cambio #${auditRow.id}`);
}
