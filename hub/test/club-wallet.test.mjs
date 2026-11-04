// npm test. Club de beneficios — wallet cards. Throwaway certificates stand in for Apple's (a test CA plays the WWDR
// intermediate), and openssl verifies the .pkpass signature exactly as Apple's check does. Skips if openssl is missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import worker from '../src/index.js';
import { zipStore } from '../src/club-wallet.js';

const hasOpenssl = (() => { try { execFileSync('openssl', ['version']); return true; } catch { return false; } })();

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
const HUB = ['0001_init.sql', '0004_club.sql', '0005_club_members.sql'].map(f => new URL('../migrations/' + f, import.meta.url));
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const CODE = 'abcdefghijklmnopqrstuvwxyz012345', CODE_OFF = 'zyxwvutsrqponmlkjihgfedcba543210';

function makeCerts(dir) {
  const o = (...a) => execFileSync('openssl', a, { cwd: dir, stdio: 'pipe' });
  o('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2', '-subj', '/CN=Test WWDR');
  o('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'pass.key.pem', '-out', 'pass.csr', '-subj', '/UID=pass.test.club/CN=Pass Type ID: pass.test.club/OU=TEAM123');
  o('x509', '-req', '-in', 'pass.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'pass.pem', '-days', '2');
  o('pkcs8', '-topk8', '-nocrypt', '-in', 'pass.key.pem', '-out', 'pass.p8');
  const r = f => readFileSync(join(dir, f), 'utf8');
  return { cert: r('pass.pem'), key: r('pass.p8'), wwdr: r('ca.pem') };
}

function setup(extra = {}) {
  const DB = d1(HUB);
  const env = { DB, SESSION_SECRET: 'test', GOOGLE_CLIENT_ID: 'x', PUBLIC_ORIGIN: 'https://apps.test',
    ASSETS: { fetch: async req => new URL(req.url).pathname.endsWith('.png') ? new Response(PNG, { headers: { 'content-type': 'image/png' } }) : new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }) }, ...extra };
  const now = Date.now();
  DB.db.prepare("INSERT INTO club_people (card_code, name, phone, status, terms_at, created_at) VALUES (?, 'Ana López', '524151111111', 'active', ?, ?), (?, 'Bloqueado', '524152222222', 'blocked', ?, ?)").run(CODE, now, now, CODE_OFF, now, now);
  DB.db.prepare("INSERT INTO club_memberships (person_id, program_id, status, created_at) VALUES (1, 'amigos', 'active', ?)").run(now);
  const get = (path, ua = '') => worker.fetch(new Request('https://apps.test' + path, { headers: ua ? { 'user-agent': ua } : {} }), env, { waitUntil() {} });
  return { env, get };
}

test('wallet off: no buttons, and the wallet links fall back to the card with a notice', async () => {
  const { get } = setup();
  const card = await (await get('/c/' + CODE)).text();
  assert.ok(card.includes('Ana López'));
  assert.ok(!card.includes('/wallet/'));
  for (const w of ['apple', 'google']) {
    const r = await get(`/c/${CODE}/wallet/${w}`);
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), `/c/${CODE}?ok=wallet_off`);
  }
  assert.ok((await (await get(`/c/${CODE}?ok=wallet_off`)).text()).includes('todavía no está disponible'));
});

test('zip: stored entries unzip byte for byte', { skip: !hasOpenssl }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  try {
    writeFileSync(join(dir, 't.zip'), zipStore({ 'a.txt': new TextEncoder().encode('hola búho'), 'b.bin': PNG }));
    execFileSync('unzip', ['-q', 't.zip', '-d', 'x'], { cwd: dir });
    assert.equal(readFileSync(join(dir, 'x/a.txt'), 'utf8'), 'hola búho');
    assert.deepEqual(new Uint8Array(readFileSync(join(dir, 'x/b.bin'))), PNG);
    execFileSync('unzip', ['-tq', 't.zip'], { cwd: dir });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Apple Wallet: a signed .pkpass Apple will accept (manifest hashes + CMS signature with the WWDR chain)', { skip: !hasOpenssl }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pkpass-'));
  try {
    const c = makeCerts(dir);
    const { get } = setup({ APPLE_PASS_TYPE_ID: 'pass.test.club', APPLE_TEAM_ID: 'TEAM123', APPLE_PASS_CERT: c.cert, APPLE_PASS_KEY: c.key.replace(/\n/g, '\\n'), APPLE_WWDR_CERT: c.wwdr });
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)';
    const card = await (await get('/c/' + CODE, iphone)).text();
    assert.ok(card.includes(`/c/${CODE}/wallet/apple`) && card.includes('Agregar a Apple Wallet'));
    assert.ok(!card.includes('Google Wallet'), 'only the wallet that is set up');
    const r = await get(`/c/${CODE}/wallet/apple`, iphone);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/vnd.apple.pkpass');
    writeFileSync(join(dir, 'p.pkpass'), new Uint8Array(await r.arrayBuffer()));
    execFileSync('unzip', ['-q', 'p.pkpass', '-d', 'p'], { cwd: dir });
    const pass = JSON.parse(readFileSync(join(dir, 'p/pass.json'), 'utf8'));
    assert.equal(pass.passTypeIdentifier, 'pass.test.club');
    assert.equal(pass.teamIdentifier, 'TEAM123');
    assert.equal(pass.serialNumber, 'club-1');
    assert.equal(pass.barcodes[0].message, `https://apps.test/c/${CODE}`, 'same QR as the web card');
    assert.equal(pass.storeCard.primaryFields[0].value, 'Ana López');
    assert.equal(pass.storeCard.secondaryFields[0].value, 'Amigos y familia');
    const manifest = JSON.parse(readFileSync(join(dir, 'p/manifest.json'), 'utf8'));
    for (const f of ['pass.json', 'icon.png', 'icon@2x.png', 'logo.png', 'logo@2x.png']) {
      const sha = execFileSync('openssl', ['dgst', '-sha1', '-r', join(dir, 'p', f)]).toString().split(' ')[0];
      assert.equal(manifest[f], sha, f);
    }
    execFileSync('openssl', ['cms', '-verify', '-binary', '-inform', 'DER', '-in', 'p/signature', '-content', 'p/manifest.json', '-CAfile', 'ca.pem', '-purpose', 'any', '-out', '/dev/null'], { cwd: dir, stdio: 'pipe' });
    const info = execFileSync('openssl', ['cms', '-cmsout', '-print', '-inform', 'DER', '-in', 'p/signature'], { cwd: dir }).toString();
    assert.ok(info.includes('signingTime') && info.includes('messageDigest'), 'signed attributes present');
    assert.ok((info.match(/Test WWDR/g) || []).length >= 1, 'WWDR certificate embedded');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('Google Wallet: a signed save link with the same QR', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const { get } = setup({ GOOGLE_WALLET_ISSUER_ID: '3388000000012345678', GOOGLE_WALLET_SA_EMAIL: 'wallet@test.iam.gserviceaccount.com', GOOGLE_WALLET_SA_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const card = await (await get('/c/' + CODE, 'Mozilla/5.0 (Linux; Android 15)')).text();
  assert.ok(card.includes('Guardar en Google Wallet') && !card.includes('Apple Wallet'));
  const r = await get(`/c/${CODE}/wallet/google`);
  assert.equal(r.status, 302);
  const loc = r.headers.get('location');
  assert.ok(loc.startsWith('https://pay.google.com/gp/v/save/'));
  const [h, b, s] = loc.split('/').pop().split('.');
  const v = createVerify('RSA-SHA256'); v.update(`${h}.${b}`);
  assert.ok(v.verify(publicKey, Buffer.from(s, 'base64url')), 'RS256 signature verifies');
  const claims = JSON.parse(Buffer.from(b, 'base64url').toString());
  assert.equal(claims.aud, 'google'); assert.equal(claims.typ, 'savetowallet');
  assert.ok(loc.length < 1800, 'save link stays under Google’s length guidance');
  const obj = claims.payload.genericObjects[0];
  assert.equal(obj.id, '3388000000012345678.club_1');
  assert.equal(obj.classId, '3388000000012345678.dosbuhos_club');
  assert.equal(obj.barcode.value, `https://apps.test/c/${CODE}`);
  assert.equal(obj.header.defaultValue.value, 'Ana López');
  assert.equal(claims.payload.genericClasses[0].id, obj.classId);
});

test('blocked card: no wallet buttons and no wallet card', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 }); void publicKey;
  const { get } = setup({ GOOGLE_WALLET_ISSUER_ID: '1', GOOGLE_WALLET_SA_EMAIL: 'w@t', GOOGLE_WALLET_SA_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  assert.ok(!(await (await get('/c/' + CODE_OFF)).text()).includes('/wallet/'));
  const r = await get(`/c/${CODE_OFF}/wallet/google`);
  assert.equal(r.status, 303);
});

test('bad Apple key: the guest gets a calm notice, not an error page', async () => {
  const { get } = setup({ APPLE_PASS_TYPE_ID: 'p', APPLE_TEAM_ID: 't', APPLE_PASS_CERT: 'nope', APPLE_PASS_KEY: 'nope', APPLE_WWDR_CERT: 'nope' });
  const r = await get(`/c/${CODE}/wallet/apple`);
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), `/c/${CODE}?ok=wallet_error`);
});
