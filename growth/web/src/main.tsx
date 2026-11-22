import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { useApi } from './api';
import { MODE_INFO, ago } from './format';
import { Today } from './views/Today';
import { Bookings } from './views/Bookings';
import { Overview } from './views/Overview';
import { Capacity } from './views/Capacity';
import { Activity, Controls } from './views/Operate';
import { Campaigns, Experiments, Reports, Connections, AiVisibility } from './views/Data';

// Six places, the same on a desktop and on a phone. Each one answers one question; a place with more than one screen
// shows them as tabs under its title. Ajustes is the gear in the top strip.
type Place = 'hoy' | 'campanas' | 'sugerencias' | 'reservaciones' | 'reportes' | 'ajustes';
const PLACES: { k: Place; label: string; icon: ReactNode }[] = [
  { k: 'hoy', label: 'Hoy', icon: <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" /> },
  { k: 'campanas', label: 'Campañas', icon: <path d="M4 10v4h3l6 4V6l-6 4H4ZM17 9a4 4 0 0 1 0 6M19.5 6.5a8 8 0 0 1 0 11" /> },
  { k: 'sugerencias', label: 'Sugerencias', icon: <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2.2h5c.1-1 .5-1.7 1.1-2.2A6 6 0 0 0 12 3Z" /> },
  { k: 'reservaciones', label: 'Reservaciones', icon: <path d="M5 6h14v14H5V6ZM5 10h14M9 3v4M15 3v4" /> },
  { k: 'reportes', label: 'Reportes', icon: <path d="M5 20V10M10 20V4M15 20v-7M20 20V8" /> },
];
const SUBS: Partial<Record<Place, [string, string][]>> = {
  reservaciones: [['origen', 'De dónde vienen'], ['capacidad', 'Próximos días']],
  reportes: [['tendencias', 'Tendencias'], ['reportes', 'Reportes'], ['experimentos', 'Experimentos']],
  ajustes: [['controles', 'Controles'], ['conexiones', 'Conexiones']],
};
// Addresses from before the six places (alerts and old bookmarks still use them).
const ALIAS: Record<string, [Place, string?]> = {
  overview: ['hoy'], campaigns: ['campanas'], capacity: ['reservaciones', 'capacidad'], experiments: ['reportes', 'experimentos'],
  activity: ['sugerencias'], reports: ['reportes', 'reportes'], connections: ['ajustes', 'conexiones'], controls: ['ajustes', 'controles'],
};
const TITLE: Record<Place, string> = { hoy: 'Hoy', campanas: 'Campañas', sugerencias: 'Sugerencias', reservaciones: 'Reservaciones', reportes: 'Reportes', ajustes: 'Ajustes' };

function route(): { place: Place; sub: string } {
  const [a = '', b] = location.hash.replace(/^#/, '').split('/');
  const [place, sub0] = ALIAS[a] ?? [(a in TITLE ? a : 'hoy') as Place, b];
  const subs = SUBS[place];
  return { place, sub: subs ? (subs.find(s => s[0] === sub0)?.[0] ?? subs[0]![0]) : '' };
}
function readTheme(): 'dark' | 'light' { try { return localStorage.getItem('growth-theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } }

function App() {
  const [r, setR] = useState(route);
  const [theme, setTheme] = useState(readTheme);
  const session = useApi('session', 120_000);
  const overview = useApi('overview', 90_000);
  useEffect(() => { const f = () => setR(route()); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('growth-theme', theme); } catch { /* private mode */ } }, [theme]);
  useEffect(() => { document.title = `${TITLE[r.place]} · Growth Terminal`; window.scrollTo(0, 0); }, [r.place, r.sub]);

  const s = session.data, o = overview.data;
  const demo = (s?.dataKind ?? o?.dataKind) === 'demo';
  const mode = s?.coordinator?.mode ?? o?.coordinator?.mode;
  const mi = mode ? MODE_INFO[mode] : null;
  const needsMe = (o?.alerts ?? []).filter((a: any) => a.severity !== 'info').length;
  const isAdmin = s?.user?.role === 'admin';
  const subs = SUBS[r.place];
  const reloadAll = () => { void session.reload(); void overview.reload(); };
  const link = (p: Place, extra?: ReactNode) => (
    <a key={p} href={`#${p}`} aria-current={r.place === p ? 'page' : undefined}>
      <svg viewBox="0 0 24 24" aria-hidden="true">{PLACES.find(x => x.k === p)!.icon}</svg><span>{TITLE[p]}</span>{extra}
    </a>);

  return (
    <>
      <div className="strip">
        <div className="strip-in">
          <a className="brand" href="#hoy">Growth Terminal <small>Dos Búhos</small></a>
          {demo && <span className="badge demo" title="Datos sintéticos, no son resultados reales">⚠ DATOS DE DEMO</span>}
          {mi && <span className={`state ${mi.cls}`} title={mi.text}>{mi.label}</span>}
          {s?.coordinator?.aiStopped && <span className="state s-warn">IA detenida</span>}
          <span className="fresh" title="Última lectura del gasto en las plataformas">Gasto leído {ago(o?.lastRefresh)}</span>
          <button className="iconbtn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={`Cambiar a tema ${theme === 'dark' ? 'claro' : 'oscuro'}`} title={theme === 'dark' ? 'Tema claro' : 'Tema oscuro'}>{theme === 'dark' ? '☀' : '☾'}</button>
          <a className="iconbtn gear" href="#ajustes" aria-label="Ajustes" aria-current={r.place === 'ajustes' ? 'page' : undefined} title="Ajustes">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM19 12l2-1-2-4-2 1-2-1V5h-4v2L9 8 7 7 5 11l2 1v2l-2 1 2 4 2-1 2 1v2h4v-2l2-1 2 1 2-4-2-1v-2Z" /></svg>
          </a>
        </div>
      </div>
      <nav className="places" aria-label="Secciones">
        {PLACES.map(p => link(p.k, p.k === 'hoy' && needsMe > 0 ? <i className="dot" aria-label={`${needsMe} requieren atención`} /> : null))}
      </nav>
      <main className="wrap">
        {demo && <div className="notice section" role="note"><b>Demostración.</b> Todos los números son sintéticos y la cuenta de anuncios es simulada.</div>}
        {subs && (
          <div className="subhead section">
            <h1>{TITLE[r.place]}</h1>
            <div className="subtabs" role="tablist">{subs.map(([k, label]) => <a key={k} role="tab" href={`#${r.place}/${k}`} aria-selected={r.sub === k}>{label}</a>)}</div>
          </div>)}
        {r.place === 'hoy' && <Today overview={o} session={s} />}
        {r.place === 'campanas' && <Campaigns />}
        {r.place === 'sugerencias' && <Activity isAdmin={isAdmin} session={s} />}
        {r.place === 'reservaciones' && r.sub === 'origen' && <Bookings overview={o} />}
        {r.place === 'reservaciones' && r.sub === 'capacidad' && <Capacity canEdit={s?.user?.role !== 'viewer'} />}
        {r.place === 'reportes' && r.sub === 'tendencias' && <Overview o={o} error={overview.error} session={s} needs={false} />}
        {r.place === 'reportes' && r.sub === 'reportes' && <><Reports /><AiVisibility /></>}
        {r.place === 'reportes' && r.sub === 'experimentos' && <Experiments />}
        {r.place === 'ajustes' && r.sub === 'controles' && <Controls session={s} reload={reloadAll} />}
        {r.place === 'ajustes' && r.sub === 'conexiones' && <Connections isAdmin={isAdmin} />}
        <p className="tiny muted section foot">Horas de San Miguel de Allende. Se actualiza cada 90 segundos con lo último que las plataformas han entregado; no es la subasta en vivo.{r.place === 'reportes' && r.sub === 'tendencias' ? ' Gráficas: TradingView Lightweight Charts (Apache-2.0).' : ''}</p>
      </main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
