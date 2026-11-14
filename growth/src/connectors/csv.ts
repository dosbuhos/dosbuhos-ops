// RFC 4180 CSV parsing and safe CSV export. Cell contents are untrusted data.

export function parseCsv(text: string, maxRows = 20_000): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', i = 0, quoted = false;
  const s = text.replace(/^﻿/, '');
  while (i < s.length) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i += 2; continue; } quoted = false; i++; continue; }
      cell += c; i++; continue;
    }
    if (c === '"' && cell === '') { quoted = true; i++; continue; }
    if (c === ',') { row.push(cell); cell = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; if (rows.length > maxRows) throw new Error(`More than ${maxRows} rows`); continue; }
    cell += c; i++;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}

/** Neutralize spreadsheet formula injection when exporting untrusted text. */
export function safeCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const toCsv = (header: string[], rows: unknown[][]) => [header.map(safeCell).join(','), ...rows.map(r => r.map(safeCell).join(','))].join('\r\n');
