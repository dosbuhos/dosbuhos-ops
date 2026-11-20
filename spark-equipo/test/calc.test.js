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
