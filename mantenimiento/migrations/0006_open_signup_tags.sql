-- Open sign-up (name + WhatsApp + email), coloured area tags, postponing with a record,
-- preventive plans by calendar month, photo previews for lists, app settings.
-- Applied to the remote database before the Worker that needs it is pushed.

-- A person is identified by the last 10 digits of their phone (so +52 / +1 / spaces don't matter).
ALTER TABLE users ADD COLUMN phone_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_key ON users(phone_key) WHERE phone_key IS NOT NULL;

-- Areas are shown as coloured tags (same 12 colour names as Horizonte).
ALTER TABLE areas ADD COLUMN color TEXT NOT NULL DEFAULT 'grey';
UPDATE areas SET color = CASE name
  WHEN 'Instalaciones' THEN 'grey'
  WHEN 'Jardín y huerta' THEN 'green'
  WHEN 'Restaurante' THEN 'orange'
  WHEN 'Bodega y cava' THEN 'red'
  WHEN 'Eventos' THEN 'pink'
  WHEN 'Hospedaje' THEN 'blue'
  WHEN 'Capilla / Contemplo' THEN 'purple'
  WHEN 'Viñedo' THEN 'teal'
  WHEN 'Oficina' THEN 'indigo'
  ELSE 'grey' END;

-- Postponing: how many times the date was pushed back, and the first date it was promised for.
ALTER TABLE tasks ADD COLUMN postponed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN first_due TEXT;
UPDATE tasks SET first_due = due_date WHERE due_date IS NOT NULL;

-- Preventive plans "N times a year": unit = 'months', months = '3,9' (March and September), day = day of the month.
ALTER TABLE pm_schedules ADD COLUMN months TEXT;
ALTER TABLE pm_schedules ADD COLUMN day INTEGER;

-- A small preview of each photo (about 10 KB) so lists load fast on a weak signal.
ALTER TABLE photos ADD COLUMN thumb BLOB;

-- App settings: signup_open ('1' anyone can sign up, '0' closed), coordinator (providers.id who gets the WhatsApp heads-up).
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
INSERT OR IGNORE INTO settings (key, value) VALUES ('signup_open', '1');
