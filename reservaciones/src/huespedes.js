// The guest behind each reservation: name, phone and email, kept in this app's own database (table guests).
// They come from Klaviyo through the growth Worker's KlaviyoGuests entrypoint (binding GUESTS), which holds the key and
// returns one page of a reservation metric's events at a time; nothing here talks to Klaviyo directly. Each run reads
// what is new, keeps the newest details per reservation, and deletes guests whose visit was more than RETENCION_DIAS
// days ago (they stay in OpenTable and Klaviyo). Runs on the cron and, at most every few minutes, when the manifest
// finds a reservation without a guest.
import { fechaLocal, sumarDias } from './fechas.js';

export const METRICAS = ['Created Reservation', 'Confirmed Reservation', 'Completed Reservation', 'Cancelled Reservation', 'No Showed Reservation'];
export const RETENCION_DIAS = 90;
/** Once caught up, each run re-reads the last two days: an event can arrive late with an older time. */
const TRASLAPE_MS = 2 * 86_400_000;

const texto = (v, max) => (typeof v === 'string' ? v : '').trim().slice(0, max);

/** Newest event wins; a detail the newer event does not carry never erases a known one. */
function guardar(db, g, ahora) {
  const nuevo = 'excluded.event_at >= guests.event_at';
  const campo = (c) => `${c} = CASE WHEN ${nuevo} AND excluded.${c} <> '' THEN excluded.${c} WHEN guests.${c} <> '' THEN guests.${c} ELSE excluded.${c} END`;
  return db.prepare(`INSERT INTO guests (confirmation_id, first_name, last_name, email, phone, service_date, event_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(confirmation_id) DO UPDATE SET ${campo('first_name')}, ${campo('last_name')}, ${campo('email')}, ${campo('phone')},
      service_date = CASE WHEN ${nuevo} THEN excluded.service_date ELSE guests.service_date END, event_at = MAX(excluded.event_at, guests.event_at), updated_at = excluded.updated_at`)
    .bind(g.confirmationId, g.firstName, g.lastName, g.email, g.phone, g.serviceDate, g.eventAt, ahora);
}

/** What the entrypoint sent, checked again: the other Worker is ours, but what crosses a boundary is still validated. */
function limpio(g, corte) {
  const confirmationId = texto(String(g?.confirmationId ?? ''), 40), eventAt = Number(g?.eventAt);
  if (!/^[A-Za-z0-9-]{1,40}$/.test(confirmationId) || !Number.isFinite(eventAt)) return null;
  const serviceDate = fechaLocal(Number.isFinite(Number(g.scheduledAt)) && g.scheduledAt !== null ? Number(g.scheduledAt) : eventAt);
  if (serviceDate < corte) return null;                       // already past the retention window: never stored
  const out = { confirmationId, eventAt, serviceDate, firstName: texto(g.firstName, 80), lastName: texto(g.lastName, 80), email: texto(g.email, 200), phone: texto(g.phone, 40) };
  return out.firstName || out.lastName || out.email || out.phone ? out : null;
}

export async function sincronizar(env, ahora, { maxPaginas = 12 } = {}) {
  const db = env.DB, corte = sumarDias(fechaLocal(ahora), -RETENCION_DIAS);
  let eventos = 0, guardados = 0, error = '';
  try {
    if (!env.GUESTS) throw new Error('Falta la conexión con Growth (binding GUESTS)');
    const filas = (await db.prepare('SELECT metric, cursor, done FROM guest_sync').all()).results || [];
    let paginas = maxPaginas;
    for (const metric of METRICAS) {
      const s = filas.find((f) => f.metric === metric) || { cursor: null, done: 0 };
      const desde = s.cursor ? new Date(Date.parse(s.cursor) - (s.done ? TRASLAPE_MS : 0)).toISOString() : null;
      let cursor = s.cursor, hecho = !!s.done, pagina = null;
      while (paginas > 0) {
        paginas--;
        const p = await env.GUESTS.page({ metric, since: desde, cursor: pagina });
        if (!p || !p.ready) break;                             // Klaviyo has no such metric yet (or no key): try again next run
        eventos += Number(p.events) || 0;
        const lote = [];
        for (const g of Array.isArray(p.guests) ? p.guests : []) { const ok = limpio(g, corte); if (ok) { lote.push(guardar(db, ok, ahora)); guardados++; } }
        if (typeof p.newest === 'string' && (!cursor || Date.parse(p.newest) > Date.parse(cursor))) cursor = p.newest;
        pagina = typeof p.cursor === 'string' && p.cursor ? p.cursor : null;
        if (!pagina) hecho = true;
        // The page and the note of how far it reached are saved together.
        lote.push(db.prepare('INSERT INTO guest_sync (metric, cursor, done, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(metric) DO UPDATE SET cursor = excluded.cursor, done = excluded.done, updated_at = excluded.updated_at')
          .bind(metric, cursor, hecho ? 1 : 0, ahora));
        for (let i = 0; i < lote.length; i += 50) await db.batch(lote.slice(i, i + 50));
        if (!pagina) break;
      }
    }
  } catch (e) {
    error = String((e && e.message) || e).slice(0, 200);
  }
  let borrados = 0;
  try { borrados = (await db.prepare('DELETE FROM guests WHERE service_date < ?').bind(corte).run()).meta?.changes || 0; } catch (e) { error = error || String((e && e.message) || e).slice(0, 200); }
  await db.prepare(`UPDATE sync_status SET last_run_at = ?, last_ok_at = CASE WHEN ? = '' THEN ? ELSE last_ok_at END, last_error = ?, events = ?, stored = ?, purged = ? WHERE id = 1`)
    .bind(ahora, error, ahora, error, eventos, guardados, borrados).run();
  return { ok: !error, error, eventos, guardados, borrados };
}

export async function estadoSync(db) {
  const s = await db.prepare('SELECT last_run_at, last_ok_at, last_error FROM sync_status WHERE id = 1').first().catch(() => null);
  return { corrio: s?.last_run_at ?? null, bien: s?.last_ok_at ?? null, error: s?.last_error || '' };
}
