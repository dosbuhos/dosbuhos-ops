-- Keep the person who served the member separate from the authenticated recorder.
-- Historical rows stay unknown: created_by alone does not prove who served them.
ALTER TABLE benefit_uses ADD COLUMN handled_by TEXT;
