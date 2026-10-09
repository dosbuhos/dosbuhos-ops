// Nightly import from Zoho Inventory. Read-only: the sales order already moved the stock,
// the app only tracks custody of the bottles after they leave the winery.

const CONSUMO_RE = /(sale|sali[oó])\s+del\s+(inventario|almac[eé]n)\s+(en\s+)?cdmx/i;
const REPOSICION_RE = /integrar(se)?\s+(al|a)\s+(su\s+)?inventario/i;

async function accessToken(env) {
  const u = new URL((env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.com') + '/oauth/v2/token');
  u.searchParams.set('refresh_token', env.ZOHO_REFRESH_TOKEN);
  u.searchParams.set('client_id', env.ZOHO_CLIENT_ID);
  u.searchParams.set('client_secret', env.ZOHO_CLIENT_SECRET);
  u.searchParams.set('grant_type', 'refresh_token');
  const r = await fetch(u, { method: 'POST' });
  const j = await r.json();
  if (!j.access_token) throw new Error('Zoho no entregó token: ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}

function api(env, token) {
  const base = env.ZOHO_API_URL || 'https://www.zohoapis.com/inventory/v1';
  return async (path, params = {}) => {
    const u = new URL(base + path);
    u.searchParams.set('organization_id', env.ZOHO_ORG_ID);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    const r = await fetch(u, { headers: { Authorization: 'Zoho-oauthtoken ' + token } });
    const j = await r.json();
    if (j.code !== 0) throw new Error(`Zoho ${path}: ${j.message || r.status}`);
    return j;
  };
}

const tc = (n) => n === n.toUpperCase() ? n.toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(Op|Ii|Iii)\b/g, x => x.toUpperCase()) : n;
const wname = (li) => tc((li.name || '').trim()) || ((li.description || '').trim() ? li.description.trim() + ' (sin artículo en Zoho)' : 'Vino sin nombre en Zoho');

export function classify(so) {
  const terms = (so.terms || '') + ' ' + (so.notes || '');
  const consumo = (so.delivery_method || '').toLowerCase() === 'bodega cdmx' || CONSUMO_RE.test(terms);
  const reposicion = !consumo && REPOSICION_RE.test(terms);
  return { consumo, reposicion };
}

export function eventName(so) {
  const t = (so.terms || '').split('\n').map(s => s.trim()).filter(Boolean)
    .filter(s => !(CONSUMO_RE.test(s) && s.length < 60));
  const desc = (so.line_items || []).map(li => (li.description || '').trim()).find(Boolean);
  let name = t[0] || desc || (CONSUMO_RE.test(so.terms || '') ? 'Uso de vino de tu bodega CDMX' : so.salesorder_number);
  name = name.replace(/^producto\s+(utilizado|a utilizar|para|a utilizarse)\s+(en|para)?\s*/i, '');
  name = name.charAt(0).toUpperCase() + name.slice(1);
  return name.length > 90 ? name.slice(0, 87) + '…' : name;
}

// Turns one Zoho sales order into an event + pulls. Idempotent on line_item_id.
export async function importOrder(env, rep, so) {
  const lines = (so.line_items || []).filter(li => Number(li.rate) <= 0.01 && Number(li.quantity) > 0);
  if (!lines.length) return 0;
  const exists = await env.DB.prepare('SELECT 1 FROM pulls WHERE line_id=?').bind(String(lines[0].line_item_id)).first();
  if (exists) return 0;
  const { consumo, reposicion } = classify(so);
  const ev = await env.DB.prepare(
    `INSERT INTO events (rep_id, source, so_number, kind, name, event_date, zoho_terms, status)
     VALUES (?, 'zoho', ?, ?, ?, ?, ?, ?) RETURNING id`)
    .bind(rep.id, so.salesorder_number, reposicion ? 'reposicion' : 'evento', reposicion ? 'Reposición a tu bodega' : eventName(so),
      so.date, (so.terms || '').trim(), reposicion ? 'aprobado' : 'abierto').first();
  const stmts = [];
  for (const li of lines) {
    stmts.push(env.DB.prepare(
      `INSERT INTO pulls (rep_id, so_id, so_number, so_date, line_id, item_id, wine, qty, kind, delivery, terms, event_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(rep.id, String(so.salesorder_id), so.salesorder_number, so.date, String(li.line_item_id), li.item_id ? String(li.item_id) : null,
        wname(li), Number(li.quantity), consumo ? 'consumo' : 'envio', so.delivery_method || '', (so.terms || '').trim(), ev.id));
    stmts.push(env.DB.prepare(
      `INSERT INTO event_lines (event_id, item_id, wine, qty, received) VALUES (?,?,?,?,?)`)
      .bind(ev.id, li.item_id ? String(li.item_id) : null, wname(li), Number(li.quantity), consumo ? 0 : 1));
    if (li.item_id) stmts.push(env.DB.prepare(
      `INSERT INTO wines (item_id, name, sku) VALUES (?,?,?) ON CONFLICT(item_id) DO UPDATE SET name=excluded.name, sku=excluded.sku`)
      .bind(String(li.item_id), li.name, li.sku || null));
  }
  await env.DB.batch(stmts);
  return lines.length;
}

export async function runSync(env) {
  const missing = ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN', 'ZOHO_ORG_ID'].filter(k => !env[k]);
  if (missing.length) {
    const msg = 'Faltan secretos de Zoho: ' + missing.join(', ');
    await env.DB.prepare('INSERT INTO sync_log (ok, message) VALUES (0, ?)').bind(msg).run();
    return { ok: false, message: msg };
  }
  try {
    const token = await accessToken(env);
    const get = api(env, token);
    const { results: reps } = await env.DB.prepare('SELECT * FROM reps WHERE active=1').all();
    let orders = 0, lines = 0;
    for (const rep of reps) {
      for (const cid of JSON.parse(rep.zoho_customer_ids || '[]')) {
        for (let page = 1; page < 20; page++) {
          const j = await get('/salesorders', { customer_id: cid, date_start: rep.sync_from, per_page: '200', page: String(page) });
          for (const s of j.salesorders || []) {
            if (['void', 'draft'].includes(s.status)) continue;
            const known = await env.DB.prepare('SELECT 1 FROM pulls WHERE so_id=?').bind(String(s.salesorder_id)).first();
            if (known) continue;
            const d = await get('/salesorders/' + s.salesorder_id);
            const n = await importOrder(env, rep, d.salesorder);
            if (n) { orders++; lines += n; }
          }
          if (!j.page_context || !j.page_context.has_more_page) break;
        }
      }
    }
    // List prices for wines we have not priced yet.
    const { results: unpriced } = await env.DB.prepare('SELECT item_id FROM wines WHERE price=0 LIMIT 40').all();
    for (const w of unpriced) {
      try {
        const j = await get('/items/' + w.item_id);
        if (j.item && j.item.rate) await env.DB.prepare('UPDATE wines SET price=? WHERE item_id=?').bind(Number(j.item.rate), w.item_id).run();
      } catch (e) { /* inactive item; leave unpriced */ }
    }
    const msg = `${orders} órdenes nuevas, ${lines} líneas`;
    await env.DB.prepare('INSERT INTO sync_log (ok, message) VALUES (1, ?)').bind(msg).run();
    return { ok: true, message: msg };
  } catch (e) {
    await env.DB.prepare('INSERT INTO sync_log (ok, message) VALUES (0, ?)').bind(String(e.message || e).slice(0, 500)).run();
    return { ok: false, message: String(e.message || e) };
  }
}
