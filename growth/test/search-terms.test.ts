// Brand vs. new searches from GA4's Google Ads search terms.
import { describe, it, expect } from 'vitest';
import { isBrandQuery } from '../src/connectors/ga4.ts';

describe('brand search terms', () => {
  it('recognizes our name in any spelling and nothing else', () => {
    for (const q of ['dos buhos', 'Dos Búhos viñedo', 'viñedo 2 buhos', 'dosbuhos restaurante', 'buhos san miguel', 'DOS BUHOS winery']) expect(isBrandQuery(q)).toBe(true);
    for (const q of ['viñedos san miguel de allende', 'wine tasting san miguel', 'cuna de tierra', 'dos rios restaurant']) expect(isBrandQuery(q)).toBe(false);
  });
});
