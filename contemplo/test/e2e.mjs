// End-to-end check against `npm run dev` (local D1 + R2): upload in parts, pair a simulated TV, sync, verify the
// download's SHA-256, send a command and see it acknowledged, and check that a stale command is never delivered.
// Usage: node test/e2e.mjs [file.mp4] [base]   (base defaults to http://localhost:8787)
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const file = process.argv[2] || '/tmp/escena-a.mp4', B = process.argv[3] || 'http://localhost:8787';
const H = { 'content-type': 'application/json', 'X-Contemplo': '1' };
const staff = async (p, method = 'GET', body) => { const r = await fetch(B + '/api/' + p, { method, headers: H, body: body && JSON.stringify(body) }); const d = await r.json(); if (!r.ok) throw new Error(p + ': ' + d.error); return d; };
const dev = (tok) => async (p, body, raw) => { const r = await fetch(B + '/api/device/' + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}), ...(raw || {}) }, body: body && JSON.stringify(body) }); return r; };
const ok = (m) => console.log('  ✓ ' + m);

const data = readFileSync(file), sha = createHash('sha256').update(data).digest('hex');
console.log(`file ${file} ${data.length} bytes`);

// 1. upload
const up = await staff('uploads', 'POST', { filename: 'Escena A.mp4', size: data.length, type: 'video/mp4' });
const parts = [];
for (let n = 1; n <= up.parts; n++) {
  const chunk = data.subarray((n - 1) * up.partSize, n * up.partSize);
  const r = await fetch(`${B}/api/uploads/${up.id}/part/${n}`, { method: 'PUT', headers: { 'X-Contemplo': '1', 'content-length': String(chunk.length) }, body: chunk });
  assert.equal(r.status, 200, await r.clone().text()); parts.push(await r.json());
}
ok(`uploaded ${up.parts} parts`);
const bad = await fetch(`${B}/api/uploads`, { method: 'POST', headers: H, body: JSON.stringify({ filename: 'x.mov', size: 10 }) });
assert.equal(bad.status, 415); ok('non-MP4 refused');
const v = await staff(`uploads/${up.id}/complete`, 'POST', { parts, sha256: sha, duration_ms: 12000, width: 1920, height: 1080 });
assert.equal(v.status, 'ready'); assert.equal(v.size, data.length); ok('upload complete, size matches');

// 2. pairing
const start = await (await dev()('pair/start', { model: 'sim' })).json();
assert.match(start.code, /^\d{6}$/);
assert.equal((await (await dev()('pair/poll', { secret: start.secret })).json()).status, 'waiting');
const d = await staff('devices/pair', 'POST', { code: start.code, name: 'Contemplo Test' });
const paired = await (await dev()('pair/poll', { secret: start.secret })).json();
assert.equal(paired.status, 'paired'); assert.equal(paired.device_id, d.id);
assert.equal((await (await dev()('pair/poll', { secret: start.secret })).json()).status, 'expired'); ok('paired; token handed over once');
const tv = dev(paired.token);
assert.equal((await dev('nope')('heartbeat', {})).status, 401); ok('bad token refused');

// 3. sync
await staff(`devices/${d.id}/sync`, 'POST', { video_ids: [v.id] });
let hb = await (await tv('heartbeat', { state: { mode: 'idle' }, storage: { total: 32e9, free: 20e9 }, lan_ip: '192.168.0.50', lan_port: 8320, app_version: 'sim' })).json();
assert.equal(hb.wanted.length, 1); assert.equal(hb.wanted[0].sha256, sha); ok('device sees wanted video with sha256');
const half = Math.floor(data.length / 2);
const r1 = await tv('media/' + v.id, null, { range: `bytes=0-${half - 1}` }); assert.equal(r1.status, 206);
const a = Buffer.from(await r1.arrayBuffer());
const r2 = await tv('media/' + v.id, null, { range: `bytes=${half}-` }); assert.equal(r2.status, 206);
const b = Buffer.from(await r2.arrayBuffer());
assert.equal(createHash('sha256').update(Buffer.concat([a, b])).digest('hex'), sha); ok('resumed download (two ranges) verifies');
await tv('heartbeat', { state: { mode: 'idle' }, media: [{ id: v.id, state: 'ready', progress: 1 }] });
const lib = await staff('videos');
assert.equal(lib.videos.find((x) => x.id === v.id).devices[0].state, 'ready'); ok('dashboard shows ✓ ready');

// 4. command → delivered → acknowledged
const c = await staff(`devices/${d.id}/commands`, 'POST', { type: 'play', payload: { video_id: v.id, loop: true } });
assert.equal((await staff('commands/' + c.id)).status, 'pending');
hb = await (await tv('heartbeat', { state: { mode: 'idle' } })).json();
assert.equal(hb.commands[0].id, c.id); assert.equal((await staff('commands/' + c.id)).status, 'delivered');
hb = await (await tv('heartbeat', { state: { mode: 'idle' } })).json();
assert.equal(hb.commands.length, 0, 'not delivered twice');
await tv('ack', { acks: [{ id: c.id, status: 'done' }] });
assert.equal((await staff('commands/' + c.id)).status, 'done'); ok('pending → delivered → done (only after the TV acks)');
const dd = await staff('devices/' + d.id);
assert.equal(dd.online, true); assert.equal(dd.lan_url, 'http://192.168.0.50:8320/'); ok('online with LAN address');

// 5. playlists
const pl = await staff('playlists', 'POST', { name: 'En la Oscuridad — Blind Tasting', mode: 'show' });
await staff('playlists/' + pl.id, 'PUT', { name: 'En la Oscuridad — Blind Tasting', mode: 'show', items: [{ video_id: v.id, label: 'Opening Atmosphere', transition: 'fade', fade_ms: 1500, end_action: 'hold' }, { video_id: v.id, label: 'Sensory Introduction' }] });
const p2 = (await staff('playlists')).playlists.find((x) => x.id === pl.id);
assert.equal(p2.items.length, 2); assert.equal(p2.items[0].transition, 'fade'); ok('run-of-show saved');

// 6. range for staff preview
const pr = await fetch(`${B}/api/media/${v.id}`, { headers: { range: 'bytes=100-199' } });
assert.equal(pr.status, 206); assert.equal((await pr.arrayBuffer()).byteLength, 100); ok('preview range request');

// cleanup
await staff('playlists/' + pl.id, 'DELETE'); await staff('devices/' + d.id, 'DELETE'); await staff('videos/' + v.id, 'DELETE');
ok('cleanup'); console.log('ALL OK');
