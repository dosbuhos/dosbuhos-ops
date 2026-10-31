// Dos Búhos theme core — pure functions shared by the Hub Worker (src/theme.js) and the admin page (Diseño).
// No DOM, no network: presets, fonts, schema normalization, WCAG contrast, CSS generation.
// Token contract and how apps adopt it: hub/THEME.md.

export const COLOR_KEYS = ['bg', 'surface', 'ink', 'muted', 'line', 'accent', 'on-accent', 'ok', 'bad', 'warn', 'off'];
export const COLOR_LABEL = {
  bg: 'Fondo de página', surface: 'Tarjetas', ink: 'Texto', muted: 'Texto secundario', line: 'Bordes',
  accent: 'Acento', 'on-accent': 'Texto sobre acento', ok: 'Listo (verde)', bad: 'Atrasado (rojo)', warn: 'Resguardo (ámbar)', off: 'Inactivo (gris)',
};
export const DENSITIES = ['compacta', 'normal', 'amplia'];
export const RADII = [6, 10, 14];
export const BORDERS = [1, 1.5, 2];
export const SIZES = [16, 17, 18];
export const WEIGHTS = [400, 500];
// Spacing scale (px) for --db-space-1..6 and the minimum touch target per density. Targets never go below 44 px.
export const SPACING = { compacta: [2, 4, 8, 12, 16, 24], normal: [4, 8, 12, 16, 24, 32], amplia: [6, 10, 16, 22, 32, 44] };
export const TAP = { compacta: 44, normal: 48, amplia: 56 };

const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const COND = '"Arial Narrow", "Roboto Condensed", "Helvetica Neue", sans-serif';
// Curated Google Fonts. `weights` = what the family has (and what is requested); `kind` picks the fallback stack.
export const FONTS = [
  { name: 'Fraunces', kind: 'serif', weights: [400, 500, 600, 700] },
  { name: 'Cormorant Garamond', kind: 'serif', weights: [400, 500, 600, 700] },
  { name: 'Playfair Display', kind: 'serif', weights: [400, 500, 600, 700] },
  { name: 'Libre Baskerville', kind: 'serif', weights: [400, 700] },
  { name: 'DM Serif Display', kind: 'serif', weights: [400] },
  { name: 'Young Serif', kind: 'serif', weights: [400] },
  { name: 'Lustria', kind: 'serif', weights: [400] },
  { name: 'IBM Plex Sans', kind: 'sans', weights: [400, 500, 600, 700] },
  { name: 'Inter', kind: 'sans', weights: [400, 500, 600, 700] },
  { name: 'Source Sans 3', kind: 'sans', weights: [400, 500, 600, 700] },
  { name: 'Public Sans', kind: 'sans', weights: [400, 500, 600, 700] },
  { name: 'Barlow', kind: 'sans', weights: [400, 500, 600, 700] },
  { name: 'Barlow Condensed', kind: 'cond', weights: [400, 500, 600, 700] },
  { name: 'Work Sans', kind: 'sans', weights: [400, 500, 600, 700] },
  { name: 'Atkinson Hyperlegible', kind: 'sans', weights: [400, 700] },
  { name: 'Nunito Sans', kind: 'sans', weights: [400, 500, 600, 700] },
];
const FALLBACK = { serif: SERIF, sans: SANS, cond: COND };
export const fontByName = (n) => FONTS.find(f => f.name.toLowerCase() === String(n || '').trim().toLowerCase()) || null;
export const fontStack = (n) => { const f = fontByName(n); return f ? `"${f.name}", ${FALLBACK[f.kind]}` : SANS; };
// Titles use 600 when the family has it, else its heaviest weight (never a faux bold).
export const displayWeight = (n) => { const f = fontByName(n); if (!f) return 600; return f.weights.includes(600) ? 600 : Math.max(...f.weights.filter(w => w <= 700)); };

// ---------------------------------------------------------------- presets
// Every preset: light + dark colours, fonts, size, shape, density. All pass the contrast rules (test/theme.test.mjs).
const P = (id, name, about, light, dark, o) => ({ id, name, about, light, dark, ...o });
const c = (bg, surface, ink, muted, line, accent, onAccent, ok, bad, warn, off) => ({ bg, surface, ink, muted, line, accent, 'on-accent': onAccent, ok, bad, warn, off });
export const PRESETS = [
  P('bodega', 'Bodega clásica', 'Vino tinto, crema y títulos con serifa. El estilo de la casa.',
    c('#f7f3ec', '#fffdf8', '#1f1a1b', '#5c5355', '#ddd4c8', '#6b2737', '#ffffff', '#2f6634', '#ae2318', '#855700', '#5f5c5b'),
    c('#171213', '#211a1c', '#f1ebe6', '#b8ada9', '#3d3335', '#e3a0ad', '#2a0f15', '#9ccb8f', '#f4a29a', '#e8c066', '#aaa4a2'),
    { fontDisplay: 'Fraunces', fontBody: 'IBM Plex Sans', size: 16, radius: 10, border: 1, density: 'normal', weightBody: 400 }),
  P('huerta', 'Huerta', 'Verde salvia, crema y tierra. Para el huerto y el jardín.',
    c('#f4f1e8', '#fdfbf4', '#1d231c', '#535a4e', '#d8d3c2', '#46653f', '#ffffff', '#2c6431', '#a3301d', '#805508', '#5f625b'),
    c('#131712', '#1b2119', '#ebeee4', '#aab1a1', '#343c31', '#a9c69d', '#142012', '#9fd08f', '#f2a596', '#e3bf6a', '#a3a69e'),
    { fontDisplay: 'Young Serif', fontBody: 'Public Sans', size: 16, radius: 14, border: 1, density: 'normal', weightBody: 400 }),
  P('campo', 'Campo', 'Contraste alto, letra más gruesa y botones grandes. Para sol y guantes.',
    c('#f2f2f0', '#ffffff', '#000000', '#2e2e2e', '#6b6b6b', '#5a1a28', '#ffffff', '#1b5520', '#951b11', '#664100', '#454545'),
    c('#000000', '#121212', '#ffffff', '#d9d9d9', '#8a8a8a', '#ffb3c1', '#000000', '#9ff09a', '#ffb0a8', '#ffd36b', '#cacaca'),
    { fontDisplay: 'Barlow Condensed', fontBody: 'Public Sans', size: 18, radius: 6, border: 2, density: 'amplia', weightBody: 500 }),
  P('noche', 'Noche de bodega', 'Casi negro con acento vino. Elegante, para la noche.',
    c('#ece8e6', '#f8f6f5', '#141012', '#4c4346', '#cfc7c4', '#7a1f33', '#ffffff', '#2b5f32', '#9f2419', '#7a5000', '#59575a'),
    c('#0d0b0c', '#171415', '#eee7e4', '#afa5a3', '#2f2a2b', '#cf7084', '#0d0b0c', '#9cc995', '#f0a198', '#e5bd64', '#a39e9d'),
    { fontDisplay: 'Cormorant Garamond', fontBody: 'Inter', size: 16, radius: 10, border: 1, density: 'normal', weightBody: 400 }),
  P('barrica', 'Barrica', 'Roble cálido y ámbar.',
    c('#f5ede1', '#fffaf2', '#2a1d12', '#614d3a', '#dccbb3', '#844712', '#ffffff', '#36632a', '#a3301d', '#784f00', '#625c56'),
    c('#18120c', '#221a12', '#f3e9dc', '#bda891', '#3e3123', '#e0a458', '#1e1408', '#a6cf8c', '#f3a596', '#f0c56b', '#aba298'),
    { fontDisplay: 'Libre Baskerville', fontBody: 'Source Sans 3', size: 17, radius: 10, border: 1, density: 'normal', weightBody: 400 }),
  P('piedra', 'Piedra', 'Grises de piedra con un vino discreto. Sobrio, de oficina.',
    c('#efefed', '#fafaf9', '#1e2022', '#53585c', '#d4d4d1', '#5b2a35', '#ffffff', '#305c37', '#a0281d', '#755100', '#5d6064'),
    c('#161718', '#1f2122', '#e7e7e5', '#a9acaf', '#36393b', '#d09aa6', '#1d1416', '#9cc79f', '#efa59d', '#e2c070', '#a3a6a9'),
    { fontDisplay: 'Barlow Condensed', fontBody: 'IBM Plex Sans', size: 16, radius: 6, border: 1, density: 'normal', weightBody: 400 }),
  P('rosado', 'Rosado', 'Rosa pálido, vino y blanco.',
    c('#fbf1f2', '#ffffff', '#2a1418', '#664950', '#efd3d8', '#7d2438', '#ffffff', '#2c6637', '#a0231a', '#7a5209', '#675e60'),
    c('#1a1214', '#24191c', '#f8eaec', '#caacb2', '#443035', '#f2a9b8', '#2a1015', '#a5d6a2', '#f6a69e', '#ecc775', '#b6aaac'),
    { fontDisplay: 'Playfair Display', fontBody: 'Nunito Sans', size: 16, radius: 14, border: 1, density: 'normal', weightBody: 400 }),
  P('capilla', 'Capilla', 'Azul noche y oro, como la capilla de Contemplo.',
    c('#f3f2ee', '#fdfcf8', '#141a2b', '#4a5165', '#d6d5cd', '#1f2d55', '#f0d58e', '#2c6439', '#a0281d', '#755200', '#5c606c'),
    c('#0c1120', '#141b2e', '#ece8dc', '#abafbf', '#2a3350', '#d9b65c', '#0c1120', '#9fd0a4', '#f2a69e', '#ecc56a', '#a4a8b5'),
    { fontDisplay: 'DM Serif Display', fontBody: 'Work Sans', size: 16, radius: 10, border: 1, density: 'normal', weightBody: 400 }),
  P('minimo', 'Mínimo', 'Blanco y negro con un solo acento.',
    c('#fafafa', '#ffffff', '#000000', '#525252', '#dddddd', '#6b2737', '#ffffff', '#1d6528', '#ab241c', '#735000', '#595959'),
    c('#000000', '#0f0f0f', '#ffffff', '#ababab', '#2e2e2e', '#f0a5b4', '#000000', '#8fd99a', '#ff9f97', '#f0c463', '#a0a0a0'),
    { fontDisplay: 'Inter', fontBody: 'Inter', size: 16, radius: 6, border: 1, density: 'compacta', weightBody: 400 }),
  P('vendimia', 'Vendimia', 'Ocre, morado uva y crema. La temporada de cosecha.',
    c('#f6efdf', '#fffaee', '#241a2a', '#5a4c5c', '#e0d3b8', '#5b2a6e', '#ffffff', '#36632a', '#a3301d', '#764f00', '#645d67'),
    c('#151018', '#1f1823', '#f3ebdc', '#bbacbb', '#3a2f40', '#cfa6e3', '#1d1222', '#a6cf8c', '#f3a596', '#e6b94f', '#aaa2ab'),
    { fontDisplay: 'Lustria', fontBody: 'Barlow', size: 16, radius: 14, border: 1, density: 'normal', weightBody: 400 }),
];
export const DEFAULT_PRESET = 'bodega';
export const presetById = (id) => PRESETS.find(p => p.id === id) || null;

// A full theme document (what is stored in theme_versions.data).
export function themeFromPreset(id, extra = {}) {
  const p = presetById(id) || presetById(DEFAULT_PRESET);
  return {
    version: 1, preset: p.id, name: p.name,
    light: { ...p.light }, dark: { ...p.dark },
    fontDisplay: p.fontDisplay, fontBody: p.fontBody, size: p.size, radius: p.radius, border: p.border,
    density: p.density, weightBody: p.weightBody,
    brand: { shortName: 'Dos Búhos' }, apps: {}, ...extra,
  };
}
export const DEFAULT_THEME = themeFromPreset(DEFAULT_PRESET);

// ---------------------------------------------------------------- colour math
const NAMED = { white: '#ffffff', black: '#000000' };
export function normHex(v) {
  if (typeof v !== 'string') return null;
  let s = v.trim().toLowerCase();
  if (NAMED[s]) return NAMED[s];
  const rgb = s.match(/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+[\d.]+%?)?\s*\)$/);
  if (rgb) { const n = rgb.slice(1, 4).map(Number); if (n.some(x => x > 255)) return null; return '#' + n.map(x => x.toString(16).padStart(2, '0')).join(''); }
  if (!s.startsWith('#')) s = '#' + s;
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + s.slice(1).split('').map(ch => ch + ch).join('');
  return /^#[0-9a-f]{6}$/.test(s) ? s : null;
}
const toRgb = (hex) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const lin = (c8) => { const c = c8 / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export function luminance(hex) { const [r, g, b] = toRgb(hex).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
export function contrast(a, b) { const la = luminance(a), lb = luminance(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
export function mix(a, b, t) { // t = share of b
  const A = toRgb(a), B = toRgb(b);
  return '#' + A.map((x, i) => Math.round(x + (B[i] - x) * t).toString(16).padStart(2, '0')).join('');
}
// Text colour (white or near-black) that reads best on a fill.
export const bestOn = (fill, dark = '#141012') => (contrast(fill, '#ffffff') >= contrast(fill, dark) ? '#ffffff' : dark);

// Colours that are derived, not chosen: second surface, soft fills behind status pills, a strong line for fields.
export function derived(mode) {
  const d = {
    'surface-2': mix(mode.surface, mode.bg, 0.5),
    'accent-soft': mix(mode.surface, mode.accent, 0.12),
    'ok-soft': mix(mode.surface, mode.ok, 0.12), 'bad-soft': mix(mode.surface, mode.bad, 0.12),
    'warn-soft': mix(mode.surface, mode.warn, 0.14), 'off-soft': mix(mode.surface, mode.off, 0.12),
  };
  // Field borders: walk the line colour toward the text colour until it is ≥ 3:1 on the card (WCAG 1.4.11).
  let s = mode.line, t = 0;
  while (contrast(s, mode.surface) < 3 && t < 1) { t += 0.05; s = mix(mode.line, mode.ink, t); }
  d['line-strong'] = s;
  return d;
}

// ---------------------------------------------------------------- contrast rules
// [fg, bg, label, min, prefer]. min is enforced on save; prefer is shown as a warning.
export const RULES = [
  ['ink', 'bg', 'Texto sobre fondo', 4.5, 7],
  ['ink', 'surface', 'Texto sobre tarjeta', 4.5, 7],
  ['muted', 'bg', 'Texto secundario sobre fondo', 4.5],
  ['muted', 'surface', 'Texto secundario sobre tarjeta', 4.5],
  ['on-accent', 'accent', 'Texto del botón principal', 4.5],
  ['accent', 'surface', 'Acento (enlaces) sobre tarjeta', 4.5],
  ['ok', 'bg', 'Listo (verde) como texto', 4.5],
  ['bad', 'bg', 'Atrasado (rojo) como texto', 4.5],
  ['warn', 'bg', 'Resguardo (ámbar) como texto', 4.5],
  ['off', 'bg', 'Inactivo (gris) como texto', 4.5],
  ['ok', 'ok-soft', 'Etiqueta Listo', 4.5],
  ['bad', 'bad-soft', 'Etiqueta Atrasado', 4.5],
  ['warn', 'warn-soft', 'Etiqueta Resguardo', 4.5],
  ['off', 'off-soft', 'Etiqueta Inactivo', 4.5],
];
const MODE_NAME = { light: 'claro', dark: 'oscuro' };
export function contrastReport(theme) {
  const out = [];
  for (const m of ['light', 'dark']) {
    const mode = theme[m]; const all = { ...mode, ...derived(mode) };
    for (const [fg, bg, label, min, prefer] of RULES) {
      const ratio = contrast(all[fg], all[bg]);
      out.push({ mode: m, fg, bg, fgHex: all[fg], bgHex: all[bg], label, ratio: Math.round(ratio * 100) / 100, min, prefer: prefer || null,
        pass: ratio >= min, preferred: !prefer || ratio >= prefer });
    }
  }
  return out;
}
export const contrastFailures = (theme) => contrastReport(theme).filter(r => !r.pass);
export const failureMessage = (f) => `Modo ${MODE_NAME[f.mode]}: ${f.label} (${f.fg} ${f.fgHex} sobre ${f.bg} ${f.bgHex}) tiene contraste ${f.ratio.toFixed(2)}:1; necesita al menos ${f.min}:1.`;

// ---------------------------------------------------------------- schema: normalize + validate
// normalizeTheme(input, base) merges a full or partial spec over `base` (a full theme). Accepts a few spellings
// (onAccent / on_accent, "font-display", colours as #rgb / rgb()). Returns { theme, errors[], warnings[] }; errors are Spanish.
const ALIAS = { onaccent: 'on-accent', on_accent: 'on-accent', 'on-accent': 'on-accent', card: 'surface', text: 'ink', border: 'line', secondary: 'muted' };
const keyOf = (k) => { const s = String(k).trim().toLowerCase(); const a = ALIAS[s.replace(/[\s]/g, '')] || ALIAS[s]; return a || s; };
const nearest = (v, list) => list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? parseFloat(v) : NaN);
const SLUG = /^[a-z][a-z0-9-]{0,40}$/;

export function normalizeTheme(input, base = DEFAULT_THEME) {
  const errors = [], warnings = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { theme: clone(base), errors: ['La especificación debe ser un objeto JSON ({ … }).'], warnings };
  // A nested { theme: {...} } or { tokens: {...} } wrapper is fine.
  if (input.theme && typeof input.theme === 'object' && !input.light) input = input.theme;
  else if (input.tokens && typeof input.tokens === 'object' && !input.light) input = { ...input, ...input.tokens };
  let t = clone(base);
  const get = (...names) => { for (const n of names) if (input[n] !== undefined) return input[n]; return undefined; };

  const presetId = get('preset');
  if (presetId !== undefined) {
    const p = presetById(String(presetId).trim().toLowerCase()) || PRESETS.find(x => x.name.toLowerCase() === String(presetId).trim().toLowerCase());
    if (p) { const keep = { brand: t.brand, apps: t.apps }; t = { ...themeFromPreset(p.id), ...keep }; }
    else errors.push(`Estilo base desconocido: "${presetId}". Opciones: ${PRESETS.map(x => x.id).join(', ')}.`);
  }
  const name = get('name');
  if (name !== undefined) t.name = String(name).slice(0, 60);

  const known = new Set(['version', 'preset', 'name', 'light', 'dark', 'colors', 'fontDisplay', 'font-display', 'fontBody', 'font-body', 'size', 'sizeBase', 'size-base', 'radius', 'border', 'density', 'weightBody', 'weight-body', 'brand', 'apps', 'shortName', 'short-name', 'accent', 'tokens', 'theme', 'note', 'notes']);
  for (const k of Object.keys(input)) if (!known.has(k)) warnings.push(`Se ignoró "${k}" (no es parte del tema).`);

  const setColors = (mode, obj) => {
    if (!obj || typeof obj !== 'object') { errors.push(`"${mode}" debe ser un objeto de colores.`); return; }
    for (const [k0, v] of Object.entries(obj)) {
      const k = keyOf(k0);
      if (!COLOR_KEYS.includes(k)) { warnings.push(`Se ignoró el color "${k0}" en ${MODE_NAME[mode]}.`); continue; }
      const h = normHex(v);
      if (!h) { errors.push(`Color inválido para ${k} (${MODE_NAME[mode]}): "${v}". Usa #rrggbb.`); continue; }
      t[mode][k] = h;
    }
  };
  const colors = get('colors');
  if (colors && typeof colors === 'object') { if (colors.light) setColors('light', colors.light); if (colors.dark) setColors('dark', colors.dark); }
  if (input.light !== undefined) setColors('light', input.light);
  if (input.dark !== undefined) setColors('dark', input.dark);
  const accent = get('accent');
  if (accent !== undefined) { // shorthand: one accent for light; dark accent and both on-accents follow
    const h = normHex(accent);
    if (!h) errors.push(`Color de acento inválido: "${accent}".`);
    else { t.light.accent = h; t.light['on-accent'] = bestOn(h); }
  }

  const fd = get('fontDisplay', 'font-display'), fb = get('fontBody', 'font-body');
  for (const [v, key, label] of [[fd, 'fontDisplay', 'títulos'], [fb, 'fontBody', 'texto']]) {
    if (v === undefined) continue;
    const f = fontByName(String(v).replace(/["']/g, '').split(',')[0]);
    if (f) t[key] = f.name; else errors.push(`Letra para ${label} no disponible: "${v}". Opciones: ${FONTS.map(x => x.name).join(', ')}.`);
  }
  const size = get('size', 'sizeBase', 'size-base');
  if (size !== undefined) {
    const n = num(size);
    if (!Number.isFinite(n)) errors.push(`Tamaño base inválido: "${size}" (16–18 px).`);
    else { const r = Math.round(n); const cl = Math.min(18, Math.max(16, r)); if (cl !== n) warnings.push(`Tamaño base ${size} ajustado a ${cl} px (16–18).`); t.size = cl; }
  }
  const radius = get('radius');
  if (radius !== undefined) {
    const n = num(radius);
    if (!Number.isFinite(n)) errors.push(`Esquinas inválidas: "${radius}" (6, 10 o 14 px).`);
    else { const r = nearest(n, RADII); if (r !== n) warnings.push(`Esquinas ${radius} ajustadas a ${r} px.`); t.radius = r; }
  }
  const border = get('border');
  if (border !== undefined) {
    const n = num(border);
    if (!Number.isFinite(n)) errors.push(`Grosor de borde inválido: "${border}" (1, 1.5 o 2 px).`);
    else { const r = nearest(n, BORDERS); if (r !== n) warnings.push(`Borde ${border} ajustado a ${r} px.`); t.border = r; }
  }
  const density = get('density');
  if (density !== undefined) {
    const s = String(density).trim().toLowerCase();
    const map = { compact: 'compacta', compacta: 'compacta', normal: 'normal', comfortable: 'amplia', spacious: 'amplia', amplia: 'amplia' };
    if (map[s]) t.density = map[s]; else errors.push(`Densidad inválida: "${density}" (compacta, normal o amplia).`);
  }
  const wb = get('weightBody', 'weight-body');
  if (wb !== undefined) { const n = num(wb); if (!Number.isFinite(n)) errors.push(`Grosor de texto inválido: "${wb}" (400 o 500).`); else t.weightBody = nearest(n, WEIGHTS); }

  const brand = get('brand'); const sn = get('shortName', 'short-name') ?? (brand && (brand.shortName ?? brand['short-name']));
  if (sn !== undefined) t.brand = { ...t.brand, shortName: String(sn).trim().slice(0, 24) || 'Dos Búhos' };
  const apps = get('apps');
  if (apps !== undefined) {
    if (!apps || typeof apps !== 'object' || Array.isArray(apps)) errors.push('"apps" debe ser un objeto { "huerto": "huerta", … }.');
    else {
      const next = { ...t.apps };
      for (const [slug, pid] of Object.entries(apps)) {
        if (!SLUG.test(slug)) { errors.push(`App inválida: "${slug}".`); continue; }
        if (pid === null || pid === '' || pid === 'general') { delete next[slug]; continue; }
        if (!presetById(String(pid))) { errors.push(`Estilo desconocido para ${slug}: "${pid}".`); continue; }
        next[slug] = String(pid);
      }
      t.apps = next;
    }
  }
  // Fill anything still missing (e.g. a stored theme from an older shape) from the base preset.
  const fb2 = themeFromPreset(t.preset);
  for (const m of ['light', 'dark']) for (const k of COLOR_KEYS) if (!normHex(t[m]?.[k])) { t[m] = { ...t[m], [k]: fb2[m][k] }; }
  if (!fontByName(t.fontDisplay)) t.fontDisplay = fb2.fontDisplay;
  if (!fontByName(t.fontBody)) t.fontBody = fb2.fontBody;
  if (!SIZES.includes(t.size)) t.size = fb2.size;
  if (!RADII.includes(t.radius)) t.radius = fb2.radius;
  if (!BORDERS.includes(t.border)) t.border = fb2.border;
  if (!DENSITIES.includes(t.density)) t.density = fb2.density;
  if (!WEIGHTS.includes(t.weightBody)) t.weightBody = 400;
  t.version = 1;
  t.brand = { shortName: (t.brand && t.brand.shortName) || 'Dos Búhos' };
  t.apps = t.apps || {};
  return { theme: t, errors, warnings };
}
const clone = (o) => JSON.parse(JSON.stringify(o));

// The look for one app: its pinned preset (if any) with the shared brand, else the main theme.
export function themeForApp(theme, app) {
  const pid = app && theme.apps && theme.apps[app];
  if (!pid || !presetById(pid)) return theme;
  return { ...themeFromPreset(pid), brand: theme.brand, apps: theme.apps, pinned: pid };
}

// ---------------------------------------------------------------- CSS
export function fontsUrl(names) {
  const fams = [...new Set(names)].map(fontByName).filter(Boolean);
  if (!fams.length) return '';
  return 'https://fonts.googleapis.com/css2?' + fams.map(f => `family=${f.name.replace(/ /g, '+')}${f.weights.length > 1 ? ':wght@' + f.weights.join(';') : ''}`).join('&') + '&display=swap';
}
export function tokens(theme, mode) {
  const m = theme[mode], d = derived(m), t = {};
  for (const k of COLOR_KEYS) t[k] = m[k];
  Object.assign(t, d);
  t['focus'] = `0 0 0 3px ${mix(m.surface, m.accent, 0.45)}`;
  return t;
}
// Mode-independent tokens: type, shape, density, brand.
export function staticTokens(theme, assets = {}) {
  const sp = SPACING[theme.density] || SPACING.normal;
  const t = {
    'font-display': fontStack(theme.fontDisplay), 'font-body': fontStack(theme.fontBody),
    'weight-display': String(displayWeight(theme.fontDisplay)), 'weight-body': String(theme.weightBody || 400),
    'size-base': theme.size + 'px', 'size-sm': (theme.size - 2) + 'px', 'size-lg': (theme.size + 4) + 'px',
    radius: theme.radius + 'px', 'radius-sm': Math.max(4, theme.radius - 4) + 'px', 'radius-lg': (theme.radius + 6) + 'px',
    border: theme.border + 'px', tap: (TAP[theme.density] || 48) + 'px', density: theme.density,
  };
  sp.forEach((v, i) => { t['space-' + (i + 1)] = v + 'px'; });
  t['focus-ring'] = '2px solid var(--db-accent)';
  t['short-name'] = JSON.stringify(theme.brand?.shortName || 'Dos Búhos');
  for (const k of ['logo-light', 'logo-dark', 'icon']) if (assets[k]) t[k] = `url("${assets[k]}")`;
  return t;
}
const decl = (o) => Object.entries(o).map(([k, v]) => `  --db-${k}: ${v};`).join('\n');
// assets: { 'logo-light': absoluteUrl, … } for the logos that exist.
export function buildCss(theme, assets = {}, meta = '') {
  const url = fontsUrl([theme.fontDisplay, theme.fontBody]);
  // --db-logo is the logo for the current mode. A light logo is usually dark ink, so it is NOT reused in dark mode:
  // without a dark logo, dark mode gets `none` and apps show the short name (or their own wordmark) instead.
  const light = tokens(theme, 'light'), dark = tokens(theme, 'dark'), st = staticTokens(theme, assets);
  const darkLogo = assets['logo-dark'] ? `\n  --db-logo: url("${assets['logo-dark']}");` : assets['logo-light'] ? '\n  --db-logo: none;' : '';
  const lightLogo = assets['logo-light'] ? `\n  --db-logo: url("${assets['logo-light']}");` : '';
  return `${url ? `@import url("${url}");\n` : ''}/* Dos Búhos theme${meta ? ' · ' + meta : ''}. Token contract: hub/THEME.md */
:root {
${decl(st)}
${decl(light)}${lightLogo}
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${decl(dark).replace(/^/gm, '  ')}${darkLogo.replace(/\n/g, '\n  ')}
  }
}
:root[data-theme="dark"] {
${decl(dark)}${darkLogo}
  color-scheme: dark;
}
:root[data-theme="light"] { color-scheme: light; }
`;
}

// ---------------------------------------------------------------- AI prompt (used by the Worker)
export function schemaDoc() {
  return {
    preset: `optional base preset id: ${PRESETS.map(p => p.id).join(' | ')}`,
    name: 'short name for this theme (Spanish)',
    light: Object.fromEntries(COLOR_KEYS.map(k => [k, `#rrggbb — ${COLOR_LABEL[k]}`])),
    dark: Object.fromEntries(COLOR_KEYS.map(k => [k, `#rrggbb — ${COLOR_LABEL[k]} (modo oscuro)`])),
    fontDisplay: `one of: ${FONTS.map(f => f.name).join(' | ')}`,
    fontBody: 'same list as fontDisplay',
    size: '16 | 17 | 18 (base text size, px)',
    radius: '6 | 10 | 14 (corner radius, px)',
    border: '1 | 1.5 | 2 (border width, px)',
    density: 'compacta | normal | amplia',
    weightBody: '400 | 500 (500 = heavier text, for outdoor use)',
    brand: { shortName: 'short app name, ≤ 24 chars' },
    apps: '{ "<app slug>": "<preset id>" } per-app preset pins; omit to keep current',
  };
}
export function rulesDoc() {
  return RULES.map(([fg, bg, label, min, prefer]) => `${fg} on ${bg} (${label}) ≥ ${min}:1${prefer ? ` (prefer ≥ ${prefer}:1)` : ''}`).concat([
    'ok-soft / bad-soft / warn-soft / off-soft are derived: 12–14% of the status colour mixed into surface; the status colour must still read on them.',
    'Rules apply to BOTH light and dark.',
  ]);
}
// Pull one JSON object out of a model reply (fences, prose around it).
export function extractJson(text) {
  const s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : s;
  try { return JSON.parse(body); } catch {}
  const a = body.indexOf('{'), b = body.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(body.slice(a, b + 1)); } catch {} }
  return null;
}
