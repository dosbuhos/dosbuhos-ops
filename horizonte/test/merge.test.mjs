import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOp, validOp } from '../src/merge.js';

test('later clock wins per field, regardless of arrival order', () => {
  const a = { k: 'task', id: 't1', f: { title: 'A', when: '2026-11-10' }, t: '0001' };
  const b = { k: 'task', id: 't1', f: { when: '2026-11-12' }, t: '0002' };
  const ab = applyOp(applyOp(null, a), b), ba = applyOp(applyOp(null, b), a);
  assert.deepEqual(ab.data, { title: 'A', when: '2026-11-12' });
  assert.deepEqual(ba.data, ab.data);
});
test('older write does not change anything', () => {
  const cur = applyOp(null, { k: 'task', id: 't1', f: { title: 'new' }, t: '0005' });
  const r = applyOp(cur, { k: 'task', id: 't1', f: { title: 'old' }, t: '0003' });
  assert.equal(r.changed, false); assert.equal(r.data.title, 'new');
});
test('op validation', () => {
  assert.ok(validOp({ k: 'task', id: 'x', f: {}, t: '1' }));
  assert.ok(!validOp({ k: 'user', id: 'x', f: {}, t: '1' }));
  assert.ok(!validOp({ k: 'task', id: '', f: {}, t: '1' }));
  assert.ok(!validOp({ k: 'task', id: 'x', f: [], t: '1' }));
});
