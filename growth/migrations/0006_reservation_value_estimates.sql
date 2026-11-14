-- Estimated value per reservation, by product, net of IVA. Owner-approved averages used until real per-booking
-- sales exist. Every change is a new row (history kept); the newest approved row per product is the one in use.
CREATE TABLE reservation_value_estimates (
  id TEXT PRIMARY KEY,
  product TEXT NOT NULL CHECK (product IN ('restaurant_visit', 'tour_tasting')),
  value_minor INTEGER NOT NULL CHECK (value_minor > 0),   -- per reservation, net of IVA, minor units
  currency TEXT NOT NULL DEFAULT 'MXN',
  basis TEXT NOT NULL,                                     -- how it was calculated (shown in the app)
  source_period TEXT NOT NULL DEFAULT '',                  -- e.g. 2026-08-12 – 2026-11-14
  approved_by TEXT NOT NULL,
  approved_at INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX reservation_value_estimates_product ON reservation_value_estimates(product, approved_at);
