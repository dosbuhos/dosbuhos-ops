import { useCallback, useMemo, useState } from 'react';
import { TickerCard, HeroChart, SeriesTable, Loading, ErrorBox } from '../components';
import { MODE_INFO, PRODUCT_LABEL, dayLabel, ago } from '../format';

const VIEW_KEYS: [string, string][] = [['contribution_after_ads', 'Contribution after ads'], ['online_reservations', 'Online reservations'], ['online_reservations_google_ads', 'Reservations from Google Ads'], ['confirmed_bookings', 'Bookings'], ['completed_guests', 'Completed guests'], ['revenue', 'Revenue'], ['ad_spend', 'Ad spend'], ['platform_conversions', 'Google conversions'], ['contribution_roas', 'Contribution ROAS']];

export function Overview({ o, error, session }: { o: any; error: string | null; session: any }) {
  const [key, setKey] = useState<string | null>(null);
  const [trend, setTrend] = useState<0 | 7 | 28>(7);
  const [table, setTable] = useState(false);
  const onMarker = useCallback((id: string) => { location.hash = `activity`; sessionStorage.setItem('growth-focus-action', id); }, []);
  const k = key ?? o?.heroKey;
  const series = useMemo(() => o?.series?.find((s: any) => s.key === k), [o, k]);
  if (!o) return error ? <ErrorBox error={error} /> : <div className="section"><Loading /></div>;
  const mode = o.coordinator?.mode;
  const alerts = (o.alerts ?? []).filter((a: any) => a.severity !== 'info');
  const fwd = o.capacity.days.filter((d: any) => d.date < addDays(o.today, 14) && (d.product === 'restaurant_visit' || d.product === 'tour_tasting'));
  const byDate = groupBy(fwd, (d: any) => d.date);

  return (
    <>
      {error && <ErrorBox error={error} stale />}
      <section className="section" aria-labelledby="needs">
        <header><h2 id="needs">What needs me?</h2><span className="small muted">{alerts.length ? `${alerts.length} item(s)` : 'Nothing right now'}</span></header>
        {alerts.length ? <div className="list">{alerts.map((a: any) => (
          <a key={a.dedupe_key} href={a.link || '#overview'} className={`notice ${a.severity === 'critical' ? 'bad' : ''}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
            <b>{a.severity === 'critical' ? '⛔ ' : '⚠ '}{a.title}</b><div className="small">{a.detail}</div>
          </a>))}</div> : <div className="small muted">No alerts. The watchdog checks spend freshness, missed reviews, unknown outcomes and capacity every 15 minutes without using the AI.</div>}
      </section>

      <section className="section" aria-labelledby="tick">
        <header><h2 id="tick">Last 28 days</h2><span className="small muted">{o.window.from} – {o.window.to} vs {o.window.prevFrom} – {o.window.prevTo}</span></header>
        <div className="grid tickers">{o.tickers.map((t: any) => <TickerCard key={t.key} t={t} currency={o.currency} />)}</div>
      </section>

      <section className="section card" aria-labelledby="hero">
        <header style={{ display: 'grid', gap: 8 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 id="hero">{series?.label ?? 'Performance'}{series?.unit === 'money' ? ` (${o.currency})` : ''}</h2>
            <span className="small muted">{series?.view === 'service' ? 'By service date (operations)' : 'By booking-creation date (acquisition cohort)'}</span>
          </div>
          <div className="seg" role="group" aria-label="Metric">{VIEW_KEYS.map(([sk, l]) => <button key={sk} aria-pressed={k === sk} onClick={() => setKey(sk)}>{l}</button>)}</div>
          <div className="row">
            <div className="seg" role="group" aria-label="Trend line">{([0, 7, 28] as const).map(n => <button key={n} aria-pressed={trend === n} onClick={() => setTrend(n)}>{n ? `${n}-day trend` : 'Daily only'}</button>)}</div>
            <div className="seg"><button aria-pressed={table} onClick={() => setTable(!table)}>Table view</button></div>
          </div>
        </header>
        {series && !series.available ? (
          <div className="notice" style={{ marginTop: 10 }}><b>{series.label} cannot be shown.</b> {series.missing ?? 'No data for this window.'}{series.key === 'revenue' || series.key.startsWith('contribution') ? ' Revenue is never labeled as profit.' : ''} {series.missing?.includes('Connections') && <a href="#connections">Open Connections →</a>}</div>
        ) : series ? (
          <>
            <div style={{ marginTop: 10 }}><HeroChart series={series} markers={o.markers} cutoff={o.cutoff} currency={o.currency} trend={trend} onMarker={onMarker} /></div>
            {table && <SeriesTable series={series} currency={o.currency} />}
            <p className="small muted">Every day is shown, including bad days. {series.view === 'acquisition' ? 'Recent cohorts are provisional because some bookings have not happened yet.' : ''} An action marker before an improvement does not mean the action caused it — see the action’s evaluation window. Attribution: {o.attributionMethod}.</p>
          </>
        ) : null}
      </section>

      {o.funnel && <Funnel f={o.funnel} />}

      <div className="grid cols-2 section">
        <section className="card" aria-labelledby="cap14">
          <header className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}><h3 id="cap14">Next 14 days</h3><a href="#capacity" className="small">Full calendar</a></header>
          {Object.keys(byDate).length === 0 && <p className="small muted">No capacity entered yet. Staff can add slots in Capacity; nothing here is treated as full or empty.</p>}
          <div className="cal">{Object.entries(byDate).map(([date, ds]) => (
            <div key={date} className="cal-day"><div className="d">{dayLabel(date).split(' ').slice(1).join(' ')}<small>{dayLabel(date).split(' ')[0]}</small></div>
              <div className="cal-prods">{(ds as any[]).map(d => <CapChip key={d.product} d={d} />)}</div></div>))}</div>
          <p className="tiny muted">Capacity last updated {ago(o.capacity.lastUpdate)}. Unknown means nobody has entered it — it is never treated as empty or unlimited.</p>
        </section>
        <section className="card" aria-labelledby="agent">
          <h3 id="agent">What is the agent doing?</h3>
          <div className="stack" style={{ marginTop: 8 }}>
            {mode && <div><span className={`state ${MODE_INFO[mode]?.cls}`}>{MODE_INFO[mode]?.label}</span> <span className="small">{MODE_INFO[mode]?.text}</span></div>}
            <div className="small">Last daily review: <b>{o.lastReview ? `${o.lastReview.status} · ${ago(Number(o.lastReview.started_at))}` : 'not run yet'}</b></div>
            <div className="small">AI analysis: <b>{session?.aiConfigured ? `on (${session.model})` : 'off — reports use the factual template, no proposals'}</b></div>
            <div className="small">Changes on the chart: {o.markers.length ? o.markers.slice(-4).reverse().map((m: any) => <div key={m.actionId + m.state}>● {m.date} · {m.label} <span className="muted">({m.state.toLowerCase()})</span></div>) : 'none'}</div>
            <a className="small" href="#activity">All proposals and decisions →</a>
          </div>
          <hr />
          <h3>Data quality</h3>
          <ul className="small" style={{ paddingLeft: 18, margin: '6px 0 0' }}>
            {o.quality.bookingsConnected === false ? <li>No booking source connected yet, so attribution, sales matching, cancellations and no-shows can’t be measured</li> : <>
              <li>Attribution coverage {o.quality.attributionCoverage ?? '—'}% · sales matched {o.quality.salesMatchingCoverage ?? '—'}%</li>
              <li>Cancellations {o.quality.cancellationRate ?? '—'}% · no-shows {o.quality.noShowRate ?? '—'}%</li></>}
            {o.quality.conversionDaysMissing.length > 0 && <li>Conversion data missing on {o.quality.conversionDaysMissing.join(', ')} — shown as gaps, not zeros</li>}
            {o.quality.spendDaysMissing.length > 0 && <li>Spend missing on {o.quality.spendDaysMissing.length} day(s)</li>}
            <li>{o.quality.lagKnown ? 'Maturation lag estimated from data' : 'Maturation lag not yet estimated — scaling on profitability is off'}</li>
          </ul>
        </section>
      </div>
    </>
  );
}

function Funnel({ f }: { f: { window: string; gaps: string[]; steps: { event: string; label: string; count: number }[] } }) {
  const top = Math.max(1, ...f.steps.map(s => s.count));
  return (
    <section className="section card" aria-labelledby="funnel">
      <header className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}><h3 id="funnel">Online booking funnel</h3><span className="small muted">{f.window}, all traffic, from GA4</span></header>
      <div className="stack">{f.steps.map((s, i) => {
        const prev = i ? f.steps[i - 1]!.count : null;
        return (
          <div key={s.event} className="row" style={{ flexWrap: 'nowrap', gap: 10 }}>
            <div style={{ flex: '0 1 46%', minWidth: 0 }} className="small">{s.label}</div>
            <div style={{ flex: 1, minWidth: 0 }}><div className="bar" style={{ width: '100%', height: 10 }}><span style={{ width: `${(s.count / top) * 100}%` }} /></div></div>
            <b className="mono" style={{ minWidth: 44, textAlign: 'right' }}>{s.count}</b>
            <span className="tiny muted" style={{ minWidth: 48, textAlign: 'right' }}>{prev ? `${Math.round((s.count / prev) * 100)}%` : ''}</span>
          </div>
        );
      })}</div>
      <p className="tiny muted">Each step is counted separately by GA4 (events, not unique people), so percentages are approximate. “Booked” counts online widget reservations only; phone bookings and cancellations are not here.{f.gaps.length ? ` GA4 recorded nothing on ${f.gaps.join(', ')}: those days are treated as missing, not as zero.` : ''}</p>
    </section>
  );
}

export function CapChip({ d }: { d: any }) {
  const pct = d.sellable ? Math.round((d.reserved / d.sellable) * 100) : 0;
  const label = PRODUCT_LABEL[d.product] ?? d.product;
  const text = d.status === 'closed' ? 'closed' : d.status === 'blocked' ? 'blocked' : d.status === 'unknown' ? 'unknown' : d.status === 'sold_out' ? 'sold out' : `${d.remaining} open`;
  return (
    <span className={`cap ${d.status}`} title={`${label}: ${d.reserved} reserved of ${d.sellable} known places${d.unknownSlots ? `, ${d.unknownSlots} unknown slot(s)` : ''}${d.staleSlots ? ', stale' : ''}`}>
      <span>{label.split(' ')[0]}</span><b className="mono">{text}</b>
      {(d.status === 'open' || d.status === 'sold_out') && <span className="bar" aria-hidden><span style={{ width: `${Math.min(100, pct)}%` }} /></span>}
      {d.staleSlots > 0 && <span title="Stale">⏱</span>}
    </span>
  );
}

export const addDays = (d: string, n: number) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y!, m! - 1, dd! + n)).toISOString().slice(0, 10); };
export function groupBy<T>(xs: T[], f: (x: T) => string): Record<string, T[]> { const o: Record<string, T[]> = {}; for (const x of xs) (o[f(x)] ??= []).push(x); return o; }
