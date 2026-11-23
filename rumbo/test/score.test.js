import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calificar, general, lectura, metaVentana, masDias, dias } from '../src/score.js';

const hoy = '2026-11-23';
const ini = (o = {}) => ({ etapa: 'marcha', siguiente: 'x', siguiente_fecha: '2026-11-30', pasos: [], medidas: [], registros: [], ...o });

test('ideas, paused and closed initiatives are not scored', () => {
  for (const etapa of ['idea', 'pausada', 'cerrada']) assert.equal(calificar(ini({ etapa }), hoy), null);
});
test('ritmo: fresh check-in and a dated next step give 30', () => {
  const s = calificar(ini({ registros: [{ id: 1, fecha: '2026-11-20', valores: {} }] }), hoy);
  assert.equal(s.ritmo, 30);
});
test('ritmo: check-in 10 days ago and an overdue next step give 14', () => {
  const s = calificar(ini({ siguiente_fecha: '2026-11-01', registros: [{ id: 1, fecha: '2026-11-13', valores: {} }] }), hoy);
  assert.equal(s.ritmo, 14);
});
test('avance: stage plus share of milestones', () => {
  const pasos = [{ hecho: 1 }, { hecho: 1 }, { hecho: 0 }, { hecho: 0 }];
  assert.equal(calificar(ini({ etapa: 'planeacion', pasos }), hoy).avance, 12);
  assert.equal(calificar(ini({ etapa: 'resultado', pasos: [{ hecho: 1 }] }), hoy).avance, 30);
});
test('resultado: weekly target counts four times over 28 days, capped at 100%', () => {
  const m = { id: 7, meta: 1, periodo: 'semana', modo: 'suma', sentido: 'sube', auto: '' };
  assert.equal(metaVentana(m), 4);
  const regs = [{ id: 1, fecha: '2026-11-02', valores: { 7: 1 } }, { id: 2, fecha: '2026-11-16', valores: { 7: 1 } }];
  assert.equal(calificar(ini({ medidas: [m], registros: regs }), hoy).resultado, 20);
  const muchos = [{ id: 1, fecha: '2026-11-20', valores: { 7: 9 } }];
  assert.equal(calificar(ini({ medidas: [m], registros: muchos }), hoy).resultado, 40);
});
test('resultado: values outside the 28-day window do not count', () => {
  const m = { id: 7, meta: 4, periodo: 'mes', modo: 'suma', sentido: 'sube', auto: '' };
  const l = lectura(m, [{ id: 1, fecha: masDias(hoy, -28), valores: { 7: 4 } }], hoy);
  assert.equal(l.valor, null);
});
test('resultado: lower-is-better percentage takes the latest value', () => {
  const m = { id: 3, meta: 30, periodo: 'mes', modo: 'ultimo', sentido: 'baja', auto: '' };
  const regs = [{ id: 1, fecha: '2026-11-03', valores: { 3: 40 } }, { id: 2, fecha: '2026-11-18', valores: { 3: 32 } }];
  const l = lectura(m, regs, hoy);
  assert.equal(l.valor, 32); assert.ok(Math.abs(l.pct - 30 / 32) < 1e-9);
  assert.equal(lectura(m, [{ id: 1, fecha: '2026-11-18', valores: { 3: 28 } }], hoy).pct, 1);
});
test('resultado: automatic measure reads from the club figures', () => {
  const m = { id: 1, meta: 4, periodo: 'mes', modo: 'suma', sentido: 'sube', auto: 'club_altas' };
  assert.equal(calificar(ini({ medidas: [m] }), hoy, { club_altas: 1 }).resultado, 10);
});
test('resultado: without a target the 40 points follow the milestones', () => {
  const s = calificar(ini({ pasos: [{ hecho: 1 }, { hecho: 0 }], medidas: [{ id: 1, meta: null, periodo: 'mes', modo: 'suma', sentido: 'sube', auto: '' }] }), hoy);
  assert.equal(s.resultado, 20); assert.equal(s.porHitos, true);
});
test('total never passes 100 and general is the average of scored initiatives', () => {
  const m = { id: 7, meta: 1, periodo: 'semana', modo: 'suma', sentido: 'sube', auto: '' };
  const top = ini({ etapa: 'resultado', pasos: [{ hecho: 1 }], medidas: [m], registros: [{ id: 1, fecha: hoy, valores: { 7: 50 } }] });
  assert.equal(calificar(top, hoy).total, 100);
  const g = general([top, ini({ etapa: 'idea' }), ini({ etapa: 'planeacion', siguiente: '', siguiente_fecha: '' })], hoy);
  assert.equal(g.n, 2); assert.equal(g.total, Math.round((100 + 8) / 2));
  assert.equal(general([], hoy).total, null);
});
test('date helpers', () => { assert.equal(dias('2026-11-01', '2026-11-23'), 22); assert.equal(masDias('2026-11-23', 7), '2026-11-30'); });
