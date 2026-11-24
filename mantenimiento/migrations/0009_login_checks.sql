-- Sign-in with the WhatsApp number and a password (Eric, 24 Nov 2026). An administrator registers each person; the app
-- gives a one-time code that is sent to them by WhatsApp and is good for 7 days. With it they choose their own
-- password (users.pin_hash / pin_salt, '' = none yet). The code is kept only as a hash.
ALTER TABLE users ADD COLUMN temp_hash TEXT;
ALTER TABLE users ADD COLUMN temp_salt TEXT;
ALTER TABLE users ADD COLUMN temp_until INTEGER;
-- Steps of a pendiente: lines of its description that are a numbered or bulleted list show as boxes to tick.
-- `checks` is a JSON array of the ticked step numbers (0-based, in the order the steps appear).
ALTER TABLE tasks ADD COLUMN checks TEXT;
