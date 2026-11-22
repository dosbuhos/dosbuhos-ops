// Sales per business day across both points of sale, so a period can be compared with the same weeks a year earlier.
// Wansoft history (pos_daily_history) covers the days before Parrot's first order; Parrot (pos_orders) covers the rest.
// Net is without IVA and after discounts. "Comparable" leaves out Parrot's "Eventos" category: private events were
// never rung up in Wansoft, so counting them would overstate growth against last year.
import { addDays, daysBetween, LOCAL_DATE, type LocalDate } from '../domain/time.ts';

export const HISTORY_SOURCE = 'wansoft';
export const EVENTS_CATEGORY = 'Eventos';
/** 52 weeks back, so every day is compared with the same weekday. */
export const YEAR_BACK_DAYS = 364;
/** Closed days (Monday and Tuesday) may sit between the last Wansoft day and the first Parrot day. */
const MAX_HANDOVER_GAP_DAYS = 4;

export interface SalesDay { netMinor: number; comparableMinor: number; orders: number; guests: number | null }
export interface SalesSeries { days: Map<LocalDate, SalesDay>; to: LocalDate; parrotFrom: LocalDate | null; historyFrom: LocalDate | null; historyTo: LocalDate | null }
export interface YearOverYear { currentMinor: number; lastYearMinor: number; absoluteMinor: number; percent: number; from: LocalDate; to: LocalDate; lastYearFrom: LocalDate; lastYearTo: LocalDate; eventsExcludedMinor: number }

export async function loadSales(db: D1Database, from: LocalDate, to: LocalDate): Promise<SalesSeries> {
  const none = <T>() => ({ results: [] as T[] });
  const [pb, hb, parrot, events, history] = await Promise.all([
    db.prepare('SELECT MIN(local_date) AS d FROM pos_orders').first<{ d: string | null }>().catch(() => null),
    db.prepare('SELECT MIN(local_date) AS a, MAX(local_date) AS b FROM pos_daily_history').first<{ a: string | null; b: string | null }>().catch(() => null),
    db.prepare(`SELECT local_date AS date, COUNT(*) AS orders, SUM(total_minor - taxes_minor) AS net FROM pos_orders
      WHERE status = 'FINISHED' AND local_date BETWEEN ? AND ? GROUP BY local_date`).bind(from, to).all<{ date: string; orders: number; net: number }>().catch(() => none<{ date: string; orders: number; net: number }>()),
    db.prepare(`SELECT i.local_date AS date, SUM(COALESCE(i.subtotal_minor, CAST(ROUND(i.total_minor / 1.16) AS INTEGER))) AS net FROM pos_items i JOIN pos_orders o ON o.uuid = i.order_uuid
      WHERE o.status = 'FINISHED' AND i.category = ? AND i.local_date BETWEEN ? AND ? GROUP BY i.local_date`).bind(EVENTS_CATEGORY, from, to).all<{ date: string; net: number }>().catch(() => none<{ date: string; net: number }>()),
    db.prepare('SELECT local_date AS date, orders, guests, net_minor AS net FROM pos_daily_history WHERE local_date BETWEEN ? AND ?').bind(from, to)
      .all<{ date: string; orders: number; guests: number | null; net: number }>().catch(() => none<{ date: string; orders: number; guests: number | null; net: number }>()),
  ]);
  const parrotFrom = pb?.d ?? null;
  const days = new Map<LocalDate, SalesDay>();
  for (const r of history.results) if (!parrotFrom || r.date < parrotFrom) days.set(r.date, { netMinor: Number(r.net) || 0, comparableMinor: Number(r.net) || 0, orders: Number(r.orders) || 0, guests: r.guests === null ? null : Number(r.guests) });
  const ev = new Map(events.results.map(r => [r.date, Number(r.net) || 0]));
  for (const r of parrot.results) { const net = Number(r.net) || 0; days.set(r.date, { netMinor: net, comparableMinor: Math.max(0, net - (ev.get(r.date) ?? 0)), orders: Number(r.orders) || 0, guests: null }); }
  return { days, to, parrotFrom, historyFrom: hb?.a ?? null, historyTo: hb?.b ?? null };
}

/** True when a missing row on that day means "closed", not "nobody was recording". */
export function isCovered(s: SalesSeries, d: LocalDate): boolean {
  if (d > s.to) return false;
  if (s.parrotFrom && d >= s.parrotFrom) return true;
  if (!s.historyFrom || !s.historyTo || d < s.historyFrom) return false;
  if (d <= s.historyTo) return true;
  return !!s.parrotFrom && daysBetween(s.historyTo, s.parrotFrom) <= MAX_HANDOVER_GAP_DAYS;
}

/** The same days 52 weeks earlier, like for like. Null unless both periods are fully recorded and last year sold something. */
export function yearOverYear(s: SalesSeries, dates: LocalDate[]): YearOverYear | null {
  if (!dates.length) return null;
  let cur = 0, prev = 0, events = 0;
  for (const d of dates) {
    const p = addDays(d, -YEAR_BACK_DAYS);
    if (!isCovered(s, d) || !isCovered(s, p)) return null;
    const a = s.days.get(d), b = s.days.get(p);
    cur += a?.comparableMinor ?? 0; events += (a?.netMinor ?? 0) - (a?.comparableMinor ?? 0); prev += b?.comparableMinor ?? 0;
  }
  if (prev <= 0) return null;
  const sorted = [...dates].sort();
  const from = sorted[0]!, to = sorted[sorted.length - 1]!;
  return { currentMinor: cur, lastYearMinor: prev, absoluteMinor: cur - prev, percent: ((cur - prev) / prev) * 100, from, to, lastYearFrom: addDays(from, -YEAR_BACK_DAYS), lastYearTo: addDays(to, -YEAR_BACK_DAYS), eventsExcludedMinor: events };
}

// ---------- Loading the history file ----------

export interface HistoryRow { date: LocalDate; orders: number; guests: number | null; netMinor: number; totalMinor: number; dineInNetMinor: number; tipsMinor: number; discountsMinor: number }
export const HISTORY_COLUMNS = ['fecha', 'ordenes', 'comensales', 'venta_sin_iva', 'venta_con_iva', 'restaurante_sin_iva', 'propinas', 'descuentos'] as const;

/** CSV prepared from Wansoft's daily sales report: one line per business day, amounts in pesos with decimals. */
export function parseHistoryCsv(text: string): { rows: HistoryRow[]; errors: { row: number; message: string }[] } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const errors: { row: number; message: string }[] = [], rows: HistoryRow[] = [], seen = new Set<string>();
  const head = (lines[0] ?? '').toLowerCase().split(',').map(h => h.trim());
  if (HISTORY_COLUMNS.some((c, i) => head[i] !== c)) return { rows, errors: [{ row: 1, message: `El encabezado debe ser: ${HISTORY_COLUMNS.join(',')}` }] };
  const cents = (v: string) => Math.round(Number(v) * 100);
  lines.slice(1).forEach((line, i) => {
    const row = i + 2, p = line.split(',').map(x => x.trim());
    if (p.length !== HISTORY_COLUMNS.length) return void errors.push({ row, message: `Tiene ${p.length} columnas; deben ser ${HISTORY_COLUMNS.length}` });
    const [date, orders, guests, net, total, dineIn, tips, discounts] = p as [string, string, string, string, string, string, string, string];
    if (!LOCAL_DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) return void errors.push({ row, message: `Fecha inválida: ${date}` });
    if (seen.has(date)) return void errors.push({ row, message: `La fecha ${date} está repetida` });
    const nums = [orders, guests === '' ? '0' : guests, net, total, dineIn, tips, discounts].map(Number);
    if (nums.some(n => !Number.isFinite(n) || n < 0)) return void errors.push({ row, message: 'Hay un número inválido o negativo' });
    if (!Number.isInteger(Number(orders)) || (guests !== '' && !Number.isInteger(Number(guests)))) return void errors.push({ row, message: 'Órdenes y comensales deben ser enteros' });
    if (cents(net) > cents(total)) return void errors.push({ row, message: 'La venta sin IVA no puede ser mayor que la venta con IVA' });
    seen.add(date);
    rows.push({ date, orders: Number(orders), guests: guests === '' ? null : Number(guests), netMinor: cents(net), totalMinor: cents(total), dineInNetMinor: cents(dineIn), tipsMinor: cents(tips), discountsMinor: cents(discounts) });
  });
  return { rows, errors };
}
