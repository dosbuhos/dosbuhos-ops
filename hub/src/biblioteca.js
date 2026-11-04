// Biblioteca — document library inside the Hub. Page /biblioteca/, JSON under /biblioteca/api/, files under /biblioteca/f/<id>.
// Roles (grant on the 'biblioteca' app; Hub admins always admin): viewer reads and downloads; editor also adds documents,
// versions and files; admin also archives and deletes. Files are stored as BLOB chunks in D1 (lib_chunks).
import { audit } from './auth.js';

export const CATEGORIES = [
  ['politicas', 'Políticas'],
  ['procedimientos', 'Procedimientos'],
  ['contratos', 'Contratos y convenios'],
  ['formatos', 'Formatos y plantillas'],
  ['propuestas', 'Propuestas y cotizaciones'],
  ['presentaciones', 'Presentaciones'],
  ['planes', 'Planes y estrategia'],
  ['legal', 'Legal y fiscal'],
  ['marca', 'Marca y diseño'],
  ['otros', 'Otros'],
];
const CAT = new Set(CATEGORIES.map(c => c[0]));
const STATUS = new Set(['borrador', 'vigente', 'archivado']);
const CHUNK = 900 * 1024;           // D1 rows top out at 2 MB
const MAX_FILE = 25 * 1024 * 1024;

const J = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const str = (v, max = 300) => String(v ?? '').trim().slice(0, max);
const err = (message, status = 400, code = 'bad_request') => J({ code, message }, status);

export async function bibliotecaRoute(request, env, url, user, role) {
  const p = url.pathname, m = request.method;
  if (p === '/biblioteca') return Response.redirect(url.origin + '/biblioteca/' + url.search, 302);
  const canEdit = role === 'admin' || role === 'editor', isAdmin = role === 'admin';

  // A file: inline (PDF opens in the browser) or ?dl=1 to download.
  let mm = p.match(/^\/biblioteca\/f\/(\d+)(?:\/[^/]*)?$/);
  if (mm && m === 'GET') return serveFile(env, Number(mm[1]), url.searchParams.has('dl'));

  if (!p.startsWith('/biblioteca/api/')) {
    const res = await env.ASSETS.fetch(new Request(new URL('/biblioteca.html', request.url), { headers: request.headers }));
    return new Response(res.body, { status: res.status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
  }
  const body = async () => { try { return await request.json(); } catch { return {}; } };
  const now = Date.now();

  if (p === '/biblioteca/api/docs' && m === 'GET') {
    const docs = (await env.DB.prepare(`SELECT d.*, v.id AS vid, v.version, v.created_at AS v_at,
        (SELECT COUNT(*) FROM lib_versions WHERE doc_id = d.id) AS n_versions
      FROM lib_docs d LEFT JOIN lib_versions v ON v.id = (SELECT id FROM lib_versions WHERE doc_id = d.id ORDER BY created_at DESC, id DESC LIMIT 1)
      ORDER BY d.updated_at DESC`).all()).results;
    const vids = docs.map(d => d.vid).filter(Boolean);
    const files = vids.length ? (await env.DB.prepare(`SELECT id, version_id, filename, mime, size FROM lib_files WHERE chunks > 0 AND version_id IN (${vids.map(() => '?').join(',')}) ORDER BY id`).bind(...vids).all()).results : [];
    for (const d of docs) d.files = files.filter(f => f.version_id === d.vid);
    return J({ role, me: { email: user.email, name: user.name }, categories: CATEGORIES, docs });
  }

  mm = p.match(/^\/biblioteca\/api\/docs\/(\d+)$/);
  if (mm && m === 'GET') {
    const id = Number(mm[1]);
    const doc = await env.DB.prepare('SELECT * FROM lib_docs WHERE id = ?').bind(id).first();
    if (!doc) return err('No existe.', 404, 'not_found');
    const versions = (await env.DB.prepare('SELECT * FROM lib_versions WHERE doc_id = ? ORDER BY created_at DESC, id DESC').bind(id).all()).results;
    const files = (await env.DB.prepare('SELECT f.id, f.version_id, f.filename, f.mime, f.size FROM lib_files f JOIN lib_versions v ON v.id = f.version_id WHERE v.doc_id = ? AND f.chunks > 0 ORDER BY f.id').bind(id).all()).results;
    for (const v of versions) v.files = files.filter(f => f.version_id === v.id);
    return J({ doc, versions });
  }

  if (!canEdit) return err('Solo lectura.', 403, 'not_granted');

  // Create a document (optionally with its first version).
  if (p === '/biblioteca/api/docs' && m === 'POST') {
    const b = await body();
    const title = str(b.title, 200); if (!title) return err('Falta el título.');
    const cat = CAT.has(b.category) ? b.category : 'otros';
    const st = STATUS.has(b.status) ? b.status : 'vigente';
    const r = await env.DB.prepare('INSERT INTO lib_docs (title, category, summary, status, audience, tags, link, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(title, cat, str(b.summary, 2000), st, str(b.audience, 300), str(b.tags, 300), str(b.link, 500), user.email, now, now).run();
    const id = r.meta.last_row_id;
    let vid = null;
    if (b.version) vid = await addVersion(env, id, str(b.version, 20), str(b.note, 1000), user.email, now);
    await audit(env, user.email, 'lib.doc.add', String(id), title);
    return J({ ok: true, id, version_id: vid });
  }

  if (mm && m === 'PATCH') {
    const id = Number(mm[1]), b = await body();
    const doc = await env.DB.prepare('SELECT * FROM lib_docs WHERE id = ?').bind(id).first();
    if (!doc) return err('No existe.', 404, 'not_found');
    if (b.status === 'archivado' && !isAdmin) return err('Solo un administrador archiva.', 403, 'not_granted');
    const v = {
      title: b.title !== undefined ? str(b.title, 200) || doc.title : doc.title,
      category: CAT.has(b.category) ? b.category : doc.category,
      summary: b.summary !== undefined ? str(b.summary, 2000) : doc.summary,
      status: STATUS.has(b.status) ? b.status : doc.status,
      audience: b.audience !== undefined ? str(b.audience, 300) : doc.audience,
      tags: b.tags !== undefined ? str(b.tags, 300) : doc.tags,
      link: b.link !== undefined ? str(b.link, 500) : doc.link,
    };
    await env.DB.prepare('UPDATE lib_docs SET title = ?, category = ?, summary = ?, status = ?, audience = ?, tags = ?, link = ?, updated_at = ? WHERE id = ?')
      .bind(v.title, v.category, v.summary, v.status, v.audience, v.tags, v.link, now, id).run();
    await audit(env, user.email, 'lib.doc.update', String(id), v.title);
    return J({ ok: true });
  }

  if (mm && m === 'DELETE') {
    if (!isAdmin) return err('Solo un administrador borra.', 403, 'not_granted');
    const id = Number(mm[1]);
    await deleteDocFiles(env, 'SELECT f.id FROM lib_files f JOIN lib_versions v ON v.id = f.version_id WHERE v.doc_id = ?', id);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM lib_versions WHERE doc_id = ?').bind(id),
      env.DB.prepare('DELETE FROM lib_docs WHERE id = ?').bind(id),
    ]);
    await audit(env, user.email, 'lib.doc.delete', String(id));
    return J({ ok: true });
  }

  // New version of a document.
  mm = p.match(/^\/biblioteca\/api\/docs\/(\d+)\/versions$/);
  if (mm && m === 'POST') {
    const id = Number(mm[1]), b = await body();
    if (!(await env.DB.prepare('SELECT id FROM lib_docs WHERE id = ?').bind(id).first())) return err('No existe.', 404, 'not_found');
    const ver = str(b.version, 20); if (!ver) return err('Falta el número de versión.');
    if (await env.DB.prepare('SELECT id FROM lib_versions WHERE doc_id = ? AND version = ?').bind(id, ver).first()) return err(`La versión ${ver} ya existe.`);
    const vid = await addVersion(env, id, ver, str(b.note, 1000), user.email, now);
    await env.DB.prepare('UPDATE lib_docs SET updated_at = ? WHERE id = ?').bind(now, id).run();
    await audit(env, user.email, 'lib.version.add', String(id), ver);
    return J({ ok: true, version_id: vid });
  }

  // Upload one file into a version: raw body, ?name=<filename>, content-type header.
  mm = p.match(/^\/biblioteca\/api\/versions\/(\d+)\/files$/);
  if (mm && m === 'POST') {
    const vid = Number(mm[1]);
    const ver = await env.DB.prepare('SELECT id, doc_id FROM lib_versions WHERE id = ?').bind(vid).first();
    if (!ver) return err('No existe esa versión.', 404, 'not_found');
    const name = str(url.searchParams.get('name'), 200).replace(/[\\/]/g, '-') || 'archivo';
    const mime = str(request.headers.get('content-type'), 120) || 'application/octet-stream';
    const buf = new Uint8Array(await request.arrayBuffer());
    if (!buf.length) return err('Archivo vacío.');
    if (buf.length > MAX_FILE) return err('Máximo 25 MB por archivo.');
    const r = await env.DB.prepare('INSERT INTO lib_files (version_id, filename, mime, size, chunks, created_at) VALUES (?, ?, ?, ?, 0, ?)').bind(vid, name, mime, buf.length, now).run();
    const fid = r.meta.last_row_id, n = Math.ceil(buf.length / CHUNK);
    for (let i = 0; i < n; i++) await env.DB.prepare('INSERT INTO lib_chunks (file_id, idx, data) VALUES (?, ?, ?)').bind(fid, i, buf.slice(i * CHUNK, (i + 1) * CHUNK)).run();
    await env.DB.batch([
      env.DB.prepare('UPDATE lib_files SET chunks = ? WHERE id = ?').bind(n, fid),
      env.DB.prepare('UPDATE lib_docs SET updated_at = ? WHERE id = ?').bind(now, ver.doc_id),
    ]);
    await audit(env, user.email, 'lib.file.add', String(ver.doc_id), name);
    return J({ ok: true, file_id: fid });
  }

  mm = p.match(/^\/biblioteca\/api\/files\/(\d+)$/);
  if (mm && m === 'DELETE') {
    if (!isAdmin) return err('Solo un administrador borra.', 403, 'not_granted');
    const fid = Number(mm[1]);
    await env.DB.batch([env.DB.prepare('DELETE FROM lib_chunks WHERE file_id = ?').bind(fid), env.DB.prepare('DELETE FROM lib_files WHERE id = ?').bind(fid)]);
    await audit(env, user.email, 'lib.file.delete', String(fid));
    return J({ ok: true });
  }

  return err('No encontrado.', 404, 'not_found');
}

async function addVersion(env, docId, version, note, by, now) {
  const r = await env.DB.prepare('INSERT INTO lib_versions (doc_id, version, note, created_by, created_at) VALUES (?, ?, ?, ?, ?)').bind(docId, version, note, by, now).run();
  return r.meta.last_row_id;
}

async function deleteDocFiles(env, sql, id) {
  const ids = (await env.DB.prepare(sql).bind(id).all()).results.map(r => r.id);
  for (const fid of ids) await env.DB.batch([env.DB.prepare('DELETE FROM lib_chunks WHERE file_id = ?').bind(fid), env.DB.prepare('DELETE FROM lib_files WHERE id = ?').bind(fid)]);
}

async function serveFile(env, id, download) {
  const f = await env.DB.prepare('SELECT * FROM lib_files WHERE id = ?').bind(id).first();
  if (!f || !f.chunks) return new Response('No existe.', { status: 404 });
  const parts = [];
  for (let i = 0; i < f.chunks; i++) {
    const c = await env.DB.prepare('SELECT data FROM lib_chunks WHERE file_id = ? AND idx = ?').bind(id, i).first();
    if (!c) return new Response('Archivo incompleto.', { status: 500 });
    parts.push(toBytes(c.data));
  }
  const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0)); let o = 0;
  for (const part of parts) { out.set(part, o); o += part.length; }
  const inline = !download && /^(application\/pdf|image\/|text\/plain)/.test(f.mime);
  return new Response(out, { headers: {
    'content-type': f.mime, 'content-length': String(out.length), 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex',
    'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
  } });
}
// D1 hands BLOBs back as an array of numbers (or an ArrayBuffer, depending on the runtime).
function toBytes(d) {
  if (d instanceof Uint8Array) return d;
  if (d instanceof ArrayBuffer) return new Uint8Array(d);
  if (Array.isArray(d)) return Uint8Array.from(d);
  if (typeof d === 'string') { const bin = atob(d); return Uint8Array.from(bin, ch => ch.charCodeAt(0)); }
  return new Uint8Array(0);
}
