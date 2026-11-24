// CI end-to-end on an Android TV emulator: the real APK against a local Worker (wrangler dev on :8787).
// Pairs the TV, uploads two clips, syncs them, plays one through the cloud, then runs the live-show path over the TV's
// LAN server (forwarded to localhost:18320): PIN, CUE, GO, NEGRO. Screenshots go to ./shots/.
import { execSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const B = 'http://localhost:8787', L = 'http://localhost:18320';
const H = { 'content-type': 'application/json', 'X-Contemplo': '1' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (c) => execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const staff = async (p, m = 'GET', b) => { const r = await fetch(B + '/api/' + p, { method: m, headers: H, body: b && JSON.stringify(b) }); const d = await r.json(); if (!r.ok) throw new Error(p + ': ' + d.error); return d; };
let lanTok = '';
const lan = async (p, b) => { const r = await fetch(L + '/api/' + p, { method: b ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'X-Show-Token': lanTok }, body: b && JSON.stringify(b) }); return { status: r.status, d: await r.json().catch(() => ({})) }; };
const until = async (what, fn, ms) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout: ' + what); await sleep(1000); } };
mkdirSync('shots', { recursive: true });
const shot = (n) => { sh(`adb exec-out screencap -p > shots/${n}.png`); console.log('  📷 ' + n); };
const ok = (m) => console.log('  ✓ ' + m);

async function upload(file, title) {
  const data = readFileSync(file);
  const up = await staff('uploads', 'POST', { filename: title + '.mp4', size: data.length, type: 'video/mp4' });
  const parts = [];
  for (let n = 1; n <= up.parts; n++) { const c = data.subarray((n - 1) * up.partSize, n * up.partSize); parts.push(await (await fetch(`${B}/api/uploads/${up.id}/part/${n}`, { method: 'PUT', headers: { 'X-Contemplo': '1' }, body: c })).json()); }
  return staff(`uploads/${up.id}/complete`, 'POST', { parts, sha256: createHash('sha256').update(data).digest('hex'), duration_ms: 8000, width: 1920, height: 1080 });
}

try {
  // 1. Pairing code shown by the TV
  const code = await until('pairing code', () => { try { const j = JSON.parse(sh(`npx wrangler d1 execute contemplo --local --json --command "SELECT code FROM pairings WHERE device_id IS NULL ORDER BY created_at DESC LIMIT 1"`)); return j[0]?.results?.[0]?.code; } catch { return null; } }, 120_000);
  shot('0-pairing'); ok('TV shows pairing code ' + code);
  const dev = await staff('devices/pair', 'POST', { code, name: 'Contemplo CI' });
  await until('device online', async () => (await staff('devices/' + dev.id)).online, 60_000); ok('paired and online');

  // 2. Upload + sync with verification
  const a = await upload('/tmp/a.mp4', 'Escena A'), b = await upload('/tmp/b.mp4', 'Escena B');
  await staff(`devices/${dev.id}/sync`, 'POST', { video_ids: [a.id, b.id] });
  await until('both ready on TV', async () => { const m = (await staff(`devices/${dev.id}/media`)).media; return m.length === 2 && m.every((x) => x.state === 'ready'); }, 240_000);
  ok('both clips downloaded and SHA-256 verified on the TV');

  // The main thread must answer: LAN state goes through it (an empty object means it is blocked).
  const probe = await (await fetch(L + '/api/lan/info')).json(); console.log('  lan info', JSON.stringify(probe));
  // 3. Cloud command, acknowledged by the TV
  const c = await staff(`devices/${dev.id}/commands`, 'POST', { type: 'play', payload: { video_id: a.id, loop: true } });
  const st = await until('play acked', async () => { const x = await staff('commands/' + c.id); return ['done', 'failed', 'expired'].includes(x.status) && x; }, 60_000);
  assert.equal(st.status, 'done', 'play: ' + st.result); ok('cloud PLAY acknowledged');
  await sleep(4000); shot('1-play-A');
  const s1 = (await staff('devices/' + dev.id)).state;
  assert.equal(s1.program?.video_id, a.id); assert.equal(s1.mode, 'playing'); ok(`TV reports playing A (${s1.transition_mode})`);

  // 4. Live show over the LAN server
  const info = await (await fetch(L + '/api/lan/info')).json(); assert.equal(info.lan, true);
  assert.equal((await lan('state')).status, 401); ok('LAN refuses without PIN');
  assert.equal((await fetch(L + '/api/lan/login', { method: 'POST', body: JSON.stringify({ pin: '0000000' }) })).status, 401); ok('wrong PIN refused');
  const pin = (await staff('devices/' + dev.id)).show_pin;
  lanTok = (await (await fetch(L + '/api/lan/login', { method: 'POST', body: JSON.stringify({ pin }) })).json()).token; assert.ok(lanTok); ok('PIN accepted');
  const lib = (await lan('library')).d; assert.equal(lib.videos.filter((v) => v.ready).length, 2); ok('LAN library lists 2 ready clips');
  const pr = await fetch(`${L}/media/${b.id}?t=${lanTok}`, { headers: { range: 'bytes=0-1023' } }); assert.equal(pr.status, 206); ok('preview stream (Range) from the TV');

  let t0 = Date.now(); let r = await lan('cmd', { type: 'cue', payload: { video_id: b.id, transition: 'fade', fade_ms: 1000, end_action: 'loop' } });
  assert.equal(r.d.status, 'done', 'cue: ' + r.d.result); ok(`CUE B acknowledged in ${Date.now() - t0} ms`);
  const cued = await until('cued ready', async () => { const s = (await lan('state')).d; return s.cued?.ready && s; }, 8000);
  assert.equal(cued.program.video_id, a.id, 'A still on air while B is cued'); ok('B ready in standby; A still on air'); shot('2-A-on-air-B-cued');
  t0 = Date.now(); r = await lan('cmd', { type: 'go', payload: {} });
  assert.equal(r.d.status, 'done', 'go: ' + r.d.result); ok(`GO acknowledged in ${Date.now() - t0} ms (${r.d.state.transition_mode})`);
  assert.equal(r.d.state.program.video_id, b.id); await sleep(500); shot('3-go-mid-fade'); await sleep(2500); shot('4-B-on-air');
  r = await lan('cmd', { type: 'blackout', payload: { on: true, fade_ms: 300 } }); assert.equal(r.d.status, 'done'); await sleep(1200); shot('5-blackout');
  assert.equal((await lan('state')).d.blackout, true); ok('NEGRO');
  r = await lan('cmd', { type: 'blackout', payload: { on: false, fade_ms: 300 } }); assert.equal(r.d.status, 'done'); ok('reveal');
  r = await lan('cmd', { type: 'pause', payload: {} }); assert.equal(r.d.status, 'done'); assert.equal(r.d.state.mode, 'paused'); ok('PAUSE');
  r = await lan('cmd', { type: 'restart', payload: {} }); assert.equal(r.d.status, 'done'); ok('RESTART');
  r = await lan('cmd', { type: 'volume', payload: { value: 0.4 } }); assert.equal(r.d.status, 'done'); assert.ok(Math.abs(r.d.state.volume - 0.4) < 0.01); ok('VOLUME 40%');
  r = await lan('cmd', { type: 'mute', payload: { on: true } }); assert.equal(r.d.state.muted, true);
  r = await lan('cmd', { type: 'mute', payload: { on: false } }); assert.equal(r.d.state.muted, false); ok('MUTE on/off');
  r = await lan('cmd', { type: 'skip', payload: { dir: 1 } }); assert.equal(r.d.status, 'done', 'skip: ' + r.d.result); ok('SKIP: ' + (r.d.result || 'ok'));
  r = await lan('cmd', { type: 'go', payload: { video_id: 'nope' } }); assert.equal(r.d.status, 'failed'); ok('GO of a missing video is refused: ' + r.d.result);

  // 5. Dashboard sees the LAN-driven state
  await sleep(4000);
  assert.equal((await staff('devices/' + dev.id)).state.program.video_id, b.id); ok('cloud state follows LAN actions');
  const crash = sh('adb logcat -d -b crash || true'); assert.ok(!/mx\.contemplo/.test(crash), 'crash in logcat:\n' + crash); ok('no crashes');
  console.log('ANDROID E2E OK');
} catch (e) {
  console.error('FAILED:', e.message);
  try { shot('fail'); } catch { /* */ }
  process.exitCode = 1;
}
