import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, HistogramSeries, LineSeries, LineStyle, createSeriesMarkers, type IChartApi, type Time } from 'lightweight-charts';
import { metricValue, deltaText, money, int, ratio, dayLabel, stateLabel, basisLabel, STATE_CLS } from './format';

/** Canvas needs a plain color: '#rrggbb' + alpha → rgba(). */
const hexA = (hex: string, a: number) => { const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h, 16); return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`; };

export interface Point { date: string; value: number | null; provisional: boolean }

/** Sparkline: a single series, so no legend; gaps where data is missing; dashed where provisional. */
export function Sparkline({ points, label }: { points: Point[]; label: string }) {
  const vals = points.map(p => p.value).filter((v): v is number => v !== null);
  if (vals.length < 2) return <div className="tiny muted">No hay suficientes datos para una tendencia</div>;
  const min = Math.min(0, ...vals), max = Math.max(...vals, 0);
  const W = 200, H = 34, pad = 3;
  const x = (i: number) => pad + (i / (points.length - 1)) * (W - 2 * pad);
  const y = (v: number) => H - pad - ((v - min) / (max - min || 1)) * (H - 2 * pad);
  const segs: { d: string; prov: boolean }[] = [];
  let cur: string[] = [], curProv = false;
  points.forEach((p, i) => {
    if (p.value === null) { if (cur.length > 1) segs.push({ d: cur.join(' '), prov: curProv }); cur = []; return; }
    if (cur.length && p.provisional !== curProv) { segs.push({ d: cur.join(' '), prov: curProv }); cur = [cur[cur.length - 1]!.replace('M', 'L')]; }
    curProv = p.provisional;
    cur.push(`${cur.length ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`);
  });
  if (cur.length > 1) segs.push({ d: cur.join(' '), prov: curProv });
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${label}: últimos ${points.length} días`}>
      {min < 0 && <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--rule)" strokeWidth={1} />}
      {segs.map((s, i) => <path key={i} d={s.d.startsWith('L') ? 'M' + s.d.slice(1) : s.d} fill="none" stroke="var(--s1)" strokeWidth={1.8} strokeDasharray={s.prov ? '3 3' : undefined} vectorEffect="non-scaling-stroke" strokeLinecap="round" />)}
    </svg>
  );
}

export function TickerCard({ t, currency }: { t: any; currency: string }) {
  const m = t.metric, d = t.delta;
  const dir = d.absolute === null || d.absolute === 0 ? 'flat' : d.absolute > 0 ? 'up' : 'down';
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■';
  return (
    <div className="card ticker">
      <div className="label"><span>{t.label}</span>{m.provisional && <span className="chip prov" title="Las cohortes recientes todavía están madurando">provisional</span>}</div>
      <div className={`value ${m.value === null ? 'unknown' : ''}`}>{metricValue(m, currency)}</div>
      <div className={`delta ${dir}`}><span aria-hidden>{arrow}</span><span>{deltaText(d, m.unit, currency)}</span><span className="sr-only" style={{ position: 'absolute', left: -9999 }}>{dir === 'up' ? 'aumento' : dir === 'down' ? 'disminución' : 'sin cambio'}</span></div>
      {t.spark?.length > 0 && <Sparkline points={t.spark} label={t.label} />}
      <div className="window">{t.window}</div>
      <details className="why">
        <summary>Cómo se calcula</summary>
        <div className="stack" style={{ marginTop: 4 }}>
          <div><b>{m.numerator.label}</b>{m.numerator.value !== null ? `: ${fmtPart(m.numerator.value, m.unit, currency)}` : ''}</div>
          {m.denominator && <div>÷ <b>{m.denominator.label}</b>{m.denominator.value !== null ? `: ${fmtPart(m.denominator.value, m.unit, currency)}` : ''}</div>}
          <div>Base: {basisLabel(m.basis)}{m.provisional ? ' · incluye cohortes que todavía están madurando' : ''}</div>
          {m.reason && <div>{m.reason}</div>}
          {d.note && <div>{d.note}</div>}
        </div>
      </details>
    </div>
  );
}
const fmtPart = (v: number, unit: string, currency: string) => (unit === 'money' || unit === 'ratio' ? money(v, currency) : int(v));

/** The hero chart: daily observations as bars (gold) + an optional trailing average line (burgundy). One y-axis. */
export function HeroChart({ series, markers, cutoff, currency, trend, onMarker }: { series: any; markers: any[]; cutoff: string; currency: string; trend: 0 | 7 | 28; onMarker: (id: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; date: string; value: number | null; trend: number | null; prov: boolean; marks: any[] } | null>(null);
  const fmt = useMemo(() => (v: number | null) => (v === null ? 'sin dato' : series.unit === 'money' ? money(v, currency) : series.unit === 'ratio' ? ratio(v) : int(v)), [series.unit, currency]);

  useEffect(() => {
    const el = host.current; if (!el) return;
    const css = getComputedStyle(document.documentElement);
    const c = (n: string) => css.getPropertyValue(n).trim();
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: c('--muted'), fontFamily: 'IBM Plex Mono, ui-monospace, monospace', fontSize: 11, attributionLogo: true },
      grid: { vertLines: { visible: false }, horzLines: { color: c('--grid') } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.1, bottom: 0.08 } },
      timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true },
      crosshair: { vertLine: { color: c('--muted'), labelVisible: false }, horzLine: { visible: false, labelVisible: false } },
      handleScale: { mouseWheel: false, pinch: true }, handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      localization: { locale: 'es-MX', priceFormatter: (v: number) => (series.unit === 'money' ? money(v, currency) : series.unit === 'ratio' ? ratio(v) : int(v)) },
    });
    chartRef.current = chart;
    const s2 = c('--s2'), s1 = c('--s1');
    const bars = chart.addSeries(HistogramSeries, { color: s2, priceLineVisible: false, lastValueVisible: false, base: 0 });
    bars.setData(series.points.map((p: Point) => (p.value === null ? { time: p.date as Time } : { time: p.date as Time, value: p.value, color: p.provisional ? hexA(s2, 0.42) : s2 })));
    const tr: (number | null)[] = trend === 7 ? series.trend7 : trend === 28 ? series.trend28 : [];
    if (trend) {
      const solid = chart.addSeries(LineSeries, { color: s1, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerRadius: 4 });
      const dashed = chart.addSeries(LineSeries, { color: s1, lineWidth: 2, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      const firstProv = series.points.findIndex((p: Point) => p.provisional);
      solid.setData(series.points.map((p: Point, i: number) => (tr[i] == null || (firstProv >= 0 && i > firstProv) ? { time: p.date as Time } : { time: p.date as Time, value: tr[i] as number })));
      dashed.setData(series.points.map((p: Point, i: number) => (tr[i] == null || firstProv < 0 || i < firstProv ? { time: p.date as Time } : { time: p.date as Time, value: tr[i] as number })));
    }
    const inRange = markers.filter(m => series.points.some((p: Point) => p.date === m.date));
    createSeriesMarkers(bars, inRange.map(m => ({ time: m.date as Time, position: 'aboveBar' as const, shape: 'circle' as const, color: c('--accent'), text: m.state === 'SHADOWED' ? 'S' : 'A', id: m.actionId })));
    chart.timeScale().fitContent();
    const onMove = (param: any) => {
      if (!param.time || !param.point) { setTip(null); return; }
      const date = String(param.time);
      const i = series.points.findIndex((p: Point) => p.date === date);
      const p = series.points[i];
      if (!p) { setTip(null); return; }
      setTip({ x: param.point.x, y: param.point.y, date, value: p.value, trend: trend ? tr[i] ?? null : null, prov: p.provisional, marks: markers.filter(m => m.date === date) });
    };
    chart.subscribeCrosshairMove(onMove);
    const onClick = (param: any) => { const id = param.hoveredObjectId ?? markers.find(m => m.date === String(param.time))?.actionId; if (id) onMarker(String(id)); };
    chart.subscribeClick(onClick);
    return () => { chart.unsubscribeCrosshairMove(onMove); chart.unsubscribeClick(onClick); chart.remove(); chartRef.current = null; };
  }, [series, markers, trend, currency, onMarker]);

  const firstProv = series.points.find((p: Point) => p.provisional)?.date;
  return (
    <div className="hero">
      <div className="legend" aria-label="Leyenda">
        <span><i style={{ background: 'var(--s2)' }} />Valor diario{series.view === 'service' ? ' (fecha de servicio)' : ' (cohorte por fecha de reservación)'}</span>
        {trend > 0 && <span><i style={{ background: 'var(--s1)' }} />Promedio móvil de {trend} días</span>}
        {firstProv && <span><i className="dash" />Provisional desde el {dayLabel(firstProv)} (todavía llegan resultados)</span>}
        <span>● marcador de acción (tócalo)</span>
        <span>Datos hasta el {dayLabel(cutoff)}</span>
      </div>
      <div ref={host} className="chart" role="img" aria-label={`${series.label}, diario, últimos ${series.points.length} días. Vista de tabla abajo.`} />
      {tip && (
        <div className="tooltip" style={{ left: Math.min(Math.max(8, tip.x - 80), (host.current?.clientWidth ?? 300) - 170), top: 34 }}>
          <div className="mono">{dayLabel(tip.date)}</div>
          <div>{series.label}: <b className="mono">{fmt(tip.value)}</b></div>
          {tip.trend !== null && trend > 0 && <div>Prom. {trend} días: <b className="mono">{fmt(tip.trend)}</b></div>}
          {tip.prov && <div className="muted">Provisional</div>}
          {tip.marks.map(m => <div key={m.actionId} className="muted">● {m.label} ({stateLabel(m.state)})</div>)}
        </div>
      )}
    </div>
  );
}

export function SeriesTable({ series, currency }: { series: any; currency: string }) {
  const f = (v: number | null) => (v === null ? 'sin dato' : series.unit === 'money' ? money(v, currency) : series.unit === 'ratio' ? ratio(v) : int(v));
  return (
    <div className="table-scroll"><table className="data">
      <thead><tr><th>Fecha</th><th className="n">{series.label}</th><th className="n">Prom. 7 días</th><th>Estado</th></tr></thead>
      <tbody>{[...series.points].reverse().map((p: Point, ri: number) => { const i = series.points.length - 1 - ri; return <tr key={p.date}><td className="mono">{p.date}</td><td className="n">{f(p.value)}</td><td className="n">{f(series.trend7[i])}</td><td>{p.provisional ? 'provisional' : ''}</td></tr>; })}</tbody>
    </table></div>
  );
}

export function StateChip({ s }: { s: string }) {
  const icon = ['VERIFIED', 'COMPENSATED'].includes(s) ? '✓' : ['FAILED', 'UNKNOWN_OUTCOME'].includes(s) ? '!' : s === 'REJECTED' ? '×' : '•';
  return <span className={`state ${STATE_CLS[s] ?? 's-mute'}`}><span aria-hidden>{icon}</span>{stateLabel(s)}</span>;
}

export function Health({ h }: { h: string }) {
  const map: Record<string, [string, string, string]> = { connected: ['s-ok', '✓', 'Conectada'], limited: ['s-warn', '◐', 'Limitada'], reconnect: ['s-bad', '!', 'Hay que volver a conectar'], not_configured: ['s-mute', '○', 'Sin configurar'] };
  const [cls, icon, label] = map[h] ?? map.not_configured!;
  return <span className={`state ${cls}`}><span aria-hidden>{icon}</span>{label}</span>;
}

export function Loading() { return <div className="skeleton" aria-busy="true" aria-label="Cargando" />; }
export function ErrorBox({ error, stale }: { error: string; stale?: boolean }) {
  return <div className="notice bad" role="alert">{stale ? 'No se pudo actualizar; se muestran los últimos datos recibidos. ' : ''}{error}</div>;
}
