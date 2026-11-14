import { useEffect, useState } from 'react';
import { api, useApi } from '../api';
import { Loading, ErrorBox, StateChip } from '../components';
import { MODE_INFO, microsMoney, money, PRODUCT_LABEL, when, stateLabel, jobStatusLabel, directionLabel } from '../format';

function opText(o: any): string {
  switch (o.kind) {
    case 'set_budget': return `Presupuesto ${o.budgetId}: ${microsMoney(o.fromMicros)} → ${microsMoney(o.toMicros)} por día`;
    case 'pause_ad': return `Pausar anuncio ${o.adId}`;
    case 'pause_campaign': return `Pausar campaña ${o.campaignId}`;
    case 'add_negative_exact': return `Agregar negativa exacta “${o.text}” a la campaña ${o.campaignId}`;
    default: return JSON.stringify(o);
  }
}

export function Activity({ isAdmin }: { isAdmin: boolean }) {
  const { data, error, reload } = useApi('activity', 90_000);
  const [msg, setMsg] = useState<string | null>(null);
  const [focus] = useState(() => { try { const f = sessionStorage.getItem('growth-focus-action'); sessionStorage.removeItem('growth-focus-action'); return f; } catch { return null; } });
  useEffect(() => { if (focus && data) document.getElementById(`a-${focus}`)?.scrollIntoView({ block: 'center' }); }, [focus, data]);
  if (!data) return error ? <ErrorBox error={error} /> : <div className="section"><Loading /></div>;
  const ledgerFor = (id: string) => (data.ledger as any[]).filter(e => e.action_id === id).sort((a, b) => a.at - b.at);
  const act = async (path: string, body?: unknown, label = 'Listo') => {
    try { const r = await api(path, { method: 'POST', body: body ?? {} }); setMsg(`${label}: ${r.state ? stateLabel(r.state) : 'ok'}${r.refused ? ` — ${r.refused}` : ''}`); void reload(); }
    catch (e) { setMsg((e as Error).message); }
  };
  const invalid = (data.proposals as any[]).filter(p => !p.action_id);

  return (
    <>
      <section className="section">
        <header><h2>Actividad del agente</h2><span className="small muted">Propuestas, decisiones de la política, cambios reales y verificación con el proveedor</span></header>
        <p className="small muted">El modelo solo propone. El código de la app revisa cada propuesta contra tu política y solo el coordinador puede cambiar la cuenta de anuncios. “Verificada” significa que se volvió a leer el proveedor después del cambio.</p>
        <div className="list">
          {(data.actions as any[]).length === 0 && <div className="item muted">Todavía no hay propuestas.</div>}
          {(data.actions as any[]).map(a => {
            const intent = a.intent, dec = a.decision;
            const ledger = ledgerFor(a.id);
            const lastReason = [...ledger].reverse().map(e => { try { return JSON.parse(e.detail_json).reason; } catch { return null; } }).find(Boolean);
            return (
              <article key={a.id} id={`a-${a.id}`} className="item" style={focus === a.id ? { borderColor: 'var(--accent)' } : undefined}>
                <div className="top"><b>{intent.resourceLabel}</b><StateChip s={a.state} /></div>
                <div className="small">{intent.proposal.hypothesis}</div>
                <div className="small mono">{intent.operations.map(opText).join(' · luego ')}</div>
                <div className="tiny muted">{a.actor === 'model' ? 'Propuesta por el optimizador' : `Por ${a.actor}`} · {when(a.created_at)} · política v{a.policy_version}{a.approved_by ? ` · aprobada por ${a.approved_by}` : ''}</div>
                {(dec.reasons?.length > 0 || lastReason) && <div className="notice" style={{ fontSize: 13 }}>{lastReason ? <div><b>Resultado:</b> {lastReason}</div> : null}{dec.reasons?.length > 0 && <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{dec.reasons.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul>}</div>}
                <details className="why"><summary>Evidencia, riesgos, evaluación y cada revisión de la política</summary>
                  <div className="small stack" style={{ marginTop: 6 }}>
                    <div><b>Esperado:</b> {intent.proposal.expectedEffect.metric} {directionLabel(intent.proposal.expectedEffect.direction)} (las predicciones no autorizan gasto)</div>
                    <div><b>Evidencia:</b> {intent.evidenceRefs.join(', ')} de la instantánea {intent.snapshotId}</div>
                    <div><b>Riesgos:</b> {intent.proposal.risks.join('; ')}</div>
                    <div><b>Si no se cambia:</b> {intent.proposal.alternative}</div>
                    <div><b>Evaluación:</b> {intent.proposal.evaluationPlan}</div>
                    <div><b>Reversión:</b> {intent.proposal.rollbackPlan}. Una reversión no puede deshacer el dinero ya gastado, los anuncios ya mostrados ni un reinicio del aprendizaje.</div>
                    <div className="table-scroll"><table className="data"><tbody>{(dec.checks ?? []).map((c: any) => <tr key={c.name}><td>{c.ok ? '✓' : c.blocksAutomationOnly ? '◐' : '×'}</td><td className="mono tiny">{c.name}</td><td>{c.detail}</td></tr>)}</tbody></table></div>
                    <div className="timeline">{ledger.map(e => <div key={e.event_id}><span className="mono tiny">{when(e.at)}</span> {e.from_state ? `${stateLabel(e.from_state)} → ` : ''}<b>{stateLabel(e.to_state)}</b></div>)}</div>
                  </div>
                </details>
                {isAdmin && <div className="row">
                  {a.state === 'APPROVAL_REQUIRED' && <button className="btn primary" onClick={() => { if (confirm(`¿Aprobar y ejecutar exactamente esto?\n\n${intent.operations.map(opText).join('\n')}`)) void act(`proposals/${a.id}/approve`, { approvalHash: a.approval_hash }, 'Aprobada'); }}>Aprobar este cambio exacto</button>}
                  {(a.state === 'UNKNOWN_OUTCOME' || a.state === 'APPLIED') && <button className="btn" onClick={() => void act(`actions/${a.id}/reconcile`, undefined, 'Conciliada')}>Conciliar con Google Ads</button>}
                  {(a.state === 'VERIFIED' || a.state === 'PARTIALLY_APPLIED') && a.action_type !== 'pause_campaign' && <button className="btn" onClick={() => { if (confirm('¿Restaurar el ajuste anterior? Solo se hace si nadie lo cambió desde entonces.')) void act(`actions/${a.id}/compensate`, undefined, 'Reversión'); }}>Restaurar ajuste anterior</button>}
                </div>}
              </article>
            );
          })}
        </div>
      </section>
      {invalid.length > 0 && <section className="section"><header><h3>Propuestas que no pasaron la validación</h3></header><div className="list">{invalid.map(p => <div key={p.id} className="item small"><div className="mono tiny">{when(p.created_at)} · {p.model}</div>{JSON.parse(p.validation_errors_json).join('; ')}</div>)}</div></section>}
      <section className="section"><header><h3>Ejecuciones programadas</h3></header>
        <div className="list">{(data.jobs as any[]).slice(0, 12).map(j => <div key={j.run_key} className="item small"><div className="top"><span className="mono">{j.run_key}</span><span className={`state ${j.status === 'succeeded' ? 's-ok' : j.status === 'failed' ? 's-bad' : 's-mute'}`}>{jobStatusLabel(j.status)}</span></div><div className="muted tiny">{j.detail?.slice(0, 240)}</div></div>)}</div>
      </section>
      {msg && <div className="toast" role="status" onClick={() => setMsg(null)}>{msg}</div>}
    </>
  );
}

export function Controls({ session, reload }: { session: any; reload: () => void }) {
  const st = session?.coordinator;
  const isAdmin = session?.user?.role === 'admin';
  const [msg, setMsg] = useState<string | null>(null);
  const [pauseResults, setPauseResults] = useState<any[] | null>(null);
  const [policyText, setPolicyText] = useState('');
  const [ack, setAck] = useState(false);
  useEffect(() => { if (st?.policy) setPolicyText(JSON.stringify(st.policy, null, 2)); }, [st?.policyVersion]);
  if (!st) return session ? <div className="notice section">Todavía no hay cuenta de anuncios registrada. En Conexiones se explican los primeros pasos.</div> : <div className="section"><Loading /></div>;
  const call = async (path: string, body: unknown, ok: string) => { try { const r = await api(path, { method: 'POST', body }); setMsg(r?.note ?? ok); reload(); return r; } catch (e) { setMsg((e as Error).message); return null; } };
  const p = st.policy;
  const missing = [p.monthlyAdSpendCeilingNative === null && 'tope mensual', p.ceilingCoversWholeAccount === null && 'alcance del tope', p.minimumAcceptableContributionReturn === null && 'retorno mínimo', !p.approvedCampaignIds.length && 'campañas aprobadas', p.protectiveStopPctOfCeiling === null && 'paro de protección', st.baselineAggregateMicros === null && 'base del presupuesto'].filter(Boolean);

  return (
    <>
      <section className="section grid cols-2">
        <div className="card stack">
          <h2>Controles de emergencia</h2>
          <p className="small">Estos dos están separados a propósito. Ninguno necesita la IA para funcionar.</p>
          <div className="item">
            <div className="top"><b>Detener cambios de la IA</b><span className={`state ${st.aiStopped ? 's-warn' : 's-ok'}`}>{st.aiStopped ? 'Detenidos' : 'Permitidos según la política'}</span></div>
            <div className="small">Evita que el optimizador cambie cualquier cosa. <b>Los anuncios siguen corriendo y gastando.</b></div>
            <button className="btn" disabled={!isAdmin} onClick={() => void call('control/stop-ai', { on: !st.aiStopped }, 'Actualizado')}>{st.aiStopped ? 'Permitir otra vez los cambios de la IA' : 'Detener cambios de la IA'}</button>
          </div>
          <div className="item">
            <div className="top"><b>Pausar anuncios administrados</b><span className="state s-bad">Detiene el gasto</span></div>
            <div className="small">Pausa todas las campañas de tu lista aprobada y muestra el resultado de cada una según Google Ads. No se tocan las campañas que no están en la lista. Reanudar es otra decisión, con revisión de presupuesto.</div>
            <button className="btn danger" disabled={!isAdmin} onClick={async () => { if (!confirm('¿Pausar ahora todas las campañas administradas?')) return; const r = await call('control/pause-managed-ads', {}, 'Pausa solicitada'); if (r) setPauseResults(r.results); }}>Pausar anuncios administrados</button>
            {pauseResults && <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{pauseResults.length ? pauseResults.map(r => <li key={r.campaignId}><b>{r.label}</b>: {r.outcome}</li>) : <li>No hay campañas administradas para pausar.</li>}</ul>}
            <div className="tiny muted">Si Cloudflare o Google no responden, los anuncios activos siguen gastando. Camino directo: Google Ads → Campañas → seleccionar → Pausar.</div>
          </div>
          <div className="item">
            <div className="top"><b>Bloqueo de emergencia</b><span className={`state ${st.emergencyLock ? 's-bad' : 's-mute'}`}>{st.emergencyLock ? 'Activo' : 'Apagado'}</span></div>
            <div className="small">Rechaza todos los cambios de crecimiento, incluso los aprobados. Las pausas de protección siguen funcionando. Al apagarlo queda En pausa, nunca pasa directo a automático.</div>
            <button className="btn" disabled={!isAdmin} onClick={() => void call('control/emergency-lock', { on: !st.emergencyLock }, 'Actualizado')}>{st.emergencyLock ? 'Apagar bloqueo' : 'Activar bloqueo'}</button>
            {st.restoredLocked && <div className="notice bad small">Restaurado desde respaldo: concilia el estado real antes de desbloquear. <button className="btn" onClick={() => void call('control/reconcile-all', {}, 'Conciliado')}>Conciliar ahora</button></div>}
          </div>
        </div>

        <div className="card stack">
          <h2>Modo de autonomía</h2>
          <div className="seg" role="radiogroup" aria-label="Modo">
            {(['OBSERVE', 'SHADOW', 'LIMITED_AUTO', 'PAUSED'] as const).concat(st.providerKind === 'mock' ? ['DEMO' as never] : []).map(m => (
              <button key={m} aria-pressed={st.mode === m} disabled={!isAdmin || m === 'LIMITED_AUTO'} onClick={() => void call('control/mode', { mode: m }, `Modo: ${MODE_INFO[m]?.label}`)}>{MODE_INFO[m]?.label}</button>
            ))}
          </div>
          <div className="small">{MODE_INFO[st.mode]?.text}</div>
          <div className="item">
            <b>Activar en vivo (Automático limitado)</b>
            {missing.length ? <div className="notice small">Todavía no se puede. Define: {missing.join(', ')}. Los cambios en producción también necesitan la conexión con la API de Google Ads (Conexiones).</div> : (
              <>
                <div className="small">Vas a activar exactamente la política <b>v{st.policyVersion}</b>:</div>
                <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                  <li>Cuenta {st.accountId}; campañas {p.approvedCampaignIds.join(', ')}</li>
                  <li>Automático: {p.allowedAutomaticActions.length ? p.allowedAutomaticActions.join(', ') : 'nada; cada cambio espera tu aprobación'}</li>
                  <li>Tope mensual {p.monthlyAdSpendCeilingNative?.toLocaleString()} {p.reportingCurrency} ({p.ceilingCoversWholeAccount ? 'toda la cuenta' : 'solo campañas administradas; la app no puede pausar las demás'}); paro de protección al {p.protectiveStopPctOfCeiling}%</li>
                  <li>Máx. {p.maxCampaignBudgetChangePctPer7Days}% por campaña cada 7 días (contando los cambios de todos), {p.maxOptimizationMutationsPerDay} cambios/día, total +{p.maxTotalBudgetBaselineIncreasePct}% sobre la base de {microsMoney(st.baselineAggregateMicros)}/día</li>
                  <li>Retorno mínimo: ROAS de contribución ≥ {p.minimumAcceptableContributionReturn} en cohortes maduras</li>
                </ul>
                <label className="row small"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} style={{ width: 22, height: 22 }} /> Revisé esta política exacta y entiendo que los anuncios siguen gastando si la app se detiene.</label>
                <button className="btn primary" disabled={!isAdmin || !ack} onClick={() => void call('control/mode', { mode: 'LIMITED_AUTO', policyVersion: st.policyVersion }, 'Automático limitado activado')}>Activar Automático limitado para la política v{st.policyVersion}</button>
              </>
            )}
          </div>
        </div>
      </section>

      <Estimates isAdmin={isAdmin} />
      <AiVisibilityRun isAdmin={isAdmin} />

      <section className="section card stack">
        <h2>Límites y permisos <span className="small muted">política v{st.policyVersion}</span></h2>
        <div className="kv">
          <div><span>Tope mensual</span><b>{p.monthlyAdSpendCeilingNative?.toLocaleString() ?? 'sin definir'} {p.reportingCurrency}</b></div>
          <div><span>Base del presupuesto / día</span><b>{microsMoney(st.baselineAggregateMicros)}</b></div>
          <div><span>Retorno mínimo</span><b>{p.minimumAcceptableContributionReturn ?? 'sin definir'}</b></div>
          <div><span>Campañas aprobadas</span><b>{p.approvedCampaignIds.length || 'ninguna'}</b></div>
          <div><span>Resultados desconocidos</span><b>{st.unknownOutcomes}</b></div>
          <div><span>Proveedor de anuncios</span><b>{st.providerKind === 'mock' ? 'Simulado (demo)' : 'API de Google Ads'}</b></div>
        </div>
        <div className="small muted">Siempre apagados a menos que los cambies aquí: campañas nuevas, estrategia de puja, objetivos de conversión, precios/descuentos, publicación en el sitio web, carga de audiencias.</div>
        {isAdmin && <>
          <BaselineForm onSave={n => void call('control/baseline', { dailyBudgetNative: n }, 'Base guardada')} />
          <details><summary className="small" style={{ cursor: 'pointer', minHeight: 36, display: 'flex', alignItems: 'center' }}>Editar la política completa (admin)</summary>
            <label className="field">JSON de la política (el modo se cambia arriba, no aquí)<textarea rows={16} className="mono" value={policyText} onChange={e => setPolicyText(e.target.value)} /></label>
            <button className="btn primary" onClick={() => { try { void call('control/policy', JSON.parse(policyText), 'Política guardada como versión nueva'); } catch { setMsg('Ese JSON no es válido'); } }}>Guardar como versión nueva de la política</button>
          </details>
          <div className="row">
            <button className="btn" onClick={() => void call('control/run-report', {}, 'Reporte regenerado')}>Volver a generar el reporte de hoy</button>
            <button className="btn" onClick={async () => { try { const r = await api('export/coordinator'); setMsg(`Respaldo guardado: ${r.stored}`); } catch (e) { setMsg((e as Error).message); } }}>Respaldar coordinador</button>
          </div>
        </>}
        {st.suspensions.length > 0 && <div className="notice">Se detectaron cambios externos: {st.suspensions.map((s: any) => <div key={s.resourceKey}>{s.resourceKey}: {s.reason} {isAdmin && <button className="btn" onClick={() => void call('control/clear-suspension', { resourceKey: s.resourceKey }, 'Marcado como visto')}>Marcar como visto</button>}</div>)}</div>}
      </section>
      {msg && <div className="toast" role="status" onClick={() => setMsg(null)}>{msg}</div>}
    </>
  );
}

const EST_PRODUCTS: [string, string][] = [['restaurant_visit', 'Restaurante (por reservación)'], ['tour_tasting', 'Tours y catas (por reservación)']];

/** Owner-approved value per reservation. Every estimated revenue/return number on the dashboard uses these. */
function Estimates({ isAdmin }: { isAdmin: boolean }) {
  const { data, error, reload } = useApi('estimates');
  const [edit, setEdit] = useState<string | null>(null);
  const [f, setF] = useState({ value: '', basis: '', sourcePeriod: '', note: '' });
  const [msg, setMsg] = useState<string | null>(null);
  if (!data) return <section className="section">{error ? <ErrorBox error={error} /> : <Loading />}</section>;
  const save = async (product: string) => {
    try { await api('estimates', { method: 'POST', body: { product, value: Number(f.value), basis: f.basis, sourcePeriod: f.sourcePeriod, note: f.note } }); setEdit(null); setMsg('Valor guardado. El historial conserva el anterior.'); void reload(); }
    catch (e) { setMsg((e as Error).message); }
  };
  return (
    <section className="section card stack">
      <h2>Valores estimados y costos</h2>
      <p className="small">Con estos promedios se calculan el <b>ingreso estimado</b> y el <b>retorno estimado</b> de los anuncios. Son estimaciones, no ventas reales: OpenTable no nos dice cuánto gastó cada mesa. Cámbialos cuando tengas un promedio más reciente.</p>
      <div className="list">{EST_PRODUCTS.map(([k, label]) => {
        const e = data.current[k];
        return (
          <div key={k} className="item">
            <div className="top"><b>{label}</b><b className="mono">{e ? money(e.valueMinor, e.currency) : 'sin definir'}</b></div>
            {e ? <div className="small">Base: {e.basis}{e.sourcePeriod ? ` · periodo ${e.sourcePeriod}` : ''} · aprobado por {e.approvedBy} el {when(e.approvedAt)}{e.note ? ` · ${e.note}` : ''}</div> : <div className="small muted">Sin valor, los ingresos estimados no se muestran.</div>}
            {isAdmin && edit !== k && <button className="btn" onClick={() => { setEdit(k); setF({ value: e ? String(e.valueMinor / 100) : '', basis: e?.basis ?? '', sourcePeriod: e?.sourcePeriod ?? '', note: '' }); }}>Cambiar</button>}
            {edit === k && (
              <div className="stack">
                <label className="field">Valor por reservación (MXN, sin IVA)<input inputMode="decimal" value={f.value} onChange={ev => setF({ ...f, value: ev.target.value.replace(/[^0-9.]/g, '') })} /></label>
                <label className="field">De dónde sale (obligatorio)<input value={f.basis} onChange={ev => setF({ ...f, basis: ev.target.value })} /></label>
                <label className="field">Periodo de los datos<input value={f.sourcePeriod} placeholder="2026-08-12 – 2026-11-14" onChange={ev => setF({ ...f, sourcePeriod: ev.target.value })} /></label>
                <label className="field">Nota (opcional)<input value={f.note} onChange={ev => setF({ ...f, note: ev.target.value })} /></label>
                <div className="row"><button className="btn primary" disabled={!Number(f.value) || f.basis.trim().length < 3} onClick={() => void save(k)}>Guardar</button><button className="btn" onClick={() => setEdit(null)}>Cancelar</button></div>
              </div>
            )}
          </div>
        );
      })}</div>
      <h3>Costos variables</h3>
      <p className="small">Se restan del valor por reservación para estimar la <b>contribución</b> (lo que queda para pagar gastos fijos y anuncios). Los marcados <span className="state s-warn">provisional</span> son aproximaciones que hay que confirmar.</p>
      <div className="list">{COSTS.map(([k, label, unit]) => <CostRow key={k} k={k} label={label} unit={unit} c={data.costs.current[k]} isAdmin={isAdmin} onSaved={m => { setMsg(m); void reload(); }} />)}</div>
      {Object.keys(data.contribution).length > 0 && <div className="small">Contribución estimada por reservación: {EST_PRODUCTS.filter(([k]) => data.contribution[k] != null).map(([k, l]) => `${l.split(' (')[0]} ${money(data.contribution[k])}`).join(' · ')}</div>}
      {data.history.length > EST_PRODUCTS.length && <details><summary className="small" style={{ cursor: 'pointer' }}>Historial</summary><ul className="small">{(data.history as any[]).map(h => <li key={h.id}>{when(h.approvedAt)} · {PRODUCT_LABEL[h.product] ?? h.product}: {money(h.valueMinor, h.currency)} ({h.basis}) por {h.approvedBy}</li>)}</ul></details>}
      {msg && <div className="toast" role="status" onClick={() => setMsg(null)}>{msg}</div>}
    </section>
  );
}

const COSTS: [string, string, 'pct' | 'mxn'][] = [
  ['restaurant_cost_pct', 'Costo de alimentos y bebidas del restaurante', 'pct'],
  ['tour_cost_pct', 'Costo de tours y catas', 'pct'],
  ['payment_fee_pct', 'Comisión por pagos con tarjeta (sobre la venta total)', 'pct'],
  ['opentable_fee_per_reservation', 'Cargo de OpenTable por reservación del sitio web', 'mxn'],
];

function CostRow({ k, label, unit, c, isAdmin, onSaved }: { k: string; label: string; unit: 'pct' | 'mxn'; c: any; isAdmin: boolean; onSaved: (m: string) => void }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ value: '', basis: '', sourcePeriod: '', note: '', provisional: false });
  const shown = !c ? 'sin definir' : unit === 'pct' ? `${(c.value / 100).toFixed(1)}%` : money(c.value);
  const save = async () => {
    try { await api('costs', { method: 'POST', body: { key: k, value: Number(f.value), basis: f.basis, sourcePeriod: f.sourcePeriod, note: f.note, provisional: f.provisional } }); setEdit(false); onSaved('Costo guardado. El historial conserva el anterior.'); }
    catch (e) { onSaved((e as Error).message); }
  };
  return (
    <div className="item">
      <div className="top"><b>{label}</b><span className="row">{c?.provisional && <span className="state s-warn">provisional</span>}<b className="mono">{shown}</b></span></div>
      {c ? <div className="small">Base: {c.basis}{c.sourcePeriod ? ` · ${c.sourcePeriod}` : ''} · {c.approvedBy}, {when(c.approvedAt)}{c.note ? ` · ${c.note}` : ''}</div> : <div className="small muted">Sin valor: la contribución estimada no se calcula.</div>}
      {isAdmin && !edit && <button className="btn" onClick={() => { setEdit(true); setF({ value: c ? String(c.value / 100) : '', basis: c?.basis ?? '', sourcePeriod: c?.sourcePeriod ?? '', note: '', provisional: c?.provisional ?? false }); }}>Cambiar</button>}
      {edit && (
        <div className="stack">
          <label className="field">{unit === 'pct' ? 'Porcentaje (ej. 21.5)' : 'Pesos por reservación'}<input inputMode="decimal" value={f.value} onChange={ev => setF({ ...f, value: ev.target.value.replace(/[^0-9.]/g, '') })} /></label>
          <label className="field">De dónde sale (obligatorio)<input value={f.basis} onChange={ev => setF({ ...f, basis: ev.target.value })} /></label>
          <label className="field">Periodo de los datos<input value={f.sourcePeriod} onChange={ev => setF({ ...f, sourcePeriod: ev.target.value })} /></label>
          <label className="field">Nota (opcional)<input value={f.note} onChange={ev => setF({ ...f, note: ev.target.value })} /></label>
          <label className="row small"><input type="checkbox" checked={f.provisional} onChange={ev => setF({ ...f, provisional: ev.target.checked })} style={{ width: 22, height: 22 }} /> Es provisional (falta confirmarlo)</label>
          <div className="row"><button className="btn primary" disabled={f.value === '' || f.basis.trim().length < 3} onClick={() => void save()}>Guardar</button><button className="btn" onClick={() => setEdit(false)}>Cancelar</button></div>
        </div>
      )}
    </div>
  );
}

function AiVisibilityRun({ isAdmin }: { isAdmin: boolean }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section className="section card stack">
      <h2>Visibilidad en asistentes de IA</h2>
      <p className="small">Cada mes, el día 1, la app pregunta a Claude (con búsqueda web) 10 preguntas que haría un turista, sin mencionar a Dos Búhos, y anota si nos recomienda. Los resultados están en Campañas. Costo aproximado: menos de US$2 por revisión.</p>
      {isAdmin && <button className="btn" disabled={busy} onClick={async () => { setBusy(true); try { const r = await api('control/ai-visibility-run', { method: 'POST', body: {} }); setMsg(`Listo: ${r.mentioned} de ${r.asked} respuestas mencionan a Dos Búhos.`); } catch (e) { setMsg((e as Error).message); } setBusy(false); }}>{busy ? 'Preguntando… (1–3 min)' : 'Ejecutar ahora'}</button>}
      {msg && <div className="toast" role="status" onClick={() => setMsg(null)}>{msg}</div>}
    </section>
  );
}

function BaselineForm({ onSave }: { onSave: (n: number) => void }) {
  const [v, setV] = useState('');
  return <div className="row"><label className="field" style={{ flex: '1 1 200px' }}>Base del presupuesto diario total (MXN enteros)<input inputMode="numeric" value={v} onChange={e => setV(e.target.value.replace(/[^0-9]/g, ''))} /></label><button className="btn" disabled={!v} onClick={() => onSave(Number(v))}>Guardar base</button></div>;
}
