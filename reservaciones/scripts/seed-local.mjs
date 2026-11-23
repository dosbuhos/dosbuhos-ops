// Local data for `npm run dev`: fills the two local D1 databases with MADE-UP reservations, guests, checks and
// prepayments shaped like the real ones (open Wednesday to Sunday, 10:00 to 19:00, the same categories and payment
// types). Nothing here is real and nothing touches the remote databases. Run again to start over.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const DIA = 86_400_000, OFF = 6 * 3_600_000;
const hoy = new Date(Date.now() - OFF).toISOString().slice(0, 10);
const mas = (f, n) => new Date(Date.parse(`${f}T00:00:00Z`) + n * DIA).toISOString().slice(0, 10);
const dow = (f) => new Date(`${f}T00:00:00Z`).getUTCDay();
const ms = (f, hhmm) => Date.parse(`${f}T${hhmm}:00-06:00`);
const abierto = (f) => [0, 3, 4, 5, 6].includes(dow(f));

// A small deterministic generator, so every run gives the same restaurant.
let semilla = 20261123;
const azar = () => { semilla |= 0; semilla = (semilla + 0x6d2b79f5) | 0; let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const entre = (a, b) => a + Math.floor(azar() * (b - a + 1));
const uno = (xs) => xs[Math.floor(azar() * xs.length)];
const pesado = (pares) => { const total = pares.reduce((a, [, w]) => a + w, 0); let r = azar() * total; for (const [v, w] of pares) { if ((r -= w) <= 0) return v; } return pares[pares.length - 1][0]; };
const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const fila = (...v) => `(${v.map(q).join(', ')})`;

const MENU = [
  ['Tacos de pato', 'Platos Fuertes', 33000], ['Chuleta de cerdo', 'Platos Fuertes', 39900], ['Rack de cordero', 'Platos Fuertes', 69800], ['Pesca del día', 'Platos Fuertes', 42000],
  ['Pizza champiñones', 'Pizzas', 34500], ['Pizza margarita', 'Pizzas', 29500], ['Tabla de quesos y charcutería', 'Quesos y Charcutería', 57400], ['Ensalada de la huerta', 'Ensaladas', 26000],
  ['Betabel rostizado', 'Vegetales', 21000], ['Papas de la casa', 'Acompañamientos', 9500], ['Pastel de chocolate', 'Postres y Fortificados', 16500], ['Helado de temporada', 'Postres y Fortificados', 12000],
  ['Copa Mosaico Blanco', 'Vinos por Copa', 18500], ['Copa Tempranillo', 'Vinos por Copa', 21000], ['Copa Rosado', 'Vinos por Copa', 17500], ['Botella Mosaico Blanco', 'Vinos por Botella', 72700], ['Botella Tempranillo GR', 'Vinos por Botella', 98000],
  ['Agua de la finca', 'Bebidas', 6000], ['Café', 'Bebidas', 5500], ['Limonada', 'Bebidas', 7500],
];
const TIENDA = [['Tienda Mosaico Blanco 2023', 'Vino Para Llevar', 52700], ['Tienda Tempranillo GR 2022', 'Vino Para Llevar', 69700], ['Tienda Umbral 2024', 'Vino Para Llevar', 52700], ['Tienda Rosado 2024', 'Vino Para Llevar', 45000],
  ['Miel de la finca', 'Tienda Alimentos', 18000], ['Jabón de lavanda', 'Tienda Belleza', 15000], ['Canasta de regalo', 'Tienda Canastas', 95000], ['Taza de barro', 'Tienda Artesanías', 22000]];
const EXPERIENCIAS = [['Tour con degustación de 4 vinos', 'Enoturismo', 70000], ['Degustación 4 vinos', 'Degustaciones', 44000], ['Maridaje', 'Degustaciones', 195000], ['Picnic 2 personas', 'Picnics', 170000]];
const EVENTO = ['Evento privado', 'Eventos', 580000];
const PAGOS = [['Pay TDC', 62], ['Pay TDD', 11], ['Cash', 16], ['Transferencia', 11]];
const HORAS = [[10, 1], [11, 4], [12, 9], [13, 15], [14, 17], [15, 15], [16, 16], [17, 13], [18, 3]];
const MESAS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'ARC1', 'ARC2', 'ARC3', 'ARC4', 'PIC1', 'PIC2', 'PIC3', 'PIR1', 'PIR2', 'PIR3', 'PIR5', 'REC1', 'REC2', 'REC4', 'M5+M6', 'ARC1+ARC2'];
const NOMBRES = ['Ana', 'Luis', 'María', 'Jorge', 'Sofía', 'Diego', 'Lucía', 'Andrés', 'Paula', 'Emilio', 'Carmen', 'Rafael', 'Elena', 'Tomás', 'Julia', 'Héctor', 'Karen', 'Mark', 'Susan', 'Peter'];
const APELLIDOS = ['Prueba', 'Inventado', 'Demostración', 'Ejemplo Ruiz', 'Muestra', 'De la Finca', 'Sample', 'Tester', 'Ficticia', 'Modelo'];
const EXP_OT = [['796500', 70000], ['842882', 45000], ['793495', 195000], ['793530', 97750]];

const growth = [], propia = [];

// ---- The old point of sale: daily totals from September 2025 until two days before Parrot.
for (let f = '2025-09-03'; f <= '2026-08-09'; f = mas(f, 1)) {
  if (!abierto(f)) continue;
  const base = { 0: 49000, 3: 17000, 4: 18000, 5: 22000, 6: 46000 }[dow(f)];
  const neto = Math.round(base * (0.7 + azar() * 0.6)) * 100 / 100, cuentas = Math.round(neto / 3400) + entre(2, 6);
  growth.push(`INSERT INTO pos_daily_history (local_date, source, orders, guests, net_minor, total_minor, dine_in_net_minor, tips_minor, discounts_minor, loaded_at) VALUES ${fila(f, 'wansoft', cuentas, Math.round(cuentas * 1.9), Math.round(neto * 100), Math.round(neto * 116), Math.round(neto * 58), Math.round(neto * 6), 0, 0)};`);
}

// ---- Parrot: checks, items and payments from 11 Aug 2026 to now.
let n = 0;
const ahora = Date.now();
for (let f = '2026-08-12'; f <= hoy; f = mas(f, 1)) {
  if (!abierto(f)) continue;
  const cuantas = Math.round({ 0: 46, 3: 20, 4: 19, 5: 23, 6: 42 }[dow(f)] * (0.75 + azar() * 0.5));
  const ordenes = [], items = [], pagos = [];
  for (let i = 0; i < cuantas; i++) {
    const h = pesado(HORAS), at = ms(f, `${String(h).padStart(2, '0')}:${String(entre(0, 59)).padStart(2, '0')}`);
    if (at > ahora) continue;
    const id = `o${++n}`, mesa = azar() < 0.62, anulada = azar() < 0.012;
    const lineas = [];
    if (mesa) { for (let k = entre(2, 6); k > 0; k--) lineas.push(uno(MENU)); if (azar() < 0.12) lineas.push(EXPERIENCIAS[1]); }
    else if (azar() < 0.45) lineas.push(uno(EXPERIENCIAS), ...(azar() < 0.5 ? [uno(EXPERIENCIAS)] : []));
    else for (let k = entre(1, 3); k > 0; k--) lineas.push(uno(TIENDA));
    if (!mesa && azar() < 0.012) lineas.splice(0, lineas.length, EVENTO);
    let total = 0;
    for (const [nombre, categoria, precio] of lineas) { const cant = azar() < 0.2 ? 2 : 1, t = precio * cant; total += t; items.push(fila(`i${++n}`, id, f, nombre, categoria, '', cant, t, Math.round(t / 1.16), anulada ? 'VOIDED' : 'ACTIVE', at)); }
    const casa = !anulada && azar() < 0.05, descuento = casa ? total : azar() < 0.08 ? Math.round(total * 0.1) : 0;
    const cobrado = anulada ? 0 : total - descuento;
    ordenes.push(fila(id, 'tienda-local', at, f, anulada ? 'VOIDED' : 'FINISHED', mesa ? 'DINE_IN' : 'TAKE_OUT', mesa ? 'Comer aquí' : 'Para llevar', mesa ? uno(MESAS.slice(0, 22)) : '', mesa ? pesado([[1, 30], [2, 35], [3, 12], [4, 14], [5, 5], [6, 3], [8, 1]]) : 1, cobrado, cobrado - Math.round(cobrado / 1.16), descuento, '', at));
    if (cobrado > 0) { const tipo = pesado(PAGOS), propina = tipo.startsWith('Pay') && azar() < 0.7 ? Math.round(cobrado * (0.1 + azar() * 0.05)) : 0; pagos.push(fila(`p${++n}`, id, f, 'CHARGED', tipo, cobrado, propina, at)); }
  }
  const trozos = (tabla, cols, filas) => { for (let i = 0; i < filas.length; i += 40) growth.push(`INSERT INTO ${tabla} (${cols}) VALUES ${filas.slice(i, i + 40).join(', ')};`); };
  trozos('pos_orders', 'uuid, store_uuid, created_at, local_date, status, order_type, order_type_name, table_name, customers, total_minor, taxes_minor, discounts_minor, reference, fetched_at', ordenes);
  trozos('pos_items', 'uuid, order_uuid, local_date, item_name, category, product_type, quantity, total_minor, subtotal_minor, status, fetched_at', items);
  trozos('pos_payments', 'uuid, order_uuid, local_date, status, payment_type, amount_minor, tip_minor, fetched_at', pagos);
}

// ---- OpenTable reservations from 2 Sep 2026, a few weeks ahead, with their guests and some prepaid experiences.
let conf = 60000, ch = 0;
for (let f = '2026-09-02'; f <= mas(hoy, 28); f = mas(f, 1)) {
  if (!abierto(f)) continue;
  const lejos = Math.max(0, (Date.parse(f) - Date.parse(hoy)) / DIA);
  const cuantas = Math.max(0, Math.round({ 0: 13, 3: 6, 4: 5, 5: 7, 6: 11 }[dow(f)] * (0.6 + azar() * 0.8) * (lejos > 0 ? Math.max(0.12, 1 - lejos / 9) : 1)));
  for (let i = 0; i < cuantas; i++) {
    const hh = pesado([[11, 8], [12, 14], [13, 24], [14, 22], [15, 16], [16, 12], [17, 4]]), mm = pesado([['00', 60], ['30', 28], ['15', 6], ['45', 6]]);
    const hora = `${String(hh).padStart(2, '0')}:${mm}`, at = ms(f, hora), personas = pesado([[1, 6], [2, 44], [3, 14], [4, 18], [5, 7], [6, 6], [7, 3], [9, 2]]);
    const pasada = at < ahora - 2 * 3_600_000, enCurso = !pasada && at < ahora + 3_600_000;
    const estado = pasada ? pesado([['completed', 82], ['cancelled', 12], ['no_show', 6]]) : enCurso ? uno(['confirmed', 'created']) : pesado([['created', 55], ['confirmed', 38], ['cancelled', 7]]);
    const creada = at - Math.round(pesado([[0.2, 34], [1, 21], [2.5, 18], [6, 15], [11, 8], [20, 4]]) * DIA * (0.6 + azar() * 0.8));
    const llego = estado === 'completed' && azar() < 0.75 ? at + entre(-12, 18) * 60_000 : null, sentado = llego ? llego + entre(0, 15) * 60_000 : null, salio = sentado && azar() < 0.8 ? sentado + entre(55, 150) * 60_000 : null;
    const id = String(++conf);
    growth.push(`INSERT INTO ot_reservations (confirmation_id, created_at, created_date, scheduled_at, service_date, party_size, origin, status, status_rank, status_at, table_name, arrived_at, seated_at, done_at, pos_total_minor, currency, updated_at) VALUES ${fila(id, creada, new Date(creada - OFF).toISOString().slice(0, 10), at, f, personas, azar() < 0.73 ? 'web' : 'phone', estado, 3, at, azar() < 0.04 ? '' : uno(MESAS), llego, sentado, salio, null, '', ahora - entre(2, 25) * 60_000)};`);
    if (azar() < 0.93) propia.push(`INSERT INTO guests (confirmation_id, first_name, last_name, email, phone, service_date, event_at, updated_at) VALUES ${fila(id, uno(NOMBRES), uno(APELLIDOS), azar() < 0.85 ? `huesped${conf}@example.com` : '', azar() < 0.9 ? `+52 415 555 01${String(entre(0, 99)).padStart(2, '0')}` : '', f, creada, ahora)};`);
    // About a third are prepaid experiences booked on the hour.
    if (mm === '00' && estado !== 'cancelled' && azar() < 0.45) { const [exp, precio] = uno(EXP_OT); growth.push(cargo(f, hora, personas * precio + (azar() < 0.25 ? Math.round(personas * precio * 0.05) : 0), exp, creada)); }
  }
  // Now and then a prepayment whose reservation is not in the feed, and one refunded.
  if (f > hoy && azar() < 0.5) growth.push(cargo(f, uno(['11:00', '12:00', '14:00']), uno([140000, 90000, 390000]), uno(['796500', '842882', '793495']), ms(mas(hoy, -4), '12:00')));
  if (azar() < 0.05) growth.push(cargo(f, '13:00', 140000, '796500', ms(mas(f, -3), '12:00'), 140000));
}
function cargo(f, hora, monto, exp, creado, reembolso = 0) {
  return `INSERT INTO stripe_payments (id, created_at, local_date, currency, amount_minor, refunded_minor, status, disputed, source, kind, experience_id, platform, service_date, service_time, booking_ref, card_country, application, fetched_at) VALUES ${fila(`ch_local${++ch}`, creado, new Date(creado - OFF).toISOString().slice(0, 10), 'MXN', monto, reembolso, 'succeeded', 0, 'opentable', 'experiences', exp, 'Diner Web', f, hora, '', 'MX', '', ahora)};`;
}
propia.push(`UPDATE sync_status SET last_run_at = ${ahora - 6 * 60_000}, last_ok_at = ${ahora - 6 * 60_000} WHERE id = 1;`);

// ---- Write the files and load them into the local databases.
const leer = (dir) => readdirSync(dir).filter((x) => x.endsWith('.sql')).sort().map((x) => readFileSync(`${dir}/${x}`, 'utf8')).join('\n');
rmSync(`${raiz}.wrangler/state`, { recursive: true, force: true });
mkdirSync(`${raiz}.wrangler/seed`, { recursive: true });
writeFileSync(`${raiz}.wrangler/seed/growth.sql`, `${leer(`${raiz}../growth/migrations`)}\n${growth.join('\n')}\n`);
writeFileSync(`${raiz}.wrangler/seed/reservaciones.sql`, `${leer(`${raiz}migrations`)}\n${propia.join('\n')}\n`);
for (const db of ['growth', 'reservaciones']) execFileSync('npx', ['wrangler', 'd1', 'execute', db, '--local', '--file', `.wrangler/seed/${db}.sql`], { cwd: raiz, stdio: ['ignore', 'ignore', 'inherit'] });
console.log(`Datos locales listos: ${growth.length} sentencias en growth, ${propia.length} en reservaciones (todo inventado).`);
