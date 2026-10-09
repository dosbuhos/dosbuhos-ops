-- Muestras app · D1 schema
-- Holdings (what a rep should have) = received bottles − bottles disposed in submitted events + approved count adjustments.

CREATE TABLE IF NOT EXISTS reps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  zoho_customer_ids TEXT NOT NULL DEFAULT '[]',   -- JSON array of Zoho contact ids used for samples
  sync_from TEXT NOT NULL DEFAULT '2026-07-10',   -- only Zoho orders on/after this date are imported
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS wines (
  item_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sku TEXT,
  price REAL NOT NULL DEFAULT 0          -- list price (MXN, before tax) used for bottle value
);

-- One row per Zoho sales-order line at 0.00/0.01 (a "pull").
CREATE TABLE IF NOT EXISTS pulls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rep_id INTEGER NOT NULL REFERENCES reps(id),
  so_id TEXT NOT NULL,
  so_number TEXT NOT NULL,
  so_date TEXT NOT NULL,
  line_id TEXT NOT NULL UNIQUE,
  item_id TEXT,
  wine TEXT NOT NULL,
  qty INTEGER NOT NULL,
  kind TEXT NOT NULL,                    -- 'envio' (new bottles to the rep) | 'consumo' (recorded use of bottles he already held)
  delivery TEXT,
  terms TEXT,
  event_id INTEGER REFERENCES events(id),
  imported_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS pulls_rep ON pulls(rep_id);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rep_id INTEGER NOT NULL REFERENCES reps(id),
  source TEXT NOT NULL,                  -- 'zoho' | 'app'
  so_number TEXT,
  kind TEXT NOT NULL DEFAULT 'evento',   -- 'evento' | 'reposicion' (stock sent to the rep, no report needed)
  name TEXT NOT NULL,
  event_date TEXT NOT NULL,
  zoho_terms TEXT,
  status TEXT NOT NULL DEFAULT 'abierto', -- abierto | enviado | devuelto | aprobado
  report TEXT NOT NULL DEFAULT '{}',     -- JSON: basics, audience, results, feedback, costs, return
  submitted_at TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS events_rep ON events(rep_id, status);

CREATE TABLE IF NOT EXISTS event_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id),
  item_id TEXT,
  wine TEXT NOT NULL,
  qty INTEGER NOT NULL,                  -- bottles this event has to account for
  received INTEGER NOT NULL DEFAULT 0,   -- 1 if these bottles were new to the rep (envio), 0 if taken from his stock
  poured INTEGER NOT NULL DEFAULT 0,
  gifted INTEGER NOT NULL DEFAULT 0,
  gifted_to TEXT,
  sold INTEGER NOT NULL DEFAULT 0,
  sold_to TEXT,
  returned INTEGER NOT NULL DEFAULT 0,
  broken INTEGER NOT NULL DEFAULT 0,
  kept INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS lines_event ON event_lines(event_id);

CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rep_id INTEGER NOT NULL,
  event_id INTEGER,
  count_id INTEGER,
  kind TEXT NOT NULL,                    -- montaje | botellas | rotas | otra | conteo
  r2_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rep_id INTEGER NOT NULL,
  event_id INTEGER,
  name TEXT NOT NULL,
  business TEXT,
  contact TEXT,
  next_step TEXT,
  due TEXT,
  done INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS placements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  account TEXT NOT NULL,
  wine TEXT,
  kind TEXT                               -- copeo | carta | anaquel
);

CREATE TABLE IF NOT EXISTS counts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rep_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'mensual',  -- 'inicial' | 'mensual'
  status TEXT NOT NULL DEFAULT 'enviado',-- enviado | aprobado | devuelto
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_note TEXT
);
CREATE TABLE IF NOT EXISTS count_lines (
  count_id INTEGER NOT NULL,
  wine TEXT NOT NULL,
  item_id TEXT,
  expected INTEGER NOT NULL,
  counted INTEGER NOT NULL
);

-- Holdings corrections. Created when ops approves a count (counted − expected).
CREATE TABLE IF NOT EXISTS adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rep_id INTEGER NOT NULL,
  wine TEXT NOT NULL,
  qty INTEGER NOT NULL,
  reason TEXT,
  count_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at TEXT NOT NULL DEFAULT (datetime('now')),
  ok INTEGER NOT NULL,
  message TEXT
);

CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  who TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT
);

CREATE TABLE IF NOT EXISTS photo_blobs (key TEXT PRIMARY KEY, type TEXT, data BLOB NOT NULL, created_at TEXT DEFAULT (datetime('now')));
