// Club de beneficios: reads shared by the staff API (src/club.js) and the guest pages (src/club-public.js).
import * as C from './club-core.js';

export async function clubAudit(env, actor, action, entity = '', id = '', detail = '') {
  await env.DB.prepare('INSERT INTO club_audit (at, actor, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(Date.now(), actor, action, entity, String(id), typeof detail === 'string' ? detail : JSON.stringify(detail)).run();
}

export async function catalog(env) {
  const [programs, benefits, cells, cfg, fields] = await Promise.all([
    env.DB.prepare('SELECT * FROM club_programs ORDER BY sort, name').all(),
    env.DB.prepare('SELECT * FROM club_benefits ORDER BY sort, name').all(),
    env.DB.prepare('SELECT * FROM club_cells').all(),
    env.DB.prepare('SELECT key, value FROM club_config').all(),
    env.DB.prepare('SELECT * FROM club_fields ORDER BY sort, id').all(),
  ]);
  return { programs: programs.results, benefits: benefits.results, cells: cells.results, fields: fields.results, config: Object.fromEntries(cfg.results.map(r => [r.key, r.value])) };
}

// Rolling 12 months: the last 365 days including today.
export const windowStart = day => C.addDays(day, -364);

const SPEND_SQL = `SELECT person_id, SUM(amt) AS total, SUM(est) AS estimated FROM (
    SELECT person_id, check_total - discount_total AS amt, 0 AS est FROM club_visits WHERE undone_at IS NULL AND day >= ?1 AND day <= ?2 %P
    UNION ALL SELECT person_id, amount, 0 FROM club_purchases WHERE status = 'approved' AND day >= ?1 AND day <= ?2 %P
    UNION ALL SELECT person_id, amount, CASE WHEN estimated = 1 THEN amount ELSE 0 END FROM club_sub_charges WHERE day >= ?1 AND day <= ?2 %P
  ) GROUP BY person_id`;

// {person_id: {total, estimated}} — what counts toward purchase levels: visits not undone, approved receipts, subscription charges.
export async function spendMap(env, day = C.today(), personId = null) {
  const sql = SPEND_SQL.replaceAll('%P', personId == null ? '' : 'AND person_id = ?3');
  const st = env.DB.prepare(sql);
  const r = await (personId == null ? st.bind(windowStart(day), day) : st.bind(windowStart(day), day, personId)).all();
  return Object.fromEntries(r.results.map(x => [x.person_id, { total: x.total || 0, estimated: x.estimated || 0 }]));
}

// Count benefits used this calendar year: {benefit_id: qty}.
export async function usedThisYear(env, personId, day = C.today()) {
  const r = await env.DB.prepare(`SELECT vb.benefit_id, SUM(vb.qty) AS qty FROM club_visit_benefits vb JOIN club_visits v ON v.id = vb.visit_id
    WHERE v.person_id = ? AND v.undone_at IS NULL AND v.day >= ? AND v.day <= ? GROUP BY vb.benefit_id`).bind(personId, C.yearStart(day), day).all();
  return Object.fromEntries(r.results.map(x => [x.benefit_id, x.qty]));
}

export async function membershipsOf(env, personId) {
  return (await env.DB.prepare(`SELECT m.id, m.program_id, m.status, m.source, m.created_at, m.reason, m.expires_on, p.name AS program, p.kind, p.duration_months, p.fee_mxn, p.pay_url
    FROM club_memberships m JOIN club_programs p ON p.id = m.program_id WHERE m.person_id = ? AND m.status IN ('active', 'pending') ORDER BY p.sort`).bind(personId).all()).results;
}

// Everything that applies to one person today.
export async function personState(env, person, cat, day = C.today()) {
  const [mem, sp, used] = await Promise.all([membershipsOf(env, person.id), spendMap(env, day, person.id), usedThisYear(env, person.id, day)]);
  const spend = sp[person.id]?.total || 0, estimated = sp[person.id]?.estimated || 0;
  const commitment = Number(person.sub_commitment) || 0;
  const eff = C.effectivePrograms({ programs: cat.programs, memberships: mem, spend, commitment, day });
  const expired = mem.filter(m => m.status === 'active' && C.isExpired(m, day));
  const resolved = person.status === 'active' ? C.resolve({ programs: eff.programs, benefits: cat.benefits, cells: cat.cells, used }) : [];
  const next = eff.level ? C.nextLevel(eff.basis, cat.programs, eff.level) : null;
  // The soonest expiry among memberships that still apply: what the card and the door show as "vigente hasta".
  const running = mem.filter(m => m.status === 'active' && m.expires_on && !C.isExpired(m, day)).map(m => m.expires_on).sort();
  return { memberships: mem, pending: mem.filter(m => m.status === 'pending'), expired, validUntil: running[0] || '', programs: eff.programs, level: eff.level, manualLevel: eff.manualLevel,
    spend, estimated, commitment, bySubscription: eff.bySubscription, next, resolved, used, vip: !!person.vip || eff.programs.some(p => p.vip) };
}

// Programs for many people at once (Hoy, Resumen, search): {person_id: [program…]} plus spend.
export async function programsFor(env, cat, personIds, day = C.today()) {
  if (!personIds.length) return {};
  const ids = [...new Set(personIds)];
  const out = {}, mem = {};
  const ph = ids.map(() => '?').join(',');
  const rows = (await env.DB.prepare(`SELECT person_id, program_id, status, source, expires_on FROM club_memberships WHERE status IN ('active', 'pending') AND person_id IN (${ph})`).bind(...ids).all()).results;
  for (const r of rows) (mem[r.person_id] ||= []).push(r);
  const sp = await spendMap(env, day);
  const cm = Object.fromEntries((await env.DB.prepare(`SELECT id, sub_commitment FROM club_people WHERE sub_commitment > 0 AND id IN (${ph})`).bind(...ids).all()).results.map(r => [r.id, r.sub_commitment]));
  for (const id of ids) {
    const ms = mem[id] || [];
    const e = C.effectivePrograms({ programs: cat.programs, memberships: ms, spend: sp[id]?.total || 0, commitment: cm[id] || 0, day });
    const live = ms.filter(m => m.status === 'active');
    const running = live.filter(m => m.expires_on && !C.isExpired(m, day)).map(m => m.expires_on).sort();
    out[id] = { programs: e.programs, level: e.level, spend: sp[id]?.total || 0, pending: ms.some(m => m.status === 'pending'),
      expired: live.filter(m => C.isExpired(m, day)).map(m => ({ program_id: m.program_id, expires_on: m.expires_on })), valid_until: running[0] || '' };
  }
  return out;
}

export const badge = p => ({ id: p.id, name: p.name, color: p.color, vip: !!p.vip, kind: p.kind, is_pro: !!p.is_pro, short_label: p.short_label });

export async function newCardCode(env) {
  for (let i = 0; i < 5; i++) {
    const code = C.token(18);
    if (!(await env.DB.prepare('SELECT 1 FROM club_people WHERE card_code = ?').bind(code).first())) return code;
  }
  throw new Error('No se pudo crear el código de la tarjeta');
}

// Find an existing person by phone, then email.
export async function findPerson(env, phone, email) {
  if (phone) { const p = await env.DB.prepare('SELECT * FROM club_people WHERE phone = ? ORDER BY id LIMIT 1').bind(phone).first(); if (p) return p; }
  if (email) { const p = await env.DB.prepare('SELECT * FROM club_people WHERE email = ? ORDER BY id LIMIT 1').bind(email).first(); if (p) return p; }
  return null;
}

// Add a membership unless the person already has a live one in that program. Returns the status it ended with.
// A new membership gets the program's duration (wine club memberships follow Stripe instead: no expiry here).
export async function addMembership(env, personId, programId, { status = 'active', source = 'manual', inviteId = null, reason = '', by = '', expiresOn = null } = {}) {
  const cur = await env.DB.prepare("SELECT id, status FROM club_memberships WHERE person_id = ? AND program_id = ? AND status IN ('active', 'pending')").bind(personId, programId).first();
  if (cur) {
    if (cur.status === 'pending' && status === 'active') {
      await env.DB.prepare("UPDATE club_memberships SET status = 'active', decided_by = ?, decided_at = ? WHERE id = ?").bind(by, Date.now(), cur.id).run();
      return 'active';
    }
    return cur.status;
  }
  let exp = expiresOn;
  if (exp == null) {
    const prog = await env.DB.prepare('SELECT duration_months FROM club_programs WHERE id = ?').bind(programId).first();
    exp = source !== 'wineclub' && prog?.duration_months > 0 ? C.addMonths(C.today(), prog.duration_months) : '';
  }
  await env.DB.prepare('INSERT INTO club_memberships (person_id, program_id, status, source, invite_id, reason, created_by, created_at, expires_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(personId, programId, status, source, inviteId, reason, by, Date.now(), exp).run();
  return status;
}

export function publicOrigin(env, url) { return (env.PUBLIC_ORIGIN || url.origin).replace(/\/$/, ''); }
export const cardUrl = (origin, code) => `${origin}/c/${code}`;
export const inviteUrl = (origin, tok) => `${origin}/c/i/${tok}`;

// Answers to the sign-up questions: {field_id: value}.
export async function fieldValues(env, personId) {
  const r = await env.DB.prepare('SELECT field_id, value FROM club_field_values WHERE person_id = ?').bind(personId).all();
  return Object.fromEntries(r.results.map(x => [x.field_id, x.value]));
}
export async function saveFieldValues(env, personId, values, by) {
  const now = Date.now();
  const st = Object.entries(values).map(([fid, v]) => v === ''
    ? env.DB.prepare('DELETE FROM club_field_values WHERE person_id = ? AND field_id = ?').bind(personId, Number(fid))
    : env.DB.prepare('INSERT INTO club_field_values (person_id, field_id, value, updated_by, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(person_id, field_id) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at').bind(personId, Number(fid), v, by, now));
  if (st.length) await env.DB.batch(st);
}
// Read and validate answers from a form/body for the given questions. Returns {values, error}.
export function readFields(fields, src, key = id => 'f_' + id) {
  const values = {};
  for (const f of fields) {
    const [v, err] = C.fieldValue(f, src[key(f.id)]);
    if (err) return { values, error: err };
    values[f.id] = v;
  }
  return { values, error: '' };
}
