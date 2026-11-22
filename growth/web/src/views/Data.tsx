import { useState } from 'react';
import feedScript from '../../../scripts/google-ads-feed.js?raw';
import { api, useApi } from '../api';
import { Loading, ErrorBox, Health } from '../components';
import { fullDate, microsMoney, money, int, when, ago, PRODUCT_LABEL, basisLabel, campaignStatusLabel, managedByLabel, importStatusLabel, bookingStatusLabel, purposeLabel, reasonLabel } from '../format';

export function Campaigns() {
  const { data, error } = useApi('campaigns', 120_000);
  if (!data) return error ? <ErrorBox error={error} /> : <div className="section"><Loading /></div>;
  const cur = data.currency;
  return (
    <>
      <section className="section">
        <header><h1>Campañas</h1><span className="small muted">{data.window.from} – {data.window.to}{data.trackingSince && data.trackingSince > data.window.from ? ` · reservaciones desde el ${data.trackingSince}` : ''}</span></header>
      </section>
      <section className="section">
        <div className="notice small" role="note">{data.estimate
          ? <>Ingreso estimado = reservaciones en línea × <b>{money(data.estimate.valueMinor, cur)}</b> por reservación (sin IVA). Base: {data.estimate.basis}{data.estimate.sourcePeriod ? `, ${data.estimate.sourcePeriod}` : ''}; aprobado por {data.estimate.approvedBy}. {data.estimate.contributionMinor != null && <> Contribución estimada: <b>{money(data.estimate.contributionMinor, cur)}</b> por reservación después de costos variables.</>} Es una estimación; se ajusta en <a href="#controls">Controles</a>.</>
          : <>Sin valor por reservación aprobado; el ingreso estimado no se calcula. Defínelo en <a href="#controls">Controles</a>.</>}</div>
      </section>
      {data.searchTerms && <SearchTerms t={data.searchTerms} cur={cur} />}
      <section className="section">
        <div className="list">{(data.campaigns as any[]).map(c => {
          const approved = data.approved.includes(c.ref);
          return (
            <article key={c.ref} className="item">
              <div className="top"><b>{c.name.replace(/_/g, ' ')}</b><span className="row"><span className="chip">{c.provider === 'meta_ads' ? 'Meta' : 'Google'}</span><span className={`state ${c.status === 'ENABLED' || c.status === 'ACTIVE' ? 's-ok' : 's-mute'}`}>{campaignStatusLabel(c.status)}</span></span></div>
              <div className="kv">
                <div><span>Gasto, 28 días</span><b>{microsMoney(c.spendMicros, cur)}</b></div>
                <div><span>Clics</span><b>{int(c.clicks)}</b></div>
                <div><span>{c.provider === 'meta_ads' ? 'Resultados de Meta' : 'Conversiones de Google'}</span><b>{c.convMilli === null ? '—' : (c.convMilli / 1000).toFixed(1)}</b></div>
                <div><span>Abrieron la disponibilidad de OpenTable</span><b>{c.openedAvailability ?? '—'}</b></div>
                <div><span>Reservaciones en línea</span><b>{c.reservations ?? '—'}</b></div>
                <div><span>Costo por reservación</span><b>{c.costPerReservationMinor === null ? '—' : money(c.costPerReservationMinor, cur)}</b></div>
                <div><span>Ingreso estimado</span><b>{c.estimatedRevenueMinor === null ? '—' : money(c.estimatedRevenueMinor, cur)}</b></div>
                <div><span>Retorno estimado</span><b>{c.estimatedReturn === null ? '—' : `${c.estimatedReturn.toFixed(1)}×`}</b></div>
                <div><span>Contribución estimada después del gasto</span><b>{c.estimatedContributionMinor == null ? '—' : money(c.estimatedContributionMinor, cur)}</b></div>
                <div><span>Presupuesto diario</span><b>{microsMoney(c.budgetMicros, cur)}</b></div>
              </div>
              {c.note && <div className="tiny muted">{c.note}</div>}
              {c.costPerReservationMinor !== null && <div className="tiny muted">Gasto de {microsMoney(c.trackedSpendMicros, cur)} en los días en que GA4 registró reservaciones ÷ {c.reservations} reservación(es). Atribución por sesión; no prueba que los anuncios las hayan causado.</div>}
              <div className="tiny muted">Administrada por {managedByLabel(c.managedBy)}{approved ? ' · la app puede cambiarla' : ' · la app no la va a cambiar'}</div>
            </article>
          );
        })}</div>
        {(data.unmatchedMeta?.clicks > 0 || data.unmatchedMeta?.opened > 0) && <p className="tiny muted">Anuncios de Meta etiquetados con el ID de campaña (no con el nombre): {data.unmatchedMeta.clicks} clic(s) en Reservar, {data.unmatchedMeta.opened} abrieron OpenTable, {data.unmatchedMeta.reservations} reservación(es). No se pueden asignar a una campaña.</p>}
        {data.unmatchedGoogleAds > 0 && <p className="tiny muted">{data.unmatchedGoogleAds} reservación(es) vinieron de campañas de Google Ads que no están en la lista actual (renombradas o eliminadas).</p>}
      </section>
    </>
  );
}

/** Where the online reservations came from (GA4, OpenTable widget). Shown in Reservaciones. */
export function Sources({ data }: { data: any }) {
  const total = (data.sources as any[]).reduce((a, x) => a + x.reservations, 0);
  const lost = (data.sources as any[]).filter(x => /Fuente perdida|Sin definir/.test(x.group)).reduce((a, x) => a + x.reservations, 0);
  if (!total) return <div className="card small muted">Todavía no hay reservaciones en línea registradas en este periodo.</div>;
  return (
    <div className="card stack">
      <h3>De dónde vienen las reservaciones en línea</h3>
      <div className="stack">{(data.sources as any[]).map(x => (
        <div key={x.group} className="row" style={{ flexWrap: 'nowrap', gap: 10 }}>
          <div className="small" style={{ flex: '0 1 50%', minWidth: 0 }}>{x.group}</div>
          <div style={{ flex: 1, minWidth: 0 }}><div className="bar" style={{ width: '100%', height: 10 }}><span style={{ width: `${(x.reservations / total) * 100}%` }} /></div></div>
          <b className="mono" style={{ minWidth: 30, textAlign: 'right' }}>{x.reservations}</b>
        </div>))}</div>
      <p className="tiny muted">{total} reservaciones en línea del {data.window.from} al {data.window.to} (widget de OpenTable, GA4). {lost ? `${lost} (${Math.round((lost / total) * 100)}%) perdieron su fuente original cuando la persona pasó de dosbuhos.com a OpenTable, así que los resultados de los anuncios probablemente se quedan cortos. ` : ''}No se incluyen las reservaciones por teléfono ni los clientes que llegan sin reservar.</p>
    </div>
  );
}

function SearchTerms({ t, cur }: { t: any; cur: string }) {
  const total = (k: string) => (t.brand[k] ?? 0) + (t.other[k] ?? 0);
  const share = (k: string) => (total(k) ? Math.round((t.brand[k] / total(k)) * 100) : null);
  const by = t.withCost ? 'costMinor' : 'sessions';
  return (
    <section className="section card stack">
      <h3>¿Pagamos por búsquedas de nuestro nombre?</h3>
      <p className="small">Búsquedas en Google que llevaron a un clic en los anuncios ({t.from} – {t.to}, según GA4). <b>De marca</b> = la búsqueda incluye “Dos Búhos”: esas personas ya nos buscaban.</p>
      <div className="kv">
        <div><span>De marca, % del {t.withCost ? 'gasto' : 'tráfico'}</span><b>{share(by) ?? '—'}%</b></div>
        {t.withCost && <div><span>Gasto en búsquedas de marca</span><b>{money(t.brand.costMinor, cur)}</b></div>}
        <div><span>Reservaciones: marca / otras</span><b>{t.brand.reservations} / {t.other.reservations}</b></div>
        <div><span>Visitas: marca / otras</span><b>{t.brand.sessions} / {t.other.sessions}</b></div>
      </div>
      <details><summary className="small" style={{ cursor: 'pointer' }}>Principales búsquedas</summary>
        <div className="list">{(t.top as any[]).map(x => (
          <div key={x.query + x.campaign} className="item"><div className="top"><span className="small">{x.query}{x.brand && <span className="chip" style={{ marginLeft: 6 }}>marca</span>}</span><span className="small mono">{t.withCost ? `${money(x.costMinor, cur)} · ` : ''}{x.sessions} visitas · {x.reservations} res.</span></div><div className="tiny muted">{x.campaign}</div></div>))}</div>
      </details>
      <p className="tiny muted">Google oculta algunas búsquedas poco frecuentes; esas no aparecen aquí.</p>
    </section>
  );
}

export function AiVisibility() {
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
            {c.health_reason && <div className="small">{reasonLabel(c.health_reason)}</div>}
            <div className="tiny muted">{c.provider} · último éxito: {ago(c.last_success_at)}{c.freshness_at ? ` · datos al ${when(c.freshness_at)}` : ''}{c.last_error ? ` · último error: ${c.last_error}` : ''}</div>
            {c.provider === 'google_ads_script' && data.script && <ScriptCard script={data.script} isAdmin={isAdmin} onMsg={setMsg} reload={() => void reload()} token={token} setToken={setToken} />}
          </article>))}</div>
      </section>
      <section className="section card stack">
        <h3>Secretos del Worker</h3>
        <div className="kv">{Object.entries(data.secrets).map(([k, v]) => <div key={k}><span>{k}</span><b>{v ? 'configurado' : 'sin configurar'}</b></div>)}</div>
      </section>
      <Ga4Setup ga4={data.ga4} isAdmin={isAdmin} onDone={m => { setMsg(m); void reload(); }} />
      <OpenTableImport onDone={m => { setMsg(m); void reload(); }} />
      <PosHistoryImport isAdmin={isAdmin} onDone={setMsg} />
      <section className="section"><h3>Importaciones recientes</h3><div className="list" style={{ marginTop: 6 }}>{(data.imports as any[]).map(i => <div key={i.id} className="item small"><div className="top"><b>{i.file_name}</b><span className="chip">{importStatusLabel(i.status)}</span></div>{i.rows_ok} válidas · {i.rows_duplicate} duplicadas · {i.rows_error} errores · {when(i.created_at)} por {i.created_by}</div>)}{!(data.imports as any[]).length && <div className="item muted small">Todavía no hay importaciones.</div>}</div></section>
      {msg && <div className="toast" role="status" onClick={() => setMsg(null)}>{msg}</div>}
    </>
  );
}

/** The Google Ads script: which copy is running, what it sends, and one button that hands over the current copy ready to paste. */
function ScriptCard({ script, isAdmin, onMsg, reload, token, setToken }: { script: any; isAdmin: boolean; onMsg: (m: string) => void; reload: () => void; token: string | null; setToken: (t: string | null) => void }) {
  const [text, setText] = useState<string | null>(null);   // the script with its token, shown only when the clipboard refused it
  const [busy, setBusy] = useState(false);
  // No confirmation dialog: making a token changes nothing until the new script uses it. The clipboard is asked for the
  // text while the token is still being made, which is what Safari requires of a copy that needs a request first.
  const copy = async () => {
    setBusy(true);
    const ready = (async () => {
      const r = await api('connections/google-ads-script/token', { method: 'POST' });
      const full = feedScript.replace("var FEED_TOKEN = 'PASTE_TOKEN_HERE';", `var FEED_TOKEN = '${r.token}';`);
      if (!r.token || !full.includes(r.token)) throw new Error('No se pudo preparar el script');
      return full as string;
    })();
    ready.catch(() => { /* reported below */ });
    try {
      let copied = false;
      try {
        if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) { await navigator.clipboard.write([new ClipboardItem({ 'text/plain': ready.then(t => new Blob([t], { type: 'text/plain' })) })]); copied = true; }
      } catch { /* an older browser, or one that wants the text itself: try the plain call next */ }
      const full = await ready;                              // a failure to make the token is reported as such, not as a copy problem
      if (!copied) { try { await navigator.clipboard.writeText(full); copied = true; } catch { /* shown in a box to copy by hand */ } }
      setText(copied ? null : full);
      onMsg(copied ? 'Script copiado, con su token. Sigue los cuatro pasos de esta tarjeta.' : 'No se pudo copiar solo. Toca el cuadro para seleccionarlo todo y cópialo.');
      reload();
    } catch (e) { onMsg((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="stack">
      <div className="kv">
        <div><span>Versión que corre en Google Ads</span><b>{script.running ?? 'anterior, sin número'}</b></div>
        <div><span>Versión actual</span><b>{script.current}</b></div>
        <div><span>Manda las palabras clave</span><b>{script.keywordsAt ? `sí, ${script.keywords} activas` : 'todavía no'}</b></div>
        <div><span>Dice qué palabra clave trajo cada búsqueda</span><b>{script.termKeywordsAt ? 'sí' : 'todavía no'}</b></div>
        <div><span>Manda todas las negativas</span><b>{script.negativesFullAt ? `sí, ${script.negatives}` : 'solo las exactas de campaña'}</b></div>
      </div>
      {script.warnings.length > 0 && <div className="notice small"><b>En su última corrida el script no pudo leer algo:</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{(script.warnings as string[]).map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
      {!script.upToDate && <div className="notice info small"><b>Hay una versión nueva del script.</b> Con ella la app ve las palabras clave de cada campaña y puede proponerte, para aprobar con un toque, pausar una palabra clave o bloquear una búsqueda.</div>}
      {script.pendingToken && <div className="small muted">Hay un token nuevo que todavía no se usa: el script nuevo aún no manda su primer reporte.</div>}
      {isAdmin && (
        <>
          <div className="row"><button className={`btn ${script.upToDate ? '' : 'primary'}`} disabled={busy} onClick={() => void copy()}>{script.upToDate ? 'Copiar el script otra vez' : 'Copiar el script nuevo'}</button>
            <span className="small muted">Se copia con un token nuevo. El script que ya corre sigue funcionando hasta que el nuevo mande su primer reporte.</span></div>
          <ol className="script-steps">
            <li>En Google Ads: Herramientas → Acciones masivas → Secuencias de comandos, y abre el script del Growth Terminal.</li>
            <li>Selecciona todo el texto, bórralo y pega lo que copiaste. Ya trae su token: no hay que editar nada.</li>
            <li>Guarda y ejecútalo una vez. Si pide autorización, acéptala. La programación de cada hora no cambia.</li>
            <li>Vuelve aquí en un par de minutos: “Versión que corre” debe decir {script.current}.</li>
          </ol>
          {text && <textarea className="mono" rows={8} readOnly value={text} onFocus={e => e.currentTarget.select()} aria-label="Script de Google Ads con su token" />}
          <details className="why"><summary>Solo crear un token, para pegarlo a mano</summary>
            <div className="stack" style={{ marginTop: 6 }}>
              <button className="btn" onClick={async () => { try { const r = await api('connections/google-ads-script/token', { method: 'POST' }); setToken(r.token); reload(); } catch (e) { onMsg((e as Error).message); } }}>Crear token del feed</button>
              {token && <div className="notice small"><b>Se muestra una sola vez.</b> Va en la línea FEED_TOKEN del script:<div className="mono" style={{ overflowWrap: 'anywhere', marginTop: 6 }}>{token}</div></div>}
            </div>
          </details>
        </>
      )}
    </div>
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

/** Sales from the point of sale used before Parrot, loaded once so a period can be compared with the same weeks last year. */
function PosHistoryImport({ isAdmin, onDone }: { isAdmin: boolean; onDone: (m: string) => void }) {
  const { data, reload } = useApi<any>('pos-history');
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await api('control/pos-history', { method: 'POST', body: { fileName: file.name, csv: file.text } });
      onDone(`Historial cargado: ${int(r.loaded)} días, del ${fullDate(r.first)} al ${fullDate(r.last)}.${r.skippedParrotDays ? ` Se omitieron ${r.skippedParrotDays} días que Parrot ya tiene.` : ''}`);
      setFile(null); void reload();
    } catch (e) { onDone((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="section card stack">
      <h3>Historial de ventas del punto de venta anterior (Wansoft)</h3>
      <p className="small muted">Parrot tiene ventas desde {data?.parrotFrom ? `el ${fullDate(data.parrotFrom)}` : 'su primer día'}. Con el historial de Wansoft, las ventas se comparan contra las mismas semanas del año pasado y no contra el mes anterior, que casi siempre es otra temporada. El archivo es un CSV con una línea por día, preparado a partir del “Reporte de ventas por día” de Wansoft. Cargarlo otra vez reemplaza los mismos días; nunca los duplica.</p>
      {data && (data.days > 0
        ? <div className="kv"><div><span>Días cargados</span><b>{int(data.days)}</b></div><div><span>Desde</span><b>{fullDate(data.first)}</b></div><div><span>Hasta</span><b>{fullDate(data.last)}</b></div><div><span>Ventas sin IVA</span><b>{money(data.netMinor, 'MXN')}</b></div></div>
        : <div className="notice small">Todavía no hay historial cargado.</div>)}
      {isAdmin && <div className="form-grid"><label className="field">Archivo CSV<input type="file" accept=".csv,text/csv" onChange={async e => { const f = e.target.files?.[0]; if (f) setFile({ name: f.name, text: await f.text() }); }} /></label></div>}
      {isAdmin && <div className="row"><button className="btn" disabled={!file || busy} onClick={() => void run()}>{busy ? 'Cargando…' : 'Cargar historial'}</button></div>}
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
