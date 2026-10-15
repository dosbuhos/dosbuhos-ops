ALTER TABLE members ADD COLUMN payment_followup_on TEXT;
ALTER TABLE members ADD COLUMN payment_followup_reason TEXT;
ALTER TABLE members ADD COLUMN payment_followup_by TEXT;

-- A follow-up is not a suspension. Paid boxes remain available; unresolved boxes
-- cannot be handed over, dispatched, or put into preparation from a stale form.
CREATE TRIGGER payment_contact_fulfillment BEFORE UPDATE OF status ON fulfillments
WHEN NEW.status IN ('needs_prep','ready','handed','shipped','delivered') AND NEW.status IS NOT OLD.status
AND (NEW.stripe_invoice_id IS NULL OR NEW.paid_on IS NULL) AND NEW.payment_release_reason IS NULL
AND EXISTS(SELECT 1 FROM subscriptions s JOIN members m ON m.id=s.member_id WHERE s.id=NEW.subscription_id AND (m.payment_followup_on IS NOT NULL OR (s.stripe_subscription_id IS NOT NULL AND s.status IN ('past_due','unpaid','incomplete'))))
BEGIN SELECT RAISE(ABORT,'Contactar para nueva forma de pago: verifica el pago de esta caja antes de preparar o entregar.'); END;
CREATE TRIGGER payment_contact_fulfillment_insert BEFORE INSERT ON fulfillments
WHEN NEW.status IN ('needs_prep','ready','handed','shipped','delivered')
AND (NEW.stripe_invoice_id IS NULL OR NEW.paid_on IS NULL) AND NEW.payment_release_reason IS NULL
AND EXISTS(SELECT 1 FROM subscriptions s JOIN members m ON m.id=s.member_id WHERE s.id=NEW.subscription_id AND (m.payment_followup_on IS NOT NULL OR (s.stripe_subscription_id IS NOT NULL AND s.status IN ('past_due','unpaid','incomplete'))))
BEGIN SELECT RAISE(ABORT,'Contactar para nueva forma de pago: verifica el pago de esta caja antes de preparar o entregar.'); END;
