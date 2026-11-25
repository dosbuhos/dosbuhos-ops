// Zoho, read-only, through the Muestras Worker's ZohoRead binding (it holds the secrets). Arqueo never writes to Zoho.
// Three things are read: the items of Almacén 1 (the SKU mirror and the nightly snapshot), the open órdenes de venta
// (the pick queue), and the invoices (to spot OVs that were billed but never closed).

const lista = async (env, recurso, opciones) => {
  if (!env.ZOHO) throw new Error('Falta la conexión con Zoho (binding ZOHO)');
  return env.ZOHO.list(recurso, opciones);
};

// Every active, stock-tracked item with its Almacén 1 figures. The warehouse filter makes this one call, not 54.
export async function items(env) {
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const r = await lista(env, 'items', { page, status: 'active', warehouse_id: env.ALMACEN_ID });
    for (const i of r.items || []) {
      if (!i.track_inventory || i.item_type !== 'inventory') continue;
      out.push({
        item_id: String(i.item_id),
        sku: i.sku || '',
        nombre: i.name || i.item_name || '',
        stock: Number(i.available_stock ?? i.stock_on_hand ?? 0),
        disponible: Number(i.available_for_sale ?? 0),
      });
    }
    if (!r.page_context || !r.page_context.has_more_page) break;
  }
  return out;
}

const ABIERTAS = new Set(['confirmed', 'partially_shipped', 'approved', 'overdue']);

// Órdenes de venta still waiting to be picked, newest first. Zoho's own status filter is not applied here because
// an order can sit in several sub-states; filtering in code keeps the rule in one readable place.
export async function ordenes(env, paginas = 2) {
  const out = [];
  for (let page = 1; page <= paginas; page++) {
    const r = await lista(env, 'salesorders', { page, sort_column: 'date', sort_order: 'D' });
    for (const o of r.salesorders || []) {
      if (!ABIERTAS.has(o.status) || o.shipped_status === 'fulfilled') continue;
      out.push({
        ov_id: String(o.salesorder_id),
        ov: o.salesorder_number || '',
        cliente: o.customer_name || '',
        fecha: o.date || '',
        vendedor: o.salesperson_name || '',
        botellas: Number(o.quantity || 0),
        entrega: o.delivery_method || '',
        referencia: o.reference_number || '',
      });
    }
    if (!r.page_context || !r.page_context.has_more_page) break;
  }
  return out;
}

// One order's lines for Almacén 1, matched to the SKU mirror. No balances: the count has to stay blind.
export async function orden(env, ovId) {
  const o = await env.ZOHO.order(ovId).catch(() => null);
  if (!o) return null;
  return {
    ov: o.numero || '',
    cliente: o.cliente || '',
    fecha: o.fecha || '',
    vendedor: o.vendedor || '',
    entrega: o.metodo || '',
    lineas: (o.lineas || [])
      .filter((l) => !l.almacen || l.almacen === env.ALMACEN_ID)
      .map((l) => ({ item_id: String(l.item_id || ''), sku: l.sku || '', nombre: l.vino, pedido: Number(l.cantidad || 0) })),
  };
}

// Open OVs that already have a factura referencing them: the bottles are gone but Zoho still holds them committed.
// Invoices here are standalone, with the OV number only as reference_number, which is why Zoho cannot see this itself.
export async function fantasmas(env, abiertas, paginas = 3) {
  const porOv = new Map();
  for (let page = 1; page <= paginas; page++) {
    const r = await lista(env, 'invoices', { page, sort_column: 'date', sort_order: 'D' });
    for (const f of r.invoices || []) {
      const ref = String(f.reference_number || '').trim();
      if (ref && !porOv.has(ref)) porOv.set(ref, f.invoice_number || '');
    }
    if (!r.page_context || !r.page_context.has_more_page) break;
  }
  const hoy = Date.now();
  return abiertas
    .filter((o) => porOv.has(o.ov))
    .map((o) => ({ ...o, factura: porOv.get(o.ov), dias: Math.max(0, Math.floor((hoy - Date.parse(o.fecha || '')) / 86400000)) || 0 }));
}
