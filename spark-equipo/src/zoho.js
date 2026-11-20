// Read-only copies of Zoho Inventory sales orders and invoices, fetched through the Muestras Worker (zoho-inventory/),
// which already holds the Zoho secrets. The direct OAuth path below is only a fallback when the ZOHO binding is absent.

async function accessToken(env) {
  const u = new URL((env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.com') + '/oauth/v2/token');
  u.searchParams.set('refresh_token', env.ZOHO_REFRESH_TOKEN);
  u.searchParams.set('client_id', env.ZOHO_CLIENT_ID);
  u.searchParams.set('client_secret', env.ZOHO_CLIENT_SECRET);
  u.searchParams.set('grant_type', 'refresh_token');
  const j = await (await fetch(u, { method: 'POST' })).json();
  if (!j.access_token) throw new Error('Zoho no entregó token: ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}

// One page of a Zoho list. With the ZOHO binding the Muestras Worker (dosbuhos-ops) makes the call with its own secrets.
async function page(env, token, path, n) {
  if (env.ZOHO) return env.ZOHO.list(path.slice(1), n);
  const u = new URL((env.ZOHO_API_URL || 'https://www.zohoapis.com/inventory/v1') + path);
  u.searchParams.set('organization_id', env.ZOHO_ORG_ID);
  u.searchParams.set('page', String(n));
  u.searchParams.set('per_page', '200');
  const r = await fetch(u, { headers: { Authorization: 'Zoho-oauthtoken ' + token } });
  const j = await r.json();
  if (j.code !== 0) throw new Error(`Zoho ${path}: ${j.message || r.status}`);
  return j;
}

const getMeta = async (env, k) => (await env.DB.prepare('SELECT v FROM meta WHERE k=?').bind(k).first())?.v ?? null;
const setMeta = (env, k, v) => env.DB.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind(k, String(v));

// Walks a Zoho list newest-first. The first runs go back through every page (a few per run, resuming where the last run
// stopped); after that each run re-reads the newest pages. On the 1st of the month the full walk starts again so that
// edits to old documents (voids, corrections) are picked up.
async function walk(env, token, { path, key, cursor, perRun, fresh, save }) {
  const today = new Date().toISOString().slice(0, 10);
  let at = Number(await getMeta(env, cursor) || 1);
  const done = at === 0;
  if (done && today.endsWith('-01') && (await getMeta(env, cursor + '_reset')) !== today) { at = 1; await setMeta(env, cursor + '_reset', today).run(); }
  const full = at !== 0;
  let n = full ? at : 1, last = full ? at + perRun - 1 : fresh, count = 0, more = true;
  for (; n <= last && more; n++) {
    const j = await page(env, token, path, n);
    const rows = j[key] || [];
    if (rows.length) await env.DB.batch(rows.map(save));
    count += rows.length;
    more = !!(j.page_context && j.page_context.has_more_page);
  }
  if (full) await setMeta(env, cursor, more ? n : 0).run();
  return count;
}

export async function syncZoho(env) {
  if (!env.ZOHO && !env.ZOHO_REFRESH_TOKEN) return { skipped: 'Falta la conexión con Zoho' };
  const token = env.ZOHO ? null : await accessToken(env);
  const orders = await walk(env, token, { path: '/salesorders', key: 'salesorders', cursor: 'so_page', perRun: 10, fresh: 2,
    save: (o) => env.DB.prepare(`INSERT INTO orders (id, numero, fecha, cliente_id, cliente, vendedor, total, estado, facturacion, pago) VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET numero=excluded.numero, fecha=excluded.fecha, cliente=excluded.cliente, vendedor=excluded.vendedor, total=excluded.total, estado=excluded.estado, facturacion=excluded.facturacion, pago=excluded.pago`)
      .bind(String(o.salesorder_id), o.salesorder_number, o.date, String(o.customer_id), o.customer_name, (o.salesperson_name || '').trim(), Number(o.total), o.status, o.invoiced_status, o.paid_status) });
  const invoices = await walk(env, token, { path: '/invoices', key: 'invoices', cursor: 'inv_page', perRun: 10, fresh: 2,
    save: (x) => env.DB.prepare(`INSERT INTO invoices (id, fecha, cliente_id, cliente, vendedor, total, estado) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET fecha=excluded.fecha, cliente=excluded.cliente, vendedor=excluded.vendedor, total=excluded.total, estado=excluded.estado`)
      .bind(String(x.invoice_id), x.date, String(x.customer_id), x.customer_name, (x.salesperson_name || '').trim(), Number(x.total), x.status) });
  const pending = (await getMeta(env, 'so_page')) !== '0' || (await getMeta(env, 'inv_page')) !== '0';
  return { orders, invoices, pending };
}
