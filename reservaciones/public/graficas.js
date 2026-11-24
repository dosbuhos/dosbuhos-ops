// Charts as plain SVG strings, drawn at the exact width of their container (and redrawn on resize) so text keeps its
// size on a phone. Thin marks, hairline grid, one accent; a mark's value is always reachable three ways: the selective
// label, the tooltip (data-t / data-s on a focusable hit area) and the table under the chart.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r1 = (n) => Math.round(n * 10) / 10;

/** $1.2 M, $48 mil, $950: for axes and labels on marks. Amounts arrive in cents. */
export function pesosCorto(minor) {
  const p = minor / 100, a = Math.abs(p);
  if (a >= 1_000_000) return `$${(p / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')} M`;
  if (a >= 10_000) return `$${Math.round(p / 1000)} mil`;
  if (a >= 1000) return `$${(p / 1000).toFixed(1).replace(/\.0$/, '')} mil`;
  return `$${Math.round(p)}`;
}

/** A round top for the axis and three or four clean steps under it. */
export function escala(max) {
  if (!(max > 0)) return { tope: 1, pasos: [0, 1] };
  const bruto = max / 3, pot = 10 ** Math.floor(Math.log10(bruto)), paso = [1, 2, 2.5, 5, 10].map((m) => m * pot).find((p) => p >= bruto);
  const pasos = []; for (let v = 0; v < max + paso * 0.999; v += paso) pasos.push(v);
  return { tope: pasos[pasos.length - 1], pasos };
}

const toque = (x, y, w, h, d) => `<rect class="toque" x="${r1(x)}" y="${r1(y)}" width="${r1(w)}" height="${r1(h)}" tabindex="0" role="img" aria-label="${esc(`${d.t}. ${d.s}`)}" data-t="${esc(d.t)}" data-s="${esc(d.s)}"/>`;
/** A column standing on the baseline: square below, 4px round above. */
const columna = (x, y, w, h, cls) => { const r = Math.min(4, w / 2, h); return h <= 0 ? '' : `<path class="${cls}" d="M${r1(x)} ${r1(y + h)}V${r1(y + r)}a${r} ${r} 0 0 1 ${r} ${-r}h${r1(w - 2 * r)}a${r} ${r} 0 0 1 ${r} ${r}V${r1(y + h)}z"/>`; };

/**
 * Columns for one series, with an optional reference mark per column (the same days a year earlier) on the same axis.
 * datos: [{ et, v (number | null = not known), ref (number | null), t, s, hoy, futuro }]
 */
export function columnas({ ancho, datos, alto = 168, formato = pesosCorto }) {
  const ml = 46, mr = 6, mt = 18, mb = 24, w = Math.max(120, ancho) - ml - mr, h = alto - mt - mb, n = datos.length;
  const max = Math.max(0, ...datos.map((d) => Math.max(d.v ?? 0, d.ref ?? 0)));
  const { tope, pasos } = escala(max), y = (v) => mt + h - (v / tope) * h, banda = w / n, bw = Math.max(3, Math.min(24, banda - (n > 12 ? 3 : 10)));
  const cadaEt = n <= 8 ? 1 : Math.ceil(n / 7), iHoy = datos.findIndex((d) => d.hoy), mayor = datos.reduce((m, d, i) => ((d.v ?? -1) > (datos[m]?.v ?? -1) ? i : m), 0);
  let s = `<svg width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}" role="group" aria-label="Gráfica de columnas">`;
  for (const p of pasos) s += `<line class="${p === 0 ? 'base' : 'rej'}" x1="${ml}" x2="${ml + w}" y1="${r1(y(p))}" y2="${r1(y(p))}"/><text x="${ml - 7}" y="${r1(y(p) + 3.5)}" text-anchor="end">${p === 0 ? '0' : esc(formato(p))}</text>`;
  datos.forEach((d, i) => {
    const cx = ml + banda * (i + 0.5);
    if (d.v !== null && d.v > 0) s += columna(cx - bw / 2, y(d.v), bw, mt + h - y(d.v), `col-a${d.hoy ? ' hoy' : ''}`);
    if (d.ref !== null && d.ref !== undefined && (d.ref > 0 || d.v > 0)) s += `<line class="marca-anio" x1="${r1(cx - bw / 2 - 2)}" x2="${r1(cx + bw / 2 + 2)}" y1="${r1(y(d.ref))}" y2="${r1(y(d.ref))}"/>`;
    if (i === mayor && d.v > 0) s += `<text class="fuerte" x="${r1(Math.min(Math.max(cx, ml + 22), ml + w - 22))}" y="${r1(Math.min(y(d.v), d.ref != null ? y(d.ref) : 1e9) - 6)}" text-anchor="middle">${esc(formato(d.v))}</text>`;
    if (d.hoy || (i % cadaEt === 0 && (iHoy < 0 || Math.abs(i - iHoy) >= cadaEt / 2))) s += `<text class="${d.hoy ? 'fuerte' : ''}" x="${r1(cx)}" y="${alto - 7}" text-anchor="middle">${esc(d.et)}</text>`;
    s += toque(ml + banda * i, mt - 8, banda, h + 8 + mb, d);
  });
  return `${s}</svg>`;
}

/**
 * Weekly sales as a line with a soft wash, the same weeks a year earlier as a thinner grey line. A week still in
 * progress is a hollow dot, not part of the line: it is not comparable yet.
 * puntos: [{ et, v (number | null), ref (number | null), parcial, t, s }]
 */
export function tendencia({ ancho, puntos, alto = 176, formato = pesosCorto }) {
  const ml = 46, mr = 14, mt = 20, mb = 24, w = Math.max(120, ancho) - ml - mr, h = alto - mt - mb, n = puntos.length;
  const max = Math.max(0, ...puntos.map((p) => Math.max(p.v ?? 0, p.ref ?? 0)));
  const { tope, pasos } = escala(max), y = (v) => mt + h - (v / tope) * h, x = (i) => ml + (n === 1 ? w / 2 : (w * i) / (n - 1));
  const camino = (sel) => { let d = '', pluma = false; puntos.forEach((p, i) => { const v = sel(p); if (v === null || v === undefined) { pluma = false; return; } d += `${pluma ? 'L' : 'M'}${r1(x(i))} ${r1(y(v))}`; pluma = true; }); return d; };
  const completos = puntos.map((p, i) => ({ ...p, i })).filter((p) => p.v !== null && !p.parcial), ultimo = completos[completos.length - 1];
  let s = `<svg width="${ancho}" height="${alto}" viewBox="0 0 ${ancho} ${alto}" role="group" aria-label="Gráfica de línea">`;
  for (const p of pasos) s += `<line class="${p === 0 ? 'base' : 'rej'}" x1="${ml}" x2="${ml + w}" y1="${r1(y(p))}" y2="${r1(y(p))}"/><text x="${ml - 7}" y="${r1(y(p) + 3.5)}" text-anchor="end">${p === 0 ? '0' : esc(formato(p))}</text>`;
  const ref = camino((p) => (p.parcial ? null : p.ref));                    // a week in progress is not comparable yet, on either line
  if (ref) s += `<path d="${ref}" fill="none" stroke="var(--fantasma)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  const linea = camino((p) => (p.parcial ? null : p.v));
  if (linea && completos.length > 1) s += `<path d="${linea}L${r1(x(ultimo.i))} ${mt + h}L${r1(x(completos[0].i))} ${mt + h}z" fill="var(--accent)" opacity=".1"/>`;
  if (linea) s += `<path d="${linea}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  if (ultimo) s += `<circle cx="${r1(x(ultimo.i))}" cy="${r1(y(ultimo.v))}" r="4.5" fill="var(--accent)" stroke="var(--card)" stroke-width="2"/><text class="fuerte halo" x="${r1(Math.min(x(ultimo.i) + 6, ancho - 2))}" y="${r1(y(ultimo.v) - 12)}" text-anchor="end">${esc(formato(ultimo.v))}</text>`;
  const cada = Math.max(1, Math.ceil(n / (ancho < 420 ? 3 : 5)));
  puntos.forEach((p, i) => {
    if (p.parcial && p.v > 0) s += `<circle cx="${r1(x(i))}" cy="${r1(y(p.v))}" r="4" fill="var(--card)" stroke="var(--accent)" stroke-width="2"/>`;
    if (i === n - 1 || (i % cada === 0 && n - 1 - i >= cada * 0.75)) s += `<text x="${r1(x(i))}" y="${alto - 7}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${esc(p.et)}</text>`;
    const paso = n === 1 ? w : w / (n - 1);
    s += toque(x(i) - paso / 2, mt - 8, paso, h + 8 + mb, p);
  });
  return `${s}</svg>`;
}

/**
 * People arriving per half hour on one day: a strip of small columns over the opening hours, each labelled when there
 * is room (otherwise only the busiest). ya: the current time in half hours (14:15 = 28.5) draws a "now" line.
 * franjas: [{ media, personas }]
 */
export function ritmo({ ancho, franjas, desde = 20, hasta = 37, ya = null }) {
  const a = Math.min(desde, ...franjas.map((f) => f.media)), b = Math.max(hasta, ...franjas.map((f) => f.media));
  const n = b - a + 1, alto = 64, mt = 15, mb = 15, h = alto - mt - mb, banda = ancho / n, bw = Math.max(4, Math.min(18, banda - 3));
  const max = Math.max(1, ...franjas.map((f) => f.personas)), tope = franjas.reduce((m, f) => (f.personas > (m?.personas ?? 0) ? f : m), null);
  const todas = banda >= 13;
  const hhmm = (k) => `${Math.floor(k / 2)}:${k % 2 ? '30' : '00'}`;
  let s = `<svg viewBox="0 0 ${ancho} ${alto}" width="${ancho}" height="${alto}" role="img" aria-label="${esc(`Personas por media hora: ${franjas.map((f) => `${hhmm(f.media)}, ${f.personas}`).join('; ')}`)}">`;
  s += `<line class="eje" x1="0" x2="${ancho}" y1="${mt + h + 0.5}" y2="${mt + h + 0.5}"/>`;
  for (let k = a; k <= b; k++) if (k % 4 === 0) s += `<text x="${r1(banda * (k - a + 0.5))}" y="${alto - 3}" text-anchor="middle">${Math.floor(k / 2)}:00</text>`;
  for (const f of franjas) {
    const cx = banda * (f.media - a + 0.5), alt = Math.max(3, (f.personas / max) * h);
    s += columna(cx - bw / 2, mt + h - alt, bw, alt, ya !== null && f.media + 1 <= ya ? 'bar pasada' : 'bar');   // half hours already over recede
    if (todas || f === tope) s += `<text class="tope" x="${r1(Math.min(Math.max(cx, 8), ancho - 8))}" y="${r1(mt + h - alt - 3)}" text-anchor="middle">${f.personas}</text>`;
  }
  if (ya !== null && ya >= a - 0.5 && ya <= b + 0.5) {
    const x = r1(banda * (ya - a + 0.5));
    s += `<line class="ya" x1="${x}" x2="${x}" y1="${mt - 4}" y2="${mt + h + 3}"/><text class="ya-t" x="${x}" y="${mt - 6}" text-anchor="${x < 30 ? 'start' : x > ancho - 30 ? 'end' : 'middle'}">ahora</text>`;
  }
  return `${s}</svg>`;
}
