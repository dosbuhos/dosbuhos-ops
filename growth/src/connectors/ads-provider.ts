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

export type NegativeMatch = 'EXACT' | 'PHRASE';
export interface KeywordRef { adGroupId: string; criterionId: string }

export interface AdsProvider {
  readonly kind: 'mock' | 'google_ads_api' | 'google_ads_script';
  /** True when writes are queued and applied later (the Google Ads Script runs hourly), so they cannot be read back at once. */
  readonly deferred: boolean;
  readBudgets(accountId: string, budgetIds: string[]): Promise<Record<string, number>>;       // micros
  readCampaignStatus(accountId: string, campaignIds: string[]): Promise<Record<string, EntityStatus>>;
  readAdStatus(accountId: string, adIds: string[]): Promise<Record<string, EntityStatus>>;
  /** Whether the campaign itself has this negative keyword with this match type. */
  hasNegative(accountId: string, campaignId: string, text: string, match: NegativeMatch): Promise<boolean>;
  /** Status of each keyword, keyed "adGroupId~criterionId". A keyword the account no longer shows is left out. */
  readKeywordStatus(accountId: string, keywords: KeywordRef[]): Promise<Record<string, EntityStatus>>;
  setBudget(accountId: string, budgetId: string, amountMicros: number, idempotencyKey: string): Promise<void>;
  setCampaignStatus(accountId: string, campaignId: string, status: 'ENABLED' | 'PAUSED', idempotencyKey: string): Promise<void>;
  setAdStatus(accountId: string, adId: string, status: 'ENABLED' | 'PAUSED', idempotencyKey: string): Promise<void>;
  addNegative(accountId: string, campaignId: string, text: string, match: NegativeMatch, idempotencyKey: string): Promise<void>;
  setKeywordStatus(accountId: string, keyword: KeywordRef & { campaignId: string; text: string }, status: 'ENABLED' | 'PAUSED', idempotencyKey: string): Promise<void>;
  /** What the provider itself recorded about one operation (the script reports applied, skipped or failed, and why), if
   *  it keeps that. `reportedSince` says whether the account has been read again, in a later run, since the operation
   *  was done: only then can "the account does not show it" be believed. */
  opState?(idempotencyKey: string): Promise<{ status: string; detail: string; doneAt: number | null; reportedSince: boolean } | null>;
}

/** Two keyword texts are the same keyword for Google: case, spacing and stray punctuation aside, accents included. */
export const sameKeywordText = (a: string, b: string) => {
  const c = (s: string) => s.normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
  return c(a) === c(b);
};
