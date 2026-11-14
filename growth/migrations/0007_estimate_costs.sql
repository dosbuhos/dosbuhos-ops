-- Variable cost assumptions for ESTIMATED contribution (value per reservation minus variable costs). Separate from the
-- booking-level cost_assumptions table in 0001. Owner-editable in Controles; newest per key wins; provisional values are flagged.
CREATE TABLE estimate_costs (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL CHECK (key IN ('restaurant_cost_pct', 'tour_cost_pct', 'payment_fee_pct', 'opentable_fee_per_reservation')),
  value INTEGER NOT NULL CHECK (value >= 0),   -- basis points (1% = 100) for *_pct keys; MXN cents for opentable_fee_per_reservation
  basis TEXT NOT NULL,
  source_period TEXT NOT NULL DEFAULT '',
  provisional INTEGER NOT NULL DEFAULT 0,
  approved_by TEXT NOT NULL,
  approved_at INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX estimate_costs_key ON estimate_costs(key, approved_at);
