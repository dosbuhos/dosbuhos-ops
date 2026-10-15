-- v2: verified Stripe mapping, atomic/concurrent-safe fulfillment. Non-destructive.

-- Product relevance: 'club' (a wine-club product), 'ignore' (not a club product: events, tests, payment plans), NULL = not reviewed.
ALTER TABLE stripe_products ADD COLUMN relevance TEXT;
-- A name-based guess is only ever a suggestion; club_id is set only by a manager confirming it.
ALTER TABLE stripe_products ADD COLUMN suggested_club_id INTEGER REFERENCES clubs(id);

-- Optimistic concurrency + explicit overrides on fulfillment.
ALTER TABLE fulfillments ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE fulfillments ADD COLUMN override_reason TEXT;
ALTER TABLE fulfillments ADD COLUMN early INTEGER NOT NULL DEFAULT 0;

-- Earlier versions auto-assigned clubs from product names. Those were never verified: demote them to suggestions.
UPDATE stripe_products SET suggested_club_id = club_id, club_id = NULL, mapped_by = NULL, mapped_at = NULL
  WHERE mapped_by LIKE 'auto%';
UPDATE stripe_products SET relevance = 'club' WHERE club_id IS NOT NULL;
