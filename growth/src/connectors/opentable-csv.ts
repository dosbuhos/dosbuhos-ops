// OpenTable reservation export → bookings. OpenTable offers no reservation API to restaurants (partner-only; see
// docs/integrations.md), so a GuestCenter export is the supported path. The import is two-step: preview (validate,
// detect duplicates, show row errors) and commit. Time zone and date format are explicit — never guessed — and
// customer names, phones, emails and notes are dropped: they are not needed for measurement.
import { parseCsv } from './csv.ts';
import { zonedToUtc, localDate, assertTimeZone } from '../domain/time.ts';
import type { BookingStatus, Product } from '../domain/measurement.ts';

export interface OpenTableMapping {
  timezone: string;
  currency: 'MXN' | 'USD';
  dateFormat: 'iso' | 'mdy' | 'dmy';
  columns: { externalId: string; createdAt: string; serviceAt: string; partySize: string; status: string; experience?: string; quotedTotal?: string; source?: string };
}

export const DEFAULT_OPENTABLE_MAPPING: Omit<OpenTableMapping, 'timezone' | 'currency' | 'dateFormat'> = {
  columns: { externalId: 'Confirmation Number', createdAt: 'Date Made', serviceAt: 'Visit Date', partySize: 'Size', status: 'Status', experience: 'Experience', source: 'Source' },
};

export interface ImportedBooking {
  id: string; source: 'opentable_csv'; externalId: string; product: Product; experienceName: string;
  createdAtUtc: number; serviceAtUtc: number; serviceDate: string; sourceTz: string; partySize: number;
  status: BookingStatus; channel: string; currency: 'MXN' | 'USD'; quotedMinor: number | null; sourceUpdatedAt: number;
}
export interface RowError { row: number; column?: string; message: string }
export interface ImportPreview { headers: string[]; missingColumns: string[]; ok: ImportedBooking[]; duplicatesInFile: number; errors: RowError[]; total: number }

const PII_HEADER = /name|nombre|phone|tel[eé]fono|e-?mail|correo|note|nota|comment|comentario|allerg|guest\s*tag/i;

export function mapStatus(raw: string): BookingStatus | null {
  const s = raw.trim().toLowerCase();
  if (/no[\s-]?show|no se present/.test(s)) return 'no_show';
  if (/cancel/.test(s)) return 'cancelled';
  if (/done|complet|seated|finished|sentad|terminad|paid|pagad/.test(s)) return 'attended';
  if (/refund|reembols/.test(s)) return 'refunded';
  if (/booked|confirm|reserv|pending|pendiente|assigned|asignad|arrived|lleg/.test(s)) return 'confirmed';
  return null;
}

function productFor(experience: string): Product {
  const e = experience.trim().toLowerCase();
  if (!e) return 'restaurant_visit';
  if (/event|evento|boda|wedding|privad|private/.test(e)) return 'private_event';
  return 'tour_tasting';
}

/** Parse a local date-time in the configured format and zone. Returns UTC ms or an error message. */
export function parseLocal(raw: string, fmt: OpenTableMapping['dateFormat'], tz: string): number | string {
  const s = raw.trim();
  let y: number, mo: number, d: number, rest: string;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(.*)$/);
  if (m && fmt === 'iso') { y = +m[1]!; mo = +m[2]!; d = +m[3]!; rest = m[4]!; }
  else if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(.*)$/)) && fmt !== 'iso') {
    const a = +m[1]!, b = +m[2]!; y = +m[3]!; if (y < 100) y += 2000;
    [mo, d] = fmt === 'mdy' ? [a, b] : [b, a]; rest = m[4]!;
  } else return `“${s.slice(0, 40)}” is not a ${fmt === 'iso' ? 'YYYY-MM-DD' : fmt === 'mdy' ? 'MM/DD/YYYY' : 'DD/MM/YYYY'} date`;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return `“${s.slice(0, 40)}” has an impossible month/day`;
  let hh = 0, mm = 0;
  const t = rest.trim().replace(/^T/, '').match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?\s?m\.?)?/i);
  if (t) {
    hh = +t[1]!; mm = +t[2]!;
    const ap = t[3]?.toLowerCase().replace(/[.\s]/g, '');
    if (ap === 'pm' && hh < 12) hh += 12;
    if (ap === 'am' && hh === 12) hh = 0;
  } else if (rest.trim()) return `“${rest.trim().slice(0, 20)}” is not a time`;
  const date = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return zonedToUtc(date, hh, mm, tz);
}

function money(raw: string): number | null | string {
  const s = raw.trim().replace(/[$\s]|MXN|USD/gi, '');
  if (!s) return null;
  if (!/^-?\d{1,3}(,\d{3})*(\.\d{1,2})?$|^-?\d+(\.\d{1,2})?$/.test(s)) return `“${raw.slice(0, 20)}” is not an amount`;
  return Math.round(Number(s.replace(/,/g, '')) * 100);
}

export function previewOpenTable(csvText: string, mapping: OpenTableMapping, wineryTz: string, importedAt: number): ImportPreview {
  assertTimeZone(mapping.timezone); assertTimeZone(wineryTz);
  const rows = parseCsv(csvText);
  const headers = (rows[0] ?? []).map(h => h.trim());
  const body = rows.slice(1);
  const col = (name: string | undefined) => (name ? headers.indexOf(name) : -1);
  const required = ['externalId', 'createdAt', 'serviceAt', 'partySize', 'status'] as const;
  const missingColumns = required.filter(k => col(mapping.columns[k]) < 0).map(k => mapping.columns[k]);
  const out: ImportPreview = { headers: headers.filter(h => !PII_HEADER.test(h)), missingColumns, ok: [], duplicatesInFile: 0, errors: [], total: body.length };
  if (missingColumns.length) return out;
  const seen = new Set<string>();
  body.forEach((r, idx) => {
    const rowNo = idx + 2;
    const get = (k: keyof OpenTableMapping['columns']) => { const i = col(mapping.columns[k]); return i >= 0 ? (r[i] ?? '').slice(0, 200) : ''; };
    const errs: RowError[] = [];
    const ext = get('externalId').trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(ext)) errs.push({ row: rowNo, column: mapping.columns.externalId, message: 'Missing or invalid confirmation number' });
    const created = parseLocal(get('createdAt'), mapping.dateFormat, mapping.timezone);
    if (typeof created === 'string') errs.push({ row: rowNo, column: mapping.columns.createdAt, message: created });
    const service = parseLocal(get('serviceAt'), mapping.dateFormat, mapping.timezone);
    if (typeof service === 'string') errs.push({ row: rowNo, column: mapping.columns.serviceAt, message: service });
    const party = Number(get('partySize').trim());
    if (!Number.isInteger(party) || party < 1 || party > 500) errs.push({ row: rowNo, column: mapping.columns.partySize, message: 'Party size must be a whole number from 1 to 500' });
    const status = mapStatus(get('status'));
    if (!status) errs.push({ row: rowNo, column: mapping.columns.status, message: `Unknown status “${get('status').slice(0, 30)}”` });
    const quoted = mapping.columns.quotedTotal ? money(get('quotedTotal')) : null;
    if (typeof quoted === 'string') errs.push({ row: rowNo, column: mapping.columns.quotedTotal, message: quoted });
    if (errs.length) { out.errors.push(...errs); return; }
    const id = `opentable:${ext}`;
    if (seen.has(id)) { out.duplicatesInFile++; return; }
    seen.add(id);
    const experienceName = get('experience').trim().replace(/[\u0000-\u001f]/g, '').slice(0, 80);
    out.ok.push({
      id, source: 'opentable_csv', externalId: ext, product: productFor(experienceName), experienceName,
      createdAtUtc: created as number, serviceAtUtc: service as number, serviceDate: localDate(service as number, wineryTz), sourceTz: mapping.timezone,
      partySize: party, status: status!, channel: get('source').trim().toLowerCase().replace(/[^a-z0-9 /._-]/g, '').slice(0, 40) || 'unknown',
      currency: mapping.currency, quotedMinor: quoted as number | null,
      // An export carries no per-row update time; the export time stands in, so a newer export supersedes an older one.
      sourceUpdatedAt: importedAt,
    });
  });
  return out;
}

export const countExisting = (p: ImportPreview, existing: ReadonlySet<string>) => p.ok.filter(b => existing.has(b.id)).length;
