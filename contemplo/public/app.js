// Contemplo Studio dashboard. Relative URLs throughout so it works under the Hub's /contemplo/ prefix.
import { $, $$, esc, tc, bytes, ago, date, res, toast, stateWords, CMD_WORDS, STATUS_WORDS } from './common.js';
import { Sha256 } from './sha256.js';

const S = { me: null, videos: [], devices: [], playlists: [], dev: localStorage.getItem('cs.dev') || '', q: '', tag: '', uploads: [], cmd: null, editing: null };
const CATEGORIES = ['En la Oscuridad', 'Catas a Ciegas', 'Ambientaciones', 'Arte', 'Eventos Privados', 'Background Loops'];

async function api(path, opt = {}) {
  const r = await fetch('api/' + path, { method: opt.method || 'GET', headers: { 'content-type': 'application/json', 'X-Contemplo': '1' }, body: opt.body === undefined ? undefined : JSON.stringify(opt.body), credentials: 'same-origin' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
  return d;
}
const device = () => S.devices.find((d) => d.id === S.dev) || S.devices[0] || null;
const thumb = (v) => (v.has_thumb ? `api/thumb/${v.id}` : '');
const onDev = (v, d = device()) => (d ? v.devices.find((x) => x.device_id === d.id) : null);
const videoById = (id) => S.videos.find((v) => v.id === id);

async function loadAll() {
  const [me, v, d, p] = await Promise.all([api('me'), api('videos'), api('devices'), api('playlists')]);
  S.me = me; S.videos = v.videos; S.devices = d.devices; S.playlists = p.playlists;
  if (!device() || !S.devices.some((x) => x.id === S.dev)) S.dev = S.devices[0]?.id || '';
}
async function refreshDevices() { try { S.devices = (await api('devices')).devices; chip(); } catch { /* keep last */ } }
async function refreshVideos() { try { S.videos = (await api('videos')).videos; } catch { /* keep last */ } }

function chip() {
  const d = device(), c = $('#devchip');
  c.innerHTML = d ? `<span class="dot ${d.online ? 'ok' : 'bad'}"></span><span>${esc(d.name)} · ${d.online ? 'en línea' : 'sin conexión ' + ago(d.last_seen)}</span>` : '<span class="dot"></span><span>Sin pantalla vinculada</span>';
  c.onclick = () => (location.hash = '#pantallas');
}

// ---------- commands: requested ≠ acknowledged ----------
async function send(type, payload = {}, label) {
  const d = device();
  if (!d) return toast('Primero vincula una pantalla en Pantallas');
  S.cmd = { type, label: label || CMD_WORDS[type] || type, status: 'sending', at: Date.now() };
  cmdLine();
  try {
    const c = await api(`devices/${d.id}/commands`, { method: 'POST', body: { type, payload } });
    S.cmd = { ...S.cmd, id: c.id, status: 'pending', offline: !c.online };
    cmdLine();
    const t0 = Date.now();
    while (Date.now() - t0 < 95_000) {
      await new Promise((r) => setTimeout(r, 700));
      const x = await api('commands/' + c.id);
      if (S.cmd?.id !== c.id) return;
      S.cmd = { ...S.cmd, status: x.status, result: x.result };
      cmdLine();
      if (['done', 'failed', 'expired'].includes(x.status)) { refreshDevices().then(renderNowIfVisible); return; }
    }
  } catch (e) { S.cmd = { ...S.cmd, status: 'failed', result: e.message }; cmdLine(); }
}
function cmdLine() {
  const el = $('#cmdline'); if (!el || !S.cmd) return;
  const c = S.cmd, cls = c.status === 'done' ? 'ok' : c.status === 'failed' || c.status === 'expired' ? 'bad' : 'warn';
  const retry = ['failed', 'expired'].includes(c.status) && c.id ? ` <button class="btn sm" id="retry">Reintentar</button>` : '';
  const off = c.offline && c.status === 'pending' ? ' — la pantalla aparece sin conexión; se entregará si vuelve en 90 s' : '';
  el.innerHTML = `<span class="badge ${cls}">${esc(c.label)}</span> ${esc(STATUS_WORDS[c.status] || c.status)}${c.result && c.status !== 'done' ? ': ' + esc(c.result) : ''}${esc(off)}${retry}`;
  const b = $('#retry'); if (b) b.onclick = async () => { const r = await api(`commands/${c.id}/retry`, { method: 'POST' }); S.cmd = { ...c, id: r.id, status: 'pending' }; cmdLine(); pollCmd(r.id); };
}
async function pollCmd(id) {
  const t0 = Date.now();
  while (Date.now() - t0 < 95_000 && S.cmd?.id === id) {
    await new Promise((r) => setTimeout(r, 700));
    const x = await api('commands/' + id); S.cmd = { ...S.cmd, status: x.status, result: x.result }; cmdLine();
    if (['done', 'failed', 'expired'].includes(x.status)) return;
  }
}

// ---------- views ----------
const views = { ahora, biblioteca, listas, vivo, pantallas, programacion, guia };
let current = '';
function route() {
  const h = (location.hash || '#ahora').slice(1).split('/')[0];
  current = views[h] ? h : 'ahora';
  $$('.nav a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + current));
  views[current]();
}
function renderNowIfVisible() { if (current === 'ahora') nowPanel(); if (current === 'pantallas') pantallas(); }

function ahora() {
  $('#view').innerHTML = `<div class="stack"><section class="panel"><h2>Ahora en la proyección</h2><div id="np"></div></section>
    <section class="panel"><div class="row"><h2 style="margin:0">Últimos videos</h2><span class="spacer"></span><button class="btn primary" id="up1">Subir video</button></div><div class="grid" id="recent" style="margin-top:12px"></div></section></div>`;
  $('#up1').onclick = () => $('#picker').click();
  nowPanel();
  $('#recent').innerHTML = S.videos.slice(0, 6).map(card).join('') || '<p class="muted">Todavía no hay videos. Arrastra un MP4 aquí o usa «Subir video».</p>';
  bindCards($('#recent'));
}
function nowPanel() {
  const el = $('#np'); if (!el) return;
  const d = device();
  if (!d) { el.innerHTML = `<p>No hay ninguna pantalla vinculada. <a href="#pantallas">Vincular el Google TV</a></p>`; return; }
  const st = d.state || {}, pg = st.program || {}, v = videoById(pg.video_id);
  const pos = pg.position_ms || 0, dur = pg.duration_ms || v?.duration_ms || 0;
  el.innerHTML = `<div class="np">
    <div><div class="screen ${st.blackout ? 'black' : ''}">${v && v.has_thumb ? `<img src="${thumb(v)}" alt="">` : '<div class="empty">Sin video</div>'}<span class="lbl pgm">PROGRAMA</span></div></div>
    <div class="stack">
      <div><div style="font-size:22px;font-weight:600">${esc(pg.title || v?.title || 'Nada en pantalla')}</div>
        <div class="row small muted" style="margin-top:4px"><span class="badge ${st.mode === 'playing' && !st.blackout ? 'bad' : ''}">${esc(stateWords(st))}</span>
        ${pg.loop ? '<span class="badge">Repetir ∞</span>' : ''}${st.muted ? '<span class="badge">Silencio</span>' : ''}
        <span><span class="dot ${d.online ? 'ok' : 'bad'}" style="display:inline-block"></span> ${esc(d.name)} · ${d.online ? 'en línea' : 'sin conexión, ' + ago(d.last_seen)}</span></div></div>
      <div><div class="bar live"><i style="width:${dur ? Math.min(100, (pos / dur) * 100) : 0}%"></i></div><div class="row small mono muted" style="justify-content:space-between;margin-top:4px"><span>${tc(pos)}</span><span>${dur ? tc(dur) : ''}</span></div></div>
      <div class="ctl">
        <button class="btn" data-c="${st.mode === 'playing' ? 'pause' : 'resume'}" ${pg.video_id ? '' : 'disabled'}>${st.mode === 'playing' ? 'Pausa' : 'Continuar'}</button>
        <button class="btn ${st.blackout ? 'on' : ''}" data-c="blackout">${st.blackout ? 'Quitar negro' : 'Negro'}</button>
        <button class="btn" data-c="restart" ${pg.video_id ? '' : 'disabled'}>Reiniciar</button>
        <button class="btn" data-c="skip" ${pg.video_id ? '' : 'disabled'}>Siguiente</button>
        <button class="btn ${pg.loop ? 'on' : ''}" data-c="loop" ${pg.video_id ? '' : 'disabled'}>Repetir ${pg.loop ? 'sí' : 'no'}</button>
        <button class="btn ${st.muted ? 'on' : ''}" data-c="mute">${st.muted ? 'Con sonido' : 'Silencio'}</button>
      </div>
      <div class="status-line" id="cmdline">${pg.video_id || S.cmd ? '' : '<span class="muted">Para proyectar: en un video listo en el TV, toca <strong>Reproducir</strong>.</span>'}</div>
      <div class="row small">${d.lan_url ? `<a class="btn sm" href="${esc(d.lan_url)}" target="_blank" rel="noopener">Control en vivo por Wi-Fi ↗</a>` : ''}<a class="btn sm ghost" href="#vivo">Control en vivo vía nube</a>
      ${st.cued?.title ? `<span class="badge cue">En espera: ${esc(st.cued.title)}</span>` : ''}${st.transition_mode ? `<span class="muted tiny">Transición: ${st.transition_mode === 'dual' ? 'doble decodificador (sin negro)' : 'corte simple'}</span>` : ''}</div>
    </div></div>`;
  $$('[data-c]', el).forEach((b) => (b.onclick = () => {
    const c = b.dataset.c;
    if (c === 'blackout') send('blackout', { on: !st.blackout, fade_ms: 500 });
    else if (c === 'loop') send('loop', { on: !pg.loop });
    else if (c === 'mute') send('mute', { on: !st.muted });
    else if (c === 'skip') send('skip', { dir: 1 });
    else send(c);
  }));
  cmdLine();
}

// ---------- library ----------
function card(v) {
  const dm = onDev(v), dev = device();
  const st = !dev ? '' : !dm ? '<span class="badge">No está en el TV</span>' : dm.state === 'ready' ? '<span class="badge ok">✓ Listo en el TV</span>'
    : dm.state === 'failed' ? `<span class="badge bad" title="${esc(dm.error)}">Falló la copia</span>` : `<span class="badge warn">${dm.state === 'queued' ? 'En cola' : dm.state === 'verifying' ? 'Verificando' : 'Copiando ' + Math.round(dm.progress * 100) + '%'}</span>`;
  return `<article class="card" data-id="${v.id}">
    <div class="thumb" data-a="preview" style="${v.has_thumb ? `background-image:url('${thumb(v)}')` : ''}"><span class="dur">${tc(v.duration_ms)}</span></div>
    <div class="body"><div class="title">${esc(v.title)}</div>
      <div class="small muted">${[res(v.width, v.height), bytes(v.size), date(v.created_at)].filter(Boolean).join(' · ')}</div>
      <div class="row" style="gap:6px">${v.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}${st}</div>
      <div class="acts">${dm?.state === 'ready' ? `<button class="btn sm primary" data-a="play">Reproducir</button>` : dev ? `<button class="btn sm primary" data-a="sync">Enviar al TV</button>` : ''}
        <button class="btn sm" data-a="preview">Ver</button><button class="btn sm" data-a="edit">Editar</button></div></div></article>`;
}
function bindCards(root) {
  $$('[data-a]', root).forEach((b) => (b.onclick = async (e) => {
    e.stopPropagation();
    const v = videoById(b.closest('[data-id]').dataset.id), a = b.dataset.a, d = device();
    if (a === 'preview') return preview(v);
    if (a === 'edit') return editVideo(v);
    if (a === 'sync') { await api(`devices/${d.id}/sync`, { method: 'POST', body: { video_ids: [v.id] } }); toast('En cola para copiarse al TV. Avisará cuando esté listo.'); await refreshVideos(); return route(); }
    if (a === 'play') { location.hash = '#ahora'; return send('play', { video_id: v.id, loop: true }, 'Reproducir ' + v.title); }
  }));
}
function dialog(title, html) { $('#dlgT').textContent = title; $('#dlgB').innerHTML = html; $('#dlg').showModal(); return $('#dlgB'); }
$('#dlgX').onclick = () => { $$('#dlgB video').forEach((x) => x.pause()); $('#dlg').close(); };
$('#dlg').addEventListener('close', () => $$('#dlgB video').forEach((x) => x.pause()));
function preview(v) { dialog(v.title, `<div class="screen"><video src="api/media/${v.id}" controls autoplay muted playsinline preload="metadata"></video></div><p class="small muted">Vista previa en este navegador. No afecta la proyección.</p>`); }
function editVideo(v) {
  const b = dialog('Editar video', `<div class="stack"><div><label class="f">Título</label><input type="text" id="et" value="${esc(v.title)}"></div>
    <div><label class="f">Etiquetas</label><div class="row" id="etags">${[...new Set([...CATEGORIES, ...S.videos.flatMap((x) => x.tags)])].map((t) => `<button class="btn sm ${v.tags.includes(t) ? 'on' : ''}" data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div>
    <input type="text" id="enew" placeholder="Otra etiqueta y Enter" style="margin-top:8px"></div>
    <div class="small muted">Archivo: ${esc(v.filename)} · ${bytes(v.size)} · ${res(v.width, v.height)} ${v.width ? `(${v.width}×${v.height})` : ''} · ${tc(v.duration_ms)}<br>SHA-256: <span class="mono">${esc(v.sha256.slice(0, 16))}…</span></div>
    <div class="row"><button class="btn primary" id="esave">Guardar</button><span class="spacer"></span><button class="btn danger" id="edel">Eliminar</button></div></div>`);
  const tags = new Set(v.tags);
  $$('[data-t]', b).forEach((x) => (x.onclick = () => { const t = x.dataset.t; tags.has(t) ? tags.delete(t) : tags.add(t); x.classList.toggle('on'); }));
  $('#enew').onkeydown = (e) => { if (e.key === 'Enter' && e.target.value.trim()) { const t = e.target.value.trim(); tags.add(t); const nb = document.createElement('button'); nb.className = 'btn sm on'; nb.textContent = t; $('#etags').append(nb); e.target.value = ''; } };
  $('#esave').onclick = async () => { await api('videos/' + v.id, { method: 'PATCH', body: { title: $('#et').value, tags: [...tags] } }); $('#dlg').close(); await refreshVideos(); route(); toast('Guardado'); };
  $('#edel').onclick = async () => { if (!confirm(`¿Eliminar «${v.title}»? Se borra de la nube y de las pantallas (si no está en proyección).`)) return; await api('videos/' + v.id, { method: 'DELETE' }); $('#dlg').close(); await refreshVideos(); route(); toast('Eliminado'); };
}

function biblioteca() {
  const tags = [...new Set([...CATEGORIES, ...S.videos.flatMap((v) => v.tags)])];
  $('#view').innerHTML = `<div class="stack">
    <div class="drop" id="drop"><div style="font-size:17px;color:var(--ink)">Arrastra aquí tus MP4</div><div class="small" style="margin:6px 0 12px">Varios a la vez. Se reanudan si se corta la conexión. Formato recomendado: MP4 H.264, 1080p o 4K.</div><button class="btn primary" id="up2">Elegir archivos</button></div>
    <section class="panel uploads ${S.uploads.length ? '' : 'hide'}" id="uploads"></section>
    <div class="row"><input type="search" id="q" placeholder="Buscar por título o archivo" value="${esc(S.q)}" style="flex:1;min-width:200px">
      <select id="tag" style="width:auto"><option value="">Todas las etiquetas</option>${tags.map((t) => `<option ${S.tag === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
    <div class="grid" id="lib"></div></div>`;
  $('#up2').onclick = () => $('#picker').click();
  $('#q').oninput = (e) => { S.q = e.target.value; libGrid(); };
  $('#tag').onchange = (e) => { S.tag = e.target.value; libGrid(); };
  libGrid(); uploadsPanel();
}
function libGrid() {
  const q = S.q.toLowerCase();
  const list = S.videos.filter((v) => (!q || (v.title + ' ' + v.filename).toLowerCase().includes(q)) && (!S.tag || v.tags.includes(S.tag)));
  $('#lib').innerHTML = list.map(card).join('') || `<p class="muted">${S.videos.length ? 'Nada coincide.' : 'La biblioteca está vacía.'}</p>`;
  bindCards($('#lib'));
}

// ---------- uploads: R2 multipart in 32 MiB parts, resumable, hashed as they go ----------
const upKey = (f) => `cs.up:${f.name}:${f.size}:${f.lastModified}`;
function addFiles(files) {
  for (const f of files) {
    if (!/\.(mp4|m4v)$/i.test(f.name)) { toast(`«${f.name}» no es MP4`); continue; }
    S.uploads.push({ file: f, name: f.name, size: f.size, done: 0, status: 'En cola', err: '' });
  }
  if (current !== 'biblioteca') location.hash = '#biblioteca'; else uploadsPanel();
  pump();
}
let pumping = false;
async function pump() {
  if (pumping) return; pumping = true;
  try { for (const u of S.uploads) if (u.status === 'En cola') await upload(u); } finally { pumping = false; }
}
function uploadsPanel() {
  const el = $('#uploads'); if (!el) return;
  el.classList.toggle('hide', !S.uploads.length);
  el.innerHTML = `<h2>Subidas</h2>` + S.uploads.map((u, i) => `<div class="up"><div><div>${esc(u.name)}</div><div class="bar" style="margin-top:6px"><i style="width:${(u.done / u.size) * 100}%"></i></div></div>
    <div class="small ${u.err ? '' : 'muted'}" style="text-align:right;min-width:130px">${u.err ? `<span style="color:var(--live)">${esc(u.err)}</span> <button class="btn sm" data-retry="${i}">Reintentar</button>` : esc(u.status)}<br><span class="mono tiny">${bytes(u.done)} / ${bytes(u.size)}</span></div></div>`).join('');
  $$('[data-retry]', el).forEach((b) => (b.onclick = () => { const u = S.uploads[b.dataset.retry]; u.err = ''; u.status = 'En cola'; uploadsPanel(); pump(); }));
}
function meta(file) {
  // Duration, size and a thumbnail from the browser's own decoder: no video-processing service needed.
  return new Promise((resolve) => {
    const v = document.createElement('video'), url = URL.createObjectURL(file), out = { duration_ms: 0, width: 0, height: 0, thumb: null };
    const done = () => { URL.revokeObjectURL(url); resolve(out); };
    v.muted = true; v.preload = 'auto'; v.src = url;
    const t = setTimeout(done, 15000);
    v.onerror = () => { clearTimeout(t); done(); };
    v.onloadedmetadata = () => { out.duration_ms = Math.round(v.duration * 1000) || 0; out.width = v.videoWidth; out.height = v.videoHeight; v.currentTime = Math.min(2, (v.duration || 0) * 0.1); };
    v.onseeked = () => {
      try {
        const c = document.createElement('canvas'), w = 640; c.width = w; c.height = Math.round(w * (v.videoHeight || 9) / (v.videoWidth || 16));
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        c.toBlob((b) => { out.thumb = b; clearTimeout(t); done(); }, 'image/jpeg', 0.82);
      } catch { clearTimeout(t); done(); }
    };
  });
}
function putPart(url, blob, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url); x.setRequestHeader('X-Contemplo', '1');
    x.upload.onprogress = (e) => onProgress(e.loaded);
    x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch { /* */ } x.status < 300 ? resolve(d) : reject(new Error(d.error || 'Error ' + x.status)); };
    x.onerror = () => reject(new Error('Se cortó la conexión'));
    x.send(blob);
  });
}
async function upload(u) {
  const f = u.file;
  try {
    u.status = 'Leyendo video…'; uploadsPanel();
    const m = await meta(f);
    if (!m.width) u.status = 'El navegador no puede leer este video (¿HEVC?). Se sube igual.';
    let st = JSON.parse(localStorage.getItem(upKey(f)) || 'null');
    if (!st) {
      const c = await api('uploads', { method: 'POST', body: { filename: f.name, size: f.size, type: f.type } });
      st = { id: c.id, partSize: c.partSize, parts: [] };
      localStorage.setItem(upKey(f), JSON.stringify(st));
    }
    const total = Math.ceil(f.size / st.partSize), hash = new Sha256();
    for (let n = 1; n <= total; n++) {
      const start = (n - 1) * st.partSize, blob = f.slice(start, Math.min(f.size, start + st.partSize));
      const buf = new Uint8Array(await blob.arrayBuffer());
      for (let i = 0; i < buf.length; i += 4 << 20) { hash.update(buf.subarray(i, i + (4 << 20))); await new Promise((r) => setTimeout(r)); }
      if (!st.parts.some((p) => p.partNumber === n)) {
        let part, tries = 0;
        for (;;) {
          try { u.status = `Subiendo parte ${n} de ${total}`; uploadsPanel(); part = await putPart(`api/uploads/${st.id}/part/${n}`, blob, (l) => { u.done = start + l; uploadsPanel(); }); break; }
          catch (e) { if (/ya no existe/.test(e.message)) { localStorage.removeItem(upKey(f)); throw e; } if (++tries >= 4) throw e; u.status = `Reintentando parte ${n}…`; uploadsPanel(); await new Promise((r) => setTimeout(r, 2000 * tries)); }
        }
        st.parts.push(part); localStorage.setItem(upKey(f), JSON.stringify(st));
      }
      u.done = Math.min(f.size, start + st.partSize); uploadsPanel();
    }
    u.status = 'Terminando…'; uploadsPanel();
    const v = await api(`uploads/${st.id}/complete`, { method: 'POST', body: { parts: st.parts, sha256: hash.hex(), duration_ms: m.duration_ms, width: m.width, height: m.height } });
    localStorage.removeItem(upKey(f));
    if (m.thumb) await fetch(`api/thumb/${v.id}`, { method: 'PUT', headers: { 'content-type': 'image/jpeg', 'X-Contemplo': '1' }, body: m.thumb }).catch(() => {});
    u.status = '✓ Listo en la biblioteca'; u.file = null;
    await refreshVideos(); if (current === 'biblioteca') libGrid(); uploadsPanel();
  } catch (e) { u.err = e.message; u.status = 'En pausa'; uploadsPanel(); }
}
$('#picker').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
document.addEventListener('dragover', (e) => { e.preventDefault(); $('#drop')?.classList.add('over'); });
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) $('#drop')?.classList.remove('over'); });
document.addEventListener('drop', (e) => { e.preventDefault(); $('#drop')?.classList.remove('over'); if (e.dataTransfer?.files?.length) addFiles([...e.dataTransfer.files]); });
window.addEventListener('beforeunload', (e) => { if (S.uploads.some((u) => u.file && !u.err && u.status !== 'En cola' && !u.status.startsWith('✓'))) { e.preventDefault(); e.returnValue = ''; } });

// ---------- playlists / run-of-show ----------
function listas() {
  const id = location.hash.split('/')[1];
  if (id) return editList(S.playlists.find((p) => p.id === id));
  $('#view').innerHTML = `<div class="stack"><div class="row"><h2 style="margin:0">Listas y guiones de show</h2><span class="spacer"></span><button class="btn primary" id="newl">Nueva lista</button></div>
    <section class="panel list">${S.playlists.map((p) => `<div class="li"><div style="flex:1"><div style="font-weight:600">${esc(p.name)}</div><div class="small muted">${p.mode === 'show' ? 'Show (cue por cue)' : 'Ambiente (se repite sola)'} · ${p.items.length} escenas · ${tc(p.items.reduce((s, i) => s + (videoById(i.video_id)?.duration_ms || 0), 0))}</div></div>
      <a class="btn sm" href="#listas/${p.id}">Editar</a>${p.mode === 'show' ? `<a class="btn sm primary" href="#vivo/${p.id}">En vivo</a>` : `<button class="btn sm primary" data-play="${p.id}">Reproducir</button>`}</div>`).join('') || '<p class="muted">Sin listas todavía.</p>'}</section></div>`;
  $('#newl').onclick = async () => { const r = await api('playlists', { method: 'POST', body: { name: 'Nueva lista', mode: 'show' } }); S.playlists = (await api('playlists')).playlists; location.hash = '#listas/' + r.id; };
  $$('[data-play]').forEach((b) => (b.onclick = () => playList(S.playlists.find((p) => p.id === b.dataset.play))));
}
async function playList(p) {
  const d = device(); if (!d) return toast('Vincula una pantalla primero');
  const missing = p.items.filter((i) => onDev(videoById(i.video_id) || { devices: [] })?.state !== 'ready');
  if (missing.length) {
    if (!confirm(`${missing.length} video(s) de esta lista aún no están en el TV. ¿Enviarlos ahora? La lista arrancará cuando todos estén verificados.`)) return;
    await api(`devices/${d.id}/sync`, { method: 'POST', body: { video_ids: p.items.map((i) => i.video_id) } });
    return toast('Copiando al TV. Vuelve a dar Reproducir cuando todos digan ✓ Listo.');
  }
  location.hash = '#ahora';
  send('play_playlist', { playlist_id: p.id }, 'Reproducir ' + p.name);
}
function editList(p) {
  if (!p) { location.hash = '#listas'; return; }
  const L = S.editing && S.editing.id === p.id ? S.editing : (S.editing = JSON.parse(JSON.stringify(p)));
  $('#view').innerHTML = `<div class="stack"><div class="row"><a class="btn sm ghost" href="#listas">← Listas</a><span class="spacer"></span><span class="small muted" id="dirty"></span><button class="btn primary" id="save">Guardar</button></div>
    <section class="panel stack"><div class="row" style="align-items:flex-end"><div style="flex:2;min-width:220px"><label class="f">Nombre</label><input type="text" id="ln" value="${esc(L.name)}"></div>
      <div><label class="f">Tipo</label><select id="lm"><option value="show" ${L.mode === 'show' ? 'selected' : ''}>Show: cue por cue (GO)</option><option value="ambient" ${L.mode === 'ambient' ? 'selected' : ''}>Ambiente: corre sola</option></select></div>
      <label class="row small"><input type="checkbox" id="ll" ${L.loop ? 'checked' : ''}> Repetir la lista al terminar</label></div></section>
    <section class="panel"><h2>Escenas</h2><div class="list" id="items"></div>
      <div class="row" style="margin-top:12px"><select id="addv" style="flex:1"><option value="">+ Agregar video…</option>${S.videos.map((v) => `<option value="${v.id}">${esc(v.title)} · ${tc(v.duration_ms)}</option>`).join('')}</select></div></section>
    <div class="row"><button class="btn" id="sync">Enviar todos al TV</button><button class="btn" id="dup">Duplicar</button><span class="spacer"></span><button class="btn danger" id="del">Eliminar lista</button></div></div>`;
  const dirty = () => ($('#dirty').textContent = 'Cambios sin guardar');
  const draw = () => {
    $('#items').innerHTML = L.items.map((it, i) => { const v = videoById(it.video_id) || {}; const dm = v.devices ? onDev(v) : null;
      return `<div class="li" draggable="true" data-i="${i}"><span class="handle">⠿</span><span class="num mono muted">${i + 1}</span><div class="mini" style="${v.has_thumb ? `background-image:url('${thumb(v)}')` : ''}"></div>
      <div style="flex:1;min-width:160px"><input type="text" value="${esc(it.label)}" placeholder="${esc(v.title || 'Video eliminado')}" data-k="label"><div class="tiny muted" style="margin-top:4px">${esc(v.title || '')} · ${tc(v.duration_ms)} ${dm?.state === 'ready' ? '· <span style="color:var(--ok)">✓ en el TV</span>' : '· no está en el TV'}</div></div>
      <div><label class="f">Entrada</label><select data-k="transition"><option value="cut" ${it.transition === 'cut' ? 'selected' : ''}>Corte</option><option value="fade" ${it.transition === 'fade' ? 'selected' : ''}>Fundido</option></select></div>
      <div style="width:84px"><label class="f">ms</label><input type="number" min="0" max="10000" step="100" value="${it.fade_ms}" data-k="fade_ms"></div>
      <div><label class="f">Al terminar</label><select data-k="end_action">${[['loop', 'Repetir'], ['hold', 'Congelar'], ['black', 'Negro'], ['next', 'Siguiente']].map(([k, w]) => `<option value="${k}" ${it.end_action === k ? 'selected' : ''}>${w}</option>`).join('')}</select></div>
      <div class="row" style="gap:4px"><button class="btn sm" data-mv="-1">↑</button><button class="btn sm" data-mv="1">↓</button><button class="btn sm danger" data-rm>✕</button></div></div>`; }).join('') || '<p class="muted">Agrega videos abajo.</p>';
    $$('#items .li').forEach((row) => {
      const i = Number(row.dataset.i);
      $$('[data-k]', row).forEach((x) => (x.onchange = x.oninput = () => { L.items[i][x.dataset.k] = x.type === 'number' ? Number(x.value) : x.value; dirty(); }));
      $$('[data-mv]', row).forEach((b) => (b.onclick = () => { const j = i + Number(b.dataset.mv); if (j < 0 || j >= L.items.length) return; [L.items[i], L.items[j]] = [L.items[j], L.items[i]]; dirty(); draw(); }));
      $('[data-rm]', row).onclick = () => { L.items.splice(i, 1); dirty(); draw(); };
      row.ondragstart = (e) => { e.dataTransfer.setData('text/plain', i); row.classList.add('drag'); };
      row.ondragend = () => row.classList.remove('drag');
      row.ondragover = (e) => { e.preventDefault(); e.stopPropagation(); row.classList.add('over'); };
      row.ondragleave = () => row.classList.remove('over');
      row.ondrop = (e) => { e.preventDefault(); e.stopPropagation(); const from = Number(e.dataTransfer.getData('text/plain')); if (Number.isNaN(from)) return; const [m] = L.items.splice(from, 1); L.items.splice(i, 0, m); dirty(); draw(); };
    });
  };
  draw();
  $('#ln').oninput = (e) => { L.name = e.target.value; dirty(); };
  $('#lm').onchange = (e) => { L.mode = e.target.value; dirty(); };
  $('#ll').onchange = (e) => { L.loop = e.target.checked; dirty(); };
  $('#addv').onchange = (e) => { if (!e.target.value) return; L.items.push({ video_id: e.target.value, label: '', transition: 'cut', fade_ms: 1000, end_action: L.mode === 'show' ? 'hold' : 'next' }); e.target.value = ''; dirty(); draw(); };
  $('#save').onclick = async () => { await api('playlists/' + p.id, { method: 'PUT', body: L }); S.playlists = (await api('playlists')).playlists; S.editing = null; toast('Lista guardada'); editList(S.playlists.find((x) => x.id === p.id)); };
  $('#dup').onclick = async () => { const r = await api('playlists', { method: 'POST', body: { name: L.name + ' (copia)', mode: L.mode, loop: L.loop, copy_from: p.id } }); S.playlists = (await api('playlists')).playlists; S.editing = null; location.hash = '#listas/' + r.id; };
  $('#del').onclick = async () => { if (!confirm('¿Eliminar esta lista? Los videos se quedan en la biblioteca.')) return; await api('playlists/' + p.id, { method: 'DELETE' }); S.playlists = (await api('playlists')).playlists; S.editing = null; location.hash = '#listas'; };
  $('#sync').onclick = async () => { const d = device(); if (!d) return toast('Vincula una pantalla'); await api(`devices/${d.id}/sync`, { method: 'POST', body: { video_ids: L.items.map((i) => i.video_id) } }); toast('Enviando al TV'); await refreshVideos(); draw(); };
}

// ---------- live (cloud fallback) ----------
function vivo() {
  const d = device(), pl = location.hash.split('/')[1] || '';
  $('#view').innerHTML = `<div class="stack"><section class="panel stack"><h2>Control en vivo</h2>
    <p>Para el show usa el <strong>control por Wi-Fi</strong>: lo sirve el propio Google TV, responde al instante y funciona aunque se caiga el internet.</p>
    ${d?.lan_url ? `<div class="row"><a class="btn primary" href="${esc(d.lan_url)}${pl ? '#' + pl : ''}" target="_blank" rel="noopener">Abrir control por Wi-Fi · ${esc(d.lan_url)}</a><span class="small muted">PIN del show: <span class="mono" style="color:var(--ink)">${esc(d.show_pin)}</span></span></div>
      <p class="small muted">Abre esa dirección en un teléfono o laptop conectado a la misma red Wi-Fi que el TV.</p>` : '<p class="muted">El TV todavía no ha reportado su dirección en la red.</p>'}
    <div class="row"><a class="btn" href="show.html?d=${esc(d?.id || '')}${pl ? '#' + pl : ''}" target="_blank" rel="noopener">Control vía nube (respaldo, ~3 s de retraso)</a></div></section></div>`;
}

// ---------- devices ----------
async function pantallas() {
  const el = $('#view');
  const blocks = await Promise.all(S.devices.map(async (d) => {
    const [media, ev] = await Promise.all([api(`devices/${d.id}/media`).catch(() => ({ media: [] })), api(`devices/${d.id}/events`).catch(() => ({ events: [] }))]);
    const s = d.storage || {}, used = s.total ? (s.total - s.free) / s.total : 0;
    return `<section class="panel stack" data-dev="${d.id}"><div class="row"><span class="dot ${d.online ? 'ok' : 'bad'}"></span><strong style="font-size:18px">${esc(d.name)}</strong><span class="muted small">${d.online ? 'En línea' : 'Sin conexión · visto ' + ago(d.last_seen)}</span><span class="spacer"></span>
      ${S.devices.length > 1 ? `<button class="btn sm ${d.id === S.dev ? 'on' : ''}" data-use>${d.id === S.dev ? 'Pantalla activa' : 'Usar esta'}</button>` : ''}<button class="btn sm" data-ren>Renombrar</button><button class="btn sm" data-idf>Identificar</button></div>
      <div class="row small"><span class="badge">${esc(d.model || 'Google TV')}</span><span class="badge">App ${esc(d.app_version || '?')}</span>${d.lan_url ? `<span>Wi-Fi: <a href="${esc(d.lan_url)}" target="_blank" rel="noopener" class="mono">${esc(d.lan_url)}</a></span>` : ''}
        <span>PIN del show: <span class="mono">${esc(d.show_pin)}</span> <button class="btn sm ghost" data-pin>Cambiar</button></span></div>
      ${s.total ? `<div><div class="row small" style="justify-content:space-between"><span>Almacenamiento</span><span class="mono">${bytes(s.free)} libres de ${bytes(s.total)}</span></div><div class="storage" style="margin-top:4px"><i style="width:${used * 100}%"></i></div></div>` : ''}
      ${d.last_error ? `<div class="badge bad" style="white-space:normal">Último error: ${esc(d.last_error)}</div>` : ''}
      <div><h2>Videos en esta pantalla</h2><div class="list">${media.media.map((x) => `<div class="li"><div style="flex:1">${esc(x.title)} <span class="muted small">${bytes(x.size)}</span></div>${x.state === 'ready' ? '<span class="badge ok">✓ Listo</span>' : x.state === 'failed' ? `<span class="badge bad">${esc(x.error || 'Falló')}</span>` : `<span class="badge warn">${x.state === 'queued' ? 'En cola' : x.state === 'verifying' ? 'Verificando' : 'Copiando ' + Math.round(x.progress * 100) + '%'}</span>`}<button class="btn sm ghost" data-unsync="${x.video_id}">Quitar</button></div>`).join('') || '<p class="muted small">Ninguno. Usa «Enviar al TV» en la Biblioteca.</p>'}</div></div>
      <details><summary class="small muted">Diagnóstico y bitácora</summary><div class="cmdlog" style="margin-top:8px">${ev.events.map((e) => `<div><span class="muted">${new Date(e.at).toLocaleString('es-MX')}</span><span>${esc(e.kind)}</span><span class="muted">${esc(e.detail)}</span></div>`).join('') || '<div class="muted">Sin eventos</div>'}</div>
        <pre class="tiny muted" style="white-space:pre-wrap">${esc(JSON.stringify(d.state, null, 1))}</pre></details>
      ${S.me?.role === 'admin' ? '<div><button class="btn sm danger" data-unpair>Desvincular pantalla</button></div>' : ''}</section>`;
  }));
  if (current !== 'pantallas') return;
  el.innerHTML = `<div class="stack">${blocks.join('')}
    <section class="panel stack"><h2>Vincular un Google TV</h2><p class="small muted">Abre <strong>Contemplo Studio</strong> en el Google TV. Aparece un código de 6 dígitos.</p>
      <div class="row"><input type="text" id="pc" inputmode="numeric" maxlength="6" placeholder="000000" class="mono" style="width:160px;font-size:22px;letter-spacing:.2em;text-align:center"><input type="text" id="pn" placeholder="Nombre: Contemplo Main" style="flex:1;min-width:180px"><button class="btn primary" id="pair">Vincular</button></div></section></div>`;
  $('#pair').onclick = async () => { try { const d = await api('devices/pair', { method: 'POST', body: { code: $('#pc').value, name: $('#pn').value || 'Contemplo Main' } }); S.dev = d.id; localStorage.setItem('cs.dev', d.id); toast('¡Vinculado! El TV se conecta en unos segundos.'); await refreshDevices(); pantallas(); } catch (e) { toast(e.message, 5000); } };
  $$('[data-dev]').forEach((sec) => {
    const d = S.devices.find((x) => x.id === sec.dataset.dev);
    const q = (s) => sec.querySelector(s);
    q('[data-use]') && (q('[data-use]').onclick = () => { S.dev = d.id; localStorage.setItem('cs.dev', d.id); chip(); pantallas(); });
    q('[data-ren]').onclick = async () => { const n = prompt('Nombre de la pantalla', d.name); if (n) { await api('devices/' + d.id, { method: 'PATCH', body: { name: n } }); await refreshDevices(); pantallas(); } };
    q('[data-pin]').onclick = async () => { const n = prompt('Nuevo PIN del show (4 a 8 dígitos). Deja vacío para generar uno.', ''); if (n === null) return; await api('devices/' + d.id, { method: 'PATCH', body: { show_pin: n || 'new' } }); await refreshDevices(); pantallas(); toast('El TV recibe el PIN nuevo en unos segundos'); };
    q('[data-idf]').onclick = () => { S.dev = d.id; send('identify', {}, 'Identificar'); toast('El nombre aparece 5 s en la proyección'); };
    $$('[data-unsync]', sec).forEach((b) => (b.onclick = async () => { await api(`devices/${d.id}/sync/${b.dataset.unsync}`, { method: 'DELETE' }); await refreshVideos(); pantallas(); }));
    q('[data-unpair]') && (q('[data-unpair]').onclick = async () => { if (!confirm(`¿Desvincular ${d.name}? Habrá que volver a vincularla con un código.`)) return; await api('devices/' + d.id, { method: 'DELETE' }); await refreshDevices(); pantallas(); });
  });
}

function programacion() {
  $('#view').innerHTML = `<section class="panel stack"><h2>Programación</h2><p>Llega en la fase 3, cuando la reproducción básica esté probada en eventos: listas por fecha y hora (zona America/Mexico_City), diarias o semanales, con anulación manual.</p>
    <p class="muted small">Regla ya decidida: un show iniciado a mano nunca se interrumpe por una lista programada.</p></section>`;
}
function guia() {
  $('#view').innerHTML = `<div class="stack"><section class="panel stack"><h2>Uso diario</h2><ol class="check">
    <li>Sube el MP4 (Biblioteca → arrastra el archivo).</li><li>En el video: <strong>Enviar al TV</strong>. Espera <span class="badge ok">✓ Listo en el TV</span>: ya está copiado y verificado.</li>
    <li><strong>Reproducir</strong>: se repite sin fin hasta que lo cambies. Si se cae el internet, sigue proyectando.</li>
    <li>Show en vivo: abre el control por Wi-Fi (En vivo). CUE prepara, GO lanza, NEGRO apaga la imagen.</li></ol></section>
    <section class="panel stack"><h2>Lista de revisión HDMI y proyector</h2><ol class="check">
    <li>Google TV → Ajustes → Pantalla y sonido → Avanzado → Resolución: fija la del proyector (por ejemplo 1080p 60 Hz) en lugar de automática si el splitter duda.</li>
    <li>Formato dinámico / HDR: desactívalo (Ajustes → Pantalla y sonido → Formato de pantalla avanzado) para que el color no cambie entre videos.</li>
    <li>Splitter: cada salida duplica la misma señal; no hay imágenes independientes por salida.</li>
    <li>Prueba: reproduce un video y luego NEGRO. Los proyectores deben mantener la señal (negro, no «sin señal»).</li>
    <li>Ahorro de energía: Ajustes → Sistema → Energía → «Apagar pantalla» y protector en Nunca. La app ya evita que el TV se duerma mientras proyecta.</li>
    <li>Monitor de confianza abajo: usa una salida libre del splitter hacia un monitor, o una capturadora HDMI-USB en la laptop del operador.</li>
    <li>Red: reserva la IP del Google TV en Omada (DHCP fijo) para que la dirección del control no cambie.</li></ol></section>
    <section class="panel stack"><h2>Si algo falla</h2><ul class="check">
    <li><strong>Pantalla sin conexión</strong>: revisa que la app esté abierta en el TV. Lo que ya está copiado sigue proyectándose sin internet.</li>
    <li><strong>Orden «No se entregó»</strong>: el TV no respondió en 90 s; la orden se descarta para que nada arranque solo después. Usa Reintentar.</li>
    <li><strong>Tras un apagón</strong>: la app intenta abrir sola y retomar lo último. Si no, abre Contemplo Studio desde Apps.</li>
    <li><strong>Copia fallida</strong>: suele ser falta de espacio. Mira Pantallas → Almacenamiento y quita videos que no uses.</li></ul></section></div>`;
}

// ---------- boot ----------
(async () => {
  try { await loadAll(); } catch (e) { $('#view').innerHTML = `<section class="panel"><p>${esc(e.message)}</p></section>`; return; }
  chip(); route();
  window.addEventListener('hashchange', route);
  setInterval(async () => { if (document.visibilityState !== 'visible') return; await refreshDevices(); if (current === 'ahora') nowPanel(); }, 3000);
  setInterval(async () => { if (document.visibilityState !== 'visible' || current !== 'biblioteca' || S.uploads.some((u) => u.file)) return; await refreshVideos(); libGrid(); }, 6000);
})();
