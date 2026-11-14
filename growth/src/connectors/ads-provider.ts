// The only interface through which ad-account state is read or changed. Only the coordinator holds an AdsProvider
// with write methods; the optimizer and the model never see one.

export type ProviderErrorKind =
  | 'ambiguous'     // request may or may not have been applied (timeout, connection reset, 5xx after send)
  | 'rejected'      // provider definitively refused (validation, policy, permission)
  | 'auth'          // credentials invalid/revoked — blocks all writes
  | 'rate_limited'  // not applied; retry later
  | 'not_enabled';  // capability not implemented/approved in this deployment

export class ProviderError extends Error {
  constructor(public readonly kind: ProviderErrorKind, message: string, public readonly detail?: unknown) { super(message); }
}

export type EntityStatus = 'ENABLED' | 'PAUSED' | 'REMOVED';

export interface AdsProvider {
  readonly kind: 'mock' | 'google_ads_api';
  readBudgets(accountId: string, budgetIds: string[]): Promise<Record<string, number>>;       // micros
  readCampaignStatus(accountId: string, campaignIds: string[]): Promise<Record<string, EntityStatus>>;
  readAdStatus(accountId: string, adIds: string[]): Promise<Record<string, EntityStatus>>;
  readNegatives(accountId: string, campaignId: string): Promise<string[]>;
  setBudget(accountId: string, budgetId: string, amountMicros: number, idempotencyKey: string): Promise<void>;
  setCampaignStatus(accountId: string, campaignId: string, status: 'ENABLED' | 'PAUSED', idempotencyKey: string): Promise<void>;
  setAdStatus(accountId: string, adId: string, status: 'ENABLED' | 'PAUSED', idempotencyKey: string): Promise<void>;
  addNegativeExact(accountId: string, campaignId: string, text: string, idempotencyKey: string): Promise<void>;
}
