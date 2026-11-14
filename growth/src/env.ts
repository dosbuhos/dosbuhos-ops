import type { AccountCoordinator } from './coordinator/do.ts';

export interface Env {
  DB: D1Database;
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
  ANTHROPIC_API_KEY?: string;       // optional: without it, template reports and no proposals
  FEED_TOKEN_PEPPER?: string;       // required to create/verify feed tokens
  TOKEN_ENCRYPTION_KEY_V1?: string; // required before storing OAuth refresh tokens
}

export type Role = 'admin' | 'editor' | 'viewer';
export interface User { email: string; name: string; role: Role }
