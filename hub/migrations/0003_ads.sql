-- Anuncios (Google + Meta) lives inside the Hub: /ads/. Data arrives from the Google Ads script (POST /ads/api/ingest)
-- and from Claude (weekly Meta numbers, bookings). Money is stored in MXN; Meta's USD is converted at the week's rate.

-- One row per platform, campaign and period. Google: one day (days = 1). Meta: one week from Monday (days = 7).
CREATE TABLE IF NOT EXISTS ads_perf (
  platform TEXT NOT NULL CHECK (platform IN ('google', 'meta')),
  campaign TEXT NOT NULL,
  period_start TEXT NOT NULL,          -- YYYY-MM-DD
  days INTEGER NOT NULL DEFAULT 1,
  spend REAL NOT NULL DEFAULT 0,       -- MXN
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  conversions REAL NOT NULL DEFAULT 0, -- bookings/purchases as the platform counts them
  value REAL NOT NULL DEFAULT 0,       -- MXN
  spend_native REAL,                   -- Meta: USD before conversion
  fx REAL,                             -- Meta: USD→MXN used
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (platform, campaign, period_start)
);
CREATE INDEX IF NOT EXISTS ads_perf_start ON ads_perf(period_start);

-- The latest state of each campaign (status, budget, lost impression share) as the platform reports it.
CREATE TABLE IF NOT EXISTS ads_campaigns (
  platform TEXT NOT NULL,
  campaign TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '',     -- ENABLED, PAUSED, REMOVED
  type TEXT NOT NULL DEFAULT '',       -- SEARCH, PERFORMANCE_MAX, …
  daily_budget REAL,                   -- MXN
  lost_is_budget REAL,                 -- % of searches missed for budget, last 7 days
  note TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (platform, campaign)
);

CREATE TABLE IF NOT EXISTS ads_targets (
  platform TEXT PRIMARY KEY,
  monthly_budget REAL,                 -- MXN
  target_roas REAL,
  target_cpa REAL,                     -- MXN per booking
  note TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

-- Bookings from the booking systems themselves (OpenTable, Rezdy), by source, so ads can be judged on real reservations.
CREATE TABLE IF NOT EXISTS ads_bookings (
  date TEXT NOT NULL,
  system TEXT NOT NULL,                -- opentable, rezdy
  source TEXT NOT NULL,                -- google / cpc, facebook / paid, organic, direct…
  bookings INTEGER NOT NULL DEFAULT 0,
  covers INTEGER NOT NULL DEFAULT 0,
  value REAL NOT NULL DEFAULT 0,       -- MXN
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (date, system, source)
);

CREATE TABLE IF NOT EXISTS ads_todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task TEXT NOT NULL,
  area TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL DEFAULT '',
  due TEXT NOT NULL DEFAULT '',        -- YYYY-MM-DD or ''
  done INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  done_at INTEGER
);

-- Settings: ingest_token_hash (SHA-256 hex of the token the Google Ads script sends), last_ingest.
CREATE TABLE IF NOT EXISTS ads_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- The app opens inside the Hub now.
UPDATE apps SET status = 'live', mode = 'internal', url = '/ads/', description = 'Google y Meta: gasto, reservas, retorno y pendientes' WHERE slug = 'ads';
