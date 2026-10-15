// End-to-end check against a real local Worker + D1 (wrangler dev) and a fake Stripe.
// Run: node test/integration.mjs   (needs .dev.vars with DEV_USER and STRIPE_API_BASE=http://127.0.0.1:8788)
// Dates are relative to the real "today", which is fine for this data (all in Aug–Nov 2026).
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const dir = fileURLToPath(new URL('..', import.meta.url));
const persist = mkdtempSync(join(tmpdir(), 'wc-'));
const cfg = join(dir, 'wrangler.test.toml');
// Same config minus Workers AI (needs a Cloudflare login) and Google sign-in (tests use DEV_USER).
writeFileSync(cfg, readFileSync(join(dir, 'wrangler.toml'), 'utf8').replace(/\r/g, '').replace(/\n\[(env\.staging\.)?ai\]\nbinding = "AI"\n/g, '\n').replace(/^(GOOGLE_CLIENT_ID|ACCESS_TEAM_DOMAIN|ACCESS_AUD) = .*$/gm, '').replace('APP_ENV = "production"', 'APP_ENV = "test"\nDEV_USER = "staff@example.com"\nSTRIPE_SECRET_KEY = "sk_test_local_mock"\nSTRIPE_API_BASE = "http://127.0.0.1:8788"').replace(/^ADMIN_EMAILS = .*$/gm, 'ADMIN_EMAILS = "staff@example.com"'));
const wrangler = join(dir, 'node_modules/wrangler/bin/wrangler.js');
const wr = (...a) => execFileSync(process.execPath, [wrangler, ...a, '-c', cfg, '--persist-to', persist], { cwd: dir, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const q = (sql) => JSON.parse(wr('d1', 'execute', 'DB', '--local', '--json', '--command', sql))[0].results;
const B = 'http://127.0.0.1:8790', O = { Origin: B, connection: 'close' };
// Always drain the body: an unread response leaves the keep-alive socket in a bad state.
const send = async (path, body) => { const r = await fetch(B + path, { method: 'POST', headers: { ...O, 'content-type': 'application/x-www-form-urlencoded' }, body, redirect: 'manual' }); const text = await r.text(); return { status: r.status, headers: r.headers, text }; };
const post = (path, body) => send(path, new URLSearchParams(body));
const get = async (path) => (await fetch(B + path, { headers: { connection: 'close' } })).text();
let dev, stripe, passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };

try {
  stripe = spawn(process.execPath, [join(dir, 'test/mock-stripe.mjs')], { stdio: 'ignore', detached: process.platform !== 'win32', windowsHide: true });
  wr('d1', 'migrations', 'apply', 'DB', '--local');
  wr('d1', 'execute', 'DB', '--local', '--file', join(dir, 'test/fixtures/legacy-sample.sql'));
  dev = spawn(process.execPath, [wrangler, 'dev', '-c', cfg, '--persist-to', persist, '--port', '8790', '--ip', '127.0.0.1'], { cwd: dir, stdio: 'ignore', detached: process.platform !== 'win32', windowsHide: true });
  for (let i = 0; i < 60; i++) { try { const h = await fetch(B + '/health'); await h.text(); if (h.ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 1000)); }

  await check('sync is idempotent', async () => {
    await post('/sync', {});
    const a = q('SELECT (SELECT COUNT(*) FROM members) m, (SELECT COUNT(*) FROM subscriptions) s, (SELECT COUNT(*) FROM fulfillments) f, (SELECT COUNT(*) FROM stripe_products) p')[0];
    await post('/sync', {});
    const b = q('SELECT (SELECT COUNT(*) FROM members) m, (SELECT COUNT(*) FROM subscriptions) s, (SELECT COUNT(*) FROM fulfillments) f, (SELECT COUNT(*) FROM stripe_products) p')[0];
    assert.deepEqual(a, b);
    assert.equal(q("SELECT COUNT(*) n FROM stripe_products WHERE club_id IS NOT NULL")[0].n, 0, 'no club is assigned without confirmation');
  });

  await check('unconfirmed products block schedules and the agenda says so', async () => {
    const html = await get('/');
    assert.match(html, /Calendarios bloqueados/);
    assert.match(html, /Valeria Prueba/);
    assert.match(html, /incompleto/);
  });

  await check('migration preview writes nothing', async () => {
    const before = q('SELECT COUNT(*) n FROM fulfillments')[0].n;
    const html = await get('/migracion');
    assert.match(html, /Sin coincidencia:<\/b> Sin Stripe/);
    assert.match(html, /Club de Vinos Dos Buhos/);
    assert.equal(q('SELECT COUNT(*) n FROM fulfillments')[0].n, before);
  });

  await check('import: products confirmed from legacy evidence, history preserved, repeatable', async () => {
    const body = new URLSearchParams([['product', 'prod_mesa'], ['product', 'prod_club'], ['recipe', '1:1'], ['recipe', '1:2'], ['recipe', '5:8']]);
    await send('/migracion/importar', body);
    await post('/sync', {}); // payments attach to shipments once the subscription has a club
    const v = q("SELECT f.k, f.status, f.done_on, f.method, f.handled_by, f.legacy_id, f.stripe_invoice_id FROM fulfillments f JOIN subscriptions s ON s.id=f.subscription_id WHERE s.stripe_subscription_id='sub_A' ORDER BY k");
    assert.equal(v[0].status, 'handed'); assert.equal(v[0].done_on, '2026-08-08'); assert.equal(v[0].method, 'pickup');
    assert.equal(v[0].handled_by, 'Eric Maycotte'); assert.equal(v[0].legacy_id, '1'); assert.equal(v[0].stripe_invoice_id, 'in_A1', 'payment link kept');
    const l = q("SELECT f.k, f.status, f.order_ref, f.method FROM fulfillments f JOIN subscriptions s ON s.id=f.subscription_id WHERE s.stripe_subscription_id='sub_C' AND f.status IS NOT NULL ORDER BY k");
    assert.deepEqual(l.map(x => [x.k, x.status]), [[1, 'handed'], [2, 'delivered']]);
    assert.equal(l[1].order_ref, 'OV-02072');
    const n = q('SELECT COUNT(*) n FROM fulfillments')[0].n;
    await send('/migracion/importar', body);
    assert.equal(q('SELECT COUNT(*) n FROM fulfillments')[0].n, n, 'second import adds nothing');
    assert.equal(q("SELECT COUNT(*) n FROM club_cases")[0].n, 3);
    assert.equal(q('SELECT slot FROM club_cases WHERE club_id=5')[0].slot, 8, 'August allocation stays in August');
  });

  await check("Vanessa's case: September and October owed, November upcoming", async () => {
    const html = await get('/');
    const card = (d) => new RegExp(`Valeria Prueba</span>\\s*<span class="meta">Círculo Diamante · Envío #${d}`);
    assert.match(html, card(2)); assert.match(html, card(3));
    const overdueSection = html.split('id="hoy"')[0];
    assert.match(overdueSection, card(2), '#2 (Sep 6) is in Atrasados');
    assert.match(overdueSection, card(3), '#3 (Oct 6) is in Atrasados');
    assert.doesNotMatch(overdueSection, card(4));
  });

  const subA = q("SELECT id FROM subscriptions WHERE stripe_subscription_id='sub_A'")[0].id;
  await check('future shipments have no fulfill button; early fulfillment needs explicit confirmation', async () => {
    const html = await get('/');
    assert.doesNotMatch(html, new RegExp(`/envio/${subA}/4/entregar`));
    const r = await post(`/envio/${subA}/4/entregar`, { como: 'handed', version: '0', done_on: '2026-10-14', packing: 'null', override: '1', override_reason: 'x' });
    assert.equal(r.status, 400);
  });

  await check('fulfillment requires packing contents or an explicit reason, and saves everything at once', async () => {
    let r = await post(`/envio/${subA}/2/entregar`, { como: 'shipped', version: '0', done_on: '2026-10-14', packing: 'null', order_ref: 'OV-9', tracking: 'T1' });
    assert.equal(r.status, 400, 'case 2 of Diamante is undefined');
    const v0 = String(q(`SELECT version FROM fulfillments WHERE subscription_id=${subA} AND k=2`)[0]?.version ?? 0); // row exists: Stripe payment attached
    r = await post(`/envio/${subA}/2/entregar`, { como: 'shipped', version: v0, done_on: '2026-10-14', packing: 'null', order_ref: 'OV-9', tracking: 'T1', carrier: 'DHL', note: 'n', override: '1', override_reason: 'caja armada a mano' });
    assert.equal(r.status, 303);
    const f = q(`SELECT status, done_on, order_ref, tracking, carrier, note, override_reason, method, version FROM fulfillments WHERE subscription_id=${subA} AND k=2`)[0];
    assert.deepEqual([f.status, f.order_ref, f.tracking, f.carrier, f.note, f.override_reason, f.method], ['shipped', 'OV-9', 'T1', 'DHL', 'n', 'caja armada a mano', 'courier']);
  });

  await check('a second submit with the same version is refused (no double fulfillment)', async () => {
    const stale = String(q(`SELECT version FROM fulfillments WHERE subscription_id=${subA} AND k=2`)[0].version - 1);
    const r = await post(`/envio/${subA}/2/entregar`, { como: 'shipped', version: stale, done_on: '2026-10-14', override: '1', override_reason: 'x' });
    assert.equal(r.status, 409);
    assert.equal(q(`SELECT COUNT(*) n FROM fulfillments WHERE subscription_id=${subA} AND k=2`)[0].n, 1);
  });

  await check('the quick status route cannot mark shipped; reopening needs a reason and is audited', async () => {
    const r = await post(`/envio/${subA}/3/estado`, { status: 'shipped', version: String(q(`SELECT version FROM fulfillments WHERE subscription_id=${subA} AND k=3`)[0].version) });
    assert.equal(r.status, 303); assert.match(r.headers.get('location'), /entregar/);
    assert.equal(q(`SELECT COUNT(*) n FROM fulfillments WHERE subscription_id=${subA} AND k=3 AND status IS NOT NULL`)[0].n, 0);
    const v = q(`SELECT version FROM fulfillments WHERE subscription_id=${subA} AND k=2`)[0].version;
    assert.equal((await post(`/envio/${subA}/2/reabrir`, { version: String(v), reason: '' })).status, 400);
    assert.equal((await post(`/envio/${subA}/2/reabrir`, { version: String(v), reason: 'marcado por error' })).status, 303);
    const f = q(`SELECT status, order_ref FROM fulfillments WHERE subscription_id=${subA} AND k=2`)[0];
    assert.equal(f.status, null); assert.equal(f.order_ref, 'OV-9', 'details kept when reopening');
    assert.ok(q("SELECT COUNT(*) n FROM audit_log WHERE action='reabrir' AND note='marcado por error'")[0].n === 1);
  });

  await check('changing a product mapping never duplicates or overwrites fulfillments', async () => {
    const before = q('SELECT subscription_id, k, status, legacy_id FROM fulfillments ORDER BY subscription_id, k');
    await post('/conciliar/prod_club', { club_id: '2' });
    await post('/conciliar/prod_club', { club_id: '1' });
    await post('/sync', {});
    assert.deepEqual(q('SELECT subscription_id, k, status, legacy_id FROM fulfillments ORDER BY subscription_id, k').filter(r => r.status), before.filter(r => r.status));
  });

  await check('irrelevant products can be dismissed; shipment list filters and search render', async () => {
    await post('/conciliar/prod_event', { ignore: '1' });
    const html = await get('/envios?f=entregados');
    assert.match(html, /Lucía Demo/);
    assert.match(html, /recogió en bodega · por Eric Maycotte/);
  });

  await check('stale inline edits cannot overwrite newer work or its audit', async () => {
    const version = String(q(`SELECT version FROM fulfillments WHERE subscription_id=${subA} AND k=2`)[0].version);
    assert.equal((await post(`/envio/${subA}/2/ref`, { version, order_ref: 'OV-NEW', tracking: 'NEW' })).status, 303);
    const before = q('SELECT COUNT(*) n FROM audit_log')[0].n;
    assert.equal((await post(`/envio/${subA}/2/ref`, { version, order_ref: 'OV-STALE' })).status, 409);
    assert.equal(q(`SELECT order_ref FROM fulfillments WHERE subscription_id=${subA} AND k=2`)[0].order_ref, 'OV-NEW');
    assert.equal(q('SELECT COUNT(*) n FROM audit_log')[0].n, before);
  });

  await check('photo failure rolls back fulfillment and audit together', async () => {
    q("CREATE TRIGGER test_photo_failure BEFORE INSERT ON photos BEGIN SELECT RAISE(ABORT,'test photo failure'); END");
    const version = String(q(`SELECT version FROM fulfillments WHERE subscription_id=${subA} AND k=3`)[0].version);
    const before = q('SELECT COUNT(*) n FROM audit_log')[0].n;
    const fd = new FormData();
    for (const [key,value] of Object.entries({como:'handed',version,done_on:'2026-10-14',packing:'null',override:'1',override_reason:'test'})) fd.set(key,value);
    fd.set('photo',new Blob(['test'],{type:'image/jpeg'}),'test.jpg');
    const r = await fetch(B + `/envio/${subA}/3/entregar`,{method:'POST',headers:O,body:fd,redirect:'manual'}); await r.text();
    assert.equal(r.status,500);
    assert.equal(q(`SELECT status FROM fulfillments WHERE subscription_id=${subA} AND k=3`)[0].status,null);
    assert.equal(q('SELECT COUNT(*) n FROM audit_log')[0].n,before);
    q('DROP TRIGGER test_photo_failure');
  });

  await check('migration preserves a pending shipment with staff notes', async () => {
    q(`INSERT INTO fulfillments(subscription_id,k,note) VALUES (${subA},5,'staff work'); INSERT INTO legacy_shipments(legacy_id,legacy_member_id,shipment_number,status,alloc_json) VALUES ('extra','3',5,'delivered','[]')`);
    const html = await get('/migracion'); assert.match(html,/ya tiene trabajo del personal/);
    await send('/migracion/importar',new URLSearchParams());
    const f = q(`SELECT status,note,legacy_id FROM fulfillments WHERE subscription_id=${subA} AND k=5`)[0];
    assert.equal(f.status,null); assert.equal(f.note,'staff work'); assert.equal(f.legacy_id,null);
  });

  console.log(`\n${passed} integration checks passed`);
} catch (e) {
  console.error('FAILED:', e.stack, e.cause?.code || e.cause?.message || ''); process.exitCode = 1;
} finally {
  for (const child of [dev, stripe]) if (child?.pid) {
    try { if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); else process.kill(-child.pid); } catch { /* already gone */ }
  }
  rmSync(persist, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); rmSync(cfg, { force: true });
}
