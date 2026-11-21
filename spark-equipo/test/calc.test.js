import test from 'node:test';
import assert from 'node:assert/strict';
import { build, paraVer, lunes, matcher, vendedorDe, esContacto, clientesPorAno, metricasPedidos, copeoEnNotas } from '../src/calc.js';
import { rowsFromValues } from '../src/sheets.js';
import zonasCfg from '../src/data/zonas.json' with { type: 'json' };
import prospectos from '../src/data/prospectos.json' with { type: 'json' };

const hoy = '2026-11-20'; // a Friday
const a = (persona, fecha, cuenta, extra = {}) => ({ persona, fecha, cuenta, actividad: 'Seguimiento', medio: 'Presencial', tipo: '', resultado: '', siguiente_paso: '', proximo: '', etapa: '', ...extra });
const inv = (id, fecha, cliente, vendedor, total) => ({ id, fecha, cliente_id: cliente, cliente, vendedor, total, estado: 'paid' });
const base = (over = {}) => build({ activity: [], orders: [], invoices: [], alias: [], zonasCfg, prospectos, hoy, ...over });

test('helpers', () => {
  assert.equal(lunes('2026-11-20'), '2026-11-16');
  assert.equal(lunes('2026-11-16'), '2026-11-16');
  assert.equal(vendedorDe('José Luis Pérez '), 'José Luis');
  assert.equal(vendedorDe('Carlos Tapia'), 'Carlos');
  assert.equal(vendedorDe('Diane'), null);
  assert.equal(esContacto({ actividad: 'Junta interna' }), false);
  assert.equal(esContacto({ actividad: 'Prospección', cuenta: 'atrio' }), true);
});

test('alias table links a CRM name to the Zoho client', () => {
  const m = matcher([{ cliente: 'Tessera Capital SA de CV', claves: 'numu' }]);
  assert.equal(m('Numu', 'Tessera Capital SA de CV'), true);
  assert.equal(m('atrio', 'Tessera Capital SA de CV'), false);
  assert.equal(m('', 'Tessera Capital SA de CV'), false);
});

test('week verdicts: zero, weak, halfway, productive, and no data before the first row', () => {
  const act = [];
  for (let i = 0; i < 30; i++) act.push(a('José Luis', '2026-11-03', 'c' + i));  // week of Nov 2: 30
  for (let i = 0; i < 15; i++) act.push(a('José Luis', '2026-10-27', 'c' + i));  // week of Oct 26: 15
  act.push(a('José Luis', '2026-10-13', 'x'));                                    // week of Oct 12: 1; Oct 19 and Nov 9: 0
  act.push(a('Carlos', '2026-11-10', 'y'));
  const m = base({ activity: act });
  const v = (w, p) => m.semanas.find((r) => r.semana === w && r.persona === p).veredicto;
  assert.equal(v('2026-11-02', 'José Luis'), 'Productiva');
  assert.equal(v('2026-10-26', 'José Luis'), 'A medias');
  assert.equal(v('2026-10-12', 'José Luis'), 'Floja');
  assert.equal(v('2026-10-19', 'José Luis'), 'En cero');
  assert.equal(v('2026-10-19', 'Carlos'), 'Sin datos');
  assert.equal(v('2026-11-09', 'José Luis'), 'Pendiente');   // nothing logged after Nov 3: not a gap yet
  assert.equal(v('2026-11-16', 'José Luis'), 'Pendiente');
  const cur = m.semanas.find((r) => r.semana === '2026-11-16' && r.persona === 'José Luis');
  assert.equal(cur.meta, 30); assert.equal(cur.en_curso, true);
  assert.equal(base({ hoy: '2026-11-17' }).semanas.find((r) => r.persona === 'Carlos').meta, 12); // Tuesday: 2 working days
});

test('follow-up states', () => {
  const m = base({ activity: [a('Carlos', '2026-11-01', 'Uno', { proximo: '2026-11-10' }), a('Carlos', '2026-11-18', 'Dos', { proximo: '2026-11-30' }),
    a('Carlos', '2026-11-05', 'Tres'), a('Carlos', '2026-11-06', 'Cuatro', { siguiente_paso: 'Cerrado - no interesa' })] });
  const e = Object.fromEntries(m.seguimiento.map((r) => [r.cuenta, r]));
  assert.equal(e.Uno.estado, 'vencida'); assert.equal(e.Uno.dias_vencido, 10);
  assert.equal(e.Dos.estado, 'al día'); assert.equal(e.Tres.estado, 'sin fecha'); assert.equal(e.Cuatro.estado, 'cerrada');
});

test('year over year compares against the same date last year', () => {
  const c = clientesPorAno([inv('1', '2025-03-01', 'A', 'Carlos Tapia', 100), inv('2', '2025-12-15', 'A', 'Carlos Tapia', 500), inv('3', '2026-02-01', 'A', 'Carlos Tapia', 150),
    { ...inv('4', '2026-02-02', 'A', 'Carlos Tapia', 999), estado: 'void' }], hoy)[0];
  assert.deepEqual([c.pasado, c.pasado_mp, c.actual, c.cambio_pct], [600, 100, 150, 50]);
});

test('a rep sees the whole team but never Efectividad', () => {
  const m = base({ activity: [a('Carlos', '2026-11-10', 'y'), a('José Luis', '2026-11-10', 'z')], invoices: [inv('1', '2026-02-01', 'A', 'Carlos Tapia', 150), inv('2', '2026-02-01', 'B', 'José Luis P', 150)] });
  const v = paraVer(m, { admin: false, persona: 'Carlos' });
  assert.ok(v.semanas.some((r) => r.persona === 'José Luis') && v.contactos.some((r) => r.persona === 'José Luis'));
  assert.deepEqual(v.efectividad, []);
  assert.equal(v.yo.persona, 'Carlos');
  assert.equal(paraVer(m, { admin: true }).efectividad.length, 3);
});

test('a count becomes contacts per day and estimated hours', () => {
  const act = [];
  for (let i = 0; i < 7; i++) act.push(a('José Luis', '2026-11-03', 'v' + i));                                   // 7 visits
  for (let i = 0; i < 4; i++) act.push(a('José Luis', '2026-11-04', 'l' + i, { medio: 'Llamada' }));              // 4 calls
  for (let i = 0; i < 2; i++) act.push(a('José Luis', '2026-11-05', 'w' + i, { medio: 'WhatsApp' }));             // 2 messages
  const m = base({ activity: act });
  const w = m.semanas.find((r) => r.semana === '2026-11-02' && r.persona === 'José Luis');
  assert.deepEqual([w.contactos, w.por_dia, w.presencial, w.llamadas, w.mensajes, w.horas, w.horas_habiles], [13, 2.6, 7, 4, 2, 7.8, 40]);
  const mes = m.meses.find((r) => r.mes === '2026-11' && r.persona === 'José Luis');
  assert.deepEqual([mes.contactos, mes.habiles, mes.meta, mes.veredicto], [13, 15, 90, 'Flojo']);              // Nov 2–20, from the Monday of the first logged week: 15 working days
});

test('zones and prospects come out complete', () => {
  const m = base();
  assert.equal(m.zonas.length, 9);
  assert.equal(m.prospectos.length, prospectos.length);
  assert.ok(m.prospectos.every((p) => ['dist', 'tienda', 'horeca', 'cliente'].includes(p.clase)));
  assert.ok(m.prospectos.some((p) => p.clase === 'dist'));
});

test('sheet rows: header and undated rows are dropped', () => {
  const rows = rowsFromValues('Carlos', [['Fecha', 'Zona', 'Cuenta'], ['2026-09-07', 'SMA', ' atrio '], ['', '', 'sin fecha'], ['7/9/2026', 'SMA', 'mal']]);
  assert.equal(rows.length, 1); assert.equal(rows[0].cuenta, 'atrio'); assert.equal(rows[0].persona, 'Carlos'); assert.equal(rows[0].pedido, '');
});

test('suggestions: which accounts need one, and reading the reply', async () => {
  const { pendientes, leer } = await import('../src/ai.js');
  const act = [a('Carlos', '2026-11-01', 'Uno', { proximo: '2026-11-10', resultado: 'no estaba el que paga' }), a('Carlos', '2026-11-18', 'Dos', { proximo: '2026-11-30', resultado: 'probaron el vino' }),
    a('Carlos', '2026-11-06', 'Cuatro', { siguiente_paso: 'Cerrado - no interesa', resultado: 'x' }), a('Carlos', '2026-11-05', 'Tres')];
  const m = base({ activity: act });
  const q = pendientes(m.seguimiento, act, [], hoy);
  assert.deepEqual(q.map((x) => x.clave), ['uno', 'dos']);           // overdue first; closed and note-less accounts are skipped
  assert.match(q[0].datos.seguimiento, /vencido hace 10 días/);
  assert.equal(pendientes(m.seguimiento, act, [{ persona: 'Carlos', clave: 'uno', firma: q[0].firma }], hoy).length, 1);
  assert.deepEqual(leer('Claro:\n```json\n[{"i":0,"paso":"Llama hoy"},{"i":"x"}]\n```'), [{ i: 0, paso: 'Llama hoy' }]);
  assert.deepEqual(leer('sin json'), []);
});

test('ordering metrics: new clients, repeat rate, rhythm and who is overdue', () => {
  const o = (fecha, cliente, total = 1000) => ({ fecha, cliente, vendedor: 'Carlos', total });
  const ord = [o('2025-01-10', 'Viejo'), o('2025-03-10', 'Viejo'), o('2025-05-10', 'Viejo'), o('2025-07-10', 'Viejo'),   // every ~60 days, last one 16 months ago
    o('2026-03-01', 'Ritmo'), o('2026-04-01', 'Ritmo'), o('2026-05-01', 'Ritmo'), o('2026-06-01', 'Ritmo'),               // monthly, then silent since June
    o('2026-06-15', 'Volvio'), o('2026-08-15', 'Volvio'), o('2026-07-01', 'Una vez'),                                    // two clients new this year: one came back
    o('2026-11-17', 'Recien', 5000), o('2026-11-03', 'Del mes')];
  const m = metricasPedidos(ord, hoy), c = Object.fromEntries(m.clientes.map((x) => [x.cliente, x])), r = m.resumen[0];
  assert.equal(c.Viejo.estado, 'Inactivo');
  assert.deepEqual([c.Ritmo.cada_dias, c.Ritmo.estado], [31, 'Ya le tocaba']);
  assert.equal(c.Recien.estado, 'Nuevo');
  assert.deepEqual(r.nuevos_semana, ['Recien']);
  assert.deepEqual(r.nuevos_mes.sort(), ['Del mes', 'Recien']);
  assert.deepEqual([r.recompra_base, r.recompra_n, r.recompra_pct], [3, 2, 67]);     // Ritmo, Volvio, Una vez had 60+ days to reorder
  assert.deepEqual(r.ya_les_tocaba.map((x) => x.cliente), ['Ritmo']);
  assert.equal(r.nuevos_por_mes.at(-1).n, 2);
});

test('copeo is picked up from the notes, one line per account', () => {
  const rows = [a('Daniel', '2026-11-10', 'Rosetta', { resultado: 'Ya tienen el rosado en copeo' }), a('Daniel', '2026-10-01', 'Rosetta', { resultado: 'proponer vino por copa' }), a('Daniel', '2026-11-01', 'Otro', { resultado: 'sin interés' })];
  const c = copeoEnNotas(rows);
  assert.equal(c.length, 1); assert.deepEqual([c[0].cuenta, c[0].fecha, c[0].menciones], ['Rosetta', '2026-11-10', 2]);
});

test('house accounts and samples are nobody\'s sales; La Competencia is reported under Eric', () => {
  const o = (id, cliente, vendedor, total) => ({ id, numero: id, fecha: '2026-11-10', cliente_id: cliente, cliente, vendedor, total, estado: 'confirmed', facturacion: 'invoiced', pago: 'paid' });
  const orders = [o('1', 'DOS BUHOS - ERIC', 'José Luis Zamora', 1210), o('2', 'JOSE LUIS MUESTRAS', 'José Luis Zamora', 500), o('3', 'Carlos Tapia La Competencia Imports', 'Carlos Tapia', 64000), o('4', 'Atrio', 'José Luis Zamora', 9000), o('5', 'TIENDA ONLINE - DOS BUHOS', 'José Luis Zamora', 5908)];
  const m = base({ orders, invoices: orders.map((x) => ({ ...x, estado: 'paid' })) });
  assert.deepEqual(m.ordenes.map((x) => x.cliente), ['Atrio']);
  assert.deepEqual(m.clientes.map((x) => x.cliente), ['Atrio']);
  assert.deepEqual([m.eric[0].cliente, m.eric[0].actual, m.eric[0].ultima], ['La Competencia Imports', 64000, '2026-11-10']);
  assert.equal(m.mes.find((x) => x.vendedor === 'Carlos').total, 0);
});

test('client book: contact details come from the notes, and "NA" is not a contact', () => {
  const o = { id: '1', numero: '1', fecha: '2026-11-10', cliente_id: 'a', cliente: 'Atrio', vendedor: 'José Luis Zamora', total: 9000, estado: 'paid', facturacion: 'invoiced', pago: 'paid' };
  const act = [a('José Luis', '2026-11-12', 'atrio', { contacto: 'NA', telefono: 'por conseguir' }), a('José Luis', '2026-11-01', 'Atrio', { contacto: 'Luis', telefono: '415 688 1405 / luis@atrio.mx' })];
  const d = base({ orders: [o], invoices: [o], activity: act, alias: [{ cliente: 'Atrio', claves: 'atrio' }] }).directorio[0];
  assert.deepEqual([d.nombre, d.contacto, d.telefono, d.email, d.vendedor], ['Atrio', 'Luis', '415 688 1405', 'luis@atrio.mx', 'José Luis']);
});

test('a house sale is carved out of the rep, and Carlos\'s distributor file marks prospects as contacted', () => {
  const o = (numero, fecha, cliente, vendedor, total) => ({ id: numero, numero, fecha, cliente_id: cliente, cliente, vendedor, total, estado: 'fulfilled', facturacion: 'invoiced', pago: 'paid' });
  const orders = [o('A1', '2026-07-01', 'Cliente Uno', 'José Luis Zamora', 1000), o('A2', '2026-10-07', 'Cliente Uno', 'Tito', 5000)];
  const distribuidores = [{ nombre: 'HEB', zona: 'noreste', plaza: 'Monterrey', tipo: 'Cadena Autoservicio', grupo: 'Rechazada', ultimo: '2026-10-14', status: 'No cataloga este año', avance: '', comentarios: '', contacto: '', telefono: '', email: '' },
    { nombre: 'Distribuidor Nuevo', zona: 'golfo', plaza: 'Veracruz', tipo: 'Distribuidor', grupo: 'En proceso', ultimo: '2026-08-27', status: 'Buscando contacto', avance: '', comentarios: '', contacto: '', telefono: '', email: '' }];
  const m = base({ orders, invoices: orders, distribuidores });
  const uno = m.clientes.filter((c) => c.cliente === 'Cliente Uno');
  assert.deepEqual(uno.map((c) => [c.vendedor, c.actual]).sort(), [['José Luis', 1000], ['Tito', 5000]]);
  assert.equal(m.mes.some((r) => r.vendedor === 'Tito'), true);
  assert.equal(m.semanas.filter((w) => w.persona === 'Tito').every((w) => w.meta === 0), true);
  const heb = m.prospectos.find((p) => p.nombre === 'HEB');
  assert.equal(heb.avance, 'Rechazado'); assert.equal(heb.ultimo_contacto, '2026-10-14'); assert.equal(heb.contacto_por, 'Carlos');
  assert.equal(m.prospectos.length, prospectos.length + 1);
  assert.equal(m.seguimiento.some((r) => r.cuenta === 'Distribuidor Nuevo' && r.persona === 'Carlos' && r.de_archivo), true);
  assert.equal(m.zonas.find((z) => z.zona === 'golfo').en_proceso >= 1, true);
});
