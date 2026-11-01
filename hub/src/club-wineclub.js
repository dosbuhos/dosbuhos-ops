// Círculo subscribers → club people. Reads the wineclub D1 (binding WINECLUB_DB, read-only use) and writes only Hub tables:
//   - each live subscriber (or one with charges in the last 12 months) becomes a club person, matched by email or phone
//   - their paid subscription charges over the last 12 months count as spend (channel "suscripción"); amounts the wine club
//     did not store are estimated at the subscription price and flagged
//   - founding members (club name "Socios Fundadores") also get the Fundadores program; it ends when they stop being one
//   - members merged into another (members.merged_into) are skipped
// Runs from the hourly cron and from Programas → "Sincronizar ahora". Without the binding (local dev) it does nothing.
import * as C from './club-core.js';
import { newCardCode, clubAudit } from './club-data.js';

async function tryAll(db, sqls) {
  let err;
  for (const q of sqls) { try { return (await db.prepare(q).all()).results; } catch (e) { err = e; } }
  throw err;
}

export async function readWineclub(db, day = C.today()) {
  const since = C.addDays(day, -365);
  // Older wine club schemas lack the contact/merge/suspension columns: fall back step by step.
  const members = await tryAll(db, [
    'SELECT id, name, COALESCE(contact_email, email) AS email, COALESCE(contact_phone, phone) AS phone, merged_into, suspended_on FROM members',
    'SELECT id, name, COALESCE(contact_email, email) AS email, COALESCE(contact_phone, phone) AS phone, NULL AS merged_into, suspended_on FROM members',
    'SELECT id, name, email, phone, NULL AS merged_into, NULL AS suspended_on FROM members',
  ]);
  const subs = (await db.prepare(`SELECT s.id, s.member_id, s.status, s.ended_on, s.price_amount, s.billing_interval, s.billing_interval_count, c.name AS club_name, c.cadence_months
    FROM subscriptions s LEFT JOIN stripe_products p ON p.product_id = s.stripe_product_id LEFT JOIN clubs c ON c.id = COALESCE(s.club_id_override, p.club_id)`).all()).results;
  const fulfillments = (await db.prepare('SELECT subscription_id, k, status, paid_on, paid_amount, done_on FROM fulfillments WHERE paid_on >= ? OR done_on >= ?').bind(since, since).all()).results;
  return { members, subs, fulfillments };
}

export async function syncWineclub(env, actor = 'sync', day = C.today()) {
  if (!env.WINECLUB_DB) return { ok: true, skipped: true, message: 'Sin conexión a la base del club de vinos (WINECLUB_DB).' };
  const now = Date.now();
  const mapped = C.mapWineclub(await readWineclub(env.WINECLUB_DB, day), day);
  let created = 0, matched = 0, founders = 0, charges = 0, estimated = 0;
  const stmts = [env.DB.prepare('DELETE FROM club_sub_charges'), env.DB.prepare('UPDATE club_people SET sub_commitment = 0 WHERE sub_commitment <> 0')];
  const founderPeople = new Set();
  for (const m of mapped) {
    let p = await env.DB.prepare('SELECT id, wineclub_member_id FROM club_people WHERE wineclub_member_id = ?').bind(m.member_id).first();
    if (!p && m.email) p = await env.DB.prepare('SELECT id, wineclub_member_id FROM club_people WHERE email = ? AND wineclub_member_id IS NULL ORDER BY id LIMIT 1').bind(m.email).first();
    if (!p && m.phone) p = await env.DB.prepare('SELECT id, wineclub_member_id FROM club_people WHERE phone = ? AND wineclub_member_id IS NULL ORDER BY id LIMIT 1').bind(m.phone).first();
    if (p) {
      matched++;
      if (p.wineclub_member_id == null) await env.DB.prepare('UPDATE club_people SET wineclub_member_id = ?, updated_at = ? WHERE id = ?').bind(m.member_id, now, p.id).run();
    } else {
      const r = await env.DB.prepare(`INSERT INTO club_people (card_code, name, phone, email, source, wineclub_member_id, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'wineclub', ?, ?, ?, ?)`).bind(await newCardCode(env), m.name || 'Socio del Círculo', m.phone, m.email, m.member_id, actor, now, now).run();
      p = { id: r.meta.last_row_id }; created++;
    }
    if (m.commitment > 0) stmts.push(env.DB.prepare('UPDATE club_people SET sub_commitment = ? WHERE id = ?').bind(Math.round(m.commitment), p.id));
    if (m.founder) {
      founderPeople.add(p.id); founders++;
      const has = await env.DB.prepare("SELECT 1 FROM club_memberships WHERE person_id = ? AND program_id = 'fundadores' AND status IN ('active', 'pending')").bind(p.id).first();
      if (!has) stmts.push(env.DB.prepare("INSERT INTO club_memberships (person_id, program_id, status, source, created_by, created_at) VALUES (?, 'fundadores', 'active', 'wineclub', ?, ?)").bind(p.id, actor, now));
    }
    for (const c of m.charges) {
      charges++; if (c.estimated) estimated++;
      stmts.push(env.DB.prepare('INSERT OR REPLACE INTO club_sub_charges (key, person_id, day, amount, estimated, synced_at) VALUES (?, ?, ?, ?, ?, ?)').bind(c.key, p.id, c.day, c.amount, c.estimated ? 1 : 0, now));
    }
  }
  // Founders the wine club no longer has: their synced Fundadores program ends (manual ones stay).
  const synced = (await env.DB.prepare("SELECT id, person_id FROM club_memberships WHERE program_id = 'fundadores' AND source = 'wineclub' AND status = 'active'").all()).results;
  let ended = 0;
  for (const s of synced) if (!founderPeople.has(s.person_id)) { ended++; stmts.push(env.DB.prepare("UPDATE club_memberships SET status = 'ended', ended_at = ?, ended_by = ? WHERE id = ?").bind(now, actor, s.id)); }
  const result = { ok: true, members: mapped.length, created, matched, founders, ended, charges, estimated, at: now };
  stmts.push(env.DB.prepare("INSERT INTO club_config (key, value) VALUES ('last_sync', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(result)));
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
  if (created || ended || actor !== 'sync') await clubAudit(env, actor, 'wineclub.sync', 'sync', '', result);
  return result;
}
