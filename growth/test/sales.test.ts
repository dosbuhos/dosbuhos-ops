// Sales across both points of sale: the Wansoft history file, the hand-over to Parrot, and the comparison with the same weeks last year.
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { parseHistoryCsv, loadSales, yearOverYear, isCovered, HISTORY_COLUMNS, type SalesSeries, type SalesDay } from '../src/read/sales.ts';
import { addDays, dateRange } from '../src/domain/time.ts';

function fakeD1(db: DatabaseSync): D1Database {
  const stmt = (sql: string, binds: unknown[] = []) => ({
    bind: (...b: unknown[]) => stmt(sql, b),
    all: async () => ({ results: db.prepare(sql).all(...(binds as never[])) }),
    first: async () => db.prepare(sql).get(...(binds as never[])) ?? null,
  });
  return { prepare: (sql: string) => stmt(sql) } as unknown as D1Database;
}
const HEAD = HISTORY_COLUMNS.join(',');
const day = (net: number, comparable = net): SalesDay => ({ netMinor: net, comparableMinor: comparable, orders: 1, guests: null });

describe('history file', () => {
  it('reads one line per day and turns pesos into cents', () => {
    const r = parseHistoryCsv(`﻿${HEAD}\n2025-11-01,35,70,59035.34,68481.00,31672.41,2945.42,2.00\n2025-11-02,6,,9871.55,11451,5274.14,0,0\n`);
    expect(r.errors).toEqual([]);
    expect(r.rows[0]).toEqual({ date: '2025-11-01', orders: 35, guests: 70, netMinor: 5903534, totalMinor: 6848100, dineInNetMinor: 3167241, tipsMinor: 294542, discountsMinor: 200 });
    expect(r.rows[1]!.guests).toBeNull();
  });
  it('refuses a file with another layout', () => {
    expect(parseHistoryCsv('Día,Fecha,Total\njueves,2025/11/01,100').errors[0]!.message).toContain('encabezado');
  });
  it('points at the bad line instead of loading it', () => {
    const r = parseHistoryCsv(`${HEAD}\n2025-02-30,1,1,10,11,5,0,0\n2025-03-01,1,1,-10,11,5,0,0\n2025-03-02,1,1,12,11,5,0,0\n2025-03-03,1,1,10,11.6,5,0,0\n2025-03-03,1,1,10,11.6,5,0,0\n2025-03-04,1.5,1,10,11.6,5,0,0`);
    expect(r.rows.map(x => x.date)).toEqual(['2025-03-03']);
    expect(r.errors.map(e => e.row)).toEqual([2, 3, 4, 6, 7]);
  });
});

describe('same weeks last year', () => {
  const series = (days: [string, SalesDay][], over: Partial<SalesSeries> = {}): SalesSeries => ({ days: new Map(days), to: '2026-11-21', parrotFrom: '2026-08-11', historyFrom: '2022-09-01', historyTo: '2026-08-09', ...over });
  const win = dateRange('2026-10-25', '2026-11-21');
  it('compares each day with the same weekday 52 weeks earlier', () => {
    const s = series([['2026-11-21', day(120_000_00)], ['2026-11-01', day(80_000_00)], ['2025-11-22', day(100_000_00)], ['2025-11-02', day(60_000_00)]]);
    const y = yearOverYear(s, win)!;
    expect(y.currentMinor).toBe(200_000_00); expect(y.lastYearMinor).toBe(160_000_00); expect(y.percent).toBeCloseTo(25, 5);
    expect(y.lastYearFrom).toBe('2025-10-26'); expect(y.lastYearTo).toBe('2025-11-22');
  });
  it('leaves private events out, because the old point of sale never had them', () => {
    const s = series([['2026-11-21', day(300_000_00, 120_000_00)], ['2025-11-22', day(100_000_00)]]);
    const y = yearOverYear(s, win)!;
    expect(y.currentMinor).toBe(120_000_00); expect(y.eventsExcludedMinor).toBe(180_000_00); expect(y.percent).toBeCloseTo(20, 5);
  });
  it('says nothing when last year is not on record', () => {
    expect(yearOverYear(series([['2026-11-21', day(100)]], { historyFrom: null, historyTo: null }), win)).toBeNull();
    expect(yearOverYear(series([['2026-11-21', day(100)]], { historyFrom: '2025-11-10' }), win)).toBeNull();          // history starts inside last year's window
    expect(yearOverYear(series([['2026-11-21', day(100)]]), win)).toBeNull();                                        // on record, but nothing sold: no percentage
  });
  it('treats the closed days between the two systems as covered, and a real hole as missing', () => {
    expect(isCovered(series([]), '2026-08-10')).toBe(true);
    expect(isCovered(series([], { historyTo: '2026-06-30' }), '2026-07-15')).toBe(false);
    expect(isCovered(series([]), '2026-11-22')).toBe(false);                                                          // after the last day read
  });
});

describe('both points of sale in one series', () => {
  it('uses the history before Parrot starts and Parrot from then on', async () => {
    const db = new DatabaseSync(':memory:');
    for (const f of ['0010_parrot_pos.sql', '0011_pos_daily_history.sql']) db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8').replace(/^INSERT OR IGNORE INTO connections.*$/m, ''));
    db.exec(`INSERT INTO pos_daily_history (local_date, source, orders, guests, net_minor, total_minor, loaded_at) VALUES ('2026-08-09', 'wansoft', 40, 90, 5000000, 5800000, 0), ('2026-08-12', 'wansoft', 1, 1, 999, 999, 0);
      INSERT INTO pos_orders (uuid, store_uuid, created_at, local_date, status, order_type, total_minor, taxes_minor, fetched_at) VALUES ('o1', 's', 0, '2026-08-12', 'FINISHED', 'DINE_IN', 1160000, 160000, 0), ('o2', 's', 0, '2026-08-12', 'FINISHED', 'TAKE_OUT', 580000, 80000, 0), ('o3', 's', 0, '2026-08-12', 'VOIDED', 'TAKE_OUT', 0, 0, 0);
      INSERT INTO pos_items (uuid, order_uuid, local_date, item_name, category, quantity, total_minor, subtotal_minor, fetched_at) VALUES ('i1', 'o2', '2026-08-12', 'Boda', 'Eventos', 1, 580000, 500000, 0), ('i2', 'o1', '2026-08-12', 'Pizza', 'Pizzas', 1, 1160000, 1000000, 0);`);
    const s = await loadSales(fakeD1(db), '2026-08-01', '2026-08-31');
    expect(s.parrotFrom).toBe('2026-08-12'); expect(s.historyFrom).toBe('2026-08-09');
    expect(s.days.get('2026-08-09')).toEqual({ netMinor: 5000000, comparableMinor: 5000000, orders: 40, guests: 90 });
    expect(s.days.get('2026-08-12')).toEqual({ netMinor: 1500000, comparableMinor: 1000000, orders: 2, guests: null });   // Parrot wins over a history row on its own days; the event is left out
    expect(addDays('2026-08-12', -364)).toBe('2025-08-13');
  });
});
