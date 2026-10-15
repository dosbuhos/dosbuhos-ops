-- Correlates a guarded staff update with its audit/photo writes in one D1 transaction.
ALTER TABLE fulfillments ADD COLUMN last_change TEXT;
