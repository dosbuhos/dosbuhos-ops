ALTER TABLE fulfillments ADD COLUMN payment_blocked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE fulfillments ADD COLUMN payment_release_reason TEXT;
CREATE TABLE membership_review_commits (
  token TEXT PRIMARY KEY,
  checked INTEGER NOT NULL CHECK(checked=1),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TRIGGER blocked_payment_fulfillment BEFORE UPDATE OF status ON fulfillments
WHEN NEW.status IN ('needs_prep','ready','handed','shipped','delivered') AND NEW.status IS NOT OLD.status
AND NEW.payment_blocked=1 AND NEW.payment_release_reason IS NULL
AND (NEW.stripe_invoice_id IS NULL OR NEW.paid_on IS NULL)
BEGIN SELECT RAISE(ABORT,'Envío bloqueado por pago pendiente.'); END;
