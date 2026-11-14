// Weekly summary email (Spanish, plain numbers). Deterministic: no AI, only stored data. Sent Monday morning through
// Resend (same pattern as spark/). Missing data is said in words, never shown as zero.
import { addDays, localDate, weekStart, type LocalDate } from '../domain/time.ts';
import { RESERVATION_EVENT, isAiAssistant, isBrandQuery, isGoogleAds, isMetaAds } from '../connectors/ga4.ts';
import { loadEstimates } from '../read/estimates.ts';

export interface WeekNumbers {
  from: LocalDate; to: LocalDate;
  googleSpendMinor: number; metaSpendMinor: number;
  reservations: number | null; google: number | null; meta: number | null; ai: number | null; lostSource: number | null;
  ga4Days: number;                       // days in the week GA4 has data for (7 = complete)
}

const sumSpend = async (db: D1Database, provider: string, from: LocalDate, to: LocalDate) =>
  Number((await db.prepare('SELECT COALESCE(SUM(d.cost_micros), 0) AS c FROM campaign_daily d JOIN ad_accounts a ON a.id = d.account_id WHERE a.provider = ? AND d.date BETWEEN ? AND ?').bind(provider, from, to).first<{ c: number }>())?.c ?? 0) / 10_000;

export async function weekNumbers(db: D1Database, from: LocalDate, to: LocalDate): Promise<WeekNumbers> {
  const rows = (await db.prepare('SELECT date, source, medium, SUM(events) AS n FROM ga4_reservations_daily WHERE event_name = ? AND date BETWEEN ? AND ? GROUP BY date, source, medium').bind(RESERVATION_EVENT, from, to).all<{ date: string; source: string; medium: string; n: number }>().catch(() => ({ results: [] }))).results;
  const days = (await db.prepare('SELECT COUNT(DISTINCT date) AS n FROM ga4_reservations_daily WHERE date BETWEEN ? AND ?').bind(from, to).first<{ n: number }>().catch(() => null))?.n ?? 0;
  const count = (f: (s: string, m: string) => boolean) => (days ? rows.filter(r => f(r.source, r.medium)).reduce((a, r) => a + Number(r.n), 0) : null);
  return {
    from, to, ga4Days: Number(days),
    googleSpendMinor: Math.round(await sumSpend(db, 'google_ads', from, to)), metaSpendMinor: Math.round(await sumSpend(db, 'meta_ads', from, to)),
    reservations: count(() => true), google: count(isGoogleAds), meta: count(isMetaAds), ai: count(isAiAssistant),
    lostSource: count((s, m) => /dosbuhos\.com/i.test(s) && /referral/i.test(m) || s === '(not set)'),
  };
}

const mx = (minor: number | null | undefined) => (minor === null || minor === undefined ? 'sin dato' : `MX$${Math.round(minor / 100).toLocaleString('en-US')}`);
const n = (x: number | null) => (x === null ? 'sin dato' : String(x));
const chg = (a: number | null, b: number | null) => (a === null || b === null ? '' : b === 0 ? (a ? ' (antes 0)' : '') : ` (${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)}% vs. semana anterior)`);
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** The email for the week (Mon–Sun) before `now`. */
export async function buildWeeklyEmail(db: D1Database, now: number, tz: string, appUrl: string): Promise<{ subject: string; text: string; html: string }> {
  const thisMonday = weekStart(localDate(now, tz));
  const from = addDays(thisMonday, -7), to = addDays(thisMonday, -1);
  const [w, p, est] = await Promise.all([weekNumbers(db, from, to), weekNumbers(db, addDays(from, -7), addDays(to, -7)), loadEstimates(db)]);
  const perRes = est.current.restaurant_visit?.valueMinor ?? null, perContrib = est.contribution.restaurant_visit ?? null;
  const cpr = w.google ? Math.round(w.googleSpendMinor / w.google) : null, cprPrev = p.google ? Math.round(p.googleSpendMinor / p.google) : null;
  const contrib = w.google !== null && perContrib !== null ? w.google * perContrib - w.googleSpendMinor : null;

  const terms = (await db.prepare('SELECT query, SUM(sessions) AS s, SUM(reservations) AS r, SUM(ad_cost_micros) AS c, COUNT(ad_cost_micros) AS wc FROM ga4_ads_queries WHERE date BETWEEN ? AND ? GROUP BY query').bind(from, to).all<{ query: string; s: number; r: number; c: number | null; wc: number }>().catch(() => ({ results: [] }))).results;
  const withCost = terms.some(t => t.wc > 0), key = (t: { s: number; c: number | null }) => (withCost ? Number(t.c ?? 0) : Number(t.s));
  const brandShare = terms.length ? Math.round((terms.filter(t => isBrandQuery(t.query)).reduce((a, t) => a + key(t), 0) / Math.max(1, terms.reduce((a, t) => a + key(t), 0))) * 100) : null;

  const attention: string[] = [];
  for (const c of (await db.prepare("SELECT purpose, health, last_error FROM connections WHERE health IN ('limited', 'reconnect')").all<{ purpose: string; health: string; last_error: string | null }>()).results)
    attention.push(`Conexión con problemas: ${c.purpose}${c.last_error ? ` (${c.last_error.slice(0, 120)})` : ''}`);
  for (const a of (await db.prepare("SELECT title FROM alerts WHERE resolved_at IS NULL AND severity IN ('critical', 'warning') ORDER BY severity, opened_at LIMIT 5").all<{ title: string }>().catch(() => ({ results: [] }))).results) attention.push(a.title);
  const provisional = Object.values(est.costs.current).filter(c => c?.provisional).length;
  if (provisional) attention.push(`${provisional} costo(s) siguen como provisionales en Controles`);
  if (w.ga4Days < 7) attention.push(`GA4 tiene datos de ${w.ga4Days} de 7 días: las reservaciones de la semana están incompletas`);
  if (w.reservations && w.lostSource !== null && w.lostSource / w.reservations >= 0.25) attention.push(`${w.lostSource} de ${w.reservations} reservaciones perdieron su fuente (dosbuhos.com / referral): los anuncios probablemente se ven peor de lo que son`);

  const lines: [string, string][] = [
    ['Reservaciones en línea (widget de OpenTable)', `${n(w.reservations)}${chg(w.reservations, p.reservations)}`],
    ['  de Google Ads', `${n(w.google)}${chg(w.google, p.google)}`],
    ['  de anuncios de Meta', n(w.meta)],
    ['  de asistentes de IA', n(w.ai)],
    ['Gasto en Google Ads', `${mx(w.googleSpendMinor)}${chg(w.googleSpendMinor, p.googleSpendMinor)}`],
    ['Gasto en Meta', mx(w.metaSpendMinor)],
    ['Costo por reservación (Google Ads)', cpr === null ? 'sin reservaciones de Google esta semana' : `${mx(cpr)}${cprPrev !== null ? ` (antes ${mx(cprPrev)})` : ''}`],
    ['Contribución estimada después de Google Ads', contrib === null ? 'sin dato' : `${mx(contrib)} (ESTIMACIÓN: ${w.google} × ${mx(perContrib)} − gasto)`],
    ['Búsquedas de marca (“Dos Búhos”)', brandShare === null ? 'sin dato todavía' : `${brandShare}% del ${withCost ? 'gasto' : 'tráfico'} de búsqueda pagada`],
  ];
  const subject = `Growth Dos Búhos · semana ${from.slice(5)} a ${to.slice(5)}: ${n(w.reservations)} reservaciones en línea, ${mx(w.googleSpendMinor + w.metaSpendMinor)} en anuncios`;
  const notes = `Valores usados: ${mx(perRes)} por reservación del restaurante; contribución ${mx(perContrib)} después de costos variables (se ajustan en Controles). Solo cuenta reservaciones del widget en línea: no incluye teléfono ni clientes sin reservación.`;
  const text = [`Semana del ${from} al ${to}`, '', ...lines.map(([k, v]) => `${k}: ${v}`), '', attention.length ? 'Requiere atención:' : 'Nada requiere atención.', ...attention.map(a => `- ${a}`), '', notes, '', `Ver el tablero: ${appUrl}`].join('\n');
  const html = `<div style="font:15px/1.5 -apple-system,Segoe UI,Arial,sans-serif;color:#1a1a1a;max-width:620px">
<h2 style="font-weight:600;margin:0 0 4px">Semana del ${from} al ${to}</h2><p style="color:#666;margin:0 0 16px">Growth Terminal · Dos Búhos</p>
<table style="border-collapse:collapse;width:100%">${lines.map(([k, v]) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee;${k.startsWith('  ') ? 'padding-left:24px;color:#555' : ''}">${esc(k.trim())}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:600">${esc(v)}</td></tr>`).join('')}</table>
<h3 style="margin:20px 0 6px">${attention.length ? 'Requiere atención' : 'Nada requiere atención'}</h3>${attention.length ? `<ul>${attention.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
<p style="color:#666;font-size:13px">${esc(notes)}</p><p><a href="${esc(appUrl)}" style="color:#7a2e2e">Abrir el tablero</a></p></div>`;
  return { subject, text, html };
}

export async function sendViaResend(apiKey: string, from: string, to: string[], mail: { subject: string; text: string; html: string }, fetchFn: typeof fetch = fetch): Promise<void> {
  const r = await fetchFn('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ from, to, subject: mail.subject, text: mail.text, html: mail.html }) });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
}
