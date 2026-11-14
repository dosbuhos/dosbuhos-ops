-- Marks this database as the DEMO database. The Worker refuses to run if this does not match its DATA_KIND, and the
-- synthetic dataset (fixtures/demo-data.ts) refuses to load into a database not marked 'demo'.
INSERT OR IGNORE INTO business_settings (id, data_kind, report_language, winery_tz, brand_facts_json, updated_at)
VALUES (1, 'demo', 'en', 'America/Mexico_City', '[{"fact":"Family winery in San Miguel de Allende, Guanajuato","source":"demo","approvedBy":"demo"}]', 0);
