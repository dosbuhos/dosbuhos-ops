import type { AccountCoordinator } from './coordinator/do.ts';

export interface Env {
  DB: D1Database;
  HUB_DB?: D1Database;            // the Hub's database, read-only (Google Ads rows from the Hub's script)
  ARCHIVE: R2Bucket;
  ASSETS: Fetcher;
  COORDINATOR: DurableObjectNamespace<AccountCoordinator>;
  DAILY_REVIEW: Workflow;
  WEEKLY_REVIEW: Workflow;
  ENVIRONMENT: 'dev' | 'demo' | 'staging' | 'production';
  DATA_KIND: 'demo' | 'real';
  ADS_PROVIDER: 'mock' | 'google_ads_api';
  ANTHROPIC_MODEL: string;
  WINERY_TZ: string;
  // secrets (optional where noted)
  HUB_SECRET?: string;              // required outside dev
  DEV_USER_EMAIL?: string;          // dev only
  ANTHROPIC_API_KEY?: string | { get(): Promise<string> }; // shared key from the account Secrets Store (or a plain secret); optional
  FEED_TOKEN_PEPPER?: string;       // required to create/verify feed tokens
  TOKEN_ENCRYPTION_KEY_V1?: string;
  GA4_SA_KEY?: string;              // service account JSON key, Viewer on the GA4 property (read-only) // required before storing OAuth refresh tokens
}

export type Role = 'admin' | 'editor' | 'viewer';
export interface User { email: string; name: string; role: Role }
