// Prueba de humo del motor contra `wrangler dev` local: node test/smoke.mjs [http://localhost:8787]
const base = process.argv[2] || 'http://localhost:8787';
let failures = 0;
const api = async (p, body, method) => {
  const r = await fetch(base + '/api' + p, { method: method || (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(`${p}: ${j.error}`);
  return j;
};
const check = (name, cond, extra = '') => { console.log(`${cond ? 'ok ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!cond) failures++; };
const expectFail = async (name, fn) => { try { await fn(); check(name, false, 'no falló'); } catch (e) { check(name, true, e.message); } };
const vmap = async () => Object.fromEntries((await api('/vessels')).vessels.map((v) => [v.code, v]));

// 1. recipientes
await api('/vessels/import', { rows: [
  { code: 'TK-01', capacity_l: 2003, vessel_type: 'fermentación', material: 'inox', kind: 'depósito' },
  { code: 'TK-02', capacity_l: 1996, vessel_type: 'fermentation', material: 'stainless_steel', kind: 'tank' },
  { code: 'TK-03', capacity_l: 1996, vessel_type: 'fermentação', material: 'inox', kind: 'depósito' },
  { code: 'TK-13', capacity_l: 3505, vessel_type: 'armazenamento', material: 'inox', kind: 'depósito', always_full: 'sim' },
  { code: 'SS-600', capacity_l: 613, vessel_type: 'fermentación', material: 'inox', kind: 'depósito' },
  { code: 'AMF-1', capacity_l: 1000, vessel_type: 'fermentación', material: 'barro', kind: 'ánfora' },
  { code: 'PRENSA', capacity_l: 1, vessel_type: 'storage', material: 'inox', kind: 'prensa' },
  { code: 'CARB-1', capacity_l: 20, vessel_type: 'storage', material: 'vidrio', kind: 'garrafón' },
] });
const seq = await api('/vessels/sequence', { prefix: 'BBL', start: 1, count: 4, digits: 3, capacity_l: 225, vessel_type: 'aging', material: 'oak', kind: 'barrel' });
check('secuencia de barricas', seq.created.length === 4);
const dup = await api('/vessels/import', { rows: [{ code: 'TK-01', capacity_l: 1 }] });
check('import omite códigos existentes', dup.created === 0 && dup.skipped.includes('TK-01'));
let V = await vmap();
check('12 recipientes', Object.keys(V).length === 12);

// 2. saldos de apertura
const ob = await api('/opening-balances', { date: '2026-11-01', rows: [
  { vessel_id: V['TK-01'].id, code: 'L07-ROSE', volume: 1895, varieties: 'Tempranillo, Malbec, Syrah', wine_type: 'rosado', vintage: 2026, phase: 'posfermentacion' },
  { vessel_id: V['TK-03'].id, code: 'L09-SB-TK', volume: 1550, varieties: 'Sauvignon Blanc', wine_type: 'blanco', vintage: 2026, phase: 'posfermentacion' },
  { vessel_id: V['BBL-001'].id, code: 'L10-SB00-1', volume: 210, varieties: 'Sauvignon Blanc', wine_type: 'blanco', vintage: 2026, phase: 'crianza' },
  { vessel_id: V['BBL-002'].id, code: 'L10-SB00-2', volume: 210, varieties: 'Sauvignon Blanc', wine_type: 'blanco', vintage: 2026, phase: 'crianza' },
  { vessel_id: V['AMF-1'].id, code: 'L06-OR-A1', volume: 800, unit: 'kg', varieties: 'Moscato Petit Grains', wine_type: 'naranja', vintage: 2026, phase: 'fermentacion' },
  { vessel_id: V['CARB-1'].id, volume: 18, varieties: 'Cabernet Franc', wine_type: 'tinto', vintage: 2026 },
] });
check('saldos: 6 lotes', ob.created.length === 6, ob.created.join(','));
check('código automático', /^26-TI-001$/.test(ob.created[5]), ob.created[5]);
await expectFail('saldo en recipiente ocupado', () => api('/opening-balances', { rows: [{ vessel_id: V['TK-01'].id, volume: 10 }] }));
V = await vmap();

// 3. trasiego con merma y lías (lías sin recipiente → falla; con recipiente → crea lote de lías)
await expectFail('lías sin recipiente', () => api('/operations', { status: 'confirmed', type: 'racking', op_date: '2026-11-03', origins: [{ vessel_id: V['TK-03'].id }], destinations: [{ vessel_id: V['TK-02'].id, volume: 1500 }], loss_l: 20, lees_l: 30 }));
let r = await api('/operations', { status: 'confirmed', type: 'racking', op_date: '2026-11-03', operator_id: 1, origins: [{ vessel_id: V['TK-03'].id }], destinations: [{ vessel_id: V['TK-02'].id, volume: 1500 }], loss_l: 20, lees_l: 30, lees_vessel_id: V['SS-600'].id, notes: 'rack off lees' });
const rackId = r.id;
V = await vmap();
check('trasiego: origen vacío', !V['TK-03'].stay_id);
check('trasiego: destino 1500 L mismo lote', V['TK-02'].stay_volume === 1500 && V['TK-02'].lot_code === 'L09-SB-TK');
check('lías: lote L09-SB-TK-LIAS 30 L', V['SS-600'].stay_volume === 30 && V['SS-600'].lot_code === 'L09-SB-TK-LIAS');
let b = await api('/board');
check('board: TK-03 por limpiar', b.vessels.find((v) => v.code === 'TK-03').flags.includes('limpiar'));
check('board: TK-02 rellenar', b.vessels.find((v) => v.code === 'TK-02').flags.includes('rellenar'));
check('board: TK-13 (tapa flotante) sin rellenar', !b.vessels.find((v) => v.code === 'TK-13').flags.includes('rellenar'));
const fail1 = await api('/operations?status=draft');
check('fallo de confirmación dejó borrador', fail1.operations.length === 1 && fail1.operations[0].lines.length >= 2);
await api(`/operations/${fail1.operations[0].id}`, null, 'DELETE');

// 4. trasiego con destino en blanco = todo el resto; luego revertir
r = await api('/operations', { status: 'confirmed', type: 'filtration', op_date: '2026-11-04', origins: [{ vessel_id: V['TK-02'].id }], destinations: [{ vessel_id: V['TK-13'].id, volume: 500 }, { vessel_id: V['TK-03'].id }] });
V = await vmap();
check('filtración: 500 + resto', V['TK-13'].stay_volume === 500 && V['TK-03'].stay_volume === 1000 && !V['TK-02'].stay_id);
await expectFail('revertir el trasiego anterior (hay op posterior)', () => api(`/operations/${rackId}/revert`, {}));
await api(`/operations/${r.id}/revert`, {});
V = await vmap();
check('revertir filtración', V['TK-02'].stay_volume === 1500 && !V['TK-13'].stay_id && !V['TK-03'].stay_id);

// 5. mezcla prohibida en trasiego, permitida en rellenado
await expectFail('trasiego a depósito con otro lote', () => api('/operations', { status: 'confirmed', type: 'racking', op_date: '2026-11-05', origins: [{ vessel_id: V['TK-01'].id }], destinations: [{ vessel_id: V['TK-02'].id, volume: 100 }] }));
await api('/operations', { status: 'confirmed', type: 'topping', op_date: '2026-11-05', destinations: [{ vessel_id: V['BBL-001'].id }], volume_l: 10, origins: [{ vessel_id: V['CARB-1'].id }] });
V = await vmap();
check('rellenado: barrica 220, garrafón 8', V['BBL-001'].stay_volume === 220 && V['CARB-1'].stay_volume === 8);
await expectFail('rellenado por encima de la capacidad', () => api('/operations', { status: 'confirmed', type: 'topping', op_date: '2026-11-05', destinations: [{ vessel_id: V['BBL-001'].id }], volume_l: 40 }));

// 6. barricas: llenar desde tanque (blank = capacidad) y vaciar
await api('/operations', { status: 'confirmed', type: 'barrel_transfer', mode: 'fill', op_date: '2026-11-06', origins: [{ vessel_id: V['TK-02'].id }], destinations: [{ vessel_id: V['BBL-003'].id }, { vessel_id: V['BBL-004'].id, volume: 200 }] });
V = await vmap();
check('llenar barricas: 225 + 200, tanque 1075, llenados=1', V['BBL-003'].stay_volume === 225 && V['BBL-004'].stay_volume === 200 && V['TK-02'].stay_volume === 1075 && V['BBL-003'].fill_count === 1);
await api('/operations', { status: 'confirmed', type: 'barrel_transfer', mode: 'empty', op_date: '2026-11-07', origins: [{ vessel_id: V['BBL-003'].id }, { vessel_id: V['BBL-004'].id }], destinations: [{ vessel_id: V['TK-02'].id }] });
V = await vmap();
check('vaciar barricas de vuelta al tanque', V['TK-02'].stay_volume === 1500 && !V['BBL-003'].stay_id);
await expectFail('vaciar barricas de lotes distintos a un tanque', () => api('/operations', { status: 'confirmed', type: 'barrel_transfer', mode: 'empty', op_date: '2026-11-07', origins: [{ vessel_id: V['BBL-001'].id }, { vessel_id: V['TK-01'].id }], destinations: [{ vessel_id: V['TK-13'].id }] }));

// 7. sangrado y prensado (lote en kg)
await api('/operations', { status: 'confirmed', type: 'bleeding', op_date: '2026-11-08', origins: [{ vessel_id: V['AMF-1'].id }], destinations: [{ vessel_id: V['TK-03'].id }], volume_l: 100 });
V = await vmap();
check('sangrado: 700 kg quedan, 100 L salen (mismo lote)', V['AMF-1'].stay_volume === 700 && V['TK-03'].stay_volume === 100 && V['TK-03'].lot_code === 'L06-OR-A1' && V['TK-03'].stay_unit === 'L');
await expectFail('prensar un depósito que no está en kg', () => api('/operations', { status: 'confirmed', type: 'bleeding', op_date: '2026-11-08', origins: [{ vessel_id: V['TK-01'].id }], destinations: [{ vessel_id: V['TK-13'].id }], volume_l: 10 }));
r = await api('/operations', { status: 'confirmed', type: 'pressing', op_date: '2026-11-09', origins: [{ vessel_id: V['AMF-1'].id }], press_vessel_id: V['PRENSA'].id, destinations: [{ vessel_id: V['TK-13'].id, volume: 420, fraction: 'free_run' }, { vessel_id: V['BBL-003'].id, volume: 120, fraction: 'press_1', new_lot_code: 'L06-OR-P1' }] });
V = await vmap();
check('prensado: ánfora vacía, free run 420 L lote -FR, prensa 120 L', !V['AMF-1'].stay_id && V['TK-13'].stay_volume === 420 && V['TK-13'].lot_code === 'L06-OR-A1-FR' && V['BBL-003'].lot_code === 'L06-OR-P1');

// 8. coupage en el propio tanque + venta a granel + adición
r = await api('/operations', { status: 'confirmed', type: 'blend', op_date: '2026-11-10', origins: [{ vessel_id: V['BBL-001'].id }, { vessel_id: V['BBL-002'].id }], destinations: [{ vessel_id: V['BBL-001'].id, volume: 225 }, { vessel_id: V['BBL-002'].id }], new_lot: { code: 'SB00-CP', phase: 'crianza' } });
V = await vmap();
check('coupage en sitio: 225 + 205, lote SB00-CP', V['BBL-001'].stay_volume === 225 && V['BBL-002'].stay_volume === 205 && V['BBL-001'].lot_code === 'SB00-CP' && V['BBL-002'].lot_code === 'SB00-CP');
await api('/operations', { status: 'confirmed', type: 'bulk_sale', op_date: '2026-11-11', origins: [{ vessel_id: V['TK-01'].id }], volume_l: 95, buyer: 'Vermouth' });
await api('/products', { name: 'KMBS', category: 'sulfite', unit: 'g' });
const prods = (await api('/products')).products;
await api('/operations', { status: 'confirmed', type: 'addition', op_date: '2026-11-11', origins: [{ vessel_id: V['TK-01'].id }], products: [{ product_id: prods[0].id, product_name: 'KMBS', qty: 95, unit: 'g', note: '25 ppm' }] });
V = await vmap();
check('venta a granel: 1800 L', V['TK-01'].stay_volume === 1800);
await expectFail('adición sin productos', () => api('/operations', { status: 'confirmed', type: 'addition', op_date: '2026-11-11', origins: [{ vessel_id: V['TK-01'].id }], products: [] }));

// 9. borrador → confirmar, edición de confirmada, análisis, cata, limpieza, traza, actividad
r = await api('/operations', { status: 'draft', type: 'racking', op_date: '2026-11-12', origins: [{ vessel_id: V['TK-01'].id }], destinations: [{ vessel_id: V['TK-13'].id }] });
let d = await api(`/operations/${r.id}`);
check('borrador con líneas y payload', d.operation.status === 'draft' && d.operation.lines.length === 2 && d.operation.payload.type === 'racking');
await expectFail('borrador → confirmar con destino ocupado por otro lote', () => api(`/operations/${r.id}`, { status: 'confirmed', type: 'racking', op_date: '2026-11-12', origins: [{ vessel_id: V['TK-01'].id }], destinations: [{ vessel_id: V['TK-13'].id }] }, 'PUT'));
d = await api(`/operations/${r.id}`);
check('tras fallo sigue borrador con líneas', d.operation.status === 'draft' && d.operation.lines.length === 2);
await api(`/operations/${r.id}`, { status: 'confirmed', type: 'racking', op_date: '2026-11-12', origins: [{ vessel_id: V['TK-01'].id }], destinations: [{ vessel_id: V['BBL-004'].id, volume: 10 }], new_lot: { create: true } }, 'PUT');
V = await vmap();
check('nuevo lote en destino (clon)', V['BBL-004'].stay_volume === 10 && V['BBL-004'].lot_code !== 'L07-ROSE' && V['TK-01'].stay_volume === 1790, V['BBL-004'].lot_code);
await api(`/operations/${r.id}`, { status: 'confirmed', type: 'racking', op_date: '2026-11-13', notes: 'editada' }, 'PUT');
d = await api(`/operations/${r.id}`);
check('editar confirmada cambia solo fecha/notas', d.operation.op_date === '2026-11-13' && d.operation.notes === 'editada' && d.operation.status === 'confirmed');
await api('/analyses', { vessel_id: V['TK-01'].id, analysed_at: '2026-11-13', ph: 3.32, so2_free: 25, analysed_by: 'Sentia' });
await api('/tastings', { vessel_id: V['TK-01'].id, tasted_at: '2026-11-13', taster: 'Eric', score: 9, overall: 'perfecto' });
await api('/cleanings', { vessel_id: V['AMF-1'].id, cleaned_at: '2026-11-13', method: 'agua caliente' });
b = await api('/board');
check('board: TK-01 sin flag análisis, AMF-1 limpia', !b.vessels.find((v) => v.code === 'TK-01').flags.includes('analisis') && !b.vessels.find((v) => v.code === 'AMF-1').flags.includes('limpiar'));
const tr = await api(`/trace?vessel=${V['TK-13'].id}`);
check('traza del lote prensado: origen = prensado del ánfora', tr.lot.code === 'L06-OR-A1-FR' && tr.origin && tr.origin.type === 'pressing' && tr.origin.origins[0].lot_code === 'L06-OR-A1');
const tr2 = await api(`/trace?lot=${tr.lot.id}`);
check('traza por lote = por recipiente', tr2.lot.id === tr.lot.id && tr2.stays.length === 1);
const act = await api('/activity');
check('actividad', act.ops30 >= 8 && act.byType.length >= 5, JSON.stringify({ ops30: act.ops30, types: act.byType.length }));
const list = await api('/operations?type=racking');
check('lista filtrada por tipo', list.operations.every((o) => o.type === 'racking') && list.operations.length >= 2);
const srch = await api('/search?q=SB00');
check('búsqueda', srch.lots.some((l) => l.code === 'SB00-CP'));
console.log(failures ? `\n${failures} fallos` : '\nTodo OK');
process.exit(failures ? 1 : 0);
