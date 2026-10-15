-- Operational contact corrections survive Stripe synchronization.
ALTER TABLE members ADD COLUMN contact_email TEXT;
ALTER TABLE members ADD COLUMN contact_phone TEXT;
