// "Reservaciones → Pagos": what was charged online by card (Stripe). Experiences paid ahead on OpenTable, what is
// already charged for visits still to come, and the club and the web store month by month. Read-only. It is never
// added to the point-of-sale sales: part of the prepaid visits is also rung up in Parrot on the day, as a transfer.
import { useApi } from '../api';
import { Loading, ErrorBox } from '../components';
import { money, int, count, dayLabel, fullDate, signedPct, when } from '../format';

const SOURCE: Record<string, string> = { opentable: 'Experiencias en OpenTable', rezdy: 'Tours en Rezdy', wine_club: 'Club de vinos', web_store: 'Tienda en línea', invoice: 'Facturas pagadas con tarjeta', payment_link: 'Ligas de pago', other: 'Otros cobros' };
const SOURCE_SHORT: Record<string, string> = { opentable: 'Experiencias', rezdy: 'Rezdy', wine_club: 'Club', web_store: 'Tienda', invoice: 'Facturas', payment_link: 'Ligas', other: 'Otros' };
const LEGEND: Record<string, string> = {
  opentable: 'Experiencias: pagadas al reservar en OpenTable', rezdy: 'Rezdy: tours pagados al reservar, hasta octubre de 2026', wine_club: 'Club: cuotas del club de vinos', web_store: 'Tienda: pedidos de la tienda en línea',
  invoice: 'Facturas: facturas de Zoho que el cliente pagó en línea con tarjeta', payment_link: 'Ligas: ligas de pago de Stripe enviadas por el equipo', other: 'Otros: cobros que no vienen de ninguno de los anteriores',
};
const ORDER = ['opentable', 'rezdy', 'wine_club', 'web_store', 'invoice', 'payment_link', 'other'];
// OpenTable's own names for where the guest booked: its app, or a browser (opentable.com and the button on dosbuhos.com
// both count as web; OpenTable does not tell them apart in the payment). Unknown ones are shown as they arrive.
const PLATFORM: Record<string, string> = { 'Diner App': 'En la app de OpenTable', 'Diner Web': 'En la web (opentable.com o el botón de dosbuhos.com)', Rezdy: 'Rezdy', '': 'Sin dato' };
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const monthLabel = (m: string) => `${MES[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
const dayMonth = (d: string) => dayLabel(d).split(' ').slice(1).join(' ');
let regions: Intl.DisplayNames | null = null;
function country(code: string): string {
  if (!code) return 'Sin dato';
  try { regions ??= new Intl.DisplayNames(['es-MX'], { type: 'region' }); return regions.of(code) ?? code; } catch { return code; }
}
const change = (now: number, before: number) => (before > 0 ? ((now - before) / before) * 100 : null);

function Rows({ rows, total }: { rows: { key: string; label: string; count: number; netMinor: number }[]; total: number }) {
  return (
    <div className="stack">{rows.map(x => (
      <div key={x.key} className="payrow">
        <div className="payrow-top"><span className="small">{x.label}</span><b className="mono">{money(x.netMinor)}</b></div>
        <div className="payrow-bar"><div className="bar" style={{ width: '100%', height: 8 }}><span style={{ width: `${total > 0 ? Math.max(2, (x.netMinor / total) * 100) : 0}%` }} /></div><span className="tiny muted">{count(x.count, 'pago', 'pagos')}</span></div>
      </div>))}</div>
  );
}

export function Payments() {
  const { data: p, error } = useApi('payments', 300_000);
  if (!p) return error ? <ErrorBox error={error} /> : <div className="section"><Loading /></div>;
  if (!p.firstDate) {
    return (
      <section className="section">
        <div className="card quiet">
          <b>Todavía no hay pagos leídos.</b>
          <span className="small muted">Los pagos con tarjeta de Stripe llegan cada 15 minutos por medio de la app del club de vinos.{p.health === 'limited' || p.health === 'reconnect' ? ` ${p.healthReason}.` : ' La primera lectura tarda unos minutos.'}</span>
          <a className="small" href="#ajustes/conexiones">Ver conexiones →</a>
        </div>
      </section>
    );
  }
  const e = p.experiencesPaid, w = p.window;
  const vsPrev = change(e.netMinor, e.previous.netMinor), vsYear = e.lastYear ? change(e.netMinor, e.lastYear.netMinor) : null;
  const paidCount = (p.cards as any[]).reduce((a, x) => a + x.count, 0);
  const foreign = (p.cards as any[]).filter(x => x.country && x.country !== 'MX').reduce((a, x) => a + x.count, 0);
  const shown = ORDER.filter(s => (p.months as any[]).some(m => m.sources[s] > 0));
  const months = [...(p.months as any[])].reverse();
  const others = (p.sources as any[]).filter(s => s.source !== 'opentable' && s.source !== 'rezdy' && (s.current.count > 0 || s.previous.count > 0));

  return (
    <>
      {error && <ErrorBox error={error} stale />}
      {!p.historyComplete && <div className="notice info section small"><b>Cargando el historial de pagos.</b> Ya está desde el {fullDate(p.firstDate)}; se completa solo en una o dos horas. Mientras tanto no hay comparación con el año pasado.</div>}

      <section className="section" aria-labelledby="pay-exp">
        <header><h2 id="pay-exp">Experiencias pagadas en línea</h2><span className="small muted">últimos 28 días · {dayMonth(w.from)} a {dayMonth(w.to)}</span></header>
        <div className="card pace">
          <div className="pace-top">
            <div><div className="bignum">{money(e.netMinor)}</div><div className="small muted">cobrados en {count(e.count, 'pago', 'pagos')}, ya sin los reembolsos</div></div>
            {vsPrev !== null && <div className="pace-proj"><div className={`midnum ${vsPrev >= 0 ? 'up' : 'down'}`}>{signedPct(vsPrev)}</div><div className="small muted">contra los 28 días anteriores ({money(e.previous.netMinor)})</div></div>}
          </div>
          {e.lastYear && (
            <div className="small">
              Las mismas semanas de {w.lastYearTo.slice(0, 4)}: <b>{money(e.lastYear.netMinor)}</b> en {count(e.lastYear.count, 'pago', 'pagos')}{vsYear !== null && <>, así que este año van <b className={vsYear >= 0 ? 'up' : 'down'}>{signedPct(vsYear)}</b></>}. Entonces se reservaba por Rezdy.
            </div>
          )}
          <div className="tiny muted">Es lo que la gente pagó con tarjeta al reservar una experiencia. Las mesas del restaurante no se pagan por adelantado, así que no están aquí.</div>
        </div>
      </section>

      <section className="section" aria-labelledby="pay-up">
        <header><h2 id="pay-up">Ya cobrado para visitas que vienen</h2>{p.upcoming.through && <span className="small muted">de hoy al {dayMonth(p.upcoming.through)}</span>}</header>
        {p.upcoming.count > 0 ? (
          <div className="card stack">
            <div><span className="midnum">{money(p.upcoming.netMinor)}</span> <span className="small muted">en {count(p.upcoming.count, 'reservación pagada', 'reservaciones pagadas')}</span></div>
            <div className="kv weeks">{(p.upcoming.weeks as any[]).map(x => (
              <div key={x.weekStart}><span>{x.weekStart <= p.today ? 'Esta semana' : `Semana del ${dayMonth(x.weekStart)}`}</span><b>{money(x.netMinor)}</b><span>{count(x.count, 'reservación', 'reservaciones')}</span></div>))}</div>
          </div>
        ) : <div className="card small muted">No hay experiencias pagadas para los próximos días.</div>}
      </section>

      {e.netMinor > 0 && (
        <div className="grid cols-2 even section">
          <section className="card stack" aria-labelledby="pay-what">
            <h3 id="pay-what">Qué experiencia pagaron</h3>
            <Rows total={e.netMinor} rows={(p.experiences as any[]).map(x => ({ key: x.id || 'otro', label: x.name, count: x.count, netMinor: x.netMinor }))} />
          </section>
          <section className="card stack" aria-labelledby="pay-where">
            <h3 id="pay-where">Dónde reservaron</h3>
            <Rows total={e.netMinor} rows={(p.platforms as any[]).map(x => ({ key: x.platform || 'sin', label: PLATFORM[x.platform] ?? x.platform, count: x.count, netMinor: x.netMinor }))} />
            <p className="tiny muted">Así lo marca OpenTable en cada pago. No distingue entre su página y el botón de reservar de dosbuhos.com.</p>
          </section>
          <section className="card stack" aria-labelledby="pay-card">
            <h3 id="pay-card">De dónde es la tarjeta</h3>
            <Rows total={e.netMinor} rows={(p.cards as any[]).slice(0, 6).map(x => ({ key: x.country || 'sin', label: country(x.country), count: x.count, netMinor: x.netMinor }))} />
            {paidCount >= 5 && <p className="small">{int(foreign)} de {count(paidCount, 'pago', 'pagos')} ({Math.round((foreign / paidCount) * 100)}%) se hicieron con una tarjeta de fuera de México.</p>}
            <p className="tiny muted">País del banco que emitió la tarjeta. No dice quién es la persona, solo de dónde viene.</p>
          </section>
          {others.length > 0 && (
            <section className="card stack" aria-labelledby="pay-other">
              <h3 id="pay-other">Lo demás cobrado en línea</h3>
              <div className="kv">{others.map((s: any) => (
                <div key={s.source}><span>{SOURCE[s.source] ?? s.source}</span><b>{money(s.current.netMinor)}</b><span>{count(s.current.count, 'pago', 'pagos')} · antes {money(s.previous.netMinor)}</span></div>))}</div>
              <p className="tiny muted">Los mismos 28 días, contra los 28 anteriores.</p>
            </section>
          )}
        </div>
      )}

      <section className="section card" aria-labelledby="pay-months">
        <header style={{ marginBottom: 8 }}><h3 id="pay-months">Todo lo cobrado en línea, mes por mes</h3></header>
        <div className="table-scroll months-table">
          <table className="data">
            <thead><tr><th>Mes</th>{shown.map(s => <th key={s} className="n">{SOURCE_SHORT[s]}</th>)}<th className="n">Total</th></tr></thead>
            <tbody>{months.map((m, i) => (
              <tr key={m.month}><td>{monthLabel(m.month)}{i === 0 && <span className="tiny muted"> en curso</span>}</td>{shown.map(s => <td key={s} className="n">{m.sources[s] ? money(m.sources[s]) : <span className="muted">·</span>}</td>)}<td className="n">{m.total ? <b>{money(m.total)}</b> : <span className="muted">·</span>}</td></tr>))}</tbody>
          </table>
        </div>
        <div className="months-list">{months.map((m, i) => (
          <div key={m.month} className="monthrow">
            <div className="payrow-top"><span className="small">{monthLabel(m.month)}{i === 0 && <span className="tiny muted"> en curso</span>}</span>{m.total ? <b className="mono">{money(m.total)}</b> : <span className="tiny muted">sin cobros</span>}</div>
            {m.total > 0 && <div className="tiny muted">{shown.filter(s => m.sources[s] > 0).map(s => `${SOURCE_SHORT[s]} ${money(m.sources[s])}`).join(' · ')}</div>}
          </div>))}</div>
        <p className="tiny muted">
          Pesos cobrados con tarjeta en Stripe, con IVA y ya sin los reembolsos, por la fecha del cobro. {shown.map(s => LEGEND[s]).join('. ')}.
          {p.otherCurrencies.length > 0 ? ` Aparte, en otra moneda en los últimos 28 días: ${(p.otherCurrencies as any[]).map(x => `${money(x.netMinor, x.currency)} en ${count(x.count, 'pago', 'pagos')}`).join(', ')}.` : ''}
        </p>
      </section>

      <p className="tiny muted section">
        Esto es dinero cobrado en línea, no ventas del punto de venta. No se suma a las ventas de Parrot: una parte de las experiencias pagadas por adelantado también se registra en Parrot el día de la visita, como transferencia, y se contaría dos veces. Tampoco dice qué anuncio trajo cada pago.
        {p.lastChargeAt ? ` Último pago registrado: ${when(p.lastChargeAt).replace(/\.$/, '')}.` : ''} Aquí no llegan nombres, correos ni tarjetas.
      </p>
    </>
  );
}
