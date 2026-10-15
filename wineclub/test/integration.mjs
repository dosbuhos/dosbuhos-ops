// End-to-end check against a real local Worker + D1 (wrangler dev) and a fake Stripe.
// Run: node test/integration.mjs. Creates its own private local config and temporary database.
// Fixture clock is fixed to October 14, 2026; production always uses winery local time.
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
writeFileSync(cfg, readFileSync(join(dir, 'wrangler.toml'), 'utf8').replace(/\r/g, '').replace(/\n\[(env\.staging\.)?ai\]\nbinding = "AI"\n/g, '\n').replace(/^(GOOGLE_CLIENT_ID|ACCESS_TEAM_DOMAIN|ACCESS_AUD) = .*$/gm, '').replace('APP_ENV = "production"', 'APP_ENV = "test"\nTEST_TODAY = "2026-10-14"\nDEV_USER = "staff@example.com"\nSTRIPE_SECRET_KEY = "sk_test_local_mock"\nSTRIPE_API_BASE = "http://127.0.0.1:8788"').replace(/^ADMIN_EMAILS = .*$/gm, 'ADMIN_EMAILS = "staff@example.com"'));
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
    const synced = await post('/sync', {});
    assert.equal(synced.status, 303, synced.text);
    assert.ok(q('SELECT COUNT(*) n FROM subscriptions')[0].n > 0, JSON.stringify(q("SELECT * FROM settings WHERE key='last_sync'")));
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

  await check('normal packing confirmation preserves a historical snapshot on reopen', async () => {
    const subC = q("SELECT id FROM subscriptions WHERE stripe_subscription_id='sub_C'")[0].id;
    let f = q(`SELECT * FROM fulfillments WHERE subscription_id=${subC} AND k=1`)[0];
    const bottles = f.bottles_json;
    assert.equal((await post(`/envio/${subC}/1/reabrir`,{version:String(f.version),reason:'test correction'})).status,303);
    f = q(`SELECT * FROM fulfillments WHERE subscription_id=${subC} AND k=1`)[0];
    assert.equal(f.bottles_json,bottles);
    const form = {version:String(f.version),como:'handed',done_on:'2026-02-12',packing:bottles};
    assert.equal((await post(`/envio/${subC}/1/entregar`,form)).status,400,'packing acknowledgment required');
    assert.equal((await post(`/envio/${subC}/1/entregar`,{...form,packed:'1',packing:'null'})).status,409,'changed packing cannot slip through');
    assert.equal((await post(`/envio/${subC}/1/entregar`,{...form,packed:'1'})).status,303);
    f = q(`SELECT * FROM fulfillments WHERE subscription_id=${subC} AND k=1`)[0];
    assert.equal(f.status,'handed'); assert.equal(f.done_on,'2026-02-12');
    await post(`/envio/${subC}/1/estado`,{version:String(f.version),status:'needs_prep'});
    assert.equal(q(`SELECT status FROM fulfillments WHERE subscription_id=${subC} AND k=1`)[0].status,'handed','quick status cannot reopen completed work');
  });

  await check('delivery delay validates input, preserves the calendar, audits and can be removed', async () => {
    const path = `/envio/${subA}/6`;
    const version = () => String(q(`SELECT version FROM fulfillments WHERE subscription_id=${subA} AND k=6`)[0]?.version || 0);
    const before = q(`SELECT start_date,anchor_override FROM subscriptions WHERE id=${subA}`)[0];
    assert.match(await get(path), /Aplazar esta entrega/);
    for (const fields of [{delayed_until:'bad',delay_reason:'Viaje'}, {delayed_until:'2027-02-30',delay_reason:'Viaje'}, {delayed_until:'2027-01-06',delay_reason:'Viaje'}, {delayed_until:'2027-02-15',delay_reason:''}]) {
      assert.equal((await post(path+'/posponer',{version:version(),...fields})).status,400);
    }
    const prior = version();
    assert.equal((await post(path+'/posponer',{version:prior,delayed_until:'2027-02-15',delay_reason:'Viaje solicitado por el socio'})).status,303);
    assert.equal((await post(path+'/posponer',{version:prior,clear:'1'})).status,409);
    const html = await get(path);
    assert.match(html,/2027/); assert.match(html,/Viaje solicitado por el socio/); assert.match(html,/Aplazado por solicitud/);
    assert.deepEqual(q(`SELECT start_date,anchor_override FROM subscriptions WHERE id=${subA}`)[0],before);
    assert.match(await get(`/envio/${subA}/7`),/6 feb 2027/);
    assert.ok(q(`SELECT id FROM audit_log WHERE entity_id='${subA}:6' AND action LIKE 'aplazar entrega%'`).length);
    assert.equal((await post(path+'/posponer',{version:version(),clear:'1'})).status,303);
    assert.equal(q(`SELECT delayed_until FROM fulfillments WHERE subscription_id=${subA} AND k=6`)[0].delayed_until,null);
    const done = q(`SELECT k,version FROM fulfillments WHERE subscription_id=${subA} AND status='shipped'`)[0];
    if (done) assert.equal((await post(`/envio/${subA}/${done.k}/posponer`,{version:String(done.version),delayed_until:'2027-03-01',delay_reason:'Viaje'})).status,400);
  });

  await check('benefit use distinguishes the staff who served from the authenticated recorder', async () => {
    const member = q(`SELECT member_id FROM subscriptions WHERE id=${subA}`)[0].member_id;
    const benefit = q('SELECT id FROM club_benefits WHERE active=1 LIMIT 1')[0].id;
    const r = await post(`/socio/${member}/beneficio`,{benefit_id:String(benefit),qty:'1',used_on:'2026-10-14',handled_by:'Ángel',created_by:'forged@example.com',note:'Kit de prueba'});
    assert.equal(r.status,303);
    assert.match(r.headers.get('location'),/beneficio=1#beneficios/);
    const u=q(`SELECT * FROM benefit_uses WHERE member_id=${member} ORDER BY id DESC LIMIT 1`)[0];
    assert.equal(u.handled_by,'Ángel'); assert.equal(u.created_by,'staff@example.com'); assert.ok(u.created_at);
    const html=await get(`/socio/${member}?beneficio=1`);
    assert.match(html,/Atendido \/ entregado por: <b>Ángel/);
    assert.match(html,/Registrado por: staff@example.com/);
    const audit=q(`SELECT after_json FROM audit_log WHERE entity='member' AND entity_id='${member}' AND action LIKE 'beneficio:%' ORDER BY id DESC LIMIT 1`)[0];
    assert.equal(JSON.parse(audit.after_json).handled_by,'Ángel');
  });

  await check('signature receipt saves with staff attribution without changing delivery history', async () => {
    const before=q(`SELECT * FROM fulfillments WHERE subscription_id=${subA} AND k=1`)[0];
    const path=`/envio/${subA}/1/comprobante`;
    const html=await get(path);assert.match(html,/signature-pad/);assert.match(html,/Foto o captura de pantalla/);
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
    const fd=new FormData();for(const [k,v] of Object.entries({version:String(before.version),kind:'signature',ink:'1',recipient:'Recibe Prueba',received_on:'2026-10-14',note:'Firma de prueba'}))fd.set(k,v);
    fd.set('file',new Blob([png],{type:'image/png'}),'firma.png');
    let r=await fetch(B+path,{method:'POST',headers:O,body:fd});assert.equal(r.status,200);assert.equal((await r.json()).ok,true);
    const after=q(`SELECT * FROM fulfillments WHERE id=${before.id}`)[0];
    for(const key of ['status','done_on','delivered_on','bottles_json','order_ref','handled_by'])assert.equal(after[key],before[key],key);
    const photo=q(`SELECT id,kind,recipient,received_on,uploaded_by FROM photos WHERE fulfillment_id=${before.id} ORDER BY id DESC LIMIT 1`)[0];
    assert.equal(photo.kind,'signature');assert.equal(photo.recipient,'Recibe Prueba');assert.equal(photo.uploaded_by,'staff@example.com');
    const image=await fetch(B+`/foto/${photo.id}`);assert.equal(image.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await image.arrayBuffer()),png);
    r=await fetch(B+path,{method:'POST',headers:O,body:fd});assert.equal(r.status,409);await r.text();
    assert.match(await get(`/envio/${subA}/1`),/Firma de recepción/);
    assert.ok(q(`SELECT id FROM audit_log WHERE entity_id='${subA}:1' AND action='firma de recepción'`).length);
  });

  await check('receipt upload validates files and creates a record without marking an unworked shipment delivered', async () => {
    const path=`/envio/${subA}/8/comprobante`;
    const fd=new FormData();for(const [k,v] of Object.entries({version:'0',kind:'receipt',recipient:'Otra persona',received_on:'2026-10-14'}))fd.set(k,v);
    const sendReceipt=async()=>{const r=await fetch(B+path,{method:'POST',headers:O,body:fd});await r.text();return r.status};
    assert.equal(await sendReceipt(),400);
    fd.set('file',new Blob(['<svg>bad</svg>'],{type:'image/png'}),'fake.png');assert.equal(await sendReceipt(),400);
    fd.set('file',new Blob([new Uint8Array(1900001)],{type:'image/png'}),'big.png');assert.equal(await sendReceipt(),413);
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
    fd.set('file',new Blob([png],{type:'image/png'}),'whatsapp.png');
    fd.set('received_on','2027-01-01');assert.equal(await sendReceipt(),400);
    fd.set('received_on','2026-10-14');fd.set('kind','signature');assert.equal(await sendReceipt(),400);
    fd.set('kind','receipt');assert.equal(await sendReceipt(),200);
    const f=q(`SELECT status,done_on,version FROM fulfillments WHERE subscription_id=${subA} AND k=8`)[0];assert.equal(f.status,null);assert.equal(f.done_on,null);assert.equal(f.version,1);
  });

  await check('preparation is the default expandable shipment workspace and inline OV saves retain context', async () => {
    const k=6,path=`/envio/${subA}/${k}`;
    let f=q(`SELECT * FROM fulfillments WHERE subscription_id=${subA} AND k=${k}`)[0];
    assert.equal((await post(path+'/estado',{version:String(f.version),status:'needs_prep'})).status,303);
    const html=await get('/envios');
    assert.match(html,/aria-current="page"[^>]*href="\/envios\?f=prep"/);
    assert.match(html,/shipment-work/);assert.match(html,/Botellas a preparar/);assert.match(html,/Contacto y entrega/);
    assert.match(html,/valeria@example.com/);assert.match(html,/Guardar OV \/ guía/);assert.match(html,/Firma \/ comprobante/);
    f=q(`SELECT * FROM fulfillments WHERE subscription_id=${subA} AND k=${k}`)[0];
    const back=`/envios?f=prep&abrir=${subA}%3A${k}#envio-${subA}-${k}`;
    const r=await post(path+'/ref',{version:String(f.version),order_ref:'OV-PACK',tracking:'PACK-1',back});
    assert.equal(r.status,303);assert.equal(r.headers.get('location'),back);
    const opened=await get(`/envios?f=prep&abrir=${subA}%3A${k}`);
    assert.match(opened,/OV-PACK/);assert.match(opened,/ open>/);
    assert.equal(q(`SELECT status FROM fulfillments WHERE subscription_id=${subA} AND k=${k}`)[0].status,'needs_prep');
  });

  await check('winery holds preserve payments and can be released by pickup or shipment', async () => {
    const k=6,path=`/envio/${subA}/${k}`;
    let f=q(`SELECT * FROM fulfillments WHERE subscription_id=${subA} AND k=${k}`)[0];
    const before={paid_on:f.paid_on,stripe_invoice_id:f.stripe_invoice_id,expected_date:f.expected_date};
    assert.equal((await post(path+'/estado',{version:String(f.version),status:'held',hold_reason:'Cliente en Nueva York'})).status,303);
    f=q(`SELECT * FROM fulfillments WHERE subscription_id=${subA} AND k=${k}`)[0];
    assert.equal(f.done_on,null);assert.equal(f.held_on,'2026-10-14');assert.equal(f.hold_reason,'Cliente en Nueva York');
    assert.deepEqual({paid_on:f.paid_on,stripe_invoice_id:f.stripe_invoice_id,expected_date:f.expected_date},before);
    const html=await get('/envios?f=resguardo');assert.match(html,/En resguardo en bodega/);assert.match(html,/Cliente en Nueva York/);
    const form={version:String(f.version),como:'handed',done_on:'2026-10-14',packing:'null',override:'1',override_reason:'Caja de prueba',early:'1'};
    assert.equal((await post(path+'/entregar',form)).status,303);
    f=q(`SELECT * FROM fulfillments WHERE subscription_id=${subA} AND k=${k}`)[0];assert.equal(f.status,'handed');assert.equal(f.hold_reason,'Cliente en Nueva York');
    await post(path+'/reabrir',{version:String(f.version),reason:'Prueba de envío por paquetería'});
    f=q(`SELECT * FROM fulfillments WHERE subscription_id=${subA} AND k=${k}`)[0];
    await post(path+'/estado',{version:String(f.version),status:'held',hold_reason:'Cliente en Nueva York'});
    f=q(`SELECT * FROM fulfillments WHERE subscription_id=${subA} AND k=${k}`)[0];
    assert.equal((await post(path+'/entregar',{...form,version:String(f.version),como:'shipped'})).status,303);
    assert.equal(q(`SELECT status FROM fulfillments WHERE subscription_id=${subA} AND k=${k}`)[0].status,'shipped');
  });

  await check('dated and indefinite holds can be edited and due holds remain held until physical release',async()=>{
    const path=`/envio/${subA}/7`,row=()=>q(`SELECT * FROM fulfillments WHERE subscription_id=${subA} AND k=7`)[0];
    assert.equal((await post(path+'/estado',{version:'0',status:'held',hold_until:'2026-02-30'})).status,400);
    assert.equal((await post(path+'/estado',{version:'0',status:'held',hold_until:'2026-10-20'})).status,303);
    let f=row();assert.equal(f.hold_until,'2026-10-20');assert.equal(f.done_on,null);
    assert.match(await get(path),/Retener hasta \(opcional\)/);
    assert.equal((await post(path+'/estado',{version:String(f.version),status:'held',hold_until:''})).status,303);
    f=row();assert.equal(f.hold_until,null);assert.match(await get(path),/Resguardo indefinido/);
    assert.equal((await post(path+'/estado',{version:String(f.version),status:'held',hold_until:'2026-10-13'})).status,303);
    f=row();assert.equal(f.status,'held');assert.equal(f.done_on,null);assert.match(await get('/envios?f=resguardo'),/Resguardo · fecha cumplida/);
    assert.match(await get('/'),/resguardo\(s\) con fecha cumplida/);
  });

  await check('staff delivery contact corrections survive Stripe sync and reach shipment screens',async()=>{
    const member=q(`SELECT member_id FROM subscriptions WHERE id=${subA}`)[0].member_id;
    assert.equal((await post(`/socio/${member}/datos`,{contact_email:'bad',delivery_pref:'envio'})).status,400);
    assert.equal((await post(`/socio/${member}/datos`,{contact_email:'delivery@example.com',contact_phone:'+19492917105',delivery_pref:'envio',delivery_address:'Dirección de prueba',staff_note:'Entregar al transportista'})).status,303);
    await post('/sync',{});
    const m=q(`SELECT email,contact_email,contact_phone,delivery_address,delivery_pref FROM members WHERE id=${member}`)[0];
    assert.equal(m.email,'valeria@example.com');assert.equal(m.contact_email,'delivery@example.com');assert.equal(m.contact_phone,'+19492917105');assert.equal(m.delivery_pref,'envio');
    const html=await get(`/envio/${subA}/7`);assert.match(html,/Dirección de prueba/);assert.match(html,/tel:\+19492917105/);
    assert.match(await get(`/socio/${member}`),/mailto:delivery@example.com/);
  });

  await check('bulk calculated deliveries are disabled', async () => {
    const before = q('SELECT COUNT(*) n FROM fulfillments WHERE status IS NOT NULL')[0].n;
    assert.equal((await post(`/suscripcion/${subA}/historico`,{before:'2026-10-14'})).status,400);
    assert.equal(q('SELECT COUNT(*) n FROM fulfillments WHERE status IS NOT NULL')[0].n,before);
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
