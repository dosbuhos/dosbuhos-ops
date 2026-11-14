import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { useApi } from './api';
import { MODE_INFO, ago } from './format';
import { Overview } from './views/Overview';
import { Capacity } from './views/Capacity';
import { Activity, Controls } from './views/Operate';
import { Campaigns, Experiments, Reports, Connections } from './views/Data';

const VIEWS = [
  ['overview', 'Overview'], ['campaigns', 'Campaigns'], ['capacity', 'Capacity'], ['experiments', 'Experiments'],
  ['activity', 'Agent activity'], ['reports', 'Reports'], ['connections', 'Connections'], ['controls', 'Controls'],
] as const;
type View = (typeof VIEWS)[number][0];

function readTheme(): 'dark' | 'light' { try { return localStorage.getItem('growth-theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } }

function App() {
  const [view, setView] = useState<View>(() => (VIEWS.find(v => `#${v[0]}` === location.hash)?.[0] ?? 'overview'));
  const [theme, setTheme] = useState(readTheme);
  const session = useApi('session', 120_000);
  const overview = useApi('overview', 90_000);
  useEffect(() => { const f = () => setView((VIEWS.find(v => `#${v[0]}` === location.hash)?.[0] ?? 'overview')); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('growth-theme', theme); } catch { /* private mode */ } }, [theme]);
  useEffect(() => { document.title = `${VIEWS.find(v => v[0] === view)?.[1]} · Growth Terminal`; window.scrollTo(0, 0); }, [view]);

  const s = session.data, o = overview.data;
  const demo = (s?.dataKind ?? o?.dataKind) === 'demo';
  const mode = s?.coordinator?.mode ?? o?.coordinator?.mode;
  const mi = mode ? MODE_INFO[mode] : null;
  const lastOpt = o?.markers?.length ? o.markers[o.markers.length - 1].date : null;
  const needsMe = (o?.alerts ?? []).filter((a: any) => a.severity !== 'info').length;

  return (
    <>
      <div className="strip">
        <div className="strip-in">
          <div className="brand">Growth Terminal <small>Dos Búhos</small></div>
          {s || o ? <span className={`badge ${demo ? 'demo' : 'real'}`} title={demo ? 'Synthetic data — not real results' : 'Real data'}>{demo ? '⚠ DEMO DATA' : '● REAL DATA'}</span> : null}
          {mi && <span className={`state ${mi.cls}`} title={mi.text}>{mi.label}</span>}
          {s?.coordinator?.aiStopped && <span className="state s-warn">AI stopped</span>}
          <div className="meta">
            <span>Account <b>{s?.account ? `${s.account.id}${demo ? ' (synthetic)' : ''}` : 'not connected'}</b></span>
            <span>Spend data <b>{ago(o?.lastRefresh)}</b></span>
            <span>Last change <b>{lastOpt ?? 'none'}</b></span>
            <span>Attribution coverage <b>{o?.quality?.attributionCoverage ?? '—'}%</b></span>
            <span>Refreshed <b>{ago(overview.loadedAt)}</b></span>
            <button className="iconbtn" style={{ marginLeft: 'auto' }} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>{theme === 'dark' ? '☀ Light' : '☾ Dark'}</button>
          </div>
        </div>
      </div>
      <nav className="tabs" aria-label="Sections">
        {VIEWS.map(([k, label]) => <a key={k} href={`#${k}`} aria-current={view === k ? 'page' : undefined}>{label}{k === 'overview' && needsMe > 0 && <span className="dot" aria-label={`${needsMe} need attention`} />}</a>)}
      </nav>
      <main className="wrap">
        {demo && <div className="notice section" role="note"><b>Demonstration.</b> Every number here is synthetic and the ad account is simulated. Real reporting starts when the Google Ads feed and an OpenTable export are connected (Connections).</div>}
        {view === 'overview' && <Overview o={o} error={overview.error} session={s} />}
        {view === 'campaigns' && <Campaigns />}
        {view === 'capacity' && <Capacity canEdit={s?.user?.role !== 'viewer'} />}
        {view === 'experiments' && <Experiments />}
        {view === 'activity' && <Activity isAdmin={s?.user?.role === 'admin'} />}
        {view === 'reports' && <Reports />}
        {view === 'connections' && <Connections isAdmin={s?.user?.role === 'admin'} />}
        {view === 'controls' && <Controls session={s} reload={() => { void session.reload(); void overview.reload(); }} />}
        <p className="tiny muted section">Charts: TradingView Lightweight Charts (Apache-2.0). Times in San Miguel de Allende (America/Mexico_City). Updates every 90 s from stored provider data — not a live auction feed.</p>
      </main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
