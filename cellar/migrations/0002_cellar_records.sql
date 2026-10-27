-- Excellovint, moved into the app: one row per log line / work order, per lot tab.
-- Filled by a one-way import from the sheet (POST /api/xl/import); nothing writes back to the sheet.
CREATE TABLE IF NOT EXISTS xl_tabs (
  tab TEXT PRIMARY KEY,
  lote TEXT, vino TEXT,            -- from the tab's header block when present
  header_row INTEGER,
  imported_at INTEGER
);
CREATE TABLE IF NOT EXISTS xl_rows (
  tab TEXT NOT NULL,
  row INTEGER NOT NULL,            -- row number in the sheet at import time
  date TEXT,                       -- ISO YYYY-MM-DD when parseable
  date_raw TEXT,
  ubi TEXT, voli TEXT, volf TEXT,
  ph TEXT, bx TEXT, tp TEXT, at TEXT, am TEXT, sl TEXT, st TEXT, aa TEXT,
  note TEXT, pri TEXT, by_ TEXT, asig TEXT, ini TEXT,
  updated_at INTEGER,
  PRIMARY KEY (tab, row)
);
CREATE INDEX IF NOT EXISTS xl_rows_open ON xl_rows (asig, ini);
CREATE INDEX IF NOT EXISTS xl_rows_date ON xl_rows (date);
