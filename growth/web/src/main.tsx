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
  ['overview', 'Resumen'], ['campaigns', 'Campañas'], ['capacity', 'Capacidad'], ['experiments', 'Experimentos'],
  ['activity', 'Actividad del agente'], ['reports', 'Reportes'], ['connections', 'Conexiones'], ['controls', 'Controles'],
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
          {s || o ? <span className={`badge ${demo ? 'demo' : 'real'}`} title={demo ? 'Datos sintéticos, no son resultados reales' : 'Datos reales'}>{demo ? '⚠ DATOS DE DEMO' : '● DATOS REALES'}</span> : null}
          {mi && <span className={`state ${mi.cls}`} title={mi.text}>{mi.label}</span>}
          {s?.coordinator?.aiStopped && <span className="state s-warn">IA detenida</span>}
          <div className="meta">
            <span>Cuenta <b>{s?.account ? `${s.account.id}${demo ? ' (sintética)' : ''}` : 'no conectada'}</b></span>
            <span>Datos de gasto <b>{ago(o?.lastRefresh)}</b></span>
            <span>Último cambio <b>{lastOpt ?? 'ninguno'}</b></span>
            <span>Cobertura de atribución <b>{o?.quality?.bookingsConnected === false ? 'n/d (sin fuente de reservaciones)' : `${o?.quality?.attributionCoverage ?? '—'}%`}</b></span>
            <span>Actualizado <b>{ago(overview.loadedAt)}</b></span>
            <button className="iconbtn" style={{ marginLeft: 'auto' }} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Cambiar a tema ${theme === 'dark' ? 'claro' : 'oscuro'}`}>{theme === 'dark' ? '☀ Claro' : '☾ Oscuro'}</button>
          </div>
        </div>
      </div>
      <nav className="tabs" aria-label="Secciones">
        {VIEWS.map(([k, label]) => <a key={k} href={`#${k}`} aria-current={view === k ? 'page' : undefined}>{label}{k === 'overview' && needsMe > 0 && <span className="dot" aria-label={`${needsMe} requieren atención`} />}</a>)}
      </nav>
      <main className="wrap">
        {demo && <div className="notice section" role="note"><b>Demostración.</b> Todos los números son sintéticos y la cuenta de anuncios es simulada. Esta copia local usa un conjunto de datos sintéticos.</div>}
        {view === 'overview' && <Overview o={o} error={overview.error} session={s} />}
        {view === 'campaigns' && <Campaigns />}
        {view === 'capacity' && <Capacity canEdit={s?.user?.role !== 'viewer'} />}
        {view === 'experiments' && <Experiments />}
        {view === 'activity' && <Activity isAdmin={s?.user?.role === 'admin'} />}
        {view === 'reports' && <Reports />}
        {view === 'connections' && <Connections isAdmin={s?.user?.role === 'admin'} />}
        {view === 'controls' && <Controls session={s} reload={() => { void session.reload(); void overview.reload(); }} />}
        <p className="tiny muted section">Gráficas: TradingView Lightweight Charts (Apache-2.0). Horas de San Miguel de Allende (America/Mexico_City). Se actualiza cada 90 s con los datos guardados de los proveedores; no es una transmisión en vivo de la subasta.</p>
      </main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
