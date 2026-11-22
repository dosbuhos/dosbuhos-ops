// Keyword text, compared the two ways it has to be compared.
//
// Google keeps accents: "queretaro" and "querétaro" are two different keywords, and a negative keyword does not expand
// to variants. So what is SENT to Google keeps the accents exactly as people typed them (canon). But to decide what a
// change could touch, the app compares without accents or punctuation (fold), which errs on the side of seeing more.
export const MATCH_TYPES = ['EXACT', 'PHRASE', 'BROAD'] as const;
export type MatchType = (typeof MATCH_TYPES)[number];

/** As Google stores it: lowercase, composed accents, single spaces, without the [ ] " + marks of the match type. */
export const canon = (s: string) => String(s ?? '').normalize('NFC').toLowerCase().replace(/[\[\]"+]/g, ' ').replace(/\s+/g, ' ').trim();
/** For comparing meaning: canon, and also without accents or punctuation. */
export const fold = (s: string) => canon(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
/** Whole words, in order. Both arguments already folded (or both canon). */
export const hasPhrase = (text: string, phrase: string) => phrase.length > 0 && ` ${text} `.includes(` ${phrase} `);

/** Could this negative keyword stop this search? Compared folded, so it also counts the accent variants. */
export function blocks(neg: { text: string; matchType: MatchType }, search: string): boolean {
  const n = fold(neg.text), q = fold(search);
  if (!n || !q) return false;
  if (neg.matchType === 'EXACT') return q === n;
  if (neg.matchType === 'PHRASE') return hasPhrase(q, n);
  const words = new Set(q.split(' '));
  return n.split(' ').every(w => words.has(w));
}

/** Does this negative keyword stop this search for certain? Accents count here, as they do for Google: a negative
 *  "queretaro" is not known to stop "querétaro". Used to decide that something is already dealt with. */
export function surelyBlocks(neg: { text: string; matchType: MatchType }, search: string): boolean {
  const plain = (s: string) => canon(s).replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
  const n = plain(neg.text), q = plain(search);
  if (!n || !q) return false;
  if (neg.matchType === 'EXACT') return q === n;
  if (neg.matchType === 'PHRASE') return hasPhrase(q, n);
  const words = new Set(q.split(' '));
  return n.split(' ').every(w => words.has(w));
}

/** The ways a folded phrase is actually written inside a text, accents kept: "querétaro" and "queretaro" for "queretaro". */
export function surfaceForms(text: string, foldedPhrase: string): string[] {
  const words = canon(text).split(' ').map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);
  const folded = words.map(fold), n = foldedPhrase.split(' ').length, out: string[] = [];
  for (let i = 0; i + n <= words.length; i++) if (folded.slice(i, i + n).join(' ') === foldedPhrase) out.push(words.slice(i, i + n).join(' '));
  return out;
}

/** Words the app never blocks or pauses: our own name and our own town. */
export const OUR_NAME = ['buho', 'buhos'];
export const OUR_PLACE = 'san miguel de allende';
export const namesUs = (folded: string) => OUR_NAME.some(w => hasPhrase(folded, w)) || /buhos?/.test(folded.replace(/ /g, ''));
/** True when a theme is our own name, our own town, or a piece of either (so "miguel" or "allende" can never be blocked). */
export const isProtectedTheme = (folded: string) => namesUs(folded) || hasPhrase(OUR_PLACE, folded) || hasPhrase(folded, 'san miguel') || hasPhrase(folded, 'allende') || hasPhrase('dos buhos', folded);
