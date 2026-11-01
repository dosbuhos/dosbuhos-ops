// Club de beneficios — staff + admin, inside the Hub. Page /club/ (public/club.html), JSON under /club/api/, printable invite
// QR at /club/print/<invite id>. Access = a grant on the 'club' app (Hub admins always): grant role 'admin' = club admin
// (programs grid, invitations, moves, approvals); 'editor' or 'viewer' = staff (Hoy, scan, register visits, receipts,
// card resends, Resumen). Staff never edit programs. Every change is written to club_audit with the Hub user's email.
import * as C from './club-core.js';
import { qrSvg } from './qr.js';
import { syncWineclub } from './club-wineclub.js';
import { clubAudit, catalog, personState, programsFor, badge, newCardCode, findPerson, addMembership, publicOrigin, cardUrl, inviteUrl, windowStart } from './club-data.js';

const J = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const str = (v, max = 300) => String(v ?? '').trim().slice(0, max);
const numOrNull = v => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
const intOrNull = v => { const n = numOrNull(v); return n == null ? null : Math.round(n); };
const NO = (message) => J({ code: 'not_granted', message }, 403);
const BAD = (message) => J({ code: 'bad_request', message }, 400);
const HEX = /^#[0-9a-f]{6}$/i;

// Hub grant → club role.
export const clubRole = hubRole => hubRole === 'admin' ? 'admin' : hubRole ? 'staff' : null;

export async function clubRoute(request, env, url, user, role) {
  const p = url.pathname, m = request.method;
  if (p === '/club') return Response.redirect(url.origin + '/club/' + url.search, 302);
  const pm = p.match(/^\/club\/print\/(\d+)$/);
  if (pm) return printInvite(env, url, Number(pm[1]));
  if (!p.startsWith('/club/api/')) {
    const res = await env.ASSETS.fetch(new Request(new URL('/club.html', request.url), { headers: request.headers }));
    return new Response(res.body, { status: res.status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
  }
  const admin = role === 'admin';
  const me = user.email;
  const body = async () => { try { return await request.json(); } catch { return {}; } };
  const origin = publicOrigin(env, url);
  const day = C.today();
  let mm;

  // ---------- boot ----------
  if (p === '/club/api/boot' && m === 'GET') {
    const cat = await catalog(env);
    const pros = await prosList(env, cat);
    return J({ role, me: { email: user.email, name: user.name }, day, origin, wineclub: !!env.WINECLUB_DB, ...cat,
      config: { milestone_every: Number(cat.config.milestone_every || 200), last_sync: cat.config.last_sync ? JSON.parse(cat.config.last_sync) : null }, pros,
      channels: C.CHANNELS, pro_types: C.PRO_TYPES });
  }

  // ---------- Hoy ----------
  if (p === '/club/api/hoy' && m === 'GET') return J(await hoy(env, url, user, admin, origin, day));

  // ---------- people ----------
  if (p === '/club/api/search' && m === 'GET') {
    const q = str(url.searchParams.get('q'), 60);
    const digits = q.replace(/\D/g, '');
    let rows;
    if (!q) rows = (await env.DB.prepare(`SELECT p.*, (SELECT MAX(created_at) FROM club_visits v WHERE v.person_id = p.id AND v.undone_at IS NULL) AS last_visit
      FROM club_people p ORDER BY COALESCE(last_visit, p.created_at) DESC LIMIT 25`).all()).results;
    else rows = (await env.DB.prepare(`SELECT * FROM club_people WHERE name LIKE ?1 COLLATE NOCASE OR email LIKE ?1 OR (?2 <> '' AND phone LIKE ?2) ORDER BY name COLLATE NOCASE LIMIT 30`)
      .bind('%' + q.replace(/[%_]/g, '') + '%', digits.length >= 3 ? '%' + digits + '%' : '').all()).results;
    const cat = await catalog(env);
    const pf = await programsFor(env, cat, rows.map(r => r.id), day);
    return J({ people: rows.map(r => listPerson(r, pf[r.id])) });
  }
  if ((mm = p.match(/^\/club\/api\/card\/([A-Za-z0-9_-]{20,64})$/)) && m === 'GET') {
    const r = await env.DB.prepare('SELECT id FROM club_people WHERE card_code = ?').bind(mm[1]).first();
    return r ? J({ id: r.id }) : J({ code: 'not_found', message: 'Esta tarjeta no existe o ya se cambió.' }, 404);
  }
  if ((mm = p.match(/^\/club\/api\/person\/(\d+)$/))) {
    const id = Number(mm[1]);
    const person = await env.DB.prepare('SELECT * FROM club_people WHERE id = ?').bind(id).first();
    if (!person) return J({ code: 'not_found', message: 'No encontramos a esta persona.' }, 404);
    if (m === 'GET') return J(await personDetail(env, person, origin, user, admin, day));
    if (m === 'PATCH') {
      const b = await body();
      const next = {}, before = {};
      if ('staff_note' in b) next.staff_note = str(b.staff_note, 1000);
      if (admin) {
        if ('name' in b && str(b.name, 80)) next.name = str(b.name, 80);
        if ('phone' in b) { const ph = C.normPhone(b.phone); if (b.phone && !C.validPhone(ph)) return BAD('Revisa el teléfono.'); next.phone = ph; }
        if ('email' in b) { const em = C.normEmail(b.email); if (b.email && !em) return BAD('Revisa el correo.'); next.email = em; }
        if ('vip' in b) next.vip = b.vip ? 1 : 0;
        if ('pro_type' in b) next.pro_type = C.PRO_TYPES[b.pro_type] ? b.pro_type : '';
        if ('status' in b) next.status = b.status === 'blocked' ? 'blocked' : 'active';
        if ('wedding_date' in b) next.wedding_date = C.DAY_RE.test(b.wedding_date || '') ? b.wedding_date : '';
      } else if (Object.keys(b).some(k => k !== 'staff_note')) return NO('Solo quien administra el club cambia los datos de una persona.');
      const keys = Object.keys(next);
      if (!keys.length) return BAD('Nada que cambiar.');
      for (const k of keys) before[k] = person[k];
      await env.DB.prepare(`UPDATE club_people SET ${keys.map(k => k + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`).bind(...keys.map(k => next[k]), Date.now(), id).run();
      await clubAudit(env, me, 'person.update', 'person', id, { before, after: next });
      return J({ ok: true });
    }
  }
  if ((mm = p.match(/^\/club\/api\/person\/(\d+)\/(visit|move|purchase|announce|sent|newcode)$/)) && m === 'POST') {
    const id = Number(mm[1]), action = mm[2];
    const person = await env.DB.prepare('SELECT * FROM club_people WHERE id = ?').bind(id).first();
    if (!person) return J({ code: 'not_found', message: 'No encontramos a esta persona.' }, 404);
    const b = await body();
    if (action === 'visit') return registerVisit(env, person, b, me, day);
    if (action === 'move') { if (!admin) return NO('Solo quien administra el club mueve a una persona de programa.'); return move(env, person, b, me); }
    if (action === 'purchase') {
      const amount = Math.round(Number(b.amount) * 100) / 100;
      if (!(amount > 0)) return BAD('Escribe el monto.');
      if (!C.DAY_RE.test(b.day || '') || b.day > day || b.day < C.addDays(day, -365)) return BAD('La fecha debe ser de los últimos 12 meses.');
      if (!['restaurante', 'tienda', 'en_linea', 'experiencias', 'punto_externo'].includes(b.channel)) return BAD('Elige dónde fue la compra.');
      const r = await env.DB.prepare("INSERT INTO club_purchases (person_id, day, amount, channel, status, source, note, created_by, created_at, decided_by, decided_at) VALUES (?, ?, ?, ?, 'approved', 'staff', ?, ?, ?, ?, ?)")
        .bind(id, b.day, amount, b.channel, str(b.note, 300), me, Date.now(), me, Date.now()).run();
      await clubAudit(env, me, 'purchase.add', 'person', id, { purchase: r.meta.last_row_id, amount, channel: b.channel, day: b.day });
      return J({ ok: true });
    }
    if (action === 'announce') {
      const d = C.DAY_RE.test(b.day || '') && b.day >= day ? b.day : day;
      await env.DB.prepare('UPDATE club_announcements SET cancelled_at = ? WHERE person_id = ? AND day = ? AND cancelled_at IS NULL').bind(Date.now(), id, d).run();
      await env.DB.prepare("INSERT INTO club_announcements (person_id, day, time, party_size, reservation_name, note, source, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, 'staff', ?, ?)")
        .bind(id, d, /^\d{2}:\d{2}$/.test(b.time || '') ? b.time : '', Math.min(40, Math.max(1, intOrNull(b.party_size) || 1)), str(b.reservation_name, 80), str(b.note, 200), me, Date.now()).run();
      return J({ ok: true });
    }
    if (action === 'sent') {
      await env.DB.prepare('UPDATE club_people SET card_sent_at = ? WHERE id = ?').bind(Date.now(), id).run();
      await env.DB.prepare('UPDATE club_card_requests SET handled_at = ?, handled_by = ? WHERE person_id = ? AND handled_at IS NULL').bind(Date.now(), me, id).run();
      await clubAudit(env, me, 'card.sent', 'person', id);
      return J({ ok: true });
    }
    if (action === 'newcode') {
      if (!admin) return NO('Solo quien administra el club cambia el código de una tarjeta.');
      const code = await newCardCode(env);
      await env.DB.prepare('UPDATE club_people SET card_code = ?, updated_at = ? WHERE id = ?').bind(code, Date.now(), id).run();
      await clubAudit(env, me, 'card.newcode', 'person', id);
      return J({ ok: true, card_url: cardUrl(origin, code) });
    }
  }
  if ((mm = p.match(/^\/club\/api\/visit\/(\d+)\/undo$/)) && m === 'POST') {
    const v = await env.DB.prepare('SELECT * FROM club_visits WHERE id = ?').bind(Number(mm[1])).first();
    if (!v) return J({ code: 'not_found' }, 404);
    if (v.undone_at) return J({ ok: true });
    if (v.created_by !== me && !admin) return NO('Solo quien registró la visita la puede deshacer.');
    if (Date.now() - v.created_at > C.UNDO_MS) return BAD('Ya pasaron 10 minutos: pide a un administrador que la corrija.');
    await env.DB.prepare('UPDATE club_visits SET undone_at = ?, undone_by = ? WHERE id = ? AND undone_at IS NULL').bind(Date.now(), me, v.id).run();
    await clubAudit(env, me, 'visit.undo', 'person', v.person_id, { visit: v.id });
    return J({ ok: true });
  }

  // ---------- receipts, resend requests, approvals ----------
  if ((mm = p.match(/^\/club\/api\/photo\/(\d+)$/)) && m === 'GET') {
    const ph = await env.DB.prepare('SELECT content_type, data FROM club_photos WHERE purchase_id = ?').bind(Number(mm[1])).first();
    if (!ph) return new Response('No hay foto', { status: 404 });
    const bin = Uint8Array.from(atob(ph.data), c => c.charCodeAt(0));
    return new Response(bin, { headers: { 'content-type': ph.content_type, 'cache-control': 'private, max-age=86400' } });
  }
  if ((mm = p.match(/^\/club\/api\/purchase\/(\d+)\/decide$/)) && m === 'POST') {
    const b = await body();
    const pu = await env.DB.prepare('SELECT * FROM club_purchases WHERE id = ?').bind(Number(mm[1])).first();
    if (!pu) return J({ code: 'not_found' }, 404);
    if (pu.status !== 'pending') return BAD('Esta compra ya se revisó.');
    const amount = b.approve ? (numOrNull(b.amount) ?? pu.amount) : pu.amount;
    if (b.approve && !(amount > 0)) return BAD('Escribe el monto.');
    await env.DB.prepare('UPDATE club_purchases SET status = ?, amount = ?, decided_by = ?, decided_at = ?, reject_reason = ? WHERE id = ?')
      .bind(b.approve ? 'approved' : 'rejected', amount, me, Date.now(), b.approve ? '' : str(b.reason, 200), pu.id).run();
    await clubAudit(env, me, b.approve ? 'purchase.approve' : 'purchase.reject', 'person', pu.person_id, { purchase: pu.id, amount, was: pu.amount });
    return J({ ok: true });
  }
  if ((mm = p.match(/^\/club\/api\/request\/(\d+)\/done$/)) && m === 'POST') {
    await env.DB.prepare('UPDATE club_card_requests SET handled_at = ?, handled_by = ? WHERE id = ? AND handled_at IS NULL').bind(Date.now(), me, Number(mm[1])).run();
    return J({ ok: true });
  }
  if ((mm = p.match(/^\/club\/api\/membership\/(\d+)\/decide$/)) && m === 'POST') {
    if (!admin) return NO('Solo quien administra el club aprueba solicitudes.');
    const b = await body();
    const ms = await env.DB.prepare('SELECT * FROM club_memberships WHERE id = ?').bind(Number(mm[1])).first();
    if (!ms || ms.status !== 'pending') return BAD('Esta solicitud ya se revisó.');
    let program = ms.program_id;
    if (b.approve && b.program_id && b.program_id !== ms.program_id) {
      const np = await env.DB.prepare('SELECT id FROM club_programs WHERE id = ? AND archived = 0').bind(b.program_id).first();
      if (!np) return BAD('Ese programa no existe.');
      program = np.id;
    }
    await env.DB.prepare('UPDATE club_memberships SET status = ?, program_id = ?, decided_by = ?, decided_at = ? WHERE id = ?')
      .bind(b.approve ? 'active' : 'rejected', program, me, Date.now(), ms.id).run();
    await clubAudit(env, me, b.approve ? 'membership.approve' : 'membership.reject', 'person', ms.person_id, { program, asked: ms.program_id });
    return J({ ok: true });
  }

  // ---------- invitations (admin) ----------
  if (p === '/club/api/invites' && m === 'GET') {
    if (!admin) return NO('Solo quien administra el club ve las invitaciones.');
    const rows = (await env.DB.prepare(`SELECT i.*, p.name AS program FROM club_invites i JOIN club_programs p ON p.id = i.program_id ORDER BY i.revoked_at IS NOT NULL, i.created_at DESC LIMIT 200`).all()).results;
    return J({ invites: rows.map(i => inviteOut(i, origin)) });
  }
  if (p === '/club/api/invites' && m === 'POST') {
    if (!admin) return NO('Solo quien administra el club invita.');
    const b = await body();
    const prog = await env.DB.prepare('SELECT * FROM club_programs WHERE id = ? AND archived = 0').bind(b.program_id || '').first();
    if (!prog) return BAD('Elige un programa.');
    const kind = b.kind === 'personal' ? 'personal' : 'link';
    const phone = C.normPhone(b.phone), email = C.normEmail(b.email);
    if (kind === 'personal' && !str(b.name, 80)) return BAD('Escribe a quién invitas.');
    if (b.phone && !C.validPhone(phone)) return BAD('Revisa el teléfono.');
    const days = intOrNull(b.expires_days);
    const expires = days && days > 0 ? Date.now() + days * C.DAY_MS : null;
    const max = kind === 'personal' ? 1 : (intOrNull(b.max_uses) > 0 ? intOrNull(b.max_uses) : null);
    const ra = 'requires_approval' in b ? (b.requires_approval ? 1 : 0) : prog.requires_approval;
    const tok = C.token(12);
    const r = await env.DB.prepare(`INSERT INTO club_invites (token, program_id, kind, label, name, phone, email, expires_at, max_uses, requires_approval, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(tok, prog.id, kind, str(b.label, 80), str(b.name, 80), phone, email, expires, max, ra, me, Date.now()).run();
    await clubAudit(env, me, 'invite.create', 'invite', r.meta.last_row_id, { program: prog.id, kind, label: str(b.label, 80), max_uses: max, expires, requires_approval: ra });
    const inv = await env.DB.prepare('SELECT i.*, p.name AS program FROM club_invites i JOIN club_programs p ON p.id = i.program_id WHERE i.id = ?').bind(r.meta.last_row_id).first();
    return J({ ok: true, invite: inviteOut(inv, origin) });
  }
  if ((mm = p.match(/^\/club\/api\/invites\/(\d+)\/revoke$/)) && m === 'POST') {
    if (!admin) return NO('Solo quien administra el club cancela invitaciones.');
    await env.DB.prepare('UPDATE club_invites SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(Date.now(), Number(mm[1])).run();
    await clubAudit(env, me, 'invite.revoke', 'invite', mm[1]);
    return J({ ok: true });
  }

  // ---------- Novios: bulk add and send cards ----------
  if (p === '/club/api/novios' && m === 'GET') {
    if (!admin) return NO('Solo quien administra el club.');
    const rows = (await env.DB.prepare(`SELECT p.id, p.name, p.phone, p.email, p.wedding_date, p.card_code, p.card_sent_at FROM club_people p
      JOIN club_memberships m ON m.person_id = p.id AND m.program_id = 'novios' AND m.status = 'active' ORDER BY p.card_sent_at IS NOT NULL, p.wedding_date DESC, p.name`).all()).results;
    return J({ people: rows.map(r => ({ ...r, phone_fmt: C.fmtPhone(r.phone), wa: r.phone ? C.waLink(r.phone, C.cardText({ name: r.name, url: cardUrl(origin, r.card_code) })) : '', card_url: cardUrl(origin, r.card_code), card_code: undefined })) });
  }
  if (p === '/club/api/novios' && m === 'POST') {
    if (!admin) return NO('Solo quien administra el club.');
    const b = await body();
    const { rows, errors } = C.parseNovios(b.text);
    if (b.preview) return J({ rows, errors });
    if (!rows.length) return BAD(errors[0] || 'Pega al menos una pareja: nombre, teléfono, correo, fecha de boda.');
    let created = 0, existing = 0; const now = Date.now();
    for (const r of rows.slice(0, 300)) {
      let person = await findPerson(env, r.phone, r.email);
      if (person) { existing++; if (r.wedding && !person.wedding_date) await env.DB.prepare('UPDATE club_people SET wedding_date = ? WHERE id = ?').bind(r.wedding, person.id).run(); }
      else {
        const ins = await env.DB.prepare(`INSERT INTO club_people (card_code, name, phone, email, wedding_date, source, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'novios', ?, ?, ?)`)
          .bind(await newCardCode(env), r.name, r.phone, r.email, r.wedding, me, now, now).run();
        person = { id: ins.meta.last_row_id }; created++;
      }
      await addMembership(env, person.id, 'novios', { source: 'novios', by: me });
    }
    await clubAudit(env, me, 'novios.bulk', 'program', 'novios', { created, existing, errors: errors.length });
    return J({ ok: true, created, existing, errors });
  }

  // ---------- programs × benefits (admin) ----------
  if (p === '/club/api/cell' && m === 'PUT') {
    if (!admin) return NO('Solo quien administra el club cambia los beneficios.');
    const b = await body();
    const prog = await env.DB.prepare('SELECT id FROM club_programs WHERE id = ?').bind(b.program_id || '').first();
    const ben = await env.DB.prepare('SELECT id, kind FROM club_benefits WHERE id = ?').bind(b.benefit_id || '').first();
    if (!prog || !ben) return BAD('Programa o beneficio desconocido.');
    const before = await env.DB.prepare('SELECT * FROM club_cells WHERE program_id = ? AND benefit_id = ?').bind(prog.id, ben.id).first();
    const pick = (k, f, dflt) => k in b ? f(b[k]) : (before ? before[k] : dflt);
    const cell = {
      enabled: pick('enabled', v => v ? 1 : 0, 0),
      value: pick('value', numOrNull, null),
      text_value: pick('text_value', v => str(v, 200), ''),
      max_guests: pick('max_guests', intOrNull, null),
      note: pick('note', v => str(v, 200), ''),
      // Any change to the value puts it back to "por confirmar" unless the same save confirms it.
      confirmed: 'confirmed' in b ? (b.confirmed ? 1 : 0) : (('value' in b || 'text_value' in b) ? 0 : (before ? before.confirmed : 0)),
    };
    if (cell.value != null && (cell.value < 0 || (ben.kind === 'percent' && cell.value > 100))) return BAD('Revisa el valor.');
    if (cell.max_guests != null && (cell.max_guests < 0 || cell.max_guests > 50)) return BAD('Revisa los acompañantes.');
    await env.DB.prepare(`INSERT INTO club_cells (program_id, benefit_id, enabled, value, text_value, max_guests, note, confirmed, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(program_id, benefit_id) DO UPDATE SET enabled = excluded.enabled, value = excluded.value, text_value = excluded.text_value, max_guests = excluded.max_guests,
        note = excluded.note, confirmed = excluded.confirmed, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .bind(prog.id, ben.id, cell.enabled, cell.value, cell.text_value, cell.max_guests, cell.note, cell.confirmed, me, Date.now()).run();
    await clubAudit(env, me, 'cell.update', 'cell', `${prog.id}|${ben.id}`, { before: before && { enabled: before.enabled, value: before.value, text_value: before.text_value, max_guests: before.max_guests, note: before.note, confirmed: before.confirmed }, after: cell });
    return J({ ok: true, cell: { program_id: prog.id, benefit_id: ben.id, ...cell } });
  }
  if (p === '/club/api/programs' && m === 'POST') {
    if (!admin) return NO('Solo quien administra el club crea programas.');
    const b = await body();
    const name = str(b.name, 60);
    if (!name) return BAD('Escribe el nombre del programa.');
    const kind = C.PROGRAM_KINDS.includes(b.kind) ? b.kind : 'invitacion';
    if (kind === 'compras' && !(Number(b.threshold_mxn) >= 0)) return BAD('Un nivel por compras necesita su monto mínimo.');
    let id = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'programa';
    while (await env.DB.prepare('SELECT 1 FROM club_programs WHERE id = ?').bind(id).first()) id += '-2';
    const color = HEX.test(b.color || '') && C.contrastOnWhite(b.color) >= 4.5 ? b.color : '#6b2737';
    const sort = ((await env.DB.prepare('SELECT MAX(sort) AS s FROM club_programs').first())?.s || 0) + 1;
    await env.DB.prepare('INSERT INTO club_programs (id, name, kind, color, short_label, vip, is_pro, requires_approval, threshold_mxn, sort, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, name, kind, color, str(b.short_label, 30) || name, b.vip ? 1 : 0, b.is_pro ? 1 : 0, b.requires_approval ? 1 : 0, kind === 'compras' ? Number(b.threshold_mxn) : null, sort, me, Date.now()).run();
    await clubAudit(env, me, 'program.create', 'program', id, { name, kind });
    return J({ ok: true, id });
  }
  if ((mm = p.match(/^\/club\/api\/programs\/([a-z0-9-]+)$/)) && m === 'PATCH') {
    if (!admin) return NO('Solo quien administra el club cambia programas.');
    const prog = await env.DB.prepare('SELECT * FROM club_programs WHERE id = ?').bind(mm[1]).first();
    if (!prog) return J({ code: 'not_found' }, 404);
    const b = await body(), next = {};
    if ('name' in b) { if (!str(b.name, 60)) return BAD('El programa necesita nombre.'); next.name = str(b.name, 60); }
    if ('short_label' in b) next.short_label = str(b.short_label, 30);
    if ('color' in b) { if (!HEX.test(b.color || '')) return BAD('Color no válido.'); if (C.contrastOnWhite(b.color) < 4.5) return BAD('Ese color es muy claro: el texto blanco no se lee. Elige uno más oscuro.'); next.color = b.color.toLowerCase(); }
    if ('vip' in b) next.vip = b.vip ? 1 : 0;
    if ('is_pro' in b) next.is_pro = b.is_pro ? 1 : 0;
    if ('requires_approval' in b) next.requires_approval = b.requires_approval ? 1 : 0;
    if ('archived' in b) next.archived = b.archived ? 1 : 0;
    if ('sort' in b && intOrNull(b.sort) != null) next.sort = intOrNull(b.sort);
    if ('threshold_mxn' in b) { if (prog.kind !== 'compras') return BAD('Solo los niveles por compras tienen monto.'); const t = numOrNull(b.threshold_mxn); if (t == null || t < 0) return BAD('Revisa el monto.'); next.threshold_mxn = t; }
    const keys = Object.keys(next);
    if (!keys.length) return BAD('Nada que cambiar.');
    await env.DB.prepare(`UPDATE club_programs SET ${keys.map(k => k + ' = ?').join(', ')}, updated_by = ?, updated_at = ? WHERE id = ?`).bind(...keys.map(k => next[k]), me, Date.now(), prog.id).run();
    await clubAudit(env, me, 'program.update', 'program', prog.id, { before: Object.fromEntries(keys.map(k => [k, prog[k]])), after: next });
    return J({ ok: true });
  }
  if (p === '/club/api/benefits' && m === 'POST') {
    if (!admin) return NO('Solo quien administra el club crea beneficios.');
    const b = await body();
    const name = str(b.name, 80);
    if (!name) return BAD('Escribe el nombre del beneficio.');
    if (!C.KINDS.includes(b.kind)) return BAD('Elige el tipo de beneficio.');
    let id = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'beneficio';
    while (await env.DB.prepare('SELECT 1 FROM club_benefits WHERE id = ?').bind(id).first()) id += '-2';
    const sort = ((await env.DB.prepare('SELECT MAX(sort) AS s FROM club_benefits').first())?.s || 0) + 10;
    const phrase = str(b.phrase, 160) || (b.kind === 'percent' ? `{v}% · ${name}` : b.kind === 'count_per_year' ? `{v} al año · ${name}` : b.kind === 'amount' ? `{v} · ${name}` : b.kind === 'text' ? '{t}' : name);
    await env.DB.prepare('INSERT INTO club_benefits (id, name, kind, unit, applies_to, rules, phrase, sort, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, name, b.kind, str(b.unit, 20) || (b.kind === 'percent' ? '%' : ''), C.APPLIES.includes(b.applies_to) ? b.applies_to : 'restaurante', str(b.rules, 300), phrase, sort, me, Date.now()).run();
    await clubAudit(env, me, 'benefit.create', 'benefit', id, { name, kind: b.kind });
    return J({ ok: true, id });
  }
  if ((mm = p.match(/^\/club\/api\/benefits\/([a-z0-9-]+)$/)) && m === 'PATCH') {
    if (!admin) return NO('Solo quien administra el club cambia beneficios.');
    const ben = await env.DB.prepare('SELECT * FROM club_benefits WHERE id = ?').bind(mm[1]).first();
    if (!ben) return J({ code: 'not_found' }, 404);
    const b = await body(), next = {};
    if ('name' in b) { if (!str(b.name, 80)) return BAD('El beneficio necesita nombre.'); next.name = str(b.name, 80); }
    if ('unit' in b) next.unit = str(b.unit, 20);
    if ('applies_to' in b) { if (!C.APPLIES.includes(b.applies_to)) return BAD('¿Dónde aplica?'); next.applies_to = b.applies_to; }
    if ('rules' in b) next.rules = str(b.rules, 300);
    if ('phrase' in b) next.phrase = str(b.phrase, 160);
    if ('archived' in b) next.archived = b.archived ? 1 : 0;
    if ('sort' in b && intOrNull(b.sort) != null) next.sort = intOrNull(b.sort);
    const keys = Object.keys(next);
    if (!keys.length) return BAD('Nada que cambiar.');
    await env.DB.prepare(`UPDATE club_benefits SET ${keys.map(k => k + ' = ?').join(', ')}, updated_by = ?, updated_at = ? WHERE id = ?`).bind(...keys.map(k => next[k]), me, Date.now(), ben.id).run();
    await clubAudit(env, me, 'benefit.update', 'benefit', ben.id, { before: Object.fromEntries(keys.map(k => [k, ben[k]])), after: next });
    return J({ ok: true });
  }
  if (p === '/club/api/config' && m === 'PUT') {
    if (!admin) return NO('Solo quien administra el club.');
    const b = await body();
    const n = intOrNull(b.milestone_every);
    if (!(n > 0)) return BAD('Escribe cada cuántas personas hay hito.');
    await env.DB.prepare("INSERT INTO club_config (key, value) VALUES ('milestone_every', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(n)).run();
    await clubAudit(env, me, 'config.update', 'config', 'milestone_every', { value: n });
    return J({ ok: true });
  }
  if (p === '/club/api/sync' && m === 'POST') {
    if (!admin) return NO('Solo quien administra el club.');
    return J(await syncWineclub(env, me));
  }
  if (p === '/club/api/audit' && m === 'GET') {
    if (!admin) return NO('Solo quien administra el club.');
    const rows = (await env.DB.prepare('SELECT at, actor, action, entity, entity_id, detail FROM club_audit ORDER BY id DESC LIMIT 100').all()).results;
    return J({ audit: rows });
  }

  // ---------- Resumen ----------
  if (p === '/club/api/resumen' && m === 'GET') return J(await resumen(env, day));

  return J({ code: 'not_found' }, 404);
}

// ---------- helpers ----------
function listPerson(r, st) {
  return { id: r.id, name: r.name, phone: C.fmtPhone(r.phone), status: r.status, vip: !!r.vip || (st?.programs || []).some(p => p.vip),
    programs: (st?.programs || []).map(badge), pending: !!st?.pending, pro_type: r.pro_type };
}

async function prosList(env, cat) {
  const proIds = cat.programs.filter(p => p.is_pro && !p.archived).map(p => p.id);
  if (!proIds.length) return [];
  const rows = (await env.DB.prepare(`SELECT p.id, p.name, p.pro_type, m.program_id FROM club_people p JOIN club_memberships m ON m.person_id = p.id AND m.status = 'active'
    WHERE p.status = 'active' AND m.program_id IN (${proIds.map(() => '?').join(',')}) ORDER BY p.name COLLATE NOCASE`).bind(...proIds).all()).results;
  const P = new Map(cat.programs.map(p => [p.id, p]));
  return [...new Map(rows.map(r => [r.id, { id: r.id, name: r.name, pro_type: C.PRO_TYPES[r.pro_type] || '', program: P.get(r.program_id)?.name || '' }])).values()];
}

function inviteOut(i, origin) {
  const url = inviteUrl(origin, i.token);
  const text = C.inviteText({ name: i.name, program: i.program, url });
  const problem = C.inviteProblem(i);
  return { id: i.id, program_id: i.program_id, program: i.program, kind: i.kind, label: i.label, name: i.name, phone: C.fmtPhone(i.phone), email: i.email,
    expires_at: i.expires_at, max_uses: i.max_uses, uses: i.uses, requires_approval: !!i.requires_approval, revoked: !!i.revoked_at, created_at: i.created_at, created_by: i.created_by,
    active: !problem, problem, url, text, wa: C.waLink(i.kind === 'personal' ? i.phone : '', text),
    mailto: `mailto:${encodeURIComponent(i.email || '')}?subject=${encodeURIComponent('Tu invitación al club de Dos Búhos')}&body=${encodeURIComponent(text)}` };
}

async function personDetail(env, person, origin, user, admin, day) {
  const cat = await catalog(env);
  const st = await personState(env, person, cat, day);
  const [visits, purchases, charges, anns, moves, brought] = await Promise.all([
    env.DB.prepare(`SELECT v.*, b.name AS brought_by_name FROM club_visits v LEFT JOIN club_people b ON b.id = v.brought_by WHERE v.person_id = ? ORDER BY v.created_at DESC LIMIT 30`).bind(person.id).all(),
    env.DB.prepare('SELECT id, day, amount, channel, status, source, has_photo, note, created_at, decided_by FROM club_purchases WHERE person_id = ? ORDER BY created_at DESC LIMIT 30').bind(person.id).all(),
    env.DB.prepare('SELECT day, amount, estimated FROM club_sub_charges WHERE person_id = ? AND day >= ? ORDER BY day DESC').bind(person.id, windowStart(day)).all(),
    env.DB.prepare('SELECT * FROM club_announcements WHERE person_id = ? AND day >= ? AND cancelled_at IS NULL ORDER BY day, time').bind(person.id, day).all(),
    env.DB.prepare("SELECT at, actor, action, detail FROM club_audit WHERE entity = 'person' AND entity_id = ? AND action IN ('person.move', 'membership.approve', 'membership.reject', 'signup', 'signup.existing', 'card.newcode') ORDER BY id DESC LIMIT 20").bind(String(person.id)).all(),
    env.DB.prepare('SELECT COUNT(*) AS visits, COALESCE(SUM(party_size), 0) AS people, COALESCE(SUM(check_total - discount_total), 0) AS spend FROM club_visits WHERE brought_by = ? AND undone_at IS NULL').bind(person.id).first(),
  ]);
  const vids = visits.results.map(v => v.id);
  const vb = vids.length ? (await env.DB.prepare(`SELECT vb.*, b.name FROM club_visit_benefits vb JOIN club_benefits b ON b.id = vb.benefit_id WHERE vb.visit_id IN (${vids.map(() => '?').join(',')})`).bind(...vids).all()).results : [];
  const url = cardUrl(origin, person.card_code);
  const P = new Map(cat.programs.map(p => [p.id, p]));
  return {
    person: { ...person, phone_fmt: C.fmtPhone(person.phone), card_url: url, pro_type_name: C.PRO_TYPES[person.pro_type] || '' },
    programs: st.programs.map(badge), level: st.level && badge(st.level), manual_level: st.manualLevel, by_subscription: st.bySubscription, commitment: st.commitment, next: st.next && { name: st.next.program.name, missing: st.next.missing },
    spend: st.spend, spend_estimated: st.estimated, vip: st.vip,
    memberships: st.memberships.map(x => ({ id: x.id, program_id: x.program_id, program: x.program, kind: x.kind, status: x.status, source: x.source, color: P.get(x.program_id)?.color })),
    benefits: st.resolved.map(r => ({ ...r, head: C.staffHead(r), rule: C.staffRule(r), guest: C.guestPhrase(r) })),
    visits: visits.results.map(v => ({ ...v, benefits: vb.filter(x => x.visit_id === v.id).map(x => ({ benefit_id: x.benefit_id, name: x.name, qty: x.qty, value: x.value, program_id: x.program_id })),
      can_undo: !v.undone_at && (v.created_by === user.email || admin) && Date.now() - v.created_at <= C.UNDO_MS, undo_until: v.created_at + C.UNDO_MS })),
    purchases: purchases.results, charges: charges.results, announcements: anns.results,
    moves: moves.results.map(x => ({ ...x, detail: safeJson(x.detail) })),
    brought: brought && brought.visits ? brought : null,
    visit_today: visits.results.some(v => v.day === day && !v.undone_at),
    opentable: C.openTableNote(person, st.resolved, st.programs),
    wa: person.phone ? C.waLink(person.phone, C.cardText({ name: person.name, url })) : '',
    card_text: C.cardText({ name: person.name, url }),
  };
}
const safeJson = s => { try { return JSON.parse(s); } catch { return s; } };

async function registerVisit(env, person, b, me, day) {
  if (person.status !== 'active') return BAD('Esta tarjeta no está activa.');
  const cat = await catalog(env);
  const st = await personState(env, person, cat, day);
  const party = Math.min(40, Math.max(1, intOrNull(b.party_size) || 1));
  const R = new Map(st.resolved.map(r => [r.benefit_id, r]));
  const used = [];
  for (const x of Array.isArray(b.benefits) ? b.benefits : []) {
    const r = R.get(x.benefit_id);
    if (!r) return BAD('Ese beneficio no aplica a esta persona.');
    let qty = 1;
    if (r.kind === 'count_per_year') {
      qty = Math.max(1, intOrNull(x.qty) || party);
      if (qty > r.left) return BAD(`${r.name}: solo quedan ${r.left} este año.`);
    }
    used.push({ r, qty });
  }
  const total = Math.max(0, numOrNull(b.check_total) || 0), discount = Math.max(0, numOrNull(b.discount_total) || 0);
  if (discount > total && total > 0) return BAD('El descuento no puede ser mayor que la cuenta.');
  let broughtBy = intOrNull(b.brought_by);
  if (broughtBy) {
    const pro = await env.DB.prepare(`SELECT 1 FROM club_memberships m JOIN club_programs p ON p.id = m.program_id WHERE m.person_id = ? AND m.status = 'active' AND p.is_pro = 1`).bind(broughtBy).first();
    if (!pro || broughtBy === person.id) broughtBy = null;
  }
  const ann = await env.DB.prepare('SELECT id FROM club_announcements WHERE person_id = ? AND day = ? AND cancelled_at IS NULL ORDER BY id DESC LIMIT 1').bind(person.id, day).first();
  const now = Date.now();
  const r = await env.DB.prepare(`INSERT INTO club_visits (person_id, day, time, party_size, parrot_check, check_total, discount_total, brought_by, announcement_id, note, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(person.id, day, C.nowHM(now), party, str(b.parrot_check, 40), total, discount, broughtBy, ann?.id ?? null, str(b.note, 500), me, now).run();
  const vid = r.meta.last_row_id;
  if (used.length) await env.DB.batch(used.map(({ r: x, qty }) => env.DB.prepare('INSERT INTO club_visit_benefits (visit_id, benefit_id, program_id, qty, value) VALUES (?, ?, ?, ?, ?)').bind(vid, x.benefit_id, x.program_id, qty, x.value)));
  await clubAudit(env, me, 'visit.add', 'person', person.id, { visit: vid, party, benefits: used.map(u => ({ id: u.r.benefit_id, qty: u.qty, from: u.r.program_id })), parrot: str(b.parrot_check, 40), total, discount, brought_by: broughtBy });
  return J({ ok: true, id: vid, undo_until: now + C.UNDO_MS });
}

// A manager moves a person between invitation programs or sets a purchase level by hand. from '' = add, to '' = remove.
async function move(env, person, b, me) {
  const reason = str(b.reason, 300);
  if (!reason) return BAD('Escribe el motivo del cambio.');
  const from = str(b.from_program, 40), to = str(b.to_program, 40);
  if (!from && !to) return BAD('Elige el programa.');
  if (from === to) return BAD('Es el mismo programa.');
  const now = Date.now();
  if (to) {
    const tp = await env.DB.prepare('SELECT id FROM club_programs WHERE id = ? AND archived = 0').bind(to).first();
    if (!tp) return BAD('Ese programa no existe.');
  }
  if (from) {
    const cur = await env.DB.prepare("SELECT id FROM club_memberships WHERE person_id = ? AND program_id = ? AND status IN ('active', 'pending')").bind(person.id, from).first();
    if (cur) await env.DB.prepare("UPDATE club_memberships SET status = 'ended', ended_at = ?, ended_by = ?, reason = ? WHERE id = ?").bind(now, me, reason, cur.id).run();
  }
  if (to) await addMembership(env, person.id, to, { status: 'active', source: 'manual', reason, by: me });
  await clubAudit(env, me, 'person.move', 'person', person.id, { from, to, reason });
  return J({ ok: true });
}

async function hoy(env, url, user, admin, origin, day) {
  const cat = await catalog(env);
  const [anns, visits, receipts, reqs, approvals] = await Promise.all([
    env.DB.prepare(`SELECT a.*, p.name, p.phone, p.vip AS pvip, p.staff_note FROM club_announcements a JOIN club_people p ON p.id = a.person_id WHERE a.day = ? AND a.cancelled_at IS NULL ORDER BY a.time = '', a.time`).bind(day).all(),
    env.DB.prepare(`SELECT v.*, p.name, p.vip AS pvip, p.staff_note, b.name AS brought_by_name FROM club_visits v JOIN club_people p ON p.id = v.person_id LEFT JOIN club_people b ON b.id = v.brought_by
      WHERE v.day = ? AND v.undone_at IS NULL ORDER BY v.created_at DESC`).bind(day).all(),
    env.DB.prepare(`SELECT u.id, u.person_id, u.day, u.amount, u.channel, u.has_photo, u.created_at, p.name FROM club_purchases u JOIN club_people p ON p.id = u.person_id WHERE u.status = 'pending' ORDER BY u.created_at`).all(),
    env.DB.prepare(`SELECT r.id, r.phone, r.reason, r.created_at, p.id AS person_id, p.name, p.card_code FROM club_card_requests r JOIN club_people p ON p.id = r.person_id WHERE r.handled_at IS NULL ORDER BY r.created_at`).all(),
    admin ? env.DB.prepare(`SELECT m.id, m.person_id, m.program_id, m.created_at, p.name, p.phone, p.pro_type, g.name AS program FROM club_memberships m JOIN club_people p ON p.id = m.person_id
      JOIN club_programs g ON g.id = m.program_id WHERE m.status = 'pending' ORDER BY m.created_at`).all() : { results: [] },
  ]);
  const ids = [...anns.results.map(a => a.person_id), ...visits.results.map(v => v.person_id)];
  const pf = await programsFor(env, cat, ids, day);
  const isVip = (pid, pvip) => !!pvip || (pf[pid]?.programs || []).some(p => p.vip);
  const visitedToday = new Set(visits.results.map(v => v.person_id));
  const cutoff = Date.now() - 4 * 3600e3;
  const progs = pid => (pf[pid]?.programs || []).map(badge);
  const otNote = (pid, pvip) => C.openTableNote({ vip: pvip }, C.resolve({ programs: pf[pid]?.programs || [], benefits: cat.benefits, cells: cat.cells }), pf[pid]?.programs || []);
  return {
    day,
    announced: anns.results.map(a => ({ id: a.id, person_id: a.person_id, name: a.name, time: a.time, party_size: a.party_size, reservation_name: a.reservation_name, note: a.note, source: a.source,
      programs: progs(a.person_id), vip: isVip(a.person_id, a.pvip), here: visitedToday.has(a.person_id), staff_note: a.staff_note, opentable: otNote(a.person_id, a.pvip) })),
    checkins: visits.results.map(v => ({ id: v.id, person_id: v.person_id, name: v.name, time: v.time, party_size: v.party_size, parrot_check: v.parrot_check, check_total: v.check_total, discount_total: v.discount_total,
      brought_by_name: v.brought_by_name, created_by: v.created_by, programs: progs(v.person_id), vip: isVip(v.person_id, v.pvip),
      can_undo: (v.created_by === user.email || admin) && Date.now() - v.created_at <= C.UNDO_MS })),
    vip_now: [...new Map(visits.results.filter(v => v.created_at >= cutoff && isVip(v.person_id, v.pvip)).map(v => [v.person_id, { person_id: v.person_id, name: v.name, time: v.time, party_size: v.party_size, programs: progs(v.person_id), staff_note: v.staff_note }])).values()],
    receipts: receipts.results.map(r => ({ ...r, channel_name: C.CHANNELS[r.channel] || r.channel })),
    resend: reqs.results.map(r => {
      const link = cardUrl(origin, r.card_code);
      return { id: r.id, person_id: r.person_id, name: r.name, phone: C.fmtPhone(r.phone), reason: r.reason, created_at: r.created_at, wa: C.waLink(r.phone, C.cardText({ name: r.name, url: link })) };
    }),
    approvals: approvals.results.map(a => ({ ...a, phone: C.fmtPhone(a.phone), pro_type: C.PRO_TYPES[a.pro_type] || '' })),
  };
}

async function resumen(env, day) {
  const cat = await catalog(env);
  const since = windowStart(day), since90 = C.addDays(day, -89);
  const people = (await env.DB.prepare("SELECT id, name, phone, vip FROM club_people WHERE status = 'active'").all()).results;
  const pf = await programsFor(env, cat, people.map(p => p.id), day);
  const visits = (await env.DB.prepare('SELECT person_id, day, party_size, check_total, discount_total, brought_by FROM club_visits WHERE undone_at IS NULL AND day >= ? AND day <= ?').bind(since, day).all()).results;
  const uses = (await env.DB.prepare(`SELECT vb.benefit_id, vb.program_id, COUNT(*) AS n, SUM(vb.qty) AS qty FROM club_visit_benefits vb JOIN club_visits v ON v.id = vb.visit_id
    WHERE v.undone_at IS NULL AND v.day >= ? GROUP BY vb.benefit_id, vb.program_id`).bind(since).all()).results;
  const byPerson = new Map();
  for (const v of visits) { const a = byPerson.get(v.person_id) || { visits: 0, discount: 0, last: '' }; a.visits++; a.discount += v.discount_total; if (v.day > a.last) a.last = v.day; byPerson.set(v.person_id, a); }
  const programs = cat.programs.filter(p => !p.archived).map(p => {
    const members = people.filter(x => (pf[x.id]?.programs || []).some(q => q.id === p.id));
    const rows = members.map(x => ({ id: x.id, name: x.name, spend: pf[x.id].spend, ...(byPerson.get(x.id) || { visits: 0, discount: 0, last: '' }) }));
    return { ...badge(p), threshold_mxn: p.threshold_mxn, members: rows.length, active90: rows.filter(r => r.last >= since90).length,
      visits: rows.reduce((s, r) => s + r.visits, 0), spend: rows.reduce((s, r) => s + r.spend, 0), discount: rows.reduce((s, r) => s + r.discount, 0),
      top: rows.sort((a, b) => b.spend - a.spend || b.visits - a.visits).slice(0, 5).map(r => ({ id: r.id, name: r.name, spend: r.spend, visits: r.visits })),
      uses: uses.filter(u => u.program_id === p.id).map(u => ({ benefit_id: u.benefit_id, n: u.n, qty: u.qty })) };
  });
  const every = Number(cat.config.milestone_every || 200);
  const allBrought = (await env.DB.prepare('SELECT brought_by, COUNT(*) AS visits, SUM(party_size) AS people, SUM(check_total - discount_total) AS spend, MAX(day) AS last FROM club_visits WHERE undone_at IS NULL AND brought_by IS NOT NULL GROUP BY brought_by').all()).results;
  const B = new Map(allBrought.map(r => [r.brought_by, r]));
  const b12 = new Map();
  for (const v of visits) if (v.brought_by) { const a = b12.get(v.brought_by) || { visits: 0, people: 0, spend: 0 }; a.visits++; a.people += v.party_size; a.spend += v.check_total - v.discount_total; b12.set(v.brought_by, a); }
  const proPeople = people.filter(x => (pf[x.id]?.programs || []).some(q => q.is_pro));
  const pros = proPeople.map(x => {
    const all = B.get(x.id) || { visits: 0, people: 0, spend: 0, last: '' };
    return { id: x.id, name: x.name, programs: pf[x.id].programs.filter(q => q.is_pro).map(badge), visits: all.visits, people: all.people, spend: all.spend, last: all.last,
      last12: b12.get(x.id) || { visits: 0, people: 0, spend: 0 }, milestone: C.milestones(all.people, every) };
  }).sort((a, b) => b.people - a.people || a.name.localeCompare(b.name));
  const totals = { people: people.length, active90: people.filter(x => (byPerson.get(x.id)?.last || '') >= since90).length, visits: visits.length,
    spend: Object.values(pf).reduce((s, x) => s + x.spend, 0), discount: visits.reduce((s, v) => s + v.discount_total, 0) };
  return { day, since, totals, programs, pros, milestone_every: every, benefits: cat.benefits.map(b => ({ id: b.id, name: b.name, kind: b.kind })) };
}

// A printable invitation card: the QR of the sign-up link, big, on cream. Staff print it for a counter or a hotel.
async function printInvite(env, url, id) {
  const i = await env.DB.prepare('SELECT i.*, p.name AS program FROM club_invites i JOIN club_programs p ON p.id = i.program_id WHERE i.id = ?').bind(id).first();
  if (!i) return new Response('No existe', { status: 404 });
  const link = inviteUrl(publicOrigin(env, url), i.token);
  const e = C.esc;
  return new Response(`<!doctype html><html lang="es-MX"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="no-referrer">
<title>Invitación · ${e(i.program)}</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=EB+Garamond:ital,wght@0,400;1,400&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box}html,body{overflow-x:clip}body{margin:0;background:#e9e1d3;font:18px/1.4 "EB Garamond",Georgia,serif;color:#2a1a1d}
.sheet{width:min(420px,calc(100vw - 32px));margin:24px auto;background:#f6efe3;border-radius:18px;padding:32px 24px;text-align:center;border:1px solid #d9c8ad}
.mark{font:600 15px "Cormorant Garamond",Georgia,serif;letter-spacing:.22em;text-transform:uppercase;color:#5a1726}h1{font:600 34px/1.1 "Cormorant Garamond",Georgia,serif;margin:14px 0 6px}
.qr{width:min(260px,70vw);margin:20px auto 10px;background:#fff;padding:10px;border-radius:12px}.qr svg{display:block;width:100%;height:auto}p{margin:6px 0;color:#6b5a55}
.bar{display:flex;gap:10px;justify-content:center;margin:0 auto 24px;width:min(420px,calc(100vw - 32px))}.bar a,.bar button{min-height:44px;padding:0 16px;border-radius:10px;border:1px solid #5a1726;background:#fff;color:#5a1726;font:600 18px "Cormorant Garamond",Georgia,serif;cursor:pointer;display:inline-flex;align-items:center;text-decoration:none}
@media print{body{background:#fff}.bar{display:none}.sheet{border:0;margin:0 auto}}</style></head><body>
<div class="sheet"><div class="mark">Dos Búhos</div><h1>Únete al club</h1><p>${e(i.label || i.program)}</p>
<div class="qr">${qrSvg(link, { label: 'Código para unirte al club' })}</div><p>Escanea con la cámara de tu teléfono.<br>Tu tarjeta queda lista en un minuto.</p></div>
<div class="bar"><a href="/club/#invitar">‹ Volver</a><button onclick="print()">Imprimir</button></div></body></html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
}
