ALTER TABLE benefit_uses ADD COLUMN request_key TEXT;
CREATE UNIQUE INDEX benefit_request_key ON benefit_uses(request_key);
