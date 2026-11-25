import { test } from 'node:test';
import assert from 'node:assert/strict';
import { total, semaforo, revisa, rotacion, MOTIVOS } from '../src/conteo.js';

const tol = { ambar: 1, rojo: 6, pct: 2 };

test('total: pallets, cases and loose bottles', () => {
  assert.equal(total({ tarimas: 2, cajas: 3, sueltas: 5 }, { botellas_caja: 12, cajas_tarima: 50 }), 2 * 50 * 12 + 36 + 5);
  assert.equal(total({ cajas: 4 }, { botellas_caja: 24 }), 96);          // 375 ml case
  assert.equal(total({ tarimas: 3 }, { botellas_caja: 12 }), 0);          // no standard pallet: pallets count for nothing
  assert.equal(total({ cajas: -2, sueltas: 1.7 }, {}), 1);                // junk in, sane out
});

test('semaforo: zero is green, small is amber, half a case is red', () => {
  assert.equal(semaforo(0, 500, tol), 'verde');
  assert.equal(semaforo(-3, 500, tol), 'ambar');
  assert.equal(semaforo(6, 500, tol), 'rojo');
  assert.equal(semaforo(-6, 500, tol), 'rojo');
});

test('semaforo: the percentage catches a small SKU the bottle count would miss', () => {
  assert.equal(semaforo(2, 20, tol), 'rojo');       // 2% of 20 rounds to 1, so 2 bottles is red
  assert.equal(semaforo(2, 5000, tol), 'ambar');    // same 2 bottles against a big stack is only amber
});

test('semaforo: a negative balance is always red', () => {
  assert.equal(semaforo(-1, -4, tol), 'rojo');
});

test('revisa: a count is required, a difference needs a reason, a red one needs a photo', () => {
  assert.match(revisa({ contado: null }, 'verde'), /Falta el conteo/);
  assert.equal(revisa({ contado: 10 }, 'verde'), '');
  assert.match(revisa({ contado: 10, motivo: '' }, 'ambar'), /motivo/);
  assert.equal(revisa({ contado: 10, motivo: MOTIVOS[0] }, 'ambar'), '');
  assert.match(revisa({ contado: 10, motivo: MOTIVOS[0], foto: '' }, 'rojo'), /foto/);
  assert.equal(revisa({ contado: 10, motivo: MOTIVOS[0], foto: 'k.jpg' }, 'rojo'), '');
});

test('revisa: "no sé" is a valid reason — without it people pick a code that is not true', () => {
  assert.equal(revisa({ contado: 10, motivo: 'no sé' }, 'ambar'), '');
});

const sku = (o) => ({ item_id: o.item_id || 'x', activo: 1, saldo: 100, contado_at: '2026-11-20', variaciones_seguidas: 0, ...o });

test('rotacion: never counted, long uncounted, and two differences in a row', () => {
  const hoy = '2026-11-25';
  const r = rotacion([
    sku({ item_id: 'nuevo', contado_at: null }),
    sku({ item_id: 'viejo', contado_at: '2026-09-01' }),
    sku({ item_id: 'terco', variaciones_seguidas: 2 }),
    sku({ item_id: 'sano' }),
  ], hoy, { dias_rotacion: 45, dias_rotacion_top: 30 });
  const ids = r.map((x) => x.item_id);
  assert.deepEqual(new Set(ids), new Set(['nuevo', 'viejo', 'terco']));
  assert.equal(ids.includes('sano'), false);
});

test('rotacion: one of the ten largest comes round sooner', () => {
  const hoy = '2026-11-25';
  // Both were counted 36 days ago: past the 30 days the ten largest get, short of the 45 everything else gets.
  const relleno = Array.from({ length: 10 }, (_, i) => sku({ item_id: 'r' + i, saldo: 5000 + i, contado_at: '2026-11-24' }));
  const grande = sku({ item_id: 'grande', saldo: 9000, contado_at: '2026-10-20' });
  const chico = sku({ item_id: 'chico', saldo: 10, contado_at: '2026-10-20' });
  const r = rotacion([...relleno, grande, chico], hoy, { dias_rotacion: 45, dias_rotacion_top: 30 });
  assert.deepEqual(r.map((x) => x.item_id), ['grande']);
});

test('rotacion: an inactive SKU never enters the queue', () => {
  assert.equal(rotacion([sku({ activo: 0, contado_at: null })], '2026-11-25', {}).length, 0);
});
