import { useState } from 'react';
import { api, useApi } from '../api';
import { Loading, ErrorBox, Health } from '../components';
import { microsMoney, money, int, when, ago, PRODUCT_LABEL, basisLabel, campaignStatusLabel, managedByLabel, importStatusLabel, bookingStatusLabel, purposeLabel } from '../format';

export function Campaigns() {
  const { data, error } = useApi('campaigns', 120_000);
  if (!data) return error ? <ErrorBox error={error} /> : <div className="section"><Loading /></div>;
  const total = (data.sources as any[]).reduce((a, x) => a + x.reservations, 0);
  const lost = (data.sources as any[]).filter(x => /Fuente perdida|Sin definir/.test(x.group)).reduce((a, x) => a + x.reservations, 0);
  const cur = data.currency;
  return (
    <>
      <section className="section">
        <header><h2>Campañas</h2><span className="small muted">{data.window.from} – {data.window.to}{data.trackingSince && data.trackingSince > data.window.from ? ` · reservaciones desde el ${data.trackingSince}` : ''}</span></header>
        {total > 0 && (
          <div className="card stack">
            <h3>De dónde vienen las reservaciones en línea</h3>
            <div className="stack">{(data.sources as any[]).map(x => (
              <div key={x.group} className="row" style={{ flexWrap: 'nowrap', gap: 10 }}>
                <div className="small" style={{ flex: '0 1 50%', minWidth: 0 }}>{x.group}</div>
                <div style={{ flex: 1, minWidth: 0 }}><div className="bar" style={{ width: '100%', height: 10 }}><span style={{ width: `${(x.reservations / total) * 100}%` }} /></div></div>
                <b className="mono" style={{ minWidth: 30, textAlign: 'right' }}>{x.reservations}</b>
              </div>))}</div>
            <p className="tiny muted">{total} reservaciones en línea (widget de OpenTable, GA4). {lost ? `${lost} (${Math.round((lost / total) * 100)}%) perdieron su fuente original cuando la persona pasó de dosbuhos.com a OpenTable, así que los resultados de los anuncios probablemente se quedan cortos. ` : ''}No se incluyen las reservaciones por teléfono ni los clientes que llegan sin reservar.</p>
          </div>
        )}
      </section>
      <section className="section">
        <div className="notice small" role="note">{data.estimate
          ? <>Ingreso estimado = reservaciones en línea × <b>{money(data.estimate.valueMinor, cur)}</b> por reservación (sin IVA). Base: {data.estimate.basis}{data.estimate.sourcePeriod ? `, ${data.estimate.sourcePeriod}` : ''}; aprobado por {data.estimate.approvedBy}. Es una estimación; se ajusta en <a href="#controls">Controles</a>.</>
          : <>Sin valor por reservación aprobado; el ingreso estimado no se calcula. Defínelo en <a href="#controls">Controles</a>.</>}</div>
      </section>
      <AiVisibility />
      <section className="section">
        <div className="list">{(data.campaigns as any[]).map(c => {
          const approved = data.approved.includes(c.ref);
          return (
            <article key={c.ref} className="item">
              <div className="top"><b>{c.name}</b><span className="row"><span className="chip">{c.provider === 'meta_ads' ? 'Meta' : 'Google'}</span><span className={`state ${c.status === 'ENABLED' || c.status === 'ACTIVE' ? 's-ok' : 's-mute'}`}>{campaignStatusLabel(c.status)}</span></span></div>
              <div className="kv">
                <div><span>Gasto, 28 días</span><b>{microsMoney(c.spendMicros, cur)}</b></div>
                <div><span>Clics</span><b>{int(c.clicks)}</b></div>
                <div><span>{c.provider === 'meta_ads' ? 'Resultados de Meta' : 'Conversiones de Google'}</span><b>{c.convMilli === null ? '—' : (c.convMilli / 1000).toFixed(1)}</b></div>
                <div><span>Abrieron la disponibilidad de OpenTable</span><b>{c.openedAvailability ?? '—'}</b></div>
                <div><span>Reservaciones en línea</span><b>{c.reservations ?? '—'}</b></div>
                <div><span>Costo por reservación</span><b>{c.costPerReservationMinor === null ? '—' : money(c.costPerReservationMinor, cur)}</b></div>
                <div><span>Ingreso estimado</span><b>{c.estimatedRevenueMinor === null ? '—' : money(c.estimatedRevenueMinor, cur)}</b></div>
                <div><span>Retorno estimado</span><b>{c.estimatedReturn === null ? '—' : `${c.estimatedReturn.toFixed(1)}×`}</b></div>
                <div><span>Presupuesto diario</span><b>{microsMoney(c.budgetMicros, cur)}</b></div>
              </div>
              {c.note && <div className="tiny muted">{c.note}</div>}
              {c.costPerReservationMinor !== null && <div className="tiny muted">Gasto de {microsMoney(c.trackedSpendMicros, cur)} en los días en que GA4 registró reservaciones ÷ {c.reservations} reservación(es). Atribución por sesión; no prueba que los anuncios las hayan causado.</div>}
              <div className="tiny muted">Administrada por {managedByLabel(c.managedBy)}{approved ? ' · la app puede cambiarla' : ' · la app no la va a cambiar'}</div>
            </article>
          );
        })}</div>
        {data.unmatchedGoogleAds > 0 && <p className="tiny muted">{data.unmatchedGoogleAds} reservación(es) vinieron de campañas de Google Ads que no están en la lista actual (renombradas o eliminadas).</p>}
      </section>
    </>
  );
}

function AiVisibility() {
  const { data } = useApi('ai-visibility', 600_000);
  if (!data) return null;
  const last = data.runs[0];
  return (
    <section className="section card stack">
      <h3>¿Nos recomiendan los asistentes de IA?</h3>
      {!last ? <p className="small muted">Todavía no hay revisión. La primera corre el día 1 del mes (o desde Controles → Ejecutar ahora).</p> : <>
        <p className="small">Última revisión {when(last.at)}: Dos Búhos aparece en <b>{last.mentioned} de {last.asked}</b> respuestas; dosbuhos.com fue citado en {last.cited}. {data.runs.length > 1 && `Antes: ${data.runs.slice(1, 4).map((r: any) => `${r.mentioned}/${r.asked}`).join(', ')}.`}</p>
        <div className="list">{(data.latest as any[]).map(r => (
          <div key={r.question_id} className="item">
            <div className="top"><span className="small">{r.question}</span><span className={`state ${r.error ? 's-warn' : r.mentioned ? 's-ok' : 's-mute'}`}>{r.error ? 'Falló' : r.mentioned ? (r.rank ? `Sí, #${r.rank}` : 'Sí') : 'No'}</span></div>
            {r.mentioned && r.excerpt && <div className="tiny muted">“{r.excerpt}”</div>}
          </div>))}</div>
        <p className="tiny muted">Respuestas de Claude con búsqueda web. ChatGPT, Gemini y otros pueden responder distinto.</p>
      </>}
    </section>
  );
}

export function Experiments() {
  const { data, error } = useApi('experiments', 300_000);
  if (!data) return error ? <ErrorBox error={error} /> : <div className="section"><Loading /></div>;
  const groups: [string, string][] = [['active', 'Activos'], ['planned', 'Planeados'], ['completed', 'Terminados'], ['inconclusive', 'No concluyentes'], ['failed', 'Fallidos'], ['stopped', 'Detenidos']];
  return (
    <section className="section">
      <header><h2>Experimentos</h2></header>
      <p className="small muted">Las pruebas fallidas y no concluyentes se quedan aquí para no repetir ideas sin evidencia nueva. Las conclusiones se vuelven a revisar después de su fecha de revisión. Las comparaciones de antes y después son observacionales, no son prueba.</p>
      {groups.map(([k, label]) => {
        const xs = (data.experiments as any[]).filter(e => e.status === k);
        if (!xs.length) return null;
        return <div key={k} className="section"><h3>{label}</h3><div className="list" style={{ marginTop: 6 }}>{xs.map(e => (
          <article key={e.id} className="item">
            <div className="top"><b>{e.title}</b><span className="chip">{e.start_date}{e.end_date ? ` → ${e.end_date}` : ' → en curso'}</span></div>
            <div className="small">{e.hypothesis}</div>
            <div className="kv"><div><span>Métrica principal</span><b>{e.primary_metric}</b></div><div><span>Costo hasta ahora / máx.</span><b>{microsMoney(e.spent_micros)} / {microsMoney(e.max_cost_micros)}</b></div><div><span>Maduración</span><b>{e.maturation_days} días</b></div><div><span>Próxima evaluación</span><b>{e.next_evaluation ?? '—'}</b></div></div>
            {e.result && <div className="small"><b>Resultado:</b> {e.result}</div>}
            <div className="small muted"><b>Limitaciones:</b> {e.limitations} · Límite de pérdida: {e.stop_loss}</div>
          </article>))}</div></div>;
      })}
    </section>
  );
}

export function Reports() {
  const { data, error } = useApi('reports', 300_000);
  const [open, setOpen] = useState<string | null>(null);
  const detail = useApi(open ? `reports/${encodeURIComponent(open)}` : null);
  if (!data) return error ? <ErrorBox error={error} /> : <div className="section"><Loading /></div>;
  return (
    <section className="section">
      <header><h2>Reportes</h2><span className="small muted">Diario a las 08:00 y semanal los lunes a las 08:30, hora de San Miguel</span></header>
      <p className="small muted">Primero se calculan los números; el resumen escrito solo puede repetirlos. Si la IA no está disponible o agrega un número que no está en los datos, se publica la plantilla de datos.</p>
      <div className="list">{(data.reports as any[]).map(r => (
        <article key={r.id} className="item">
          <div className="top"><b>{r.kind === 'daily' ? 'Diario' : 'Semanal'} · {r.period_from} – {r.period_to}</b><span className="row"><span className="chip">{r.narrative_source === 'model' ? 'Escrito por IA con los datos' : 'Plantilla'}</span><span className="chip">rev {r.revision}</span></span></div>
          <div className="tiny muted">Corte de datos: {when(r.cutoff_at)}</div>
          {open === r.id && detail.data ? (
            <div className="stack">
              <pre className="narr">{detail.data.narrative}</pre>
              <div className="table-scroll"><table className="data"><thead><tr><th>Métrica</th><th className="n">Valor</th><th>Cambio</th><th>Base</th></tr></thead>
                <tbody>{detail.data.facts.headline.map((h: any) => <tr key={h.key}><td>{h.label}</td><td className="n">{h.display}</td><td>{h.change}</td><td>{basisLabel(h.basis)}{h.provisional ? ', provisional' : ''}</td></tr>)}</tbody></table></div>
              <a className="btn" href={`api/reports/${encodeURIComponent(r.id)}?format=csv`} download>Descargar CSV</a>
            </div>
          ) : <button className="btn" onClick={() => setOpen(r.id)}>Abrir</button>}
        </article>))}
        {(data.reports as any[]).length === 0 && <div className="item muted">Todavía no hay reportes. El primer reporte diario corre a las 08:00.</div>}
      </div>
    </section>
  );
}

export function Connections({ isAdmin }: { isAdmin: boolean }) {
  const { data, error, reload } = useApi('connections', 120_000);
  const [token, setToken] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  if (!data) return error ? <ErrorBox error={error} /> : <div className="section"><Loading /></div>;
  return (
    <>
      <section className="section">
        <header><h2>Conexiones y calidad de los datos</h2></header>
        <p className="small muted">Es normal tener que volver a conectar de vez en cuando (acceso revocado, consentimiento vencido). Los cambios se detienen de inmediato cuando una conexión necesaria no está bien. Nunca se escriben contraseñas ni claves en esta página ni en el chat; un administrador configura los secretos en Cloudflare.</p>
        <div className="list">{(data.connections as any[]).map(c => (
          <article key={c.id} className="item">
            <div className="top"><b>{purposeLabel(c.purpose)}</b><Health h={c.health} /></div>
            <div className="small">{c.health_reason}</div>
            <div className="tiny muted">{c.provider} · último éxito: {ago(c.last_success_at)}{c.freshness_at ? ` · datos al ${when(c.freshness_at)}` : ''}{c.last_error ? ` · último error: ${c.last_error}` : ''}</div>
            {c.provider === 'google_ads_script' && isAdmin && (
              <div className="stack">
                <button className="btn" onClick={async () => { if (!confirm('¿Crear un token nuevo para el feed? El actual deja de funcionar.')) return; try { const r = await api('connections/google-ads-script/token', { method: 'POST' }); setToken(r.token); void reload(); } catch (e) { setMsg((e as Error).message); } }}>Crear token del feed</button>
                {token && <div className="notice small"><b>Se muestra una sola vez.</b> Pégalo en el Google Ads Script (Herramientas → Acciones masivas → Secuencias de comandos) y prográmalo cada hora:<div className="mono" style={{ overflowWrap: 'anywhere', marginTop: 6 }}>{token}</div></div>}
              </div>
            )}
          </article>))}</div>
      </section>
      <section className="section card stack">
        <h3>Secretos del Worker</h3>
        <div className="kv">{Object.entries(data.secrets).map(([k, v]) => <div key={k}><span>{k}</span><b>{v ? 'configurado' : 'sin configurar'}</b></div>)}</div>
      </section>
      <Ga4Setup ga4={data.ga4} isAdmin={isAdmin} onDone={m => { setMsg(m); void reload(); }} />
      <OpenTableImport onDone={m => { setMsg(m); void reload(); }} />
      <section className="section"><h3>Importaciones recientes</h3><div className="list" style={{ marginTop: 6 }}>{(data.imports as any[]).map(i => <div key={i.id} className="item small"><div className="top"><b>{i.file_name}</b><span className="chip">{importStatusLabel(i.status)}</span></div>{i.rows_ok} válidas · {i.rows_duplicate} duplicadas · {i.rows_error} errores · {when(i.created_at)} por {i.created_by}</div>)}{!(data.imports as any[]).length && <div className="item muted small">Todavía no hay importaciones.</div>}</div></section>
      {msg && <div className="toast" role="status" onClick={() => setMsg(null)}>{msg}</div>}
    </>
  );
}

function Ga4Setup({ ga4, isAdmin, onDone }: { ga4: { propertyId: string | null; serviceAccountEmail: string | null }; isAdmin: boolean; onDone: (m: string) => void }) {
  const [pid, setPid] = useState(ga4?.propertyId ?? '');
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { const r = await api('connections/ga4', { method: 'POST', body: { propertyId: pid.trim() } }); onDone(r.synced ? `GA4 conectado: se cargaron ${r.reservations} reservaciones en línea.` : r.message); } catch (e) { onDone((e as Error).message); } finally { setBusy(false); } };
  const sync = async () => { setBusy(true); try { const r = await api('control/sync-now', { method: 'POST' }); onDone(r.ga4?.error ? `GA4: ${r.ga4.error}` : r.ga4 ? `Sincronizado: ${r.ga4.reservations} reservaciones en línea.` : 'Google Ads sincronizado; GA4 todavía no está configurado.'); } catch (e) { onDone((e as Error).message); } finally { setBusy(false); } };
  return (
    <section className="section card stack">
      <h3>Reservaciones en línea de OpenTable (vía Google Analytics)</h3>
      <p className="small muted">OpenTable ya manda cada reservación en línea a tu GA4 como <span className="mono">ot-reservation-made</span>. Growth lee los totales diarios por fuente de tráfico, solo lectura. No incluye reservaciones por teléfono, clientes que llegan sin reservar ni cancelaciones posteriores.</p>
      <div className="kv">
        <div><span>Cuenta de servicio (secreto GA4_SA_KEY)</span><b>{ga4?.serviceAccountEmail ?? 'sin configurar'}</b></div>
        <div><span>Propiedad de GA4</span><b>{ga4?.propertyId ?? 'sin configurar'}</b></div>
      </div>
      {ga4?.serviceAccountEmail && <div className="tiny muted">En GA4 → Administrar → Gestión del acceso a la propiedad, este correo necesita el rol Lector.</div>}
      {isAdmin && <div className="row">
        <label className="field" style={{ flex: '1 1 200px' }}>ID de propiedad de GA4 (dígitos)<input inputMode="numeric" value={pid} onChange={e => setPid(e.target.value.replace(/[^0-9]/g, ''))} /></label>
        <button className="btn primary" disabled={busy || !pid} onClick={() => void save()}>Guardar y sincronizar</button>
        <button className="btn" disabled={busy} onClick={() => void sync()}>Sincronizar ahora</button>
      </div>}
    </section>
  );
}

function OpenTableImport({ onDone }: { onDone: (m: string) => void }) {
  const [csv, setCsv] = useState<{ name: string; text: string } | null>(null);
  const [m, setM] = useState({ timezone: 'America/Mexico_City', currency: 'MXN', dateFormat: 'mdy' });
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!csv) return; setBusy(true);
    try { setPreview(await api('imports/opentable/preview', { method: 'POST', body: { fileName: csv.name, csv: csv.text, mapping: m } })); } catch (e) { onDone((e as Error).message); } finally { setBusy(false); }
  };
  const commit = async () => {
    setBusy(true);
    try { const r = await api(`imports/${preview.importId}/commit`, { method: 'POST' }); onDone(`Se importaron ${r.rows} reservaciones.`); setPreview(null); setCsv(null); } catch (e) { onDone((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="section card stack">
      <h3>Importar reservaciones de OpenTable</h3>
      <p className="small muted">OpenTable no ofrece a los restaurantes una API de reservaciones, así que las reservaciones vienen de una exportación de GuestCenter (Reporting → Reservations → Export CSV). Se ignoran nombres, teléfonos, correos y notas. Volver a importar el mismo archivo nunca duplica reservaciones; las exportaciones más nuevas actualizan los estados (cancelaciones, inasistencias).</p>
      <div className="form-grid">
        <label className="field">Archivo CSV<input type="file" accept=".csv,text/csv" onChange={async e => { const f = e.target.files?.[0]; if (f) { setCsv({ name: f.name, text: await f.text() }); setPreview(null); } }} /></label>
        <label className="field">Las horas del archivo están en<select value={m.timezone} onChange={e => setM({ ...m, timezone: e.target.value })}><option>America/Mexico_City</option><option>America/Chicago</option><option>America/Los_Angeles</option><option>UTC</option></select></label>
        <label className="field">Formato de fecha<select value={m.dateFormat} onChange={e => setM({ ...m, dateFormat: e.target.value })}><option value="mdy">MM/DD/AAAA</option><option value="dmy">DD/MM/AAAA</option><option value="iso">AAAA-MM-DD</option></select></label>
        <label className="field">Moneda<select value={m.currency} onChange={e => setM({ ...m, currency: e.target.value })}><option>MXN</option><option>USD</option></select></label>
      </div>
      <div className="row"><button className="btn" disabled={!csv || busy} onClick={() => void run()}>Vista previa</button></div>
      {preview && (
        <div className="stack">
          {preview.missingColumns.length > 0 && <div className="notice bad small">Faltan columnas: {preview.missingColumns.join(', ')}. Columnas encontradas: {preview.headers.join(', ')}</div>}
          <div className="kv"><div><span>Filas</span><b>{preview.total}</b></div><div><span>Válidas</span><b>{preview.valid}</b></div><div><span>Actualizan existentes</span><b>{preview.updatesExisting}</b></div><div><span>Duplicadas en el archivo</span><b>{preview.duplicatesInFile}</b></div><div><span>Errores de fila</span><b>{preview.errors.length}</b></div></div>
          {preview.errors.length > 0 && <details className="why"><summary>Errores de fila</summary><ul className="small">{preview.errors.slice(0, 50).map((e: any, i: number) => <li key={i}>Fila {e.row}{e.column ? ` (${e.column})` : ''}: {e.message}</li>)}</ul></details>}
          {preview.sample.length > 0 && <div className="table-scroll"><table className="data"><thead><tr><th>Confirmación</th><th>Producto</th><th>Servicio (UTC)</th><th className="n">Personas</th><th>Estado</th><th>Fuente</th></tr></thead><tbody>{preview.sample.map((b: any) => <tr key={b.id}><td className="mono">{b.externalId}</td><td>{PRODUCT_LABEL[b.product]}</td><td className="mono">{b.serviceAt.slice(0, 16)}</td><td className="n">{b.partySize}</td><td>{bookingStatusLabel(b.status)}</td><td>{b.channel}</td></tr>)}</tbody></table></div>}
          <button className="btn primary" disabled={busy || !preview.valid} onClick={() => void commit()}>Importar {preview.valid} reservaciones</button>
        </div>
      )}
    </section>
  );
}
