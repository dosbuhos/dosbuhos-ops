import test from 'node:test'; import assert from 'node:assert'; import { createHash, randomBytes } from 'node:crypto';
import { Sha256 } from '../public/sha256.js';
test('incremental sha256 matches node for odd chunk sizes', () => {
  for (const n of [0, 1, 55, 56, 63, 64, 65, 1000, 200_003]) {
    const d = randomBytes(n), h = new Sha256(); let i = 0;
    while (i < n) { const k = Math.min(n - i, 1 + ((i * 7919) % 4097)); h.update(d.subarray(i, i + k)); i += k; }
    assert.equal(h.hex(), createHash('sha256').update(d).digest('hex'), 'n=' + n);
  }
});
