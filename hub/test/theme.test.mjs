// npm test  (node --test test/*.test.mjs)   (no dependencies). Pure theme functions + the public endpoints against an in-memory D1 stand-in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/kit/theme-core.js';
import { publicTheme, isPublicThemePath, themeApi } from '../src/theme.js';

test('contrast math matches WCAG reference values', () => {
  assert.equal(Math.round(T.contrast('#ffffff', '#000000') * 100) / 100, 21);
  assert.equal(T.contrast('#777777', '#777777'), 1);
  assert.ok(Math.abs(T.contrast('#767676', '#ffffff') - 4.54) < 0.01); // the classic AA-passing grey
  assert.equal(T.normHex('#ABC'), '#aabbcc');
  assert.equal(T.normHex('rgb(107, 39, 55)'), '#6b2737');
  assert.equal(T.normHex('nope'), null);
});

test('all 10 presets pass every contrast rule in light and dark', () => {
  assert.equal(T.PRESETS.length, 10);
  for (const p of T.PRESETS) {
    const fails = T.contrastFailures(T.themeFromPreset(p.id));
    assert.deepEqual(fails.map(T.failureMessage), [], p.id);
    for (const f of [p.fontDisplay, p.fontBody]) assert.ok(T.fontByName(f), `${p.id} font ${f}`);
  }
});

test('partial spec merges over the base and normalizes', () => {
  const base = T.themeFromPreset('huerta');
  const { theme, errors, warnings } = T.normalizeTheme({ size: '18', light: { onAccent: '#FFF', accent: '#7a2a3a' }, radius: 12, density: 'compact', extra: 1 }, base);
  assert.deepEqual(errors, []);
  assert.equal(theme.size, 18); assert.equal(theme.light.accent, '#7a2a3a'); assert.equal(theme.light['on-accent'], '#ffffff');
  assert.equal(theme.radius, 10); assert.equal(theme.density, 'compacta');
  assert.equal(theme.fontDisplay, base.fontDisplay); assert.deepEqual(theme.dark, base.dark); assert.equal(theme.light.bg, base.light.bg);
  assert.ok(warnings.some(w => w.includes('extra'))); assert.ok(warnings.some(w => w.includes('12')));
});

test('invalid values produce Spanish errors; preset switch keeps brand and app pins', () => {
  const r = T.normalizeTheme({ fontBody: 'Comic Sans', light: { ink: 'rojo' }, apps: { huerto: 'nada' } });
  assert.equal(r.errors.length, 3); assert.match(r.errors.join(' '), /Letra para texto no disponible/);
  const base = { ...T.DEFAULT_THEME, apps: { huerto: 'huerta' }, brand: { shortName: 'Búhos' } };
  const s = T.normalizeTheme({ preset: 'capilla' }, base).theme;
  assert.equal(s.light.accent, '#1f2d55'); assert.deepEqual(s.apps, { huerto: 'huerta' }); assert.equal(s.brand.shortName, 'Búhos');
});

test('contrast failure message names the pair and ratio', () => {
  const t = T.normalizeTheme({ light: { muted: '#cccccc' } }).theme;
  const f = T.contrastFailures(t);
  assert.ok(f.length >= 1);
  assert.match(T.failureMessage(f[0]), /Modo claro: Texto secundario .*muted #cccccc.* \d\.\d\d:1; necesita al menos 4\.5:1/);
});

test('CSS has light, dark (media + data-theme), fonts and derived tokens', () => {
  const css = T.buildCss(T.themeFromPreset('campo'), { 'logo-light': 'https://h/theme/logo-light?v=1' });
  assert.ok(css.startsWith('@import url("https://fonts.googleapis.com/css2?family=Barlow+Condensed'));
  assert.match(css, /@media \(prefers-color-scheme: dark\) \{\n  :root:not\(\[data-theme="light"\]\) \{/);
  assert.match(css, /:root\[data-theme="dark"\] \{/);
  for (const k of ['bg', 'surface', 'ink', 'muted', 'line', 'accent', 'on-accent', 'ok', 'bad', 'warn', 'off', 'font-display', 'font-body', 'size-base', 'radius', 'border', 'space-1', 'space-6', 'tap', 'focus-ring'])
    assert.ok(css.includes(`--db-${k}:`), k);
  assert.ok(css.includes('--db-tap: 56px;') && css.includes('--db-size-base: 18px;'));
  assert.ok(css.includes('--db-logo: none;'), 'no dark logo → none in dark');
  assert.equal(T.extractJson('Aquí está:\n```json\n{"size":17}\n```').size, 17);
  assert.deepEqual(T.themeForApp({ ...T.DEFAULT_THEME, apps: { huerto: 'huerta' } }, 'huerto').light, T.themeFromPreset('huerta').light);
});

// ---- endpoints with a tiny in-memory D1 stand-in (only the queries theme.js uses)
function fakeDB() {
  const st = { versions: [], assets: [], audit: [] };
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async run() {
      if (sql.startsWith('INSERT INTO theme_versions')) { const id = st.versions.length + 1; st.versions.push({ id, data: args[0], note: args[1], author: args[2], created_at: args[3], active: 0 }); return { meta: { last_row_id: id } }; }
      if (sql.startsWith('UPDATE theme_versions SET active = 0')) st.versions.forEach(v => { v.active = 0; });
      if (sql.startsWith('UPDATE theme_versions SET active = 1')) st.versions.find(v => v.id === args[0]).active = 1;
      if (sql.startsWith('INSERT INTO audit_log')) st.audit.push(args);
      return { meta: {} };
    },
    async first() {
      if (sql.includes('FROM theme_versions WHERE active = 1')) return st.versions.filter(v => v.active).at(-1) || null;
      if (sql.includes('FROM theme_versions WHERE id')) return st.versions.find(v => v.id === args[0]) || null;
      if (sql.includes('FROM theme_assets WHERE kind')) return st.assets.find(a => a.kind === args[0]) || null;
      return null;
    },
    async all() {
      if (sql.includes('FROM theme_assets')) return { results: st.assets };
      if (sql.includes('FROM theme_versions')) return { results: [...st.versions].reverse() };
      return { results: [] };
    },
  });
  return { st, prepare: (sql) => stmt(sql), batch: async (list) => { for (const s of list) await s.run(); return []; } };
}
const req = (path, init) => { const r = new Request('https://hub.test' + path, init); return [r, new URL(r.url)]; };

test('public endpoints: CSS + JSON + ETag/304 + CORS, default theme when nothing saved', async () => {
  const env = { DB: fakeDB() };
  assert.ok(isPublicThemePath('/theme.css') && isPublicThemePath('/theme/icon') && !isPublicThemePath('/theme/x'));
  const [r1, u1] = req('/theme.css'); const res = await publicTheme(r1, env, u1);
  assert.equal(res.status, 200); assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.match(res.headers.get('cache-control'), /max-age=60/);
  const css = await res.text(); assert.ok(css.includes('--db-accent: #6b2737;'));
  const [r2, u2] = req('/theme.css', { headers: { 'if-none-match': res.headers.get('etag') } });
  assert.equal((await publicTheme(r2, env, u2)).status, 304);
  const [r3, u3] = req('/theme.json'); const j = await (await publicTheme(r3, env, u3)).json();
  assert.equal(j.version, null); assert.equal(j.theme.preset, 'bodega'); assert.equal(j.tokens.light.bg, '#f7f3ec');
  const [r4, u4] = req('/theme/logo-light'); assert.equal((await publicTheme(r4, env, u4)).status, 404);
});

test('admin save → refused on contrast, accepted otherwise, app pin served, audit written', async () => {
  const env = { DB: fakeDB() }, user = { email: 'eric@example.com', admin: true };
  const put = async (body) => { const [r, u] = req('/api/admin/theme', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return themeApi(r, env, u, user); };
  let r = await put({ theme: { light: { muted: '#cccccc' } } });
  assert.equal(r.status, 422); assert.match((await r.json()).message, /^No se guardó: Modo claro: Texto secundario/);
  r = await put({ theme: { preset: 'huerta', apps: { spark: 'noche' } }, note: 'prueba' });
  assert.equal(r.status, 200); assert.equal((await r.json()).id, 1);
  assert.equal(env.DB.st.audit.at(-1)[2], 'theme.save');
  const [a, ua] = req('/theme.css?app=spark'); const css = await (await publicTheme(a, env, ua)).text();
  assert.ok(css.includes('app spark → noche') && css.includes('--db-accent: #7a1f33;'));
  const [i, ui] = req('/api/admin/theme/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ instructions: 'más cálido' }) });
  const ai = await themeApi(i, env, ui, user); assert.equal(ai.status, 400); assert.equal((await ai.json()).code, 'no_ai_key');
});
