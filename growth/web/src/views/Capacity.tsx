import { useState } from 'react';
import { api, useApi } from '../api';
import { Loading, ErrorBox } from '../components';
import { PRODUCT_LABEL, dayLabel, hhmm, ago, slotStatusLabel } from '../format';
import { CapChip, groupBy, AvailabilityList } from './Overview';

export function Capacity({ canEdit }: { canEdit: boolean }) {
  const [days, setDays] = useState<14 | 30>(14);
  const { data, error, reload } = useApi(`capacity?days=${days}`, 120_000);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (!data) return error ? <ErrorBox error={error} /> : <div className="section"><Loading /></div>;
  const byDate = groupBy(data.summary as any[], d => d.date);
  const slotsByDate = groupBy(data.slots as any[], s => s.date);

  const confirm = async (date: string) => {
    try { const r = await api('capacity/confirm-day', { method: 'POST', body: { date } }); setMsg(`Se confirmaron ${r.slots} horario(s) del ${date}.`); void reload(); } catch (e) { setMsg((e as Error).message); }
  };

  return (
    <>
      <section className="section">
        <header><h2>Capacidad</h2><div className="seg">{([14, 30] as const).map(n => <button key={n} aria-pressed={days === n} onClick={() => setDays(n)}>Próximos {n} días</button>)}</div></header>
        <p className="small muted">Cada producto se cuenta por separado: los lugares del restaurante nunca se suman a los de los tours. Un guía o un salón que comparten horarios traslapados se cuenta una sola vez. Última actualización: {ago(data.lastUpdate)}. La capacidad desactualizada o desconocida bloquea los aumentos de presupuesto por capacidad; los reportes siguen.</p>
        {data.availability?.days?.length > 0 && <div className="card stack" style={{ marginBottom: 12 }}><h3>Horarios disponibles en OpenTable (automático)</h3><AvailabilityList a={data.availability} detail /></div>}
        <h3 style={{ marginTop: 8 }}>Calendario de capacidad del personal</h3>
        <div className="legend" style={{ margin: '8px 0' }}>
          <span className="cap open">libre</span><span className="cap sold_out">agotado</span><span className="cap unknown">desconocido</span><span className="cap blocked">bloqueado / cerrado</span><span>⏱ desactualizado</span>
        </div>
        <div className="cal">{Object.entries(byDate).map(([date, ds]) => (
          <div key={date} className="item">
            <div className="top">
              <div><b className="mono">{dayLabel(date)}</b></div>
              <div className="row">
                <button className="btn" style={{ minHeight: 36, padding: '4px 10px' }} onClick={() => setOpen(open === date ? null : date)} aria-expanded={open === date}>{open === date ? 'Ocultar horarios' : 'Horarios'}</button>
                {canEdit && <button className="btn" style={{ minHeight: 36, padding: '4px 10px' }} onClick={() => void confirm(date)}>Sigue correcto</button>}
              </div>
            </div>
            <div className="cal-prods">{(ds as any[]).map(d => <CapChip key={d.product} d={d} />)}</div>
            {open === date && <div className="list" style={{ marginTop: 6 }}>{(slotsByDate[date] ?? []).sort((a: any, b: any) => a.startMin - b.startMin).map((s: any) => (
              <div key={s.slotId} className="row small" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--rule)', paddingTop: 6 }}>
                <span className="mono">{hhmm(s.startMin)}</span><span>{PRODUCT_LABEL[s.product]}</span>
                <span className={`cap ${s.status}`}>{s.status === 'open' ? `${s.remainingGuests} de ${s.sellableGuests} libres` : slotStatusLabel(s.status)}</span>
                <span className="muted">{s.bindingResource ? `limitado por ${s.bindingResource}` : s.reason ?? ''}</span>
              </div>))}</div>}
            {open === date && canEdit && <SlotEditor date={date} onSaved={m => { setMsg(m); void reload(); }} />}
          </div>))}</div>
      </section>
      {msg && <div className="toast" role="status" onClick={() => setMsg(null)}>{msg}</div>}
    </>
  );
}

function SlotEditor({ date, onSaved }: { date: string; onSaved: (m: string) => void }) {
  const [f, setF] = useState({ product: 'restaurant_visit', time: '13:00', duration: 90, buffer: 15, maxGuests: '', reserved: 0, state: 'open', seats: true });
  const save = async () => {
    const [h, m] = f.time.split(':').map(Number);
    const startMin = (h ?? 0) * 60 + (m ?? 0);
    const requires = f.product === 'restaurant_visit' ? [{ resourceId: 'seats', perGuest: 1, perSlot: 0 }] : f.product === 'tour_tasting' ? [{ resourceId: 'guides', perGuest: 0, perSlot: 1 }] : [];
    try {
      await api('capacity/slots', { method: 'POST', body: { product: f.product, date, startMin, durationMin: Number(f.duration), bufferMin: Number(f.buffer), state: f.state, maxGuests: f.maxGuests === '' ? null : Number(f.maxGuests), requires, reservedGuests: Number(f.reserved), label: '' } });
      onSaved(`Se guardó ${PRODUCT_LABEL[f.product]} ${f.time} el ${date}.`);
    } catch (e) { onSaved((e as Error).message); }
  };
  return (
    <div className="card" style={{ background: 'var(--surface-2)' }}>
      <h3 style={{ fontSize: 16 }}>Agregar o cambiar un horario</h3>
      <div className="form-grid" style={{ marginTop: 8 }}>
        <label className="field">Producto<select value={f.product} onChange={e => setF({ ...f, product: e.target.value })}>{Object.entries(PRODUCT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field">Inicio<input type="time" value={f.time} onChange={e => setF({ ...f, time: e.target.value })} /></label>
        <label className="field">Duración (min)<input type="number" inputMode="numeric" value={f.duration} onChange={e => setF({ ...f, duration: Number(e.target.value) })} /></label>
        <label className="field">Margen entre horarios (min)<input type="number" inputMode="numeric" value={f.buffer} onChange={e => setF({ ...f, buffer: Number(e.target.value) })} /></label>
        <label className="field">Máx. de personas (vacío = según lugares/guías)<input type="number" inputMode="numeric" value={f.maxGuests} onChange={e => setF({ ...f, maxGuests: e.target.value })} /></label>
        <label className="field">Ya reservadas (personas)<input type="number" inputMode="numeric" value={f.reserved} onChange={e => setF({ ...f, reserved: Number(e.target.value) })} /></label>
        <label className="field">Estado<select value={f.state} onChange={e => setF({ ...f, state: e.target.value })}><option value="open">Abierto</option><option value="blocked">Bloqueado</option><option value="closed">Cerrado</option></select></label>
      </div>
      <div className="row" style={{ marginTop: 10 }}><button className="btn primary" onClick={() => void save()}>Guardar horario</button><span className="tiny muted">Un administrador define los lugares y la disponibilidad de guías por día; aquí solo se edita el horario.</span></div>
    </div>
  );
}
