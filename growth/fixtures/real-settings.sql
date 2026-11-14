-- Run once on the staging/production database after migrations. Marks it as REAL data; demo data can never load here.
INSERT OR IGNORE INTO business_settings (id, data_kind, report_language, winery_tz, updated_at) VALUES (1, 'real', 'en', 'America/Mexico_City', 0);
INSERT OR IGNORE INTO connections (id, provider, purpose, health, health_reason, updated_at) VALUES
  ('conn_google_ads_script', 'google_ads_script', 'Google Ads reads (hourly script feed)', 'not_configured', 'Create a feed token and install scripts/google-ads-feed.js in Google Ads', 0),
  ('conn_google_ads_api', 'google_ads_api', 'Google Ads changes (API)', 'not_configured', 'Needs approved Google Ads API access for the owner’s Cloud project and owner OAuth', 0),
  ('conn_opentable_csv', 'opentable_csv', 'Restaurant + experience bookings (CSV export)', 'not_configured', 'Import a GuestCenter reservation export', 0),
  ('conn_ga4', 'ga4', 'Website analytics', 'not_configured', 'Tag audit pending', 0),
  ('conn_anthropic', 'anthropic', 'Analysis and report narrative', 'not_configured', 'Optional secret ANTHROPIC_API_KEY', 0),
  ('conn_data_manager', 'google_data_manager', 'Offline conversions back to Google Ads', 'not_configured', 'Phase 2', 0),
  ('conn_zoho_inventory', 'zoho_inventory', 'Wine sales', 'not_configured', 'Phase 3', 0),
  ('conn_parrot', 'parrot_pos', 'Restaurant checks', 'not_configured', 'No public API found; export-based import in Phase 3', 0),
  ('conn_meta', 'meta_ads', 'Meta Ads', 'not_configured', 'Phase 4', 0);
