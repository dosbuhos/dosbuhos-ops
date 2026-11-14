import { useState } from 'react';
import { api, useApi } from '../api';
import { Loading, ErrorBox, Health } from '../components';
import { microsMoney, money, int, when, ago, PRODUCT_LABEL } from '../format';

export function Campaigns() {
  const { data, error } = useApi('campaigns', 120_000);
  if (!data) return error ? <ErrorBox error={error} /> : <div className="section"><Loading /></div>;
  const total = (data.sources as any[]).reduce((a, x) => a + x.reservations, 0);
  const lost = (data.sources as any[]).filter(x => /Lost source|Not set/.test(x.group)).reduce((a, x) => a + x.reservations, 0);
  const cur = data.currency;
  return (
    <>
      <section className="section">
        <header><h2>Campaigns</h2><span className="small muted">{data.window.from} – {data.window.to}{data.trackingSince && data.trackingSince > data.window.from ? ` · reservations since ${data.trackingSince}` : ''}</span></header>
        {total > 0 && (
          <div className="card stack">
            <h3>Where online reservations come from</h3>
            <div className="stack">{(data.sources as any[]).map(x => (
              <div key={x.group} className="row" style={{ flexWrap: 'nowrap', gap: 10 }}>
                <div className="small" style={{ flex: '0 1 50%', minWidth: 0 }}>{x.group}</div>
                <div style={{ flex: 1, minWidth: 0 }}><div className="bar" style={{ width: '100%', height: 10 }}><span style={{ width: `${(x.reservations / total) * 100}%` }} /></div></div>
                <b className="mono" style={{ minWidth: 30, textAlign: 'right' }}>{x.reservations}</b>
              </div>))}</div>
            <p className="tiny muted">{total} online reservations (OpenTable widget, GA4). {lost ? `${lost} (${Math.round((lost / total) * 100)}%) lost their original source when the guest moved from dosbuhos.com to OpenTable, so ad results are probably undercounted. ` : ''}Phone and walk-in bookings are not included.</p>
          </div>
        )}
      </section>
      <section className="section">
        <div className="list">{(data.campaigns as any[]).map(c => {
          const approved = data.approved.includes(c.ref);
          return (
            <article key={c.ref} className="item">
              <div className="top"><b>{c.name}</b><span className="row"><span className="chip">{c.provider === 'meta_ads' ? 'Meta' : 'Google'}</span><span className={`state ${c.status === 'ENABLED' || c.status === 'ACTIVE' ? 's-ok' : 's-mute'}`}>{c.status.toLowerCase() || 'unknown'}</span></span></div>
              <div className="kv">
                <div><span>Spend, 28 days</span><b>{microsMoney(c.spendMicros, cur)}</b></div>
                <div><span>Clicks</span><b>{int(c.clicks)}</b></div>
                <div><span>{c.provider === 'meta_ads' ? 'Meta results' : 'Google conversions'}</span><b>{c.convMilli === null ? '—' : (c.convMilli / 1000).toFixed(1)}</b></div>
                <div><span>Opened OpenTable availability</span><b>{c.openedAvailability ?? '—'}</b></div>
                <div><span>Online reservations</span><b>{c.reservations ?? '—'}</b></div>
                <div><span>Cost per reservation</span><b>{c.costPerReservationMinor === null ? '—' : money(c.costPerReservationMinor, cur)}</b></div>
                <div><span>Daily budget</span><b>{microsMoney(c.budgetMicros, cur)}</b></div>
              </div>
              {c.note && <div className="tiny muted">{c.note}</div>}
              {c.costPerReservationMinor !== null && <div className="tiny muted">Spend {microsMoney(c.trackedSpendMicros, cur)} on the days GA4 tracked reservations ÷ {c.reservations} reservation(s). Session attribution; not proof the ads caused them.</div>}
              <div className="tiny muted">Managed by {c.managedBy}{approved ? ' · the app may change it' : ' · the app will not change it'}</div>
            </article>
          );
        })}</div>
        {data.unmatchedGoogleAds > 0 && <p className="tiny muted">{data.unmatchedGoogleAds} reservation(s) came from Google Ads campaigns not in the current list (renamed or removed).</p>}
      </section>
    </>
  );
}

export function Experiments() {
  const { data, error } = useApi('experiments', 300_000);
  if (!data) return error ? <ErrorBox error={error} /> : <div className="section"><Loading /></div>;
  const groups: [string, string][] = [['active', 'Active'], ['planned', 'Planned'], ['completed', 'Completed'], ['inconclusive', 'Inconclusive'], ['failed', 'Failed'], ['stopped', 'Stopped']];
  return (
    <section className="section">
      <header><h2>Experiments</h2></header>
      <p className="small muted">Failed and inconclusive tests stay here so ideas are not retried without new evidence. Conclusions are reviewed again after their review date. Before/after comparisons are observational, not proof.</p>
      {groups.map(([k, label]) => {
        const xs = (data.experiments as any[]).filter(e => e.status === k);
        if (!xs.length) return null;
        return <div key={k} className="section"><h3>{label}</h3><div className="list" style={{ marginTop: 6 }}>{xs.map(e => (
          <article key={e.id} className="item">
            <div className="top"><b>{e.title}</b><span className="chip">{e.start_date}{e.end_date ? ` → ${e.end_date}` : ' → ongoing'}</span></div>
            <div className="small">{e.hypothesis}</div>
            <div className="kv"><div><span>Primary metric</span><b>{e.primary_metric}</b></div><div><span>Cost so far / max</span><b>{microsMoney(e.spent_micros)} / {microsMoney(e.max_cost_micros)}</b></div><div><span>Maturation</span><b>{e.maturation_days} days</b></div><div><span>Next evaluation</span><b>{e.next_evaluation ?? '—'}</b></div></div>
            {e.result && <div className="small"><b>Result:</b> {e.result}</div>}
            <div className="small muted"><b>Limitations:</b> {e.limitations} · Stop-loss: {e.stop_loss}</div>
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
      <header><h2>Reports</h2><span className="small muted">Daily 08:00 and weekly Monday 08:30, San Miguel time</span></header>
      <p className="small muted">Numbers are computed first; the written summary may only restate them. If the AI is unavailable or adds a number that is not in the facts, the factual template is published instead.</p>
      <div className="list">{(data.reports as any[]).map(r => (
        <article key={r.id} className="item">
          <div className="top"><b>{r.kind === 'daily' ? 'Daily' : 'Weekly'} · {r.period_from} – {r.period_to}</b><span className="row"><span className="chip">{r.narrative_source === 'model' ? 'AI-written from facts' : 'Template'}</span><span className="chip">rev {r.revision}</span></span></div>
          <div className="tiny muted">Data cutoff {when(r.cutoff_at)}</div>
          {open === r.id && detail.data ? (
            <div className="stack">
              <pre className="narr">{detail.data.narrative}</pre>
              <div className="table-scroll"><table className="data"><thead><tr><th>Metric</th><th className="n">Value</th><th>Change</th><th>Basis</th></tr></thead>
                <tbody>{detail.data.facts.headline.map((h: any) => <tr key={h.key}><td>{h.label}</td><td className="n">{h.display}</td><td>{h.change}</td><td>{h.basis}{h.provisional ? ', provisional' : ''}</td></tr>)}</tbody></table></div>
              <a className="btn" href={`api/reports/${encodeURIComponent(r.id)}?format=csv`} download>Download CSV</a>
            </div>
          ) : <button className="btn" onClick={() => setOpen(r.id)}>Open</button>}
        </article>))}
        {(data.reports as any[]).length === 0 && <div className="item muted">No reports yet. The first daily report runs at 08:00.</div>}
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
        <header><h2>Connections and data quality</h2></header>
        <p className="small muted">Occasional reconnection is normal (revoked access, expired consent). Writes stop immediately when a required connection is not healthy. No passwords or keys are ever typed into this page or into chat; secrets are set by an administrator in Cloudflare.</p>
        <div className="list">{(data.connections as any[]).map(c => (
          <article key={c.id} className="item">
            <div className="top"><b>{c.purpose}</b><Health h={c.health} /></div>
            <div className="small">{c.health_reason}</div>
            <div className="tiny muted">{c.provider} · last success {ago(c.last_success_at)}{c.freshness_at ? ` · data as of ${when(c.freshness_at)}` : ''}{c.last_error ? ` · last error: ${c.last_error}` : ''}</div>
            {c.provider === 'google_ads_script' && isAdmin && (
              <div className="stack">
                <button className="btn" onClick={async () => { if (!confirm('Create a new feed token? The current one stops working.')) return; try { const r = await api('connections/google-ads-script/token', { method: 'POST' }); setToken(r.token); void reload(); } catch (e) { setMsg((e as Error).message); } }}>Create feed token</button>
                {token && <div className="notice small"><b>Shown once.</b> Paste into the Google Ads Script (Tools → Bulk actions → Scripts), then schedule it hourly:<div className="mono" style={{ overflowWrap: 'anywhere', marginTop: 6 }}>{token}</div></div>}
              </div>
            )}
          </article>))}</div>
      </section>
      <section className="section card stack">
        <h3>Worker secrets present</h3>
        <div className="kv">{Object.entries(data.secrets).map(([k, v]) => <div key={k}><span>{k}</span><b>{v ? 'set' : 'not set'}</b></div>)}</div>
      </section>
      <Ga4Setup ga4={data.ga4} isAdmin={isAdmin} onDone={m => { setMsg(m); void reload(); }} />
      <OpenTableImport onDone={m => { setMsg(m); void reload(); }} />
      <section className="section"><h3>Recent imports</h3><div className="list" style={{ marginTop: 6 }}>{(data.imports as any[]).map(i => <div key={i.id} className="item small"><div className="top"><b>{i.file_name}</b><span className="chip">{i.status}</span></div>{i.rows_ok} valid · {i.rows_duplicate} duplicate · {i.rows_error} errors · {when(i.created_at)} by {i.created_by}</div>)}{!(data.imports as any[]).length && <div className="item muted small">No imports yet.</div>}</div></section>
      {msg && <div className="toast" role="status" onClick={() => setMsg(null)}>{msg}</div>}
    </>
  );
}

function Ga4Setup({ ga4, isAdmin, onDone }: { ga4: { propertyId: string | null; serviceAccountEmail: string | null }; isAdmin: boolean; onDone: (m: string) => void }) {
  const [pid, setPid] = useState(ga4?.propertyId ?? '');
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { const r = await api('connections/ga4', { method: 'POST', body: { propertyId: pid.trim() } }); onDone(r.synced ? `GA4 connected: ${r.reservations} online reservations loaded.` : r.message); } catch (e) { onDone((e as Error).message); } finally { setBusy(false); } };
  const sync = async () => { setBusy(true); try { const r = await api('control/sync-now', { method: 'POST' }); onDone(r.ga4?.error ? `GA4: ${r.ga4.error}` : r.ga4 ? `Synced: ${r.ga4.reservations} online reservations.` : 'Google Ads synced; GA4 not configured yet.'); } catch (e) { onDone((e as Error).message); } finally { setBusy(false); } };
  return (
    <section className="section card stack">
      <h3>OpenTable online reservations (via Google Analytics)</h3>
      <p className="small muted">OpenTable already sends each online reservation to your GA4 as <span className="mono">ot-reservation-made</span>. Growth reads the daily counts by traffic source, read-only. Phone and walk-in bookings and later cancellations are not included.</p>
      <div className="kv">
        <div><span>Service account (GA4_SA_KEY secret)</span><b>{ga4?.serviceAccountEmail ?? 'not set'}</b></div>
        <div><span>GA4 property</span><b>{ga4?.propertyId ?? 'not set'}</b></div>
      </div>
      {ga4?.serviceAccountEmail && <div className="tiny muted">In GA4 → Admin → Property access management, this email needs the Viewer role.</div>}
      {isAdmin && <div className="row">
        <label className="field" style={{ flex: '1 1 200px' }}>GA4 property ID (digits)<input inputMode="numeric" value={pid} onChange={e => setPid(e.target.value.replace(/[^0-9]/g, ''))} /></label>
        <button className="btn primary" disabled={busy || !pid} onClick={() => void save()}>Save and sync</button>
        <button className="btn" disabled={busy} onClick={() => void sync()}>Sync now</button>
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
    try { const r = await api(`imports/${preview.importId}/commit`, { method: 'POST' }); onDone(`Imported ${r.rows} bookings.`); setPreview(null); setCsv(null); } catch (e) { onDone((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="section card stack">
      <h3>Import OpenTable reservations</h3>
      <p className="small muted">OpenTable does not offer a reservation API to restaurants, so bookings come from a GuestCenter export (Reporting → Reservations → Export CSV). Names, phones, emails and notes are ignored. Re-importing the same file never duplicates bookings; newer exports update statuses (cancellations, no-shows).</p>
      <div className="form-grid">
        <label className="field">CSV file<input type="file" accept=".csv,text/csv" onChange={async e => { const f = e.target.files?.[0]; if (f) { setCsv({ name: f.name, text: await f.text() }); setPreview(null); } }} /></label>
        <label className="field">Times in the file are in<select value={m.timezone} onChange={e => setM({ ...m, timezone: e.target.value })}><option>America/Mexico_City</option><option>America/Chicago</option><option>America/Los_Angeles</option><option>UTC</option></select></label>
        <label className="field">Date format<select value={m.dateFormat} onChange={e => setM({ ...m, dateFormat: e.target.value })}><option value="mdy">MM/DD/YYYY</option><option value="dmy">DD/MM/YYYY</option><option value="iso">YYYY-MM-DD</option></select></label>
        <label className="field">Currency<select value={m.currency} onChange={e => setM({ ...m, currency: e.target.value })}><option>MXN</option><option>USD</option></select></label>
      </div>
      <div className="row"><button className="btn" disabled={!csv || busy} onClick={() => void run()}>Preview</button></div>
      {preview && (
        <div className="stack">
          {preview.missingColumns.length > 0 && <div className="notice bad small">Missing columns: {preview.missingColumns.join(', ')}. Columns found: {preview.headers.join(', ')}</div>}
          <div className="kv"><div><span>Rows</span><b>{preview.total}</b></div><div><span>Valid</span><b>{preview.valid}</b></div><div><span>Updates existing</span><b>{preview.updatesExisting}</b></div><div><span>Duplicates in file</span><b>{preview.duplicatesInFile}</b></div><div><span>Row errors</span><b>{preview.errors.length}</b></div></div>
          {preview.errors.length > 0 && <details className="why"><summary>Row errors</summary><ul className="small">{preview.errors.slice(0, 50).map((e: any, i: number) => <li key={i}>Row {e.row}{e.column ? ` (${e.column})` : ''}: {e.message}</li>)}</ul></details>}
          {preview.sample.length > 0 && <div className="table-scroll"><table className="data"><thead><tr><th>Confirmation</th><th>Product</th><th>Service (UTC)</th><th className="n">Party</th><th>Status</th><th>Source</th></tr></thead><tbody>{preview.sample.map((b: any) => <tr key={b.id}><td className="mono">{b.externalId}</td><td>{PRODUCT_LABEL[b.product]}</td><td className="mono">{b.serviceAt.slice(0, 16)}</td><td className="n">{b.partySize}</td><td>{b.status}</td><td>{b.channel}</td></tr>)}</tbody></table></div>}
          <button className="btn primary" disabled={busy || !preview.valid} onClick={() => void commit()}>Import {preview.valid} bookings</button>
        </div>
      )}
    </section>
  );
}
