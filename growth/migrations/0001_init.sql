-- Dos Búhos Growth Terminal — D1 schema.
-- D1 is authoritative for business facts and analytics configuration. Autonomy mode, emergency lock, policy version,
-- action state and reservations live in the per-account Durable Object; action_ledger_projection mirrors its ledger.
-- Money: integer minor units (revenue/costs) or provider micros (ad cost/budgets), always with a currency column.
-- Time: *_at columns are UTC epoch milliseconds; *_date columns are local dates in the zone named alongside.

CREATE TABLE business_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data_kind TEXT NOT NULL CHECK (data_kind IN ('demo', 'real')),   -- must equal the Worker's DATA_KIND or the app refuses to start
  locale TEXT NOT NULL DEFAULT 'es-MX',
  report_language TEXT NOT NULL DEFAULT 'en',
  reporting_currency TEXT NOT NULL DEFAULT 'MXN' CHECK (reporting_currency IN ('MXN', 'USD')),
  winery_tz TEXT NOT NULL DEFAULT 'America/Mexico_City',
  notification_tz TEXT,                                            -- NULL = notifications off; never inherits the server zone
  notification_local_time TEXT,                                    -- HH:MM
  brand_facts_json TEXT NOT NULL DEFAULT '[]',                     -- approved claims with source + approver + date
  policy_links_json TEXT NOT NULL DEFAULT '[]',
  software_cost_ceiling_usd_month INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE ad_accounts (
  id TEXT PRIMARY KEY,                                             -- internal key, e.g. acct_google_main
  provider TEXT NOT NULL CHECK (provider IN ('google_ads', 'meta_ads')),
  external_id TEXT NOT NULL,                                       -- customer ID; stored here, never in the repo
  name TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('MXN', 'USD')),
  account_tz TEXT NOT NULL,                                        -- the ad account's own zone (dates in campaign_daily)
  access_status TEXT NOT NULL DEFAULT 'not_configured',
  known_automation_json TEXT NOT NULL DEFAULT '[]',                -- agency tools, scripts, automated rules found at onboarding
  created_at INTEGER NOT NULL,
  UNIQUE (provider, external_id)
);

CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,                                          -- google_ads_script, google_ads_api, ga4, opentable_csv, anthropic, …
  purpose TEXT NOT NULL,
  health TEXT NOT NULL DEFAULT 'not_configured' CHECK (health IN ('connected', 'limited', 'reconnect', 'not_configured')),
  health_reason TEXT NOT NULL DEFAULT '',
  scopes_json TEXT NOT NULL DEFAULT '[]',
  account_ref TEXT,
  credential_ref TEXT,                                             -- id in encrypted_credentials, never the secret
  token_meta_json TEXT NOT NULL DEFAULT '{}',                      -- expiry, key version — no token values
  last_success_at INTEGER,
  last_error TEXT,
  freshness_at INTEGER,                                            -- newest data time this connection has delivered
  updated_at INTEGER NOT NULL
);

CREATE TABLE encrypted_credentials (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES connections(id),
  key_version INTEGER NOT NULL,
  iv_b64 TEXT NOT NULL,
  ciphertext_b64 TEXT NOT NULL,                                    -- AES-256-GCM; AAD = connection id + key version
  rotated_from TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE feed_tokens (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES connections(id),
  token_hash TEXT NOT NULL UNIQUE,                                 -- SHA-256(pepper + token); the token is shown once
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE TABLE products (
  id TEXT PRIMARY KEY CHECK (id IN ('restaurant_visit', 'tour_tasting', 'wine_order', 'private_event')),
  label TEXT NOT NULL,
  capacity_rule TEXT NOT NULL DEFAULT '',
  valuation_rule TEXT NOT NULL DEFAULT '',
  maturation_lag_days INTEGER NOT NULL,                            -- conservative provisional window until estimated
  lag_estimated_from_data INTEGER NOT NULL DEFAULT 0,
  capacity_max_age_minutes INTEGER NOT NULL DEFAULT 1440
);

CREATE TABLE campaign_registry (
  ref TEXT PRIMARY KEY,                                            -- res_… server-issued reference the model sees
  account_id TEXT NOT NULL REFERENCES ad_accounts(id),
  kind TEXT NOT NULL DEFAULT 'campaign' CHECK (kind IN ('campaign', 'ad')),
  external_id TEXT NOT NULL,
  parent_campaign_id TEXT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL DEFAULT 'SEARCH',
  products_json TEXT NOT NULL DEFAULT '[]',
  intent TEXT NOT NULL DEFAULT '',
  brand INTEGER NOT NULL DEFAULT 0,
  language TEXT NOT NULL DEFAULT '',
  booking_horizon_days INTEGER NOT NULL DEFAULT 14,
  budget_id TEXT,
  budget_shared INTEGER NOT NULL DEFAULT 0,
  budget_micros INTEGER,
  writable INTEGER NOT NULL DEFAULT 0,
  managed_by TEXT NOT NULL DEFAULT 'unknown',
  optimization_signal TEXT NOT NULL DEFAULT '',                    -- the one primary conversion this campaign optimizes for
  updated_at INTEGER NOT NULL,
  UNIQUE (account_id, kind, external_id)
);

CREATE TABLE campaign_daily (
  account_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  date TEXT NOT NULL,                                              -- in ad_accounts.account_tz
  currency TEXT NOT NULL,
  cost_micros INTEGER NOT NULL,
  impressions INTEGER NOT NULL,
  clicks INTEGER NOT NULL,
  platform_conversions_milli INTEGER,                              -- conversions × 1000 (platform counts fractional); NULL = not reported
  platform_conversion_value_micros INTEGER,
  conversion_action TEXT,
  attribution_model TEXT,
  source TEXT NOT NULL,                                            -- google_ads_script | google_ads_api | demo
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, campaign_id, date)
);
CREATE INDEX campaign_daily_date ON campaign_daily(date);

CREATE TABLE spend_readings (
  account_id TEXT NOT NULL,
  read_at INTEGER NOT NULL,
  data_as_of INTEGER NOT NULL,
  month TEXT NOT NULL,                                             -- YYYY-MM in account zone
  month_to_date_micros INTEGER NOT NULL,
  today_micros INTEGER NOT NULL,
  managed_daily_budget_micros INTEGER NOT NULL,
  unmanaged_daily_budget_micros INTEGER NOT NULL,
  max_hourly_micros INTEGER NOT NULL,
  PRIMARY KEY (account_id, read_at)
);

CREATE TABLE search_term_facts (
  account_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  term TEXT NOT NULL,                                              -- untrusted text: data, never instructions
  match_type TEXT NOT NULL DEFAULT '',
  keyword TEXT NOT NULL DEFAULT '',
  cost_micros INTEGER NOT NULL,
  clicks INTEGER NOT NULL,
  conversions_milli INTEGER,
  PRIMARY KEY (account_id, campaign_id, date_from, date_to, term, match_type)
);

CREATE TABLE tracking_events (
  source_event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,                                        -- booking_intent_click, booking_confirmed, …
  event_at INTEGER NOT NULL,
  consent_json TEXT NOT NULL,                                      -- consent snapshot at the time of the event
  session_key TEXT,                                                -- pseudonymous
  gclid TEXT, gbraid TEXT, wbraid TEXT,                            -- only when consent permits
  utm_json TEXT NOT NULL DEFAULT '{}',
  provenance TEXT NOT NULL
);

CREATE TABLE bookings (
  id TEXT PRIMARY KEY,                                             -- source:external_id
  source TEXT NOT NULL,                                            -- opentable_csv | opentable_api | manual | demo
  external_id TEXT NOT NULL,
  product TEXT NOT NULL REFERENCES products(id),
  experience_name TEXT NOT NULL DEFAULT '',
  created_at_utc INTEGER NOT NULL,
  service_at_utc INTEGER NOT NULL,
  service_date TEXT NOT NULL,                                      -- winery zone
  source_tz TEXT NOT NULL,
  party_size INTEGER NOT NULL CHECK (party_size > 0),
  status TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'unknown',                         -- as reported by the source; 'unknown' when not knowable
  currency TEXT NOT NULL,
  quoted_minor INTEGER,
  paid_minor INTEGER,
  source_updated_at INTEGER NOT NULL,
  import_id TEXT,
  UNIQUE (source, external_id)
);
CREATE INDEX bookings_service ON bookings(service_date);
CREATE INDEX bookings_created ON bookings(created_at_utc);

CREATE TABLE booking_status_history (
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  source_event_id TEXT NOT NULL,
  status TEXT NOT NULL,
  source_updated_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (booking_id, source_event_id)
);

CREATE TABLE orders_and_checks (
  id TEXT PRIMARY KEY,                                             -- source:transaction id
  source TEXT NOT NULL,
  transaction_at INTEGER NOT NULL,
  service_date TEXT NOT NULL,
  currency TEXT NOT NULL,
  paid INTEGER NOT NULL,
  refundable_deposit INTEGER NOT NULL DEFAULT 0,
  lines_json TEXT NOT NULL,                                        -- TransactionLine[]
  matched_booking_id TEXT,
  match_method TEXT,                                               -- booking_ref | transaction_link | none (never timestamp+party guesses)
  match_confidence TEXT,
  source_updated_at INTEGER NOT NULL
);

CREATE TABLE revenue_allocations (
  transaction_id TEXT NOT NULL REFERENCES orders_and_checks(id),
  line_id TEXT NOT NULL,
  booking_id TEXT,
  product TEXT NOT NULL,
  currency TEXT NOT NULL,
  net_minor INTEGER NOT NULL,
  contribution_minor INTEGER,
  PRIMARY KEY (transaction_id, line_id)                            -- one allocation per line: no double counting
);

CREATE TABLE cost_assumptions (
  id TEXT PRIMARY KEY,
  product TEXT NOT NULL REFERENCES products(id),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  variable_cost_pct_bp INTEGER,
  variable_cost_per_guest_minor INTEGER,
  currency TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('estimated', 'actual')),
  source TEXT NOT NULL,
  approved_by TEXT,
  approved_at INTEGER
);

CREATE TABLE capacity_resources (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('seats', 'guide', 'space')),
  label TEXT NOT NULL,
  quantity INTEGER NOT NULL
);
CREATE TABLE capacity_resource_windows (
  resource_id TEXT NOT NULL REFERENCES capacity_resources(id),
  date TEXT NOT NULL,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY (resource_id, date, start_min)
);
CREATE TABLE capacity_slots (
  id TEXT PRIMARY KEY,
  product TEXT NOT NULL REFERENCES products(id),
  label TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  start_min INTEGER NOT NULL,
  duration_min INTEGER NOT NULL,
  buffer_min INTEGER NOT NULL DEFAULT 0,
  requires_json TEXT NOT NULL DEFAULT '[]',
  max_guests INTEGER,
  state TEXT NOT NULL CHECK (state IN ('open', 'closed', 'blocked')),
  reserved_guests INTEGER NOT NULL DEFAULT 0,                      -- from bookings or entered by staff
  source TEXT NOT NULL,
  source_updated_at INTEGER,
  updated_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX capacity_slots_date ON capacity_slots(date);

CREATE TABLE attribution_links (
  id TEXT PRIMARY KEY,
  booking_id TEXT,
  order_id TEXT,
  tracking_event_id TEXT,
  campaign_ref TEXT,
  method TEXT NOT NULL,                                            -- click_id | platform_reported | booking_source_field | unknown
  evidence TEXT NOT NULL,
  lookback_days INTEGER,
  confidence TEXT NOT NULL CHECK (confidence IN ('observed', 'attributed', 'modeled', 'unknown')),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE conversion_delivery (
  dedupe_key TEXT PRIMARY KEY,                                     -- destination + business event key
  destination TEXT NOT NULL,
  business_event_key TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  consent_json TEXT NOT NULL,
  validation TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at INTEGER,
  diagnostic TEXT,
  adjustment_state TEXT NOT NULL DEFAULT 'none'
);

CREATE TABLE experiments (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  unit TEXT NOT NULL,
  primary_metric TEXT NOT NULL,
  guardrails_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('planned', 'active', 'completed', 'inconclusive', 'failed', 'stopped')),
  start_date TEXT, end_date TEXT,
  allocation TEXT NOT NULL DEFAULT '',
  max_cost_micros INTEGER,
  spent_micros INTEGER NOT NULL DEFAULT 0,
  maturation_days INTEGER NOT NULL DEFAULT 0,
  stop_loss TEXT NOT NULL DEFAULT '',
  evidence_json TEXT NOT NULL DEFAULT '{}',
  result TEXT NOT NULL DEFAULT '',
  limitations TEXT NOT NULL DEFAULT '',
  next_evaluation TEXT,
  review_after TEXT,                                               -- conclusions age out; revisit by this date
  created_at INTEGER NOT NULL
);

CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,                                             -- snap_…
  account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  json TEXT NOT NULL
);

CREATE TABLE proposals (
  id TEXT PRIMARY KEY,
  action_id TEXT,                                                  -- coordinator action, if the proposal validated
  account_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  run_key TEXT NOT NULL,
  raw_json TEXT NOT NULL,                                          -- the model's output as received (untrusted)
  validation_errors_json TEXT NOT NULL DEFAULT '[]',
  decision TEXT,
  reasons_json TEXT NOT NULL DEFAULT '[]',
  model TEXT NOT NULL DEFAULT '',
  prompt_version TEXT NOT NULL DEFAULT '',
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE action_ledger_projection (
  event_id TEXT PRIMARY KEY,                                       -- coordinator event id: idempotent mirror
  account_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  label TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  at INTEGER NOT NULL,
  operations_json TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  policy_version INTEGER NOT NULL
);
CREATE INDEX action_ledger_action ON action_ledger_projection(action_id, at);
CREATE INDEX action_ledger_at ON action_ledger_projection(at);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,                                             -- daily:2026-11-14 / weekly:2026-11-09
  kind TEXT NOT NULL CHECK (kind IN ('daily', 'weekly')),
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,
  cutoff_at INTEGER NOT NULL,
  data_quality_json TEXT NOT NULL,
  facts_json TEXT NOT NULL,                                        -- deterministic payload; the narrative may only restate it
  narrative TEXT NOT NULL,
  narrative_source TEXT NOT NULL CHECK (narrative_source IN ('model', 'template')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE TABLE notification_deliveries (
  dedupe_key TEXT PRIMARY KEY,                                     -- report id + destination
  report_id TEXT NOT NULL,
  destination TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE job_runs (
  run_key TEXT PRIMARY KEY,                                        -- logical run (job:local date / hour / slot)
  job TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('claimed', 'running', 'succeeded', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  checkpoint_json TEXT NOT NULL DEFAULT '{}',
  detail TEXT NOT NULL DEFAULT '',
  ai_input_tokens INTEGER NOT NULL DEFAULT 0,
  ai_output_tokens INTEGER NOT NULL DEFAULT 0,
  ai_cost_micro_usd INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX job_runs_job ON job_runs(job, started_at);

CREATE TABLE alerts (
  dedupe_key TEXT PRIMARY KEY,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  link TEXT NOT NULL DEFAULT '',
  opened_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  occurrences INTEGER NOT NULL DEFAULT 1,
  resolved_at INTEGER,
  acknowledged_by TEXT,
  acknowledged_at INTEGER
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  config_version INTEGER
);
CREATE INDEX audit_events_at ON audit_events(at);

CREATE TABLE imports (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  file_name TEXT NOT NULL,
  r2_key TEXT,
  mapping_json TEXT NOT NULL,
  rows_total INTEGER NOT NULL,
  rows_ok INTEGER NOT NULL,
  rows_duplicate INTEGER NOT NULL,
  rows_error INTEGER NOT NULL,
  errors_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('previewed', 'committed', 'discarded')),
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

INSERT INTO products (id, label, capacity_rule, valuation_rule, maturation_lag_days, capacity_max_age_minutes) VALUES
  ('restaurant_visit', 'Restaurant visit', 'Seats by service turn (duration + buffer)', 'Check net of tax and tips; margin from approved assumptions', 14, 1440),
  ('tour_tasting', 'Tour / tasting', 'Guide per group + group size cap; shared spaces', 'Ticket net revenue; variable cost per guest', 21, 1440),
  ('wine_order', 'Wine order', 'Inventory (not modeled yet)', 'Order net revenue minus product and shipping cost', 7, 10080),
  ('private_event', 'Private event', 'Spaces and dates; staff-confirmed', 'Reported separately: long sales cycle', 120, 10080);
