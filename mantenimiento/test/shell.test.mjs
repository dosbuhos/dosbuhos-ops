// The service worker keeps the app on the phone: its list must name the same files and version as index.html,
// or a phone would keep running an old copy with no signal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
test('sw.js keeps the files index.html loads, at the same version', () => {
  const used = [...html.matchAll(/(?:src|href)="(\/[^"]+\?v=\d+)"/g)].map((m) => m[1]);
  assert.ok(used.length >= 5);
  for (const u of used) assert.ok(sw.includes(`'${u}'`), `sw.js does not keep ${u}`);
  const v = used[0].split('v=')[1];
  assert.ok(sw.includes(`const V = 'pulso-${v}'`), 'bump V in sw.js with ?v= in index.html');
});
