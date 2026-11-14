-- Google Ads Script write path. Approved changes are queued here; the script in the Google Ads account picks them up
-- (at most hourly), applies each only if the account still shows the expected "before" value, and reports back.
-- The coordinator verifies against the live state the same script posts (ads_live, negatives_live, campaign_registry).
CREATE TABLE script_ops (
  id TEXT PRIMARY KEY,                 -- the coordinator's idempotency key for this operation
  account_id TEXT NOT NULL REFERENCES ad_accounts(id),
  kind TEXT NOT NULL CHECK (kind IN ('set_budget', 'pause_campaign', 'pause_ad', 'add_negative_exact')),
  campaign_id TEXT, budget_id TEXT, ad_id TEXT, text TEXT,
  from_micros INTEGER, to_micros INTEGER,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'applied', 'skipped', 'failed', 'expired')),
  detail TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, sent_at INTEGER, done_at INTEGER
);
CREATE INDEX script_ops_open ON script_ops(account_id, status);
CREATE TABLE ads_live (account_id TEXT NOT NULL, ad_id TEXT NOT NULL, campaign_id TEXT NOT NULL, status TEXT NOT NULL, seen_at INTEGER NOT NULL, PRIMARY KEY (account_id, ad_id));
CREATE TABLE negatives_live (account_id TEXT NOT NULL, campaign_id TEXT NOT NULL, text TEXT NOT NULL, seen_at INTEGER NOT NULL, PRIMARY KEY (account_id, campaign_id, text));
