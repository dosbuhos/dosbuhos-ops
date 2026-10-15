ALTER TABLE members ADD COLUMN suspended_on TEXT;
ALTER TABLE members ADD COLUMN suspension_reason TEXT;
ALTER TABLE members ADD COLUMN suspension_by TEXT;
ALTER TABLE members ADD COLUMN membership_version INTEGER NOT NULL DEFAULT 0;

-- Enforce the block even if a fulfillment form was opened before suspension.
CREATE TRIGGER suspended_fulfillment_insert BEFORE INSERT ON fulfillments
WHEN NEW.status IN ('needs_prep','ready','handed','shipped','delivered')
AND EXISTS (SELECT 1 FROM subscriptions s JOIN members m ON m.id=s.member_id WHERE s.id=NEW.subscription_id AND m.suspended_on IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'Membresía suspendida: reactiva al socio antes de preparar o entregar.'); END;
CREATE TRIGGER suspended_fulfillment_update BEFORE UPDATE OF status ON fulfillments
WHEN NEW.status IN ('needs_prep','ready','handed','shipped','delivered') AND NEW.status IS NOT OLD.status
AND EXISTS (SELECT 1 FROM subscriptions s JOIN members m ON m.id=s.member_id WHERE s.id=NEW.subscription_id AND m.suspended_on IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'Membresía suspendida: reactiva al socio antes de preparar o entregar.'); END;
CREATE TRIGGER suspended_benefit_insert BEFORE INSERT ON benefit_uses
WHEN EXISTS (SELECT 1 FROM members WHERE id=NEW.member_id AND suspended_on IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'Membresía suspendida: reactiva al socio antes de registrar beneficios.'); END;
