-- Pass 2b: the account feed now carries each campaign's keywords, which keyword brought each search, and the negative
-- keywords of every level and match type. With them the app can tell a stray search (block it) from a keyword somebody
-- put in the campaign (pause it), and can check a negative against the keywords before offering it.
-- All four tables hold live state that the feed replaces on every run; nothing here is a ledger.

-- Keywords of enabled campaigns (not removed). "Active" means the keyword and its ad group are both ENABLED.
CREATE TABLE keywords_live (
  account_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  ad_group_id TEXT NOT NULL,
  criterion_id TEXT NOT NULL,
  ad_group_name TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  match_type TEXT NOT NULL CHECK (match_type IN ('EXACT', 'PHRASE', 'BROAD')),
  status TEXT NOT NULL CHECK (status IN ('ENABLED', 'PAUSED')),
  ad_group_status TEXT NOT NULL DEFAULT 'ENABLED' CHECK (ad_group_status IN ('ENABLED', 'PAUSED')),
  clicks INTEGER NOT NULL DEFAULT 0,             -- the keyword's own numbers over stats_from..stats_to
  cost_micros INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  conversions_milli INTEGER NOT NULL DEFAULT 0,
  stats_from TEXT, stats_to TEXT,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, ad_group_id, criterion_id)
);
CREATE INDEX keywords_live_campaign ON keywords_live(account_id, campaign_id);

-- Which keyword brought each search term in the last 28 days.
CREATE TABLE search_term_keywords (
  account_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  term TEXT NOT NULL,
  ad_group_id TEXT NOT NULL DEFAULT '',
  criterion_id TEXT NOT NULL DEFAULT '',
  keyword TEXT NOT NULL,
  keyword_match_type TEXT NOT NULL DEFAULT '',
  clicks INTEGER NOT NULL,
  cost_micros INTEGER NOT NULL,
  date_from TEXT NOT NULL, date_to TEXT NOT NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, campaign_id, term, ad_group_id, criterion_id, keyword, keyword_match_type)
);

-- Negative keywords: every match type, and the ones set on an ad group or in a shared list, not only the campaign's
-- exact ones. Rebuilt in place so the rows the write path verifies against are never missing.
CREATE TABLE negatives_live_v2 (
  account_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  text TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'EXACT' CHECK (match_type IN ('EXACT', 'PHRASE', 'BROAD')),
  level TEXT NOT NULL DEFAULT 'campaign' CHECK (level IN ('campaign', 'ad_group', 'list')),
  scope_id TEXT NOT NULL DEFAULT '',             -- ad group id or shared list id; empty for the campaign itself
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, campaign_id, level, scope_id, match_type, text)
);
INSERT INTO negatives_live_v2 (account_id, campaign_id, text, match_type, level, scope_id, seen_at)
  SELECT account_id, campaign_id, text, 'EXACT', 'campaign', '', seen_at FROM negatives_live;
DROP TABLE negatives_live;
ALTER TABLE negatives_live_v2 RENAME TO negatives_live;

-- What the script last sent besides the numbers: its version, when each new section last arrived, and anything it
-- could not read (so a failed query shows up in Conexiones instead of only in the script's own log).
CREATE TABLE feed_state (
  account_id TEXT PRIMARY KEY,
  script_version TEXT NOT NULL DEFAULT '',
  keywords_at INTEGER,
  term_keywords_at INTEGER,
  negatives_full_at INTEGER,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);

-- Queued changes for the script: a phrase negative and pausing a keyword, plus the two undo operations the script
-- already knows how to apply (not queued by the app yet).
CREATE TABLE script_ops_v2 (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES ad_accounts(id),
  kind TEXT NOT NULL CHECK (kind IN ('set_budget', 'pause_campaign', 'pause_ad', 'add_negative_exact', 'add_negative_phrase', 'remove_negative', 'pause_keyword', 'enable_keyword')),
  campaign_id TEXT, budget_id TEXT, ad_id TEXT, text TEXT,
  from_micros INTEGER, to_micros INTEGER,
  ad_group_id TEXT, criterion_id TEXT, match_type TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'applied', 'skipped', 'failed', 'expired')),
  detail TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL, sent_at INTEGER, done_at INTEGER
);
INSERT INTO script_ops_v2 (id, account_id, kind, campaign_id, budget_id, ad_id, text, from_micros, to_micros, status, detail, created_at, sent_at, done_at)
  SELECT id, account_id, kind, campaign_id, budget_id, ad_id, text, from_micros, to_micros, status, detail, created_at, sent_at, done_at FROM script_ops;
DROP TABLE script_ops;
ALTER TABLE script_ops_v2 RENAME TO script_ops;
CREATE INDEX script_ops_open ON script_ops(account_id, status);

-- A new feed token no longer cuts off the script that is running: it takes over the first time it is used, and only
-- then are the older ones revoked. Tokens in use today count as used.
ALTER TABLE feed_tokens ADD COLUMN first_used_at INTEGER;
UPDATE feed_tokens SET first_used_at = created_at WHERE revoked_at IS NULL;

-- What each review said, in full: the rules' one-line count and the model's summary for the owner. The job log keeps
-- only a short copy.
CREATE TABLE review_notes (
  run_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  rules_summary TEXT NOT NULL DEFAULT '',
  model_summary TEXT NOT NULL DEFAULT '',
  submitted INTEGER NOT NULL DEFAULT 0
);
