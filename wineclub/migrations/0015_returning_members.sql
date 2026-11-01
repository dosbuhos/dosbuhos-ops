-- A member who comes back can pay under a NEW Stripe customer. Remember every extra customer of a member
-- so sync and webhooks attach its subscriptions to the member we already know instead of creating a duplicate.
CREATE TABLE IF NOT EXISTS member_customers (
  stripe_customer_id TEXT PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id),
  matched_by TEXT NOT NULL,                       -- 'email' | 'name' | 'merge'
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS member_customers_member ON member_customers(member_id);

-- A duplicate absorbed by the return flow is hidden, never deleted. Its Stripe customer stays on the row
-- (UNIQUE) and is also linked above to the member that absorbed it.
-- Last statement on purpose: re-running this file fails only here ("duplicate column"), after the rest is in place.
ALTER TABLE members ADD COLUMN merged_into INTEGER REFERENCES members(id);
