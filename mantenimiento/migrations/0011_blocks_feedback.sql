-- Time blocks (Eric, 25 Nov 2026): Adrián blocks his own time on the calendar each week, with whatever name he wants
-- (Huerto, Compras...), so everyone sees when he has room. They do not repeat: he plans every week. Only admins write them.
CREATE TABLE IF NOT EXISTS blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id INTEGER REFERENCES providers(id) ON DELETE CASCADE,   -- whose time: the person's contact card
  day TEXT NOT NULL,                                                -- YYYY-MM-DD
  start_min INTEGER NOT NULL,                                       -- minutes after midnight
  end_min INTEGER NOT NULL,
  title TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS blocks_day ON blocks(day);

-- "¿Cuándo te conviene?": whoever reports can suggest a time; only admins put it on the calendar.
ALTER TABLE tasks ADD COLUMN when_ok TEXT;

-- Sugerencias para la app: ideas and problems sent from Mi cuenta, with the screen they came from.
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  screen TEXT,
  version TEXT,
  status TEXT NOT NULL DEFAULT 'nueva',                             -- 'nueva' | 'hecha' | 'no'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
ALTER TABLE photos ADD COLUMN feedback_id INTEGER REFERENCES feedback(id) ON DELETE CASCADE;
