// Money is always an integer amount with an explicit currency. Two representations exist:
//   - minor units (centavos / cents) for business revenue and costs;
//   - provider-native micros (1 unit = 1_000_000 micros) for ad cost and budgets, exactly as Google Ads reports them.
// Never floating point for budget arithmetic; never add MXN to USD without a dated exchange rate.

export const CURRENCIES = ['MXN', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

export interface Minor { readonly currency: Currency; readonly minor: number }
export interface Micros { readonly currency: Currency; readonly micros: number }

export class CurrencyMismatchError extends Error {
  constructor(a: Currency, b: Currency) { super(`Cannot combine ${a} with ${b} without a dated exchange rate`); }
}

function assertInt(n: number, what: string): void {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${what} must be a safe integer, got ${n}`);
}

export const minor = (currency: Currency, amount: number): Minor => { assertInt(amount, 'minor'); return { currency, minor: amount }; };
export const micros = (currency: Currency, amount: number): Micros => { assertInt(amount, 'micros'); return { currency, micros: amount }; };

export function addMinor(a: Minor, b: Minor): Minor {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
  return minor(a.currency, a.minor + b.minor);
}
export function subMinor(a: Minor, b: Minor): Minor {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
  return minor(a.currency, a.minor - b.minor);
}
export function addMicros(a: Micros, b: Micros): Micros {
  if (a.currency !== b.currency) throw new CurrencyMismatchError(a.currency, b.currency);
  return micros(a.currency, a.micros + b.micros);
}
export function sumMinor(currency: Currency, items: readonly Minor[]): Minor {
  return items.reduce((acc, m) => addMinor(acc, m), minor(currency, 0));
}
export function sumMicros(currency: Currency, items: readonly Micros[]): Micros {
  return items.reduce((acc, m) => addMicros(acc, m), micros(currency, 0));
}

/** Round half to even (banker's rounding) for an exact integer division. */
export function divRoundHalfEven(n: number, d: number): number {
  if (d <= 0 || !Number.isInteger(d)) throw new RangeError('divisor must be a positive integer');
  const q = Math.trunc(n / d), r = n - q * d;
  const twice = Math.abs(r) * 2;
  if (twice < d) return q;
  if (twice > d) return q + Math.sign(n);
  return q % 2 === 0 ? q : q + Math.sign(n);
}

/** Micros → minor units for two-decimal currencies (MXN, USD): 1 minor = 10_000 micros. */
export const microsToMinor = (m: Micros): Minor => minor(m.currency, divRoundHalfEven(m.micros, 10_000));
export const minorToMicros = (m: Minor): Micros => micros(m.currency, m.minor * 10_000);

/** Percent change applied to micros, rounded to the nearest whole currency unit's micros (Google requires budget
 *  amounts in multiples of the currency's minimum unit; we round to whole minor units to be safe). */
export function scaleMicros(m: Micros, numerator: number, denominator: number): Micros {
  assertInt(numerator, 'numerator'); assertInt(denominator, 'denominator');
  const raw = divRoundHalfEven(m.micros * numerator, denominator);
  return micros(m.currency, divRoundHalfEven(raw, 10_000) * 10_000);
}

/** A dated exchange rate. rateMicros = how many micros of `to` one whole unit of `from` buys. */
export interface FxRate { readonly from: Currency; readonly to: Currency; readonly date: string; readonly rateMicros: number; readonly source: string }

export function convertMinor(m: Minor, rate: FxRate): Minor {
  if (m.currency === rate.to) return m;
  if (m.currency !== rate.from) throw new CurrencyMismatchError(m.currency, rate.from);
  return minor(rate.to, divRoundHalfEven(m.minor * rate.rateMicros, 1_000_000));
}

export function formatMinor(m: Minor | null, locale = 'es-MX'): string {
  if (!m) return '—';
  return new Intl.NumberFormat(locale, { style: 'currency', currency: m.currency, maximumFractionDigits: 0 }).format(m.minor / 100);
}
