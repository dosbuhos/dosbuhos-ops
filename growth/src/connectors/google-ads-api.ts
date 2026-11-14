// Google Ads API adapter — CONTRACT ONLY, BLOCKED.
//
// What it needs before it can be implemented and enabled (docs/integrations.md, docs/setup.md):
//   1. Google Ads API access for the owner's Google Cloud project at Basic or Standard level. Google's pages, as
//      summarized on 2026-11-14, say access levels moved from developer tokens to the Cloud project on 2026-09-09,
//      while other pages still describe developer tokens; the live pages must be read before implementing.
//   2. An OAuth client in the owner's Cloud project, one-time owner consent with the adwords scope, and the refresh
//      token stored encrypted (src/connectors/crypto.ts), refreshed with a per-connection lock.
//   3. The account ID and the writable campaign allowlist set in Controls.
// Until then every method throws ProviderError('not_enabled'), so the coordinator records a clear refusal and no
// write path exists in staging/production. Phase 1 reads come from the Google Ads Script feed instead.
import { ProviderError, type AdsProvider } from './ads-provider.ts';

const blocked = (what: string): never => {
  throw new ProviderError('not_enabled', `Google Ads API ${what} is not enabled: needs approved API access and owner OAuth (see docs/integrations.md)`);
};

export class GoogleAdsApiProvider implements AdsProvider {
  readonly kind = 'google_ads_api' as const;
  async readBudgets(): Promise<Record<string, number>> { return blocked('read'); }
  async readCampaignStatus(): Promise<Record<string, 'ENABLED' | 'PAUSED' | 'REMOVED'>> { return blocked('read'); }
  async readAdStatus(): Promise<Record<string, 'ENABLED' | 'PAUSED' | 'REMOVED'>> { return blocked('read'); }
  async readNegatives(): Promise<string[]> { return blocked('read'); }
  async setBudget(): Promise<void> { return blocked('budget mutation'); }
  async setCampaignStatus(): Promise<void> { return blocked('campaign status mutation'); }
  async setAdStatus(): Promise<void> { return blocked('ad status mutation'); }
  async addNegativeExact(): Promise<void> { return blocked('negative keyword mutation'); }
}
