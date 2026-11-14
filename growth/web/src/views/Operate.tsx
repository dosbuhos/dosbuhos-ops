import { useEffect, useState } from 'react';
import { api, useApi } from '../api';
import { Loading, ErrorBox, StateChip } from '../components';
import { MODE_INFO, microsMoney, when, stateLabel } from '../format';

function opText(o: any): string {
  switch (o.kind) {
    case 'set_budget': return `Budget ${o.budgetId}: ${microsMoney(o.fromMicros)} → ${microsMoney(o.toMicros)} per day`;
    case 'pause_ad': return `Pause ad ${o.adId}`;
    case 'pause_campaign': return `Pause campaign ${o.campaignId}`;
    case 'add_negative_exact': return `Add exact negative “${o.text}” to campaign ${o.campaignId}`;
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
  const act = async (path: string, body?: unknown, label = 'Done') => {
    try { const r = await api(path, { method: 'POST', body: body ?? {} }); setMsg(`${label}: ${r.state ? stateLabel(r.state) : 'ok'}${r.refused ? ` — ${r.refused}` : ''}`); void reload(); }
    catch (e) { setMsg((e as Error).message); }
  };
  const invalid = (data.proposals as any[]).filter(p => !p.action_id);

  return (
    <>
      <section className="section">
        <header><h2>Agent activity</h2><span className="small muted">Proposals, policy decisions, actual changes and provider verification</span></header>
        <p className="small muted">The model only proposes. Application code checks every proposal against your policy and only the coordinator can change the ad account. “Verified” means the provider was read back after the change.</p>
        <div className="list">
          {(data.actions as any[]).length === 0 && <div className="item muted">No proposals yet.</div>}
          {(data.actions as any[]).map(a => {
            const intent = a.intent, dec = a.decision;
            const ledger = ledgerFor(a.id);
            const lastReason = [...ledger].reverse().map(e => { try { return JSON.parse(e.detail_json).reason; } catch { return null; } }).find(Boolean);
            return (
              <article key={a.id} id={`a-${a.id}`} className="item" style={focus === a.id ? { borderColor: 'var(--accent)' } : undefined}>
                <div className="top"><b>{intent.resourceLabel}</b><StateChip s={a.state} /></div>
                <div className="small">{intent.proposal.hypothesis}</div>
                <div className="small mono">{intent.operations.map(opText).join(' · then ')}</div>
                <div className="tiny muted">{a.actor === 'model' ? 'Proposed by the optimizer' : `By ${a.actor}`} · {when(a.created_at)} · policy v{a.policy_version}{a.approved_by ? ` · approved by ${a.approved_by}` : ''}</div>
                {(dec.reasons?.length > 0 || lastReason) && <div className="notice" style={{ fontSize: 13 }}>{lastReason ? <div><b>Outcome:</b> {lastReason}</div> : null}{dec.reasons?.length > 0 && <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{dec.reasons.map((r: string, i: number) => <li key={i}>{r}</li>)}</ul>}</div>}
                <details className="why"><summary>Evidence, risks, evaluation and every policy check</summary>
                  <div className="small stack" style={{ marginTop: 6 }}>
                    <div><b>Expected:</b> {intent.proposal.expectedEffect.metric} {intent.proposal.expectedEffect.direction} (predictions do not authorize spending)</div>
                    <div><b>Evidence:</b> {intent.evidenceRefs.join(', ')} from snapshot {intent.snapshotId}</div>
                    <div><b>Risks:</b> {intent.proposal.risks.join('; ')}</div>
                    <div><b>If unchanged:</b> {intent.proposal.alternative}</div>
                    <div><b>Evaluation:</b> {intent.proposal.evaluationPlan}</div>
                    <div><b>Rollback:</b> {intent.proposal.rollbackPlan}. A rollback cannot undo money already spent, ads already shown or a learning reset.</div>
                    <div className="table-scroll"><table className="data"><tbody>{(dec.checks ?? []).map((c: any) => <tr key={c.name}><td>{c.ok ? '✓' : c.blocksAutomationOnly ? '◐' : '×'}</td><td className="mono tiny">{c.name}</td><td>{c.detail}</td></tr>)}</tbody></table></div>
                    <div className="timeline">{ledger.map(e => <div key={e.event_id}><span className="mono tiny">{when(e.at)}</span> {e.from_state ? `${stateLabel(e.from_state)} → ` : ''}<b>{stateLabel(e.to_state)}</b></div>)}</div>
                  </div>
                </details>
                {isAdmin && <div className="row">
                  {a.state === 'APPROVAL_REQUIRED' && <button className="btn primary" onClick={() => { if (confirm(`Approve and run exactly this?\n\n${intent.operations.map(opText).join('\n')}`)) void act(`proposals/${a.id}/approve`, { approvalHash: a.approval_hash }, 'Approved'); }}>Approve this exact change</button>}
                  {(a.state === 'UNKNOWN_OUTCOME' || a.state === 'APPLIED') && <button className="btn" onClick={() => void act(`actions/${a.id}/reconcile`, undefined, 'Reconciled')}>Reconcile with Google Ads</button>}
                  {(a.state === 'VERIFIED' || a.state === 'PARTIALLY_APPLIED') && a.action_type !== 'pause_campaign' && <button className="btn" onClick={() => { if (confirm('Restore the previous setting? This only runs if nobody changed it since.')) void act(`actions/${a.id}/compensate`, undefined, 'Rollback'); }}>Restore previous setting</button>}
                </div>}
              </article>
            );
          })}
        </div>
      </section>
      {invalid.length > 0 && <section className="section"><header><h3>Proposals that failed validation</h3></header><div className="list">{invalid.map(p => <div key={p.id} className="item small"><div className="mono tiny">{when(p.created_at)} · {p.model}</div>{JSON.parse(p.validation_errors_json).join('; ')}</div>)}</div></section>}
      <section className="section"><header><h3>Scheduled runs</h3></header>
        <div className="list">{(data.jobs as any[]).slice(0, 12).map(j => <div key={j.run_key} className="item small"><div className="top"><span className="mono">{j.run_key}</span><span className={`state ${j.status === 'succeeded' ? 's-ok' : j.status === 'failed' ? 's-bad' : 's-mute'}`}>{j.status}</span></div><div className="muted tiny">{j.detail?.slice(0, 240)}</div></div>)}</div>
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
  if (!st) return session ? <div className="notice section">No ad account is registered yet. Connections explains the first steps.</div> : <div className="section"><Loading /></div>;
  const call = async (path: string, body: unknown, ok: string) => { try { const r = await api(path, { method: 'POST', body }); setMsg(r?.note ?? ok); reload(); return r; } catch (e) { setMsg((e as Error).message); return null; } };
  const p = st.policy;
  const missing = [p.monthlyAdSpendCeilingNative === null && 'monthly ceiling', p.ceilingCoversWholeAccount === null && 'ceiling scope', p.minimumAcceptableContributionReturn === null && 'return floor', !p.approvedCampaignIds.length && 'approved campaigns', p.protectiveStopPctOfCeiling === null && 'protective stop', st.baselineAggregateMicros === null && 'budget baseline'].filter(Boolean);

  return (
    <>
      <section className="section grid cols-2">
        <div className="card stack">
          <h2>Emergency controls</h2>
          <p className="small">These two are separate on purpose. Neither needs the AI to work.</p>
          <div className="item">
            <div className="top"><b>Stop AI changes</b><span className={`state ${st.aiStopped ? 's-warn' : 's-ok'}`}>{st.aiStopped ? 'Stopped' : 'Allowed under policy'}</span></div>
            <div className="small">Stops the optimizer from changing anything. <b>Ads keep running and spending.</b></div>
            <button className="btn" disabled={!isAdmin} onClick={() => void call('control/stop-ai', { on: !st.aiStopped }, 'Updated')}>{st.aiStopped ? 'Allow AI changes again' : 'Stop AI changes'}</button>
          </div>
          <div className="item">
            <div className="top"><b>Pause managed ads</b><span className="state s-bad">Stops spend</span></div>
            <div className="small">Pauses every campaign on your approved list and reports each result from Google Ads. Campaigns not on the list are not touched. Resuming is a separate decision with budget checks.</div>
            <button className="btn danger" disabled={!isAdmin} onClick={async () => { if (!confirm('Pause every managed campaign now?')) return; const r = await call('control/pause-managed-ads', {}, 'Pause requested'); if (r) setPauseResults(r.results); }}>Pause managed ads</button>
            {pauseResults && <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{pauseResults.length ? pauseResults.map(r => <li key={r.campaignId}><b>{r.label}</b>: {r.outcome}</li>) : <li>No managed campaigns to pause.</li>}</ul>}
            <div className="tiny muted">If Cloudflare or Google is unreachable, running ads keep spending. Direct path: Google Ads → Campaigns → select → Pause.</div>
          </div>
          <div className="item">
            <div className="top"><b>Emergency lock</b><span className={`state ${st.emergencyLock ? 's-bad' : 's-mute'}`}>{st.emergencyLock ? 'On' : 'Off'}</span></div>
            <div className="small">Refuses every growth write, including approved ones. Protective pauses still work. Turning it off lands in Paused, never straight into automation.</div>
            <button className="btn" disabled={!isAdmin} onClick={() => void call('control/emergency-lock', { on: !st.emergencyLock }, 'Updated')}>{st.emergencyLock ? 'Turn lock off' : 'Turn lock on'}</button>
            {st.restoredLocked && <div className="notice bad small">Restored from backup: reconcile live state before unlocking. <button className="btn" onClick={() => void call('control/reconcile-all', {}, 'Reconciled')}>Reconcile now</button></div>}
          </div>
        </div>

        <div className="card stack">
          <h2>Autonomy mode</h2>
          <div className="seg" role="radiogroup" aria-label="Mode">
            {(['OBSERVE', 'SHADOW', 'LIMITED_AUTO', 'PAUSED'] as const).concat(st.providerKind === 'mock' ? ['DEMO' as never] : []).map(m => (
              <button key={m} aria-pressed={st.mode === m} disabled={!isAdmin || m === 'LIMITED_AUTO'} onClick={() => void call('control/mode', { mode: m }, `Mode: ${MODE_INFO[m]?.label}`)}>{MODE_INFO[m]?.label}</button>
            ))}
          </div>
          <div className="small">{MODE_INFO[st.mode]?.text}</div>
          <div className="item">
            <b>Go live (Limited auto)</b>
            {missing.length ? <div className="notice small">Not possible yet. Set: {missing.join(', ')}. Production writes also need the Google Ads API connection (Connections).</div> : (
              <>
                <div className="small">You are enabling exactly policy <b>v{st.policyVersion}</b>:</div>
                <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                  <li>Account {st.accountId}; campaigns {p.approvedCampaignIds.join(', ')}</li>
                  <li>Automatic: {p.allowedAutomaticActions.length ? p.allowedAutomaticActions.join(', ') : 'nothing — every change waits for your approval'}</li>
                  <li>Monthly ceiling {p.monthlyAdSpendCeilingNative?.toLocaleString()} {p.reportingCurrency} ({p.ceilingCoversWholeAccount ? 'whole account' : 'managed campaigns only — the app cannot pause the others'}); protective stop at {p.protectiveStopPctOfCeiling}%</li>
                  <li>Max {p.maxCampaignBudgetChangePctPer7Days}% per campaign per 7 days (counting everyone’s changes), {p.maxOptimizationMutationsPerDay} changes/day, aggregate +{p.maxTotalBudgetBaselineIncreasePct}% over baseline {microsMoney(st.baselineAggregateMicros)}/day</li>
                  <li>Return floor: contribution ROAS ≥ {p.minimumAcceptableContributionReturn} on mature cohorts</li>
                </ul>
                <label className="row small"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} style={{ width: 22, height: 22 }} /> I reviewed this exact policy and understand ads keep spending if the app stops.</label>
                <button className="btn primary" disabled={!isAdmin || !ack} onClick={() => void call('control/mode', { mode: 'LIMITED_AUTO', policyVersion: st.policyVersion }, 'Limited auto enabled')}>Enable Limited auto for policy v{st.policyVersion}</button>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="section card stack">
        <h2>Limits and permissions <span className="small muted">policy v{st.policyVersion}</span></h2>
        <div className="kv">
          <div><span>Monthly ceiling</span><b>{p.monthlyAdSpendCeilingNative?.toLocaleString() ?? 'not set'} {p.reportingCurrency}</b></div>
          <div><span>Budget baseline / day</span><b>{microsMoney(st.baselineAggregateMicros)}</b></div>
          <div><span>Return floor</span><b>{p.minimumAcceptableContributionReturn ?? 'not set'}</b></div>
          <div><span>Approved campaigns</span><b>{p.approvedCampaignIds.length || 'none'}</b></div>
          <div><span>Unknown outcomes</span><b>{st.unknownOutcomes}</b></div>
          <div><span>Ad provider</span><b>{st.providerKind === 'mock' ? 'Simulated (demo)' : 'Google Ads API'}</b></div>
        </div>
        <div className="small muted">Always off unless you change them here: new campaigns, bid strategy, conversion goals, prices/discounts, website publishing, audience uploads.</div>
        {isAdmin && <>
          <BaselineForm onSave={n => void call('control/baseline', { dailyBudgetNative: n }, 'Baseline saved')} />
          <details><summary className="small" style={{ cursor: 'pointer', minHeight: 36, display: 'flex', alignItems: 'center' }}>Edit full policy (admin)</summary>
            <label className="field">Policy JSON — mode is changed above, not here<textarea rows={16} className="mono" value={policyText} onChange={e => setPolicyText(e.target.value)} /></label>
            <button className="btn primary" onClick={() => { try { void call('control/policy', JSON.parse(policyText), 'Policy saved as a new version'); } catch { setMsg('That is not valid JSON'); } }}>Save as new policy version</button>
          </details>
          <div className="row">
            <button className="btn" onClick={() => void call('control/run-report', {}, 'Report regenerated')}>Regenerate today’s report</button>
            <button className="btn" onClick={async () => { try { const r = await api('export/coordinator'); setMsg(`Backup stored: ${r.stored}`); } catch (e) { setMsg((e as Error).message); } }}>Back up coordinator</button>
          </div>
        </>}
        {st.suspensions.length > 0 && <div className="notice">External changes detected: {st.suspensions.map((s: any) => <div key={s.resourceKey}>{s.resourceKey}: {s.reason} {isAdmin && <button className="btn" onClick={() => void call('control/clear-suspension', { resourceKey: s.resourceKey }, 'Acknowledged')}>Acknowledge</button>}</div>)}</div>}
      </section>
      {msg && <div className="toast" role="status" onClick={() => setMsg(null)}>{msg}</div>}
    </>
  );
}

function BaselineForm({ onSave }: { onSave: (n: number) => void }) {
  const [v, setV] = useState('');
  return <div className="row"><label className="field" style={{ flex: '1 1 200px' }}>Aggregate daily budget baseline (whole MXN)<input inputMode="numeric" value={v} onChange={e => setV(e.target.value.replace(/[^0-9]/g, ''))} /></label><button className="btn" disabled={!v} onClick={() => onSave(Number(v))}>Save baseline</button></div>;
}
