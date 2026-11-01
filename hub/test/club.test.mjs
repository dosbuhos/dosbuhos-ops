// npm test. Club de beneficios: the rules (src/club-core.js) and the Worker end to end (src/index.js) against in-memory
// SQLite standing in for D1 — the Hub with migrations 0001 + 0004, and a fake wine club built from wineclub/migrations.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { hmac } from '../src/auth.js';
import * as C from '../src/club-core.js';
import { syncWineclub } from '../src/club-wineclub.js';

function d1(files) {
  const db = new DatabaseSync(':memory:');
  for (const f of files) db.exec(readFileSync(f, 'utf8'));
  const stmt = (q, args = []) => ({
    bind: (...a) => stmt(q, a),
    run: async () => { const r = db.prepare(q).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    all: async () => ({ results: db.prepare(q).all(...args).map(x => ({ ...x })) }),
    first: async () => { const r = db.prepare(q).get(...args); return r ? { ...r } : null; },
  });
  return { db, prepare: q => stmt(q), batch: async list => { const out = []; for (const s of list) out.push(await s.run()); return out; } };
}
const HUB = ['0001_init.sql', '0004_club.sql'].map(f => new URL('../migrations/' + f, import.meta.url));
const WC_DIR = new URL('../../wineclub/migrations/', import.meta.url);
const WC = readdirSync(WC_DIR).filter(f => f.endsWith('.sql')).sort().map(f => new URL(f, WC_DIR));

async function setup() {
  const DB = d1(HUB);
  const env = { DB, SESSION_SECRET: 'test', GOOGLE_CLIENT_ID: 'x', ASSETS: { fetch: async req => new Response('<!doctype html><title>' + new URL(req.url).pathname + '</title>', { headers: { 'content-type': 'text/html' } }) } };
  const now = Date.now();
  DB.db.prepare("INSERT INTO users (email, name, is_admin, active, created_at) VALUES ('admin@x.test', 'Admin', 0, 1, ?), ('staff@x.test', 'Host', 0, 1, ?), ('other@x.test', 'Otro', 0, 1, ?)").run(now, now, now);
  DB.db.prepare("INSERT INTO grants (email, slug, role, created_at) VALUES ('admin@x.test', 'club', 'admin', ?), ('staff@x.test', 'club', 'editor', ?)").run(now, now);
  const cookies = {};
  for (const who of ['admin', 'staff', 'other']) {
    const sid = 's-' + who, exp = Math.floor(now / 1000) + 3600;
    DB.db.prepare('INSERT INTO sessions (id, email, created_at, expires_at) VALUES (?, ?, ?, ?)').run(sid, who + '@x.test', now, exp * 1000);
    cookies[who] = 'hub_session=' + encodeURIComponent(`${sid}|${exp}|${await hmac(env, `${sid}|${exp}`)}`);
  }
  const call = async (who, method, path, body, raw = false) => {
    const headers = {};
    if (who) headers.cookie = cookies[who];
    let b;
    if (body instanceof URLSearchParams) { b = body.toString(); headers['content-type'] = 'application/x-www-form-urlencoded'; }
    else if (body !== undefined) { b = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    const res = await worker.fetch(new Request('https://hub.test' + path, { method, headers, body: b, redirect: 'manual' }), env, { waitUntil() {} });
    if (raw) return res;
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text, location: res.headers.get('location'), headers: res.headers };
  };
  return { env, DB, call };
}
const form = o => new URLSearchParams(o);
const addPerson = (DB, name, extra = {}) => {
  const r = DB.db.prepare("INSERT INTO club_people (card_code, name, phone, email, staff_note, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(extra.code || C.token(18), name, extra.phone || '', extra.email || '', extra.note || '', Date.now());
  const id = Number(r.lastInsertRowid);
  for (const p of extra.programs || []) DB.db.prepare("INSERT INTO club_memberships (person_id, program_id, status, created_at) VALUES (?, ?, ?, ?)").run(id, p, extra.status || 'active', Date.now());
  return { id, code: DB.db.prepare('SELECT card_code FROM club_people WHERE id = ?').get(id).card_code };
};

// ---------- rules ----------
test('seeded badge colours all carry white text at 4.5:1 or better', () => {
  const { DB } = { DB: d1(HUB) };
  for (const p of DB.db.prepare('SELECT id, color FROM club_programs').all()) assert.ok(C.contrastOnWhite(p.color) >= 4.5, `${p.id} ${p.color} ${C.contrastOnWhite(p.color).toFixed(2)}`);
  // and every seeded cell starts "por confirmar"
  assert.equal(DB.db.prepare('SELECT COUNT(*) AS n FROM club_cells WHERE confirmed = 1').get().n, 0);
  assert.ok(DB.db.prepare("SELECT 1 FROM apps WHERE slug = 'club' AND section = 'hospitalidad' AND name = 'Club de beneficios' AND mode = 'internal'").get());
});

test('best value per benefit across programs, no stacking, source program kept', async () => {
  const DB = d1(HUB);
  const cat = { programs: DB.db.prepare('SELECT * FROM club_programs').all(), benefits: DB.db.prepare('SELECT * FROM club_benefits').all(), cells: DB.db.prepare('SELECT * FROM club_cells').all() };
  // Amigos y familia + Nivel 2 by spend.
  const eff = C.effectivePrograms({ programs: cat.programs, memberships: [{ program_id: 'amigos', status: 'active' }], spend: 12000 });
  assert.deepEqual(eff.programs.map(p => p.id), ['amigos', 'nivel-2']);
  const r = Object.fromEntries(C.resolve({ ...cat, programs: eff.programs, used: { recorridos: 1 } }).map(x => [x.benefit_id, x]));
  assert.equal(r.vino.value, 25); assert.equal(r.vino.program_id, 'amigos');
  assert.deepEqual(r.vino.others, [{ program: 'Nivel 2', value: 15, text: '' }]);
  assert.equal(r.restaurante.value, 10); assert.equal(r.restaurante.program_id, 'amigos', 'tie → the program listed first');
  assert.equal(r.recorridos.program_id, 'nivel-2'); assert.equal(r.recorridos.left, 3);
  assert.equal(r.eventos.value, 20);
  assert.ok(!r.copa, 'Nivel 1 copa is not inherited by Nivel 2');
  assert.match(C.staffHead(r.restaurante) + ' · ' + C.staffRule(r.restaurante), /^10% sobre toda la cuenta · Socio presente · hasta 4 acompañantes · no se combina/);
  assert.equal(C.guestPhrase(r.vino), '25% en vino para llevar, en tienda y en línea');
  // Empleados 30% beats Nivel 3 15%; Nivel 3 brings VIP.
  const e2 = C.effectivePrograms({ programs: cat.programs, memberships: [{ program_id: 'empleados', status: 'active' }], spend: 25000 });
  const r2 = Object.fromEntries(C.resolve({ ...cat, programs: e2.programs }).map(x => [x.benefit_id, x]));
  assert.equal(r2.restaurante.value, 30); assert.equal(r2.restaurante.program_id, 'empleados'); assert.ok(r2.vip);
});

test('purchase level: Nivel 1 from the first peso, invitation-only people without spend have no level, manual floor', () => {
  const programs = d1(HUB).db.prepare('SELECT * FROM club_programs').all();
  assert.equal(C.levelFromSpend(1, programs).id, 'nivel-1');
  assert.equal(C.levelFromSpend(9999.99, programs).id, 'nivel-1');
  assert.equal(C.levelFromSpend(10000, programs).id, 'nivel-2');
  assert.equal(C.levelFromSpend(20000, programs).id, 'nivel-3');
  assert.deepEqual(C.nextLevel(3600, programs, C.levelFromSpend(3600, programs)).missing, 6400);
  assert.equal(C.nextLevel(25000, programs, C.levelFromSpend(25000, programs)), null);
  assert.deepEqual(C.effectivePrograms({ programs, memberships: [{ program_id: 'novios', status: 'active' }], spend: 0 }).programs.map(p => p.id), ['novios']);
  assert.deepEqual(C.effectivePrograms({ programs, memberships: [], spend: 0 }).programs.map(p => p.id), ['nivel-1'], 'joined from a purchase link');
  assert.deepEqual(C.effectivePrograms({ programs, memberships: [{ program_id: 'pro-1', status: 'pending' }], spend: 0 }).programs, [], 'pending only: nothing yet');
  const f = C.effectivePrograms({ programs, memberships: [{ program_id: 'nivel-3', status: 'active' }], spend: 500 });
  assert.equal(f.level.id, 'nivel-3'); assert.equal(f.manualLevel, true);
});

test('novios paste and phone normalisation', () => {
  const { rows, errors } = C.parseNovios('Ana y Luis Pérez, 415 123 4567, ana@x.test, 17/05/2025\nMaría\tmaria@x.test\t2024-11-02\nSin datos\n\n');
  assert.equal(rows.length, 2); assert.equal(errors.length, 1);
  assert.deepEqual(rows[0], { name: 'Ana y Luis Pérez', phone: '524151234567', email: 'ana@x.test', wedding: '2025-05-17' });
  assert.equal(rows[1].wedding, '2024-11-02');
  assert.equal(C.normPhone('+52 1 415 123 4567'), '524151234567');
  assert.equal(C.normPhone('+1 (210) 555-0100'), '12105550100');
});

// ---------- permissions ----------
test('permissions: guest, staff and admin; staff cannot edit programs; no grant = no access', async () => {
  const { call } = await setup();
  const g = await call(null, 'GET', '/club/');
  assert.equal(g.status, 200); assert.match(g.text, /Entrar con Google/);
  assert.equal((await call(null, 'GET', '/club/api/boot')).status, 401);
  assert.equal((await call('other', 'GET', '/club/api/boot')).status, 403);
  assert.equal((await call('staff', 'GET', '/club/api/boot')).json.role, 'staff');
  assert.equal((await call('admin', 'GET', '/club/api/boot')).json.role, 'admin');
  for (const [m, path, body] of [['PUT', '/club/api/cell', { program_id: 'amigos', benefit_id: 'vino', value: 50 }], ['POST', '/club/api/programs', { name: 'X' }],
    ['PATCH', '/club/api/programs/amigos', { name: 'Y' }], ['POST', '/club/api/benefits', { name: 'B', kind: 'yes_no' }], ['PATCH', '/club/api/benefits/vino', { name: 'Z' }],
    ['POST', '/club/api/invites', { program_id: 'amigos' }], ['GET', '/club/api/invites'], ['POST', '/club/api/novios', { text: 'A, 4151234567' }], ['PUT', '/club/api/config', { milestone_every: 5 }]]) {
    const r = await call('staff', m, path, body);
    assert.equal(r.status, 403, `${m} ${path}`);
  }
  const ok = await call('admin', 'PUT', '/club/api/cell', { program_id: 'amigos', benefit_id: 'vino', value: 30, confirmed: true });
  assert.equal(ok.status, 200); assert.equal(ok.json.cell.value, 30); assert.equal(ok.json.cell.confirmed, 1);
  assert.equal((await call('admin', 'PATCH', '/club/api/programs/amigos', { color: '#f5f5f5' })).status, 400, 'too light for white text');
});

test('the public card shows only this person: no staff notes, no phones, nobody else; staff get the staff view', async () => {
  const { DB, call } = await setup();
  const ana = addPerson(DB, 'Ana López', { phone: '524151112222', note: 'Alérgica a nueces — SECRETO', programs: ['amigos'] });
  addPerson(DB, 'Beto Otro', { phone: '524153334444', programs: ['amigos'] });
  const r = await call(null, 'GET', '/c/' + ana.code);
  assert.equal(r.status, 200);
  assert.match(r.text, /Ana López/); assert.match(r.text, /Amigos y familia/); assert.match(r.text, /25% en vino para llevar/);
  assert.doesNotMatch(r.text, /SECRETO|nueces|Beto|4151112222|415 111/);
  assert.match(r.headers.get('cache-control'), /^private, max-age=/);
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  const s = await call('staff', 'GET', '/c/' + ana.code);
  assert.equal(s.status, 303); assert.equal(s.location, '/club/#c/' + ana.code);
  assert.equal((await call('staff', 'GET', '/c/' + ana.code + '?invitado=1')).status, 200);
  assert.equal((await call('other', 'GET', '/c/' + ana.code)).status, 200, 'a Hub user without a club grant is a guest here');
  assert.equal((await call(null, 'GET', '/c/' + 'x'.repeat(24))).status, 404);
  // The staff API does show the note.
  const d = await call('staff', 'GET', '/club/api/person/' + ana.id);
  assert.match(d.json.person.staff_note, /SECRETO/);
  assert.equal((await call('staff', 'PATCH', '/club/api/person/' + ana.id, { vip: 1 })).status, 403, 'staff edit notes only');
  assert.equal((await call('staff', 'PATCH', '/club/api/person/' + ana.id, { staff_note: 'Mesa junto a la ventana' })).status, 200);
});

test('lost card: the same neutral answer whether or not the number exists; a request only for members', async () => {
  const { DB, call } = await setup();
  addPerson(DB, 'Ana López', { phone: '524151112222', programs: ['amigos'] });
  const a = await call(null, 'POST', '/c/perdi', form({ phone: '415 111 2222' }));
  const b = await call(null, 'POST', '/c/perdi', form({ phone: '415 999 0000' }));
  assert.equal(a.status, 200); assert.equal(a.text, b.text);
  await call(null, 'POST', '/c/perdi', form({ phone: '4151112222' }));
  assert.equal(DB.db.prepare('SELECT COUNT(*) AS n FROM club_card_requests').get().n, 1);
  const hoy = await call('staff', 'GET', '/club/api/hoy');
  assert.equal(hoy.json.resend.length, 1);
  assert.match(decodeURIComponent(hoy.json.resend[0].wa), /^https:\/\/wa\.me\/524151112222\?text=Hola Ana, esta es tu tarjeta del club de Dos Búhos: https:\/\/hub\.test\/c\//);
});

// ---------- invitations ----------
test('invites: personal (one use), multi-use with max uses, expiry, revoke, approval queue', async () => {
  const { DB, call } = await setup();
  const mk = async b => (await call('admin', 'POST', '/club/api/invites', b)).json.invite;
  const fam = await mk({ program_id: 'amigos', kind: 'personal', name: 'Tía Carmen', phone: '415 222 3333' });
  assert.match(fam.wa, /^https:\/\/wa\.me\/524152223333\?text=Hola%20T%C3%ADa%2C/);
  assert.equal(fam.max_uses, 1); assert.equal(fam.requires_approval, false);
  const tok = fam.url.split('/c/i/')[1];
  assert.match((await call(null, 'GET', '/c/i/' + tok)).text, /Hola, Tía/);
  const bad = await call(null, 'POST', '/c/i/' + tok, form({ name: 'Tía Carmen', phone: '123', terms: '1' }));
  assert.equal(bad.status, 400); assert.match(bad.text, /Revisa tu número/);
  const ok = await call(null, 'POST', '/c/i/' + tok, form({ name: 'Tía Carmen', phone: '415 222 3333', terms: '1', bday: '3', bmonth: '7' }));
  assert.equal(ok.status, 303); assert.match(ok.location, /^\/c\/[A-Za-z0-9_-]{24}\?ok=nuevo$/);
  const p = DB.db.prepare("SELECT * FROM club_people WHERE name = 'Tía Carmen'").get();
  assert.equal(p.birthday, '07-03'); assert.equal(p.phone, '524152223333');
  assert.match((await call(null, 'GET', ok.location)).text, /25% en vino/);
  assert.match((await call(null, 'GET', '/c/i/' + tok)).text, /ya se usó/, 'one use only');
  assert.equal((await call(null, 'POST', '/c/i/' + tok, form({ name: 'Otra', phone: '4150000000', terms: '1' }))).status, 410);

  // Distributor link: needs approval (Profesionales default), max 2 uses.
  const dist = await mk({ program_id: 'pro-1', kind: 'link', label: 'Distribuidores 2026', max_uses: 2 });
  assert.equal(dist.requires_approval, true);
  const dtok = dist.url.split('/c/i/')[1];
  assert.match((await call(null, 'GET', '/c/i/' + dtok)).text, /A qué te dedicas/);
  assert.equal((await call(null, 'POST', '/c/i/' + dtok, form({ name: 'Dist Uno', phone: '4155550001', terms: '1' }))).status, 400, 'pro type required');
  const d1r = await call(null, 'POST', '/c/i/' + dtok, form({ name: 'Dist Uno', phone: '4155550001', terms: '1', pro_type: 'distribuidor' }));
  const card = await call(null, 'GET', d1r.location);
  assert.match(card.text, /en revisión/); assert.doesNotMatch(card.text, /Tus beneficios/);
  // Same number again: neutral answer, no second person, no card shown.
  const again = await call(null, 'POST', '/c/i/' + dtok, form({ name: 'Impostor', phone: '415 555 0001', terms: '1', pro_type: 'cliente' }));
  assert.equal(again.status, 200); assert.match(again.text, /Ya tienes tarjeta/); assert.doesNotMatch(again.text, /\/c\/[A-Za-z0-9_-]{24}/);
  assert.equal(DB.db.prepare("SELECT COUNT(*) AS n FROM club_people WHERE phone = '524155550001'").get().n, 1);
  assert.match((await call(null, 'GET', '/c/i/' + dtok)).text, /ya se usó/, 'max 2 uses reached');

  const hoyStaff = await call('staff', 'GET', '/club/api/hoy');
  assert.equal(hoyStaff.json.approvals.length, 0, 'approvals are for admins');
  const hoy = await call('admin', 'GET', '/club/api/hoy');
  assert.equal(hoy.json.approvals.length, 1); assert.equal(hoy.json.approvals[0].pro_type, 'Distribuidor');
  assert.equal((await call('staff', 'POST', `/club/api/membership/${hoy.json.approvals[0].id}/decide`, { approve: true })).status, 403);
  assert.equal((await call('admin', 'POST', `/club/api/membership/${hoy.json.approvals[0].id}/decide`, { approve: true, program_id: 'pro-2' })).status, 200);
  const after = await call(null, 'GET', d1r.location.split('?')[0]);
  assert.match(after.text, /Profesionales 2/); assert.match(after.text, /20% en vino/);

  // Expired and revoked links.
  const old = await mk({ program_id: 'amigos', kind: 'link', label: 'Viejo', expires_days: 1 });
  DB.db.prepare('UPDATE club_invites SET expires_at = ? WHERE id = ?').run(Date.now() - 1000, old.id);
  assert.match((await call(null, 'GET', '/c/i/' + old.url.split('/c/i/')[1])).text, /ya venció/);
  const rev = await mk({ program_id: 'amigos', kind: 'link', label: 'Cancelado' });
  await call('admin', 'POST', `/club/api/invites/${rev.id}/revoke`);
  assert.match((await call(null, 'GET', '/c/i/' + rev.url.split('/c/i/')[1])).text, /ya no está activa/);
  assert.ok(DB.db.prepare("SELECT COUNT(*) AS n FROM club_audit WHERE action = 'invite.create' AND actor = 'admin@x.test'").get().n >= 4);
});

// ---------- visits: counts, undo, lo trajo ----------
test('register a visit: counts decrement per person, cannot overspend, undo within 10 minutes only', async () => {
  const { DB, call } = await setup();
  const pro = addPerson(DB, 'Paola Tours', { programs: ['pro-1'] });
  const g = addPerson(DB, 'Gaby Nivel', { programs: [] });
  DB.db.prepare("INSERT INTO club_purchases (person_id, day, amount, channel, status, created_at) VALUES (?, ?, 12000, 'tienda', 'approved', ?)").run(g.id, C.today(), Date.now());
  let d = (await call('staff', 'GET', '/club/api/person/' + g.id)).json;
  const rec = d.benefits.find(b => b.benefit_id === 'recorridos');
  assert.equal(rec.left, 4); assert.equal(d.level.id, 'nivel-2');
  assert.match(d.benefits.find(b => b.benefit_id === 'restaurante').rule, /hasta 4 acompañantes/);
  const v = await call('staff', 'POST', `/club/api/person/${g.id}/visit`, { party_size: 3, benefits: [{ benefit_id: 'recorridos', qty: 3 }, { benefit_id: 'restaurante' }],
    parrot_check: 'A-1042', check_total: 2000, discount_total: 200, brought_by: pro.id, note: 'Mesa 4' });
  assert.equal(v.status, 200, v.text);
  d = (await call('staff', 'GET', '/club/api/person/' + g.id)).json;
  assert.equal(d.benefits.find(b => b.benefit_id === 'recorridos').left, 1);
  assert.equal(d.spend, 13800, 'paid = check − discount counts');
  assert.equal(d.visits[0].brought_by_name, 'Paola Tours'); assert.equal(d.visits[0].can_undo, true);
  const over = await call('staff', 'POST', `/club/api/person/${g.id}/visit`, { party_size: 2, benefits: [{ benefit_id: 'recorridos', qty: 2 }] });
  assert.equal(over.status, 400); assert.match(over.json.message, /solo quedan 1/);
  assert.equal((await call('staff', 'POST', `/club/api/person/${g.id}/visit`, { benefits: [{ benefit_id: 'vip' }] })).status, 400, 'Nivel 2 has no VIP');
  // Another staff member cannot undo it; the author can.
  DB.db.prepare("INSERT INTO grants (email, slug, role, created_at) VALUES ('other@x.test', 'club', 'viewer', 1)").run();
  assert.equal((await call('other', 'POST', `/club/api/visit/${v.json.id}/undo`)).status, 403);
  assert.equal((await call('staff', 'POST', `/club/api/visit/${v.json.id}/undo`)).status, 200);
  d = (await call('staff', 'GET', '/club/api/person/' + g.id)).json;
  assert.equal(d.benefits.find(b => b.benefit_id === 'recorridos').left, 4); assert.equal(d.spend, 12000);
  // After 10 minutes, no undo.
  const v2 = await call('staff', 'POST', `/club/api/person/${g.id}/visit`, { party_size: 2, benefits: [{ benefit_id: 'recorridos', qty: 2 }], brought_by: pro.id });
  DB.db.prepare('UPDATE club_visits SET created_at = ? WHERE id = ?').run(Date.now() - 11 * 60e3, v2.json.id);
  const late = await call('staff', 'POST', `/club/api/visit/${v2.json.id}/undo`);
  assert.equal(late.status, 400); assert.match(late.json.message, /10 minutos/);
  const res = (await call('staff', 'GET', '/club/api/resumen')).json;
  const pp = res.pros.find(x => x.id === pro.id);
  assert.equal(pp.people, 2); assert.equal(pp.visits, 1); assert.equal(pp.milestone.next, 200);
  assert.ok(DB.db.prepare("SELECT COUNT(*) AS n FROM club_audit WHERE action IN ('visit.add', 'visit.undo') AND actor = 'staff@x.test'").get().n >= 3);
});

// ---------- receipts and levels ----------
test('level from spend: visits + approved receipts + subscription charges; pending and rejected receipts do not count', async () => {
  const { DB, call } = await setup();
  const g = addPerson(DB, 'Rita Recibos', { programs: [] });
  const tiny = 'data:image/jpeg;base64,' + Buffer.from('fakejpeg').toString('base64');
  const up = await call(null, 'POST', `/c/${g.code}/compra`, { amount: 9000, day: C.today(), channel: 'tienda', photo: tiny });
  assert.equal(up.status, 200, up.text);
  assert.equal((await call(null, 'POST', `/c/${g.code}/compra`, { amount: 500, day: C.today(), channel: 'tienda' })).status, 400, 'photo required');
  DB.db.prepare("INSERT INTO club_sub_charges (key, person_id, day, amount, estimated, synced_at) VALUES ('1:1', ?, ?, 3600, 1, 1), ('1:0', ?, ?, 3600, 0, 1)").run(g.id, C.addDays(C.today(), -30), g.id, C.addDays(C.today(), -400));
  let card = await call(null, 'GET', `/c/${g.code}`);
  assert.match(card.text, /Nivel 1/); assert.match(card.text, /Te faltan <b>\$6,400<\/b> para Nivel 2/); assert.match(card.text, /en revisión/);
  const hoy = (await call('staff', 'GET', '/club/api/hoy')).json;
  assert.equal(hoy.receipts.length, 1);
  const photo = await call('staff', 'GET', `/club/api/photo/${hoy.receipts[0].id}`, undefined, true);
  assert.equal(photo.headers.get('content-type'), 'image/jpeg');
  assert.equal((await call(null, 'GET', `/club/api/photo/${hoy.receipts[0].id}`)).status, 401, 'photos are staff only');
  await call('staff', 'POST', `/club/api/purchase/${hoy.receipts[0].id}/decide`, { approve: true, amount: 8500 });
  card = await call(null, 'GET', `/c/${g.code}`);
  assert.match(card.text, /Nivel 2/); assert.match(card.text, /\$12,100 en compras/); assert.match(card.text, /suscripción estimada/);
  // A rejected receipt never counts.
  await call(null, 'POST', `/c/${g.code}/compra`, { amount: 50000, day: C.today(), channel: 'punto_externo', photo: tiny });
  const h2 = (await call('staff', 'GET', '/club/api/hoy')).json;
  await call('staff', 'POST', `/club/api/purchase/${h2.receipts[0].id}/decide`, { approve: false, reason: 'Ticket ilegible' });
  assert.equal((await call('staff', 'GET', '/club/api/person/' + g.id)).json.spend, 12100);
  assert.equal((await call('staff', 'GET', '/club/api/person/' + g.id)).json.level.id, 'nivel-2');
});

test('"Voy a ir" from the card shows on Hoy; the shift sees VIPs who checked in', async () => {
  const { DB, call } = await setup();
  const a = addPerson(DB, 'Ana López', { programs: ['amigos'] });
  const r = await call(null, 'POST', `/c/${a.code}/voy`, form({ day: C.today(), time: '14:00', party: '4', reservation_name: 'López' }));
  assert.equal(r.status, 303);
  let hoy = (await call('staff', 'GET', '/club/api/hoy')).json;
  assert.equal(hoy.announced.length, 1);
  assert.deepEqual([hoy.announced[0].name, hoy.announced[0].party_size, hoy.announced[0].time, hoy.announced[0].reservation_name, hoy.announced[0].programs[0].name], ['Ana López', 4, '14:00', 'López', 'Amigos y familia']);
  await call('staff', 'POST', `/club/api/person/${a.id}/visit`, { party_size: 4, benefits: [{ benefit_id: 'restaurante' }], check_total: 3000, discount_total: 300 });
  hoy = (await call('staff', 'GET', '/club/api/hoy')).json;
  assert.equal(hoy.announced[0].here, true); assert.equal(hoy.vip_now[0].name, 'Ana López');
  assert.equal(DB.db.prepare('SELECT announcement_id FROM club_visits').get().announcement_id, hoy.announced[0].id);
});

test('moves between programs are admin-only, need a reason, and are audited', async () => {
  const { DB, call } = await setup();
  const p = addPerson(DB, 'Pepe Pro', { programs: ['pro-1'] });
  assert.equal((await call('staff', 'POST', `/club/api/person/${p.id}/move`, { from_program: 'pro-1', to_program: 'pro-2', reason: 'x' })).status, 403);
  assert.equal((await call('admin', 'POST', `/club/api/person/${p.id}/move`, { from_program: 'pro-1', to_program: 'pro-2' })).status, 400);
  assert.equal((await call('admin', 'POST', `/club/api/person/${p.id}/move`, { from_program: 'pro-1', to_program: 'pro-2', reason: 'Trajo 3 bodas en 2026' })).status, 200);
  const d = (await call('admin', 'GET', '/club/api/person/' + p.id)).json;
  assert.deepEqual(d.programs.map(x => x.id), ['pro-2']);
  assert.equal(d.moves[0].detail.reason, 'Trajo 3 bodas en 2026');
});

test('novios bulk add: creates people once, adds the program, gives a WhatsApp link per couple', async () => {
  const { DB, call } = await setup();
  addPerson(DB, 'Ya Existía', { phone: '524157778888' });
  const r = await call('admin', 'POST', '/club/api/novios', { text: 'Ana y Luis, 415 123 4567, ana@x.test, 2025-05-17\nYa Existía, 4157778888\nMal' });
  assert.equal(r.json.created, 1); assert.equal(r.json.existing, 1); assert.equal(r.json.errors.length, 1);
  const list = (await call('admin', 'GET', '/club/api/novios')).json.people;
  assert.equal(list.length, 2);
  assert.ok(list.every(x => x.wa.startsWith('https://wa.me/52')));
  await call('admin', 'POST', `/club/api/person/${list[0].id}/sent`);
  assert.ok((await call('admin', 'GET', '/club/api/novios')).json.people.some(x => x.card_sent_at));
});

// ---------- the wine club ----------
test('wine club sync: match by email or phone, founders get Fundadores, charges (exact and estimated), merged skipped', async () => {
  const { DB, env, call } = await setup();
  const W = d1(WC);
  const day = C.today(), recent = C.addDays(day, -20), old = C.addDays(day, -500);
  W.db.exec(`INSERT INTO stripe_products (product_id, name, club_id) VALUES ('prod_b', 'Bronce', 2), ('prod_f', 'Fundadores', 1);
    INSERT INTO members (id, name, email, phone) VALUES (1, 'Socia Bronce', 'BRONCE@x.test', NULL), (2, 'Socio Fundador', NULL, '415 444 5555'), (3, 'Duplicado', 'dup@x.test', NULL), (4, 'Ex socio', 'ex@x.test', NULL);
    UPDATE members SET merged_into = 1 WHERE id = 3;
    INSERT INTO subscriptions (id, member_id, stripe_product_id, price_amount, status, start_date) VALUES (10, 1, 'prod_b', 360000, 'active', '2025-01-01'), (20, 2, 'prod_f', 300000, 'active', '2024-01-01'),
      (30, 3, 'prod_b', 360000, 'active', '2025-01-01'), (40, 4, 'prod_b', 360000, 'canceled', '2023-01-01');
    INSERT INTO fulfillments (subscription_id, k, paid_on, paid_amount, stripe_invoice_id) VALUES (10, 1, '${recent}', 360000, 'in_1'), (10, 0, '${old}', 360000, 'in_0'), (20, 5, '${recent}', NULL, 'in_2'), (30, 1, '${recent}', 360000, 'in_3'), (40, 9, '${old}', 360000, 'in_4');
    INSERT INTO fulfillments (subscription_id, k, status, done_on) VALUES (20, 4, 'delivered', '${C.addDays(day, -100)}');`);
  const existing = addPerson(DB, 'Socia B', { email: 'bronce@x.test', programs: ['amigos'] });
  assert.deepEqual(await syncWineclub(env), { ok: true, skipped: true, message: 'Sin conexión a la base del club de vinos (WINECLUB_DB).' });
  env.WINECLUB_DB = W;
  const r = await syncWineclub(env);
  assert.equal(r.members, 2); assert.equal(r.created, 1); assert.equal(r.matched, 1); assert.equal(r.founders, 1); assert.equal(r.charges, 3); assert.equal(r.estimated, 2);
  assert.equal(DB.db.prepare('SELECT wineclub_member_id FROM club_people WHERE id = ?').get(existing.id).wineclub_member_id, 1);
  assert.equal(DB.db.prepare("SELECT COUNT(*) AS n FROM club_people WHERE name = 'Duplicado' OR name = 'Ex socio'").get().n, 0);
  const f = DB.db.prepare("SELECT * FROM club_people WHERE wineclub_member_id = 2").get();
  assert.equal(f.phone, '524154445555'); assert.equal(f.source, 'wineclub');
  const fd = (await call('staff', 'GET', '/club/api/person/' + f.id)).json;
  assert.deepEqual(fd.programs.map(p => p.id), ['fundadores', 'nivel-2'], 'founder at $3,000 a quarter = $12,000/yr commitment');
  assert.equal(fd.spend, 6000); assert.equal(fd.spend_estimated, 6000);
  assert.equal((await call('staff', 'GET', '/club/api/person/' + existing.id)).json.spend, 3600);
  // Re-sync is idempotent; when the founder cancels, Fundadores ends.
  await syncWineclub(env);
  assert.equal(DB.db.prepare('SELECT COUNT(*) AS n FROM club_sub_charges').get().n, 3);
  W.db.exec("UPDATE subscriptions SET status = 'canceled', ended_on = '2020-01-01' WHERE id = 20");
  const r3 = await syncWineclub(env);
  assert.equal(r3.ended, 1);
  assert.deepEqual((await call('staff', 'GET', '/club/api/person/' + f.id)).json.programs.map(p => p.id), ['nivel-1']);
});

test('an active Círculo subscriber is placed by the higher of 12-month spend and the annual commitment', async () => {
  const programs = d1(HUB).db.prepare('SELECT * FROM club_programs').all();
  const e = C.effectivePrograms({ programs, memberships: [], spend: 3600, commitment: 14400 });
  assert.equal(e.level.id, 'nivel-2'); assert.equal(e.bySubscription, true);
  assert.equal(C.nextLevel(e.basis, programs, e.level).missing, 5600);
  const e2 = C.effectivePrograms({ programs, memberships: [], spend: 21000, commitment: 14400 });
  assert.equal(e2.level.id, 'nivel-3'); assert.equal(e2.bySubscription, false, 'spend set it');
  const e3 = C.effectivePrograms({ programs, memberships: [], spend: 12000, commitment: 14400 });
  assert.equal(e3.level.id, 'nivel-2'); assert.equal(e3.bySubscription, false, 'same level either way');

  const { DB, env, call } = await setup();
  const W = d1(WC);
  const day = C.today();
  // Bronce: quarterly in Stripe (month × 3) at $3,600, joined last month: one charge paid. Monthly Oro by club cadence only.
  W.db.exec(`INSERT INTO stripe_products (product_id, name, club_id) VALUES ('prod_b', 'Bronce', 2), ('prod_o', 'Oro', 4);
    INSERT INTO members (id, name, email) VALUES (1, 'Nueva Bronce', 'nb@x.test'), (2, 'Oro Mensual', 'oro@x.test'), (3, 'Bronce Cancelado', 'bc@x.test');
    INSERT INTO subscriptions (id, member_id, stripe_product_id, price_amount, billing_interval, billing_interval_count, status, start_date) VALUES
      (1, 1, 'prod_b', 360000, 'month', 3, 'active', '${C.addDays(day, -30)}'), (2, 2, 'prod_o', 250000, NULL, NULL, 'active', '${C.addDays(day, -10)}'),
      (3, 3, 'prod_b', 360000, 'month', 3, 'canceled', '${C.addDays(day, -200)}');
    INSERT INTO fulfillments (subscription_id, k, paid_on, paid_amount, stripe_invoice_id) VALUES (1, 0, '${C.addDays(day, -30)}', 360000, 'in_1'), (3, 0, '${C.addDays(day, -200)}', 360000, 'in_3');`);
  env.WINECLUB_DB = W;
  await syncWineclub(env);
  const id = n => DB.db.prepare('SELECT id, card_code, sub_commitment FROM club_people WHERE name = ?').get(n);
  const nb = id('Nueva Bronce');
  assert.equal(nb.sub_commitment, 14400);
  const card = await call(null, 'GET', '/c/' + nb.card_code);
  assert.match(card.text, /Nivel 2 · por tu suscripción/); assert.match(card.text, /15% en vino/);
  assert.match(card.text, /Te faltan <b>\$5,600<\/b> para Nivel 3/);
  assert.equal((await call('staff', 'GET', '/club/api/person/' + nb.id)).json.by_subscription, true);
  assert.equal(id('Oro Mensual').sub_commitment, 30000);
  assert.match((await call(null, 'GET', '/c/' + id('Oro Mensual').card_code)).text, /Nivel 3 · por tu suscripción/);
  // Cancelled: only the real spend counts.
  const bc = id('Bronce Cancelado');
  assert.equal(bc.sub_commitment, 0);
  assert.doesNotMatch((await call(null, 'GET', '/c/' + bc.card_code)).text, /por tu suscripción/);
  // When the subscription ends, the next sync drops the commitment.
  W.db.exec("UPDATE subscriptions SET status = 'canceled', ended_on = '2020-01-01' WHERE id = 1");
  await syncWineclub(env);
  assert.equal(id('Nueva Bronce').sub_commitment, 0);
  assert.match((await call(null, 'GET', '/c/' + nb.card_code)).text, /<h2>Nivel 1<\/h2>/);
});
