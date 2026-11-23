// Live show control. The same page runs in two places:
//   • Served by the Google TV itself on the local network (http://<tv>:8320/) — the primary path. No internet needed,
//     commands answer in milliseconds, the preview streams from the TV's own verified copy.
//   • Served by the Worker through the Hub (show.html?d=<device>) — backup over the internet, ~1–3 s per command.
// PROGRAM = what the TV says is on the projectors. PREVIEW = this browser only; never touches the HDMI output.
import { $, $$, esc, tc, toast, stateWords, CMD_WORDS, STATUS_WORDS } from './common.js';

const app = $('#app');
let T;                       // transport
const S = { lib: { videos: [], playlists: [] }, list: '', sel: 0, st: null, stAt: 0, online: false, log: [], busy: new Set(), mirror: false, conf: null, mon: 'thumb' };

// ---------- transports ----------
async function lanTransport() {
  const r = await fetch('api/lan/info', { cache: 'no-store' }).catch(() => null);
  if (!r || !r.ok) return null;
  const info = await r.json();
  if (!info.lan) return null;
  let token = localStorage.getItem('cs.lan.token') || '';
  const call = async (path, body) => {
    const res = await fetch('api/' + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'X-Show-Token': token }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
    if (res.status === 401) { const e = new Error('PIN'); e.pin = true; throw e; }
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'Error ' + res.status);
    return d;
  };
  return {
    kind: 'lan', name: info.name, info, pollMs: 300,
    login: async (pin) => { const res = await fetch('api/lan/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin }) }); const d = await res.json().catch(() => ({})); if (!res.ok) throw new Error(d.error || 'PIN incorrecto'); token = d.token; localStorage.setItem('cs.lan.token', token); },
    state: async () => ({ state: await call('state'), online: true }),
    library: () => call('library'),
    // On the LAN the TV answers after it has acted: done/failed is the acknowledgement itself.
    cmd: async (type, payload, onStatus) => { onStatus('pending'); const d = await call('cmd', { type, payload }); return d; },
    media: (id) => `media/${id}?t=${encodeURIComponent(token)}`,
    thumb: (id) => `thumb/${id}?t=${encodeURIComponent(token)}`,
  };
}
async function cloudTransport() {
  const H = { 'content-type': 'application/json', 'X-Contemplo': '1' };
  const call = async (path, opt = {}) => { const r = await fetch('api/' + path, { method: opt.method || 'GET', headers: H, body: opt.body ? JSON.stringify(opt.body) : undefined, cache: 'no-store' }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Error ' + r.status); return d; };
  const devs = (await call('devices')).devices;
  const want = new URLSearchParams(location.search).get('d');
  const dev = devs.find((d) => d.id === want) || devs[0];
  if (!dev) throw new Error('No hay ninguna pantalla vinculada');
  let readyIds = new Set();
  return {
    kind: 'cloud', name: dev.name, dev, pollMs: 1500,
    state: async () => { const d = await call('devices/' + dev.id); return { state: d.state, online: d.online, lan_url: d.lan_url }; },
    library: async () => {
      const [v, p, m] = await Promise.all([call('videos'), call('playlists'), call(`devices/${dev.id}/media`)]);
      readyIds = new Set(m.media.filter((x) => x.state === 'ready').map((x) => x.video_id));
      return { videos: v.videos.map((x) => ({ ...x, ready: readyIds.has(x.id) })), playlists: p.playlists };
    },
    cmd: async (type, payload, onStatus) => {
      const c = await call(`devices/${dev.id}/commands`, { method: 'POST', body: { type, payload } });
      onStatus('pending');
      const t0 = Date.now();
      while (Date.now() - t0 < 95_000) {
        await new Promise((r) => setTimeout(r, 400));
        const x = await call('commands/' + c.id);
        if (x.status === 'delivered') onStatus('delivered');
        if (['done', 'failed', 'expired'].includes(x.status)) return { status: x.status, result: x.result };
      }
      return { status: 'expired', result: '' };
    },
    media: (id) => `api/media/${id}`,
    thumb: (id) => `api/thumb/${id}`,
  };
}

// ---------- model ----------
const scenes = () => {
  if (S.list) { const p = S.lib.playlists.find((x) => x.id === S.list); if (p) return p.items.map((it, i) => ({ ...it, index: i, playlist_id: p.id, v: S.lib.videos.find((v) => v.id === it.video_id) })).filter((s) => s.v); }
  return S.lib.videos.map((v, i) => ({ video_id: v.id, label: '', transition: 'cut', fade_ms: 800, end_action: 'loop', index: i, playlist_id: '', v }));
};
const scenePayload = (s) => ({ video_id: s.video_id, playlist_id: s.playlist_id, scene_index: s.index, transition: s.transition, fade_ms: s.fade_ms, end_action: s.end_action, loop: s.end_action === 'loop' });
const liveIndex = () => { const pg = S.st?.program; if (!pg) return -1; return scenes().findIndex((s) => (pg.playlist_id && s.playlist_id === pg.playlist_id ? s.index === pg.scene_index : s.video_id === pg.video_id)); };
const cuedIndex = () => { const c = S.st?.cued; if (!c) return -1; return scenes().findIndex((s) => (c.playlist_id && s.playlist_id === c.playlist_id ? s.index === c.scene_index : s.video_id === c.video_id)); };
const position = () => { const pg = S.st?.program; if (!pg) return 0; const p = pg.position_ms || 0; return S.st.mode === 'playing' ? p + (Date.now() - S.stAt) : p; };

// ---------- commands with requested / acknowledged states ----------
async function cmd(type, payload = {}, label) {
  if (S.busy.has(type)) return;
  const entry = { at: new Date(), label: label || CMD_WORDS[type] || type, status: 'sending', result: '' };
  S.log.unshift(entry); S.log.length = Math.min(S.log.length, 40); S.busy.add(type); drawLog(); drawButtons();
  const t0 = performance.now();
  try {
    const r = await T.cmd(type, payload, (st) => { entry.status = st; drawLog(); });
    entry.status = r.status; entry.result = r.result || ''; entry.ms = Math.round(performance.now() - t0);
    if (r.state) { S.st = r.state; S.stAt = Date.now(); }
    if (r.status !== 'done') toast(`${entry.label}: ${STATUS_WORDS[r.status] || r.status}${r.result ? ' — ' + r.result : ''}`, 5000);
  } catch (e) {
    if (e.pin) return pinScreen();
    entry.status = 'failed'; entry.result = e.message === 'Failed to fetch' ? 'Sin conexión con el TV' : e.message;
    toast(entry.label + ': ' + entry.result, 5000);
  } finally { S.busy.delete(type); drawLog(); drawButtons(); poll(true); }
}
const doCue = () => { const s = scenes()[S.sel]; if (!s) return; if (!s.v.ready) return toast('Ese video no está copiado en el TV. Envíalo desde la Biblioteca.', 5000); cmd('cue', scenePayload(s), 'CUE ' + (s.index + 1) + ' · ' + (s.label || s.v.title)); };
const doGo = () => {
  const ci = cuedIndex(), s = scenes()[S.sel];
  if (ci >= 0) return cmd('go', {}, 'GO ' + (ci + 1) + ' · ' + (scenes()[ci].label || scenes()[ci].v.title));
  if (!s) return;
  if (!s.v.ready) return toast('Ese video no está copiado en el TV.', 5000);
  cmd('go', scenePayload(s), 'GO ' + (s.index + 1) + ' · ' + (s.label || s.v.title));   // nothing cued: cue + go in one step
};
const doNext = () => { const li = liveIndex(), list = scenes(); const n = Math.min(list.length - 1, (li >= 0 ? li : S.sel) + 1); if (n < 0) return; S.sel = n; drawRos(); loadPreview(); doCue(); };
const doPause = () => cmd(S.st?.mode === 'playing' ? 'pause' : 'resume');
const doBlack = () => cmd('blackout', { on: !S.st?.blackout, fade_ms: 600 }, S.st?.blackout ? 'Quitar negro' : 'NEGRO');
const doRestart = () => cmd('restart');

// ---------- UI ----------
function layout() {
  const showLists = S.lib.playlists.filter((p) => p.items.length);
  app.innerHTML = `
    <div class="monitors">
      <section class="mon program"><div class="screen" id="pgmScreen"><span class="lbl pgm">PROGRAMA</span><div class="empty">Sin señal de video</div></div>
        <div class="meta"><div class="t" id="pgmT">—</div><div class="tc" id="pgmTc">0:00</div></div>
        <div class="bar live" style="margin-top:8px"><i id="pgmBar"></i></div>
        <div class="sub row small"><span class="badge" id="pgmState">—</span><span id="pgmInfo" class="muted"></span><span class="spacer"></span>
          <select id="mon" style="width:auto;min-height:30px;padding:2px 6px;font-size:12px"><option value="thumb">Miniatura</option><option value="mirror">Espejo (simulación)</option>${window.isSecureContext && navigator.mediaDevices ? '<option value="capture">Capturadora HDMI (señal real)</option>' : ''}</select></div></section>
      <section class="mon preview"><div class="screen" id="pvwScreen"><span class="lbl pvw">VISTA PREVIA</span><video id="pvw" muted playsinline preload="auto"></video></div>
        <div class="meta"><div class="t" id="pvwT">—</div><div class="tc" id="pvwTc">0:00</div></div>
        <input type="range" class="scrub" id="scrub" min="0" max="1000" value="0">
        <div class="sub row small"><button class="btn sm" id="pvPlay">▶ Ver</button><button class="btn sm" id="pvSound">Sonido: no</button><span class="spacer"></span><span id="cueState"></span></div></section>
    </div>
    <div class="transport">
      <button class="tbtn cue" id="bCue">CUE<small>preparar en el TV · C</small></button>
      <button class="tbtn go" id="bGo">GO<small>lanzar · espacio</small></button>
      <button class="tbtn" id="bNext">NEXT<small>preparar siguiente · N</small></button>
      <button class="tbtn" id="bPause">PAUSA<small>P</small></button>
      <button class="tbtn" id="bRestart">REINICIAR<small>R</small></button>
      <button class="tbtn black" id="bBlack">NEGRO<small>B</small></button>
    </div>
    <div class="monitors">
      <section class="panel"><div class="row"><h2 style="margin:0">Guion</h2><span class="spacer"></span>
        <select id="list" style="width:auto"><option value="">Todos los videos</option>${showLists.map((p) => `<option value="${p.id}" ${S.list === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
        <div class="list ros" id="ros" style="margin-top:10px"></div></section>
      <section class="panel"><h2>Órdenes</h2><div class="cmdlog" id="log"></div>
        <p class="tiny muted" style="margin-top:10px">Clic en una escena = vista previa aquí (no toca la proyección). <kbd>C</kbd> CUE · <kbd>espacio</kbd> GO · <kbd>N</kbd> siguiente · <kbd>P</kbd> pausa · <kbd>B</kbd> negro · <kbd>R</kbd> reiniciar</p>
        <div class="row small" style="margin-top:8px"><button class="btn sm" id="bFit">Encuadre</button><button class="btn sm" id="bMute">Silencio</button><button class="btn sm" id="bId">Identificar</button><button class="btn sm danger" id="bStop">Detener</button></div></section>
    </div>`;
  $('#bCue').onclick = doCue; $('#bGo').onclick = doGo; $('#bNext').onclick = doNext; $('#bPause').onclick = doPause; $('#bRestart').onclick = doRestart; $('#bBlack').onclick = doBlack;
  $('#bFit').onclick = () => cmd('fit', { mode: S.st?.fit === 'fill' ? 'fit' : 'fill' }, S.st?.fit === 'fill' ? 'Encuadre: completo' : 'Encuadre: llenar (recorta)');
  $('#bMute').onclick = () => cmd('mute', { on: !S.st?.muted });
  $('#bId').onclick = () => cmd('identify');
  $('#bStop').onclick = () => { if (confirm('¿Detener la proyección? La pantalla queda en negro.')) cmd('stop'); };
  $('#list').onchange = (e) => { S.list = e.target.value; S.sel = 0; location.hash = S.list; drawRos(); loadPreview(); };
  $('#mon').value = S.mon; $('#mon').onchange = (e) => setMonitor(e.target.value);
  const pv = $('#pvw');
  $('#pvPlay').onclick = () => (pv.paused ? pv.play() : pv.pause());
  $('#pvSound').onclick = () => { pv.muted = !pv.muted; $('#pvSound').textContent = 'Sonido: ' + (pv.muted ? 'no' : 'sí'); };
  pv.onplay = pv.onpause = () => ($('#pvPlay').textContent = pv.paused ? '▶ Ver' : '❚❚ Pausa');
  pv.ontimeupdate = () => { $('#pvwTc').textContent = tc(pv.currentTime * 1000) + ' / ' + tc((pv.duration || 0) * 1000); if (!scrubbing) $('#scrub').value = pv.duration ? (pv.currentTime / pv.duration) * 1000 : 0; };
  let scrubbing = false;
  $('#scrub').oninput = (e) => { scrubbing = true; if (pv.duration) pv.currentTime = (e.target.value / 1000) * pv.duration; };
  $('#scrub').onchange = () => (scrubbing = false);
  drawRos(); drawLog(); loadPreview(); drawProgram(); drawButtons();
}
function drawRos() {
  const list = scenes(), li = liveIndex(), ci = cuedIndex();
  $('#ros').innerHTML = list.map((s, i) => `<div class="li ${i === S.sel ? 'sel' : ''} ${i === li ? 'live' : ''} ${i === ci ? 'cued' : ''}" data-i="${i}">
    <span class="num">${i + 1}</span><div class="mini" style="${s.v.has_thumb ? `background-image:url('${T.thumb(s.v.id)}')` : ''}"></div>
    <div style="flex:1;min-width:0"><div style="font-weight:600">${esc(s.label || s.v.title)}</div><div class="tiny muted">${tc(s.v.duration_ms)} · ${s.transition === 'fade' ? 'fundido ' + s.fade_ms + ' ms' : 'corte'} · al final: ${({ loop: 'repetir', hold: 'congelar', black: 'negro', next: 'siguiente' })[s.end_action]}</div></div>
    ${i === li ? '<span class="badge bad">AL AIRE</span>' : ''}${i === ci ? `<span class="badge cue">${S.st?.cued?.ready ? 'EN ESPERA ✓' : 'CARGANDO…'}</span>` : ''}${s.v.ready ? '' : '<span class="badge warn">No está en el TV</span>'}</div>`).join('') || '<p class="muted">No hay videos copiados en este TV.</p>';
  $$('#ros .li').forEach((el) => (el.onclick = () => { S.sel = Number(el.dataset.i); drawRos(); loadPreview(); }));
}
let pvId = '';
function loadPreview() {
  const s = scenes()[S.sel], pv = $('#pvw'); if (!pv) return;
  $('#pvwT').textContent = s ? `${s.index + 1}. ${s.label || s.v.title}` : '—';
  if (!s || pvId === s.v.id) return;
  pvId = s.v.id; pv.src = T.media(s.v.id); pv.load();
}
function drawButtons() {
  const st = S.st || {}, ok = S.online;
  const set = (id, dis, busyKey) => { const b = $(id); if (!b) return; b.disabled = !ok || dis; b.classList.toggle('busy', S.busy.has(busyKey)); };
  set('#bCue', !scenes().length, 'cue'); set('#bGo', !scenes().length && cuedIndex() < 0, 'go'); set('#bNext', !scenes().length, 'cue');
  set('#bPause', !st.program, st.mode === 'playing' ? 'pause' : 'resume'); set('#bRestart', !st.program, 'restart'); set('#bBlack', false, 'blackout');
  if ($('#bPause')) $('#bPause').firstChild.textContent = st.mode === 'playing' ? 'PAUSA' : 'CONTINUAR';
  if ($('#bBlack')) { $('#bBlack').classList.toggle('on', !!st.blackout); $('#bBlack').firstChild.textContent = st.blackout ? 'QUITAR NEGRO' : 'NEGRO'; }
  const ci = cuedIndex();
  if ($('#bGo')) $('#bGo').querySelector('small').textContent = ci >= 0 ? `lanza ${ci + 1} · espacio` : 'lanza la seleccionada · espacio';
  if ($('#cueState')) $('#cueState').innerHTML = st.cued ? `<span class="badge cue">En espera en el TV: ${esc(st.cued.title)} ${st.cued.ready ? '✓' : '…'}</span>` : '<span class="muted">Nada en espera</span>';
}
function drawLog() {
  const el = $('#log'); if (!el) return;
  el.innerHTML = S.log.map((e) => { const c = e.status === 'done' ? 'ok' : ['failed', 'expired'].includes(e.status) ? 'bad' : 'warn';
    return `<div><span class="muted">${e.at.toLocaleTimeString('es-MX')}</span><span class="badge ${c}">${esc(e.label)}</span><span>${esc(STATUS_WORDS[e.status] || e.status)}${e.ms != null && e.status === 'done' ? ` · ${e.ms} ms` : ''}${e.result && e.status !== 'done' ? ' — ' + esc(e.result) : ''}</span></div>`; }).join('') || '<div class="muted">Aún no hay órdenes</div>';
}
let pgmVideo = '';
function drawProgram() {
  const st = S.st || {}, pg = st.program, scr = $('#pgmScreen'); if (!scr) return;
  $('#pgmT').textContent = pg ? (pg.scene_index != null && pg.playlist_id ? pg.scene_index + 1 + '. ' : '') + (pg.title || '') : 'Nada en pantalla';
  const pos = position(), dur = pg?.duration_ms || 0;
  $('#pgmTc').textContent = pg ? `${tc(pos % (dur || Infinity))} / ${tc(dur)}` : '0:00';
  $('#pgmBar').style.width = dur ? Math.min(100, ((pos % dur) / dur) * 100) + '%' : '0';
  const b = $('#pgmState'); b.textContent = !S.online ? 'SIN CONEXIÓN' : stateWords(st).toUpperCase(); b.className = 'badge ' + (!S.online ? 'bad' : st.mode === 'playing' && !st.blackout ? 'bad' : st.mode === 'error' ? 'bad' : '');
  $('#pgmInfo').textContent = [pg?.loop ? 'repite ∞' : '', st.muted ? 'sin sonido' : '', st.fit === 'fill' ? 'llenar' : '', st.transition_mode === 'dual' ? 'GO sin negro' : st.transition_mode === 'single' ? 'GO con corte breve' : '', st.last_error ? '⚠ ' + st.last_error : ''].filter(Boolean).join(' · ');
  scr.classList.toggle('black', !!st.blackout);
  if (S.mon === 'thumb') {
    const id = pg?.video_id || '';
    if (id !== pgmVideo) { pgmVideo = id; const v = S.lib.videos.find((x) => x.id === id); scr.querySelector('.empty, img, video')?.remove(); scr.insertAdjacentHTML('afterbegin', v?.has_thumb ? `<img src="${T.thumb(id)}" alt="">` : '<div class="empty">' + (id ? 'Sin miniatura' : 'Sin video') + '</div>'); }
  } else if (S.mon === 'mirror') {
    const mv = scr.querySelector('video'); if (!mv) return;
    const id = pg?.video_id || '';
    if (id !== pgmVideo) { pgmVideo = id; mv.src = id ? T.media(id) : ''; }
    if (id && mv.readyState >= 1) {
      const want = ((pos % (dur || 1e12)) / 1000);
      if (Math.abs(mv.currentTime - want) > 0.6) mv.currentTime = want;
      if (st.mode === 'playing' && mv.paused) mv.play().catch(() => {}); if (st.mode !== 'playing' && !mv.paused) mv.pause();
    }
  }
}
async function setMonitor(m) {
  const scr = $('#pgmScreen');
  if (S.conf) { S.conf.getTracks().forEach((t) => t.stop()); S.conf = null; }
  scr.querySelector('.empty, img, video')?.remove(); pgmVideo = '';
  S.mon = m;
  if (m === 'mirror') scr.insertAdjacentHTML('afterbegin', '<video muted playsinline></video>');
  if (m === 'capture') {
    try {
      S.conf = await navigator.mediaDevices.getUserMedia({ video: { width: 1920, height: 1080 }, audio: false });
      scr.insertAdjacentHTML('afterbegin', '<video muted playsinline autoplay></video>'); scr.querySelector('video').srcObject = S.conf;
    } catch (e) { toast('No se pudo abrir la capturadora: ' + e.message, 5000); $('#mon').value = 'thumb'; return setMonitor('thumb'); }
  }
  drawProgram();
}

// ---------- polling ----------
let lastPoll = 0, polling = false;
async function poll(now) {
  if (polling || (!now && Date.now() - lastPoll < T.pollMs)) return;
  polling = true; lastPoll = Date.now();
  try {
    const r = await T.state(); S.st = r.state; S.stAt = Date.now(); S.online = r.online !== false;
    $('#conn').textContent = T.kind === 'lan' ? 'Wi-Fi directo · sin internet necesario' : 'vía nube (respaldo)';
  } catch (e) { if (e.pin) { polling = false; return pinScreen(); } S.online = false; $('#conn').textContent = T.kind === 'lan' ? 'Sin conexión con el TV' : 'Sin conexión'; }
  polling = false;
  $('#devchip').innerHTML = `<span class="dot ${S.online ? 'ok' : 'bad'}"></span><span>${esc(T.name)}</span>`;
  drawButtons(); drawProgram(); if (!S.ros || S.ros !== JSON.stringify([liveIndex(), cuedIndex(), S.st?.cued?.ready])) { S.ros = JSON.stringify([liveIndex(), cuedIndex(), S.st?.cued?.ready]); drawRos(); }
}
function pinScreen() {
  app.innerHTML = `<div class="pinbox panel stack"><h2>PIN del show</h2><p class="small muted">Está en Contemplo Studio → Pantallas.</p><input id="pin" inputmode="numeric" maxlength="8" autocomplete="off"><button class="btn primary" id="go" style="width:100%">Entrar</button><div id="pe" class="small" style="color:var(--live)"></div></div>`;
  $('#pin').focus();
  const go = async () => { try { await T.login($('#pin').value); await start(); } catch (e) { $('#pe').textContent = e.message; } };
  $('#go').onclick = go; $('#pin').onkeydown = (e) => e.key === 'Enter' && go();
}
async function start() {
  try { S.lib = await T.library(); } catch (e) { if (e.pin) return pinScreen(); throw e; }
  S.list = location.hash.slice(1) && S.lib.playlists.some((p) => p.id === location.hash.slice(1)) ? location.hash.slice(1) : S.list;
  layout(); await poll(true);
  setInterval(() => document.visibilityState === 'visible' && poll(), 100);
  setInterval(() => drawProgram(), 250);
  setInterval(async () => { try { S.lib = await T.library(); drawRos(); } catch { /* keep */ } }, 30_000);
}
document.addEventListener('keydown', (e) => {
  if (!T || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName) || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  const k = e.key.toLowerCase();
  if (k === ' ') { e.preventDefault(); doGo(); } else if (k === 'c') doCue(); else if (k === 'n') doNext(); else if (k === 'p') doPause(); else if (k === 'b') doBlack(); else if (k === 'r') doRestart();
  else if (k === 'arrowdown' || k === 'arrowup') { e.preventDefault(); S.sel = Math.max(0, Math.min(scenes().length - 1, S.sel + (k === 'arrowdown' ? 1 : -1))); drawRos(); loadPreview(); }
});

(async () => {
  try {
    T = (await lanTransport()) || (await cloudTransport());
    await start();
  } catch (e) { app.innerHTML = `<section class="panel"><p>${esc(e.message)}</p></section>`; }
})();
