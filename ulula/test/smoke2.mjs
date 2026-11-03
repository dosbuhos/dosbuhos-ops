// Prueba de humo de los módulos nuevos (viñedo, vendimia, embotellado, inventario, configuración, panel). Ejecutar tras smoke.mjs.
const base = process.argv[2] || 'http://localhost:8787';
let failures = 0;
const api = async (p, body, method) => { const r = await fetch(base + '/api' + p, { method: method || (body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); const j = await r.json(); if (!r.ok) throw new Error(`${p}: ${j.error}`); return j; };
const check = (name, cond, extra = '') => { console.log(`${cond ? 'ok ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); if (!cond) failures++; };
const expectFail = async (name, fn) => { try { await fn(); check(name, false, 'no falló'); } catch (e) { check(name, true, e.message); } };
const vmap = async () => Object.fromEntries((await api('/vessels')).vessels.map((v) => [v.code, v]));

// configuración
await api('/company', { name: 'Dos Búhos', production_mode: 'organic', sugar_unit: 'brix', lot_numbering: 'custom', lot_pattern: 'L{YY}{NNNN}' }, 'PUT');
let c = (await api('/company')).company; check('empresa guardada', c.lot_pattern === 'L{YY}{NNNN}' && c.production_mode === 'organic');
let u = await api('/users', { name: 'Paris', email: 'elian875mg@gmail.com', role: 'operator', area: 'winery' });
check('usuario creado', !!u.id);
let loc1 = await api('/locations', { name: 'Sala de barricas', kind: 'room' });
let loc2 = await api('/locations', { name: 'Fila 1', kind: 'row', parent_id: loc1.id });
let locs = (await api('/locations')).locations; check('ubicaciones jerárquicas', locs.find((l) => l.id === loc2.id).path === 'Sala de barricas › Fila 1');
await expectFail('borrar ubicación con hijas', () => api(`/locations/${loc1.id}`, null, 'DELETE'));
let V = await vmap();
await api('/vessels/bulk', { action: 'location', ids: [V['BBL-001'].id, V['BBL-002'].id], location_id: loc2.id });
await api('/vessels/bulk', { action: 'note', ids: [V['BBL-001'].id], text: 'Duela rezumando', by_name: 'Paris' });
await api('/vessels/bulk', { action: 'cleaning', ids: [V['TK-13'].id], method: 'agua caliente' });
V = await vmap(); check('acción en lote: ubicación', V['BBL-001'].location_name === 'Fila 1' && V['BBL-002'].location_name === 'Fila 1');
const notes = (await api(`/vessels/notes?vessel=${V['BBL-001'].id}`)).notes; check('nota en lote', notes.length === 1 && notes[0].text === 'Duela rezumando');
await api(`/vessels/${V['BBL-001'].id}`, { barrel_status: 'full', grain: 'fine', toast_level: 'medium' }, 'PUT');
V = await vmap(); check('atributos de barrica', V['BBL-001'].barrel_status === 'full' && V['BBL-001'].grain === 'fine');

// viñedo
await expectFail('parcela sin superficie', () => api('/parcels', { code: 'X', vineyard: 'Y', variety: 'Z' }));
const pa = await api('/parcels', { code: 'SB-N', vineyard: 'Santa Gloria', variety: 'Sauvignon Blanc', area_ha: 1.2, planted_year: 2006, production_mode: 'organic', geojson: { type: 'Polygon', coordinates: [[[-100.74, 20.9], [-100.73, 20.9], [-100.73, 20.91], [-100.74, 20.9]]] } });
const pb = await api('/parcels', { code: 'TE-S', vineyard: 'Santa Gloria', variety: 'Tempranillo', area_ha: 0.8 });
let ps = (await api('/parcels')).parcels; check('2 parcelas con geojson', ps.length === 2 && ps[0].geojson?.type === 'Polygon');
await api('/phenology', { parcel_id: pa.id, observed_at: '2026-03-20', stage: 'C', operator_name: 'Eric' });
await api('/phenology/batch', { parcel_ids: [pa.id, pb.id], observed_at: '2026-05-10', stage: 'I' });
let ph = (await api(`/phenology?parcel=${pa.id}`)).records; check('fenología por parcela', ph.length === 2 && ph[0].stage === 'I');
await expectFail('estadio inválido', () => api('/phenology', { parcel_id: pa.id, stage: 'Z' }));
await api('/field-ops', { op_type: 'pruning', started_at: '2026-02-01', ended_at: '2026-02-03', parcel_ids: [pa.id, pb.id], crew: 'Adrián + 2', equipment: 'Tijeras' });
await expectFail('labor con fin antes del inicio', () => api('/field-ops', { op_type: 'mowing', started_at: '2026-02-05', ended_at: '2026-02-01', parcel_ids: [pa.id] }));
let fo = (await api('/field-ops')).ops; check('labores', fo.length === 1 && fo[0].parcel_ids.length === 2);
const inp = await api('/spray/inputs', { input_type: 'pesticide', name: 'Azufre mojable', active_ingredient: 'Azufre 80%', rei_hours: 24, phi_days: 5, default_rate: 3, unit: 'kg/ha' });
const app = await api('/spray/apps', { started_at: '2026-11-02 08:00', ended_at: '2026-11-02 10:00', applicator: 'Adrián', method: 'ground', blocks: [{ parcel_id: pa.id, area_ha: 1.2 }], products: [{ input_id: inp.id, input_type: 'pesticide', name: 'Azufre mojable', active_ingredient: 'Azufre 80%', rate: 3, unit: 'kg/ha', total: 3.6, rei_hours: 24, phi_days: 5 }] });
await expectFail('corrección sin motivo', () => api(`/spray/apps/${app.id}`, { started_at: '2026-11-02 08:00', ended_at: '2026-11-02 10:30', applicator: 'Adrián', blocks: [{ parcel_id: pa.id, area_ha: 1.2 }], products: [{ name: 'Azufre mojable', active_ingredient: 'Azufre 80%' }] }, 'PUT'));
await api(`/spray/apps/${app.id}`, { started_at: '2026-11-02 08:00', ended_at: '2026-11-02 10:30', applicator: 'Adrián', blocks: [{ parcel_id: pa.id, area_ha: 1.2 }], products: [{ name: 'Azufre mojable', active_ingredient: 'Azufre 80%', phi_days: 5 }], correction_reason: 'hora de fin mal anotada' }, 'PUT');
let sa = await api('/spray/apps'); check('aplicación corregida con historial', sa.apps[0].version === 2 && sa.apps[0].history.length === 1);
check('restricciones PHI vigentes', sa.restrictions.some((r) => r.kind === 'phi' && r.parcel_id === pa.id), JSON.stringify(sa.restrictions.map((r) => r.kind)));
await api('/maturation', { parcel_id: pa.id, sampled_at: '2026-08-20', brix: 21.5, ph: 3.2, ta: 7.1, berry_weight_100: 140, ammonium: 60, alpha_amino: 120 });
let ms = (await api('/maturation')).samples; check('muestra de maduración', ms.length === 1 && ms[0].parcel_code === 'SB-N');

// vendimia → prensado (recipientes nuevos y vacíos)
await api('/vessels/import', { rows: [{ code: 'TK-20', capacity_l: 1000, vessel_type: 'fermentation', material: 'inox', kind: 'tank' }, { code: 'TK-21', capacity_l: 1000, vessel_type: 'fermentation', material: 'inox', kind: 'tank' }, { code: 'TK-22', capacity_l: 1000, vessel_type: 'fermentation', material: 'inox', kind: 'tank' }] });
V = await vmap();
const rec = await api('/harvest', { received_at: '2026-08-28', origin: 'own', parcel_id: pa.id, variety: 'Sauvignon Blanc', wine_type: 'blanco', weight_kg: 1200, brix: 22, process: 'maceration', destinations: [{ vessel_id: V['TK-20'].id, kg: 400 }, { vessel_id: V['TK-21'].id }] });
check('recepción crea lote en kg con numeración personalizada', /^L26\d{4}$/.test(rec.lot_code), rec.lot_code);
V = await vmap(); check('kg repartidos 400 + 800', V['TK-20'].stay_volume === 400 && V['TK-21'].stay_volume === 800 && V['TK-21'].stay_unit === 'kg');
await expectFail('recepción a depósito ocupado', () => api('/harvest', { received_at: '2026-08-29', origin: 'purchased', parcel_label: 'Comprada', variety: 'Merlot', wine_type: 'tinto', weight_kg: 100, destinations: [{ vessel_id: V['TK-20'].id }] }));
const rec2 = await api('/harvest', { received_at: '2026-08-29', origin: 'purchased', parcel_label: 'Viñedo vecino', variety: 'Chenin Blanc', wine_type: 'blanco', weight_kg: 500, process: 'direct_press', yield_l_per_kg: 0.6, destinations: [{ vessel_id: V['TK-22'].id }] });
V = await vmap(); check('prensado directo → 300 L', V['TK-22'].stay_volume === 300 && V['TK-22'].stay_unit === 'L');
let fe = await api('/fermentations'); check('fermentaciones activas incluyen los lotes nuevos', fe.rows.some((r) => r.lot_code === rec.lot_code) && fe.rows.some((r) => r.lot_code === rec2.lot_code));
const lotB = fe.rows.find((r) => r.lot_code === rec2.lot_code);
await api('/fermentations/readings', { lot_id: lotB.lot_id, vessel_id: lotB.vessel_id, read_at: '2026-08-30 08:00', sugar: 21.0, temp: 16, recorded_by: 'Paris', shift: 'morning' });
await api('/fermentations/readings', { lot_id: lotB.lot_id, vessel_id: lotB.vessel_id, read_at: '2026-08-31 08:00', sugar: 18.5, temp: 17, recorded_by: 'Paris', shift: 'morning' });
await expectFail('lectura sin quién', () => api('/fermentations/readings', { lot_id: lotB.lot_id, sugar: 10 }));
fe = await api('/fermentations'); const rowB = fe.rows.find((r) => r.lot_id === lotB.lot_id); check('lecturas + velocidad', rowB.readings === 2 && rowB.rate === 2.5, JSON.stringify({ r: rowB.readings, rate: rowB.rate }));
await api(`/fermentations/${lotB.lot_id}/done`, {}); fe = await api('/fermentations'); check('fermentación terminada sale de la lista', !fe.rows.some((r) => r.lot_id === lotB.lot_id));
const tr = await api(`/trace?lot=${lotB.lot_id}`); check('traza con lecturas', tr.readings.length === 2);

// inventario: entradas, FEFO en adición, recuento, auditoría
const prods = (await api('/products')).products; const kmbs = prods.find((p) => p.name === 'KMBS');
await api('/product-batches', { product_id: kmbs.id, supplier_lot: 'K-OLD', received_at: '2026-01-10', expires_at: '2026-12-31', qty: 100 });
await api('/product-batches', { product_id: kmbs.id, supplier_lot: 'K-NEW', received_at: '2026-06-10', expires_at: '2027-12-31', qty: 500 });
let inv = await api('/inventory'); check('inventario: KMBS stock 600', inv.consumables.find((p) => p.id === kmbs.id).stock === 600);
V = await vmap();
const addOp = await api('/operations', { status: 'confirmed', type: 'addition', op_date: '2026-11-12', origins: [{ vessel_id: V['TK-01'].id }], products: [{ product_id: kmbs.id, product_name: 'KMBS', qty: 150, unit: 'g' }] });
let bt = (await api('/product-batches')).batches; const old = bt.find((b) => b.supplier_lot === 'K-OLD'), nw = bt.find((b) => b.supplier_lot === 'K-NEW');
check('FEFO: agota el viejo (100) y toma 50 del nuevo', old.qty_available === 0 && old.status === 'depleted' && nw.qty_available === 450);
const opd = await api(`/operations/${addOp.id}`); check('línea de producto con lotes', /K-OLD \(100\).*K-NEW \(50\)/.test(opd.operation.lines.find((l) => l.side === 'product').line_note));
await api(`/operations/${addOp.id}/revert`, {}); bt = (await api('/product-batches')).batches; check('revertir devuelve a los lotes', bt.find((b) => b.supplier_lot === 'K-OLD').qty_available === 100 && bt.find((b) => b.supplier_lot === 'K-NEW').qty_available === 500);
await api(`/product-batches/${nw.id}/count`, { qty: 480 }); bt = (await api('/product-batches')).batches; check('recuento físico', bt.find((b) => b.id === nw.id).qty_available === 480);
await api(`/product-batches/${old.id}/status`, { status: 'quarantine' }); bt = (await api('/product-batches')).batches; check('cuarentena', bt.find((b) => b.id === old.id).status === 'quarantine');
const audit = await api('/product-batches/fefo-audit'); check('auditoría FEFO responde', typeof audit.movements === 'number');

// embotellado
await expectFail('sesión sin producto terminado', () => api('/bottling', { vessel_id: V['TK-01'].id, volume_l: 100, bottles: 133 }));
const fp = await api('/finished-products', { code: 'ROSE-26', name: 'Rosé 2026', category: 'rosado', vintage: 2026, bottle_ml: 750 });
V = await vmap(); const before = V['TK-01'].stay_volume;
const bs = await api('/bottling', { product_id: fp.id, vessel_id: V['TK-01'].id, bottled_at: '2026-11-18', volume_l: 300, bottle_ml: 750, bottles: 400, cases: 33, bottles_per_case: 12, operator_name: 'Eric' });
V = await vmap(); check('embotellado resta 300 L', V['TK-01'].stay_volume === before - 300);
let sess = (await api('/bottling')).sessions; check('sesión en llenado', sess.length === 1 && sess[0].stage === 'filled' && sess[0].bottles_available === 400);
await api(`/bottling/${sess[0].id}/stage`, { stage: 'labelled' }); sess = (await api('/bottling?stage=labelled')).sessions; check('etiquetado', sess.length === 1);
inv = await api('/inventory'); check('inventario: producto terminado 400 botellas', inv.kpi.finished_bottles === 400 && inv.bottled[0].bottles === 400);
const ops = await api('/operations?type=bottling'); check('operación de embotellado en la lista', ops.operations.length === 1 && ops.operations[0].biodynamic);
await api(`/bottling/${sess[0].id}`, null, 'DELETE'); V = await vmap(); check('revertir sesión devuelve el vino', V['TK-01'].stay_volume === before);

// panel y actividad
const pn = await api('/panel'); check('panel', pn.total_l > 0 && pn.steps.every((s) => s.done) && pn.vineyard.parcels === 2 && pn.alerts.length >= 1, JSON.stringify(pn.alerts.map((a) => a.kind)));
const act = await api('/activity'); check('actividad con existencias', act.stock && typeof act.stock.active === 'number' && act.bulkVsBottled);
const srch = await api('/search?q=ROSE'); check('búsqueda con embotellados', Array.isArray(srch.bottlings));
console.log(failures ? `\n${failures} fallos` : '\nTodo OK');
process.exit(failures ? 1 : 0);
